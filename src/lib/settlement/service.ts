import type { AuditLog, PriceSnapshot, Settlement, SettlementEvidence } from "@/lib/types";
import { sessionDateOf } from "@/lib/market/calendar";
import { startOpenFor } from "@/lib/expiration";
import type { Observation } from "@/lib/chainlink/feeds";
import { UNEXPLAINED_MOVE_PCT } from "@/lib/chainlink/config";
import { priceNumber } from "@/lib/chainlink/report";
import { buildSettlement, compareReturns, returnE6, type EngineInput } from "./engine";

// server-side settlement service. the browser never decides a winner: it can only ask
// this service to lock or settle, and the service reads its own prices from chainlink.
// any doubt about the data pauses settlement ("needs_verification"); nothing is guessed.
//
// timing: starting prices at `startAt` (the first market open after activation), ending
// prices at `deadline`. each is the first chainlink feed round at or after that time,
// within the max delay. both stocks use the same two times and the same rule.

export interface SettleableDuel {
  id: string;
  status: string;
  participants: { userId: string; ticker: string }[];
  /** when the final participant accepted (iso utc) */
  acceptedAt: string;
  /** agreed start: the market open after activation (iso utc). older duels derive it from acceptedAt */
  startAt?: string;
  /** agreed deadline (iso utc) */
  deadline: string;
  /** starting snapshots locked at activation (immutable once written) */
  startSnapshots?: PriceSnapshot[];
}

/** where observations come from (ChainlinkFeedPrices implements it) */
export interface PriceObserver {
  observe(ticker: string, at: Date, maxDelayS?: number): Promise<Observation>;
  readonly methodology: { id: string };
}

/** a recorded split / reverse split (kept for records; feeds are total-return and already include them) */
export interface CorporateAction { ticker: string; session: string; ratioNum: number; ratioDen: number }

export interface SettlementRepository {
  getSettlement(duelId: string): Promise<Settlement | null>;
  /** must be atomic: returns false if a settlement for this duel already exists */
  insertSettlementIfAbsent(s: Settlement): Promise<boolean>;
  appendAudit(log: Omit<AuditLog, "id">): Promise<void>;
  listAudit(duelId: string): Promise<AuditLog[]>;
  corporateActions(ticker: string, from: string, to: string): Promise<CorporateAction[]>;
}

export class InMemorySettlementRepository implements SettlementRepository {
  private settlements = new Map<string, Settlement>();
  private audits: AuditLog[] = [];
  private seq = 0;
  constructor(public actions: CorporateAction[] = []) {}
  async getSettlement(id: string) { return this.settlements.get(id) ?? null; }
  async insertSettlementIfAbsent(s: Settlement) {
    if (this.settlements.has(s.duelId)) return false;
    this.settlements.set(s.duelId, s);
    return true;
  }
  async appendAudit(log: Omit<AuditLog, "id">) { this.audits.push({ ...log, id: `aud_${++this.seq}` }); }
  async listAudit(id: string) { return this.audits.filter((a) => a.duelId === id); }
  async corporateActions(t: string, from: string, to: string) { return this.actions.filter((a) => a.ticker === t && a.session > from && a.session <= to); }
}

export const SOURCE = "chainlink-data-feeds";

/** the agreed start for a duel (stored, or derived the same way for duels from before it was stored) */
export const startAtOf = (duel: SettleableDuel) => new Date(duel.startAt ?? startOpenFor(new Date(duel.acceptedAt)).toISOString());

function snapshotOf(o: Observation, kind: "start" | "end"): PriceSnapshot {
  const p = o.price!;
  return {
    ticker: o.ticker, kind, price: priceNumber(p.mid), priceE18: p.mid.toString(), session: sessionDateOf(new Date(o.at)),
    timestamp: o.at, source: SOURCE, simulated: false,
    streamId: p.streamId, observationsTimestamp: p.observationsTimestamp, reportHash: p.reportHash, roundId: p.roundId,
    answer: o.answer, decimals: o.decimals, readBlock: o.readBlock ?? undefined,
    verification: o.verification ? { status: o.verification.status, method: o.verification.method, verifier: o.verification.verifier, configDigest: o.verification.configDigest, checkedAt: o.verification.checkedAt } : undefined,
  };
}

const evidenceOf = (s: PriceSnapshot): SettlementEvidence => ({
  ticker: s.ticker, kind: s.kind, streamId: s.streamId!, observationsTimestamp: s.observationsTimestamp!, marketStatus: s.marketStatus ?? null,
  midE18: s.priceE18!, reportHash: s.reportHash!, roundId: s.roundId, verification: s.verification?.status ?? "none",
});

/** a stored start snapshot counts only if it's a chainlink feed observation for this duel's agreed start */
function validStoredStart(s: PriceSnapshot | undefined, startAt: Date): s is PriceSnapshot {
  return !!s && s.source === SOURCE && new Date(s.timestamp).getTime() === startAt.getTime() && !!s.priceE18 && BigInt(s.priceE18) > 0n
    && !!s.streamId && !!s.reportHash && s.verification?.status === "onchain";
}

export interface LockResult { ok: boolean; pending: boolean; startAt: string; snapshots: PriceSnapshot[]; issues: string[] }

/** records starting prices: the first feed round at or after the agreed start for every stock */
export async function lockStartPrices(duel: SettleableDuel, observer: PriceObserver, now: Date): Promise<LockResult> {
  const startAt = startAtOf(duel);
  if (now.getTime() < startAt.getTime()) return { ok: false, pending: true, startAt: startAt.toISOString(), snapshots: [], issues: ["waiting for the market open that locks starting prices"] };
  const obs = await Promise.all(duel.participants.map((p) => observer.observe(p.ticker, startAt)));
  if (obs.some((o) => o.status === "pending") && !obs.some((o) => o.status === "failed")) {
    return { ok: false, pending: true, startAt: startAt.toISOString(), snapshots: [], issues: obs.flatMap((o) => o.problems) };
  }
  const issues = obs.flatMap((o) => (o.status === "ok" ? [] : o.problems));
  return { ok: issues.length === 0, pending: false, startAt: startAt.toISOString(), snapshots: issues.length ? [] : obs.map((o) => snapshotOf(o, "start")), issues };
}

export type SettleOutcome =
  | { outcome: "settled"; settlement: Settlement; endSnapshots: PriceSnapshot[]; startSnapshots: PriceSnapshot[] }
  | { outcome: "already_settled"; settlement: Settlement }
  | { outcome: "needs_verification"; settlement: Settlement }
  | { outcome: "not_due"; dueAt: string; reason?: string }
  | { outcome: "rejected"; reason: string };

/**
 * idempotent settlement:
 * 1 deadline reached · 2 starting prices = the locked snapshots (or the same rule, if missing)
 * 3 ending prices = first feed round at or after the deadline, within the max delay, for every stock
 * 4 same-window and validity checks · 5 bigint returns · 6 compare · 7 record once (insert-if-absent)
 */
export async function settleDuel(duel: SettleableDuel, observer: PriceObserver, repo: SettlementRepository, now: Date): Promise<SettleOutcome> {
  const existing = await repo.getSettlement(duel.id);
  if (existing && existing.status !== "needs_verification") {
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.skipped", detail: "already settled, returning stored result" });
    return { outcome: "already_settled", settlement: existing };
  }
  if (!["active", "awaiting_verification"].includes(duel.status)) return { outcome: "rejected", reason: `duel is ${duel.status}, only active duels can settle` };
  if (duel.participants.length < 2) return { outcome: "rejected", reason: "not enough participants" };

  const startAt = startAtOf(duel);
  const deadline = new Date(duel.deadline);
  if (deadline.getTime() <= startAt.getTime()) return { outcome: "rejected", reason: "the deadline isn't after the start" };
  if (now.getTime() < deadline.getTime()) return { outcome: "not_due", dueAt: deadline.toISOString() };

  const window = { startSession: sessionDateOf(startAt), endSession: sessionDateOf(deadline), startTimestamp: Math.floor(startAt.getTime() / 1000), endTimestamp: Math.floor(deadline.getTime() / 1000) };
  const issues: string[] = [];
  const startSnapshots: PriceSnapshot[] = [];
  const endSnapshots: PriceSnapshot[] = [];
  const inputs: EngineInput[] = [];

  // ending observations first: if any is still pending, wait without recording anything
  const ends = await Promise.all(duel.participants.map((p) => observer.observe(p.ticker, deadline)));
  if (ends.some((o) => o.status === "pending") && !ends.some((o) => o.status === "failed")) {
    return { outcome: "not_due", dueAt: deadline.toISOString(), reason: ends.flatMap((o) => o.problems).join("; ") };
  }
  await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.start", detail: `${observer.methodology.id}: start ${startAt.toISOString()} → end ${deadline.toISOString()}` });

  for (const [i, p] of duel.participants.entries()) {
    const stored = duel.startSnapshots?.find((s) => s.ticker === p.ticker && s.kind === "start");
    let start: PriceSnapshot;
    if (validStoredStart(stored, startAt)) start = stored;
    else {
      const o = await observer.observe(p.ticker, startAt);
      if (o.status !== "ok") { issues.push(...o.problems); continue; }
      start = snapshotOf(o, "start");
    }
    const e = ends[i];
    if (e.status !== "ok") { issues.push(...e.problems); continue; }
    const end = snapshotOf(e, "end");
    if (start.streamId !== end.streamId) { issues.push(`${p.ticker}: start and end came from different feeds`); continue; }
    const r6 = returnE6(BigInt(start.priceE18!), BigInt(end.priceE18!));
    const absPct = (r6 < 0n ? -r6 : r6) / 1_000_000n;
    if (absPct >= BigInt(UNEXPLAINED_MOVE_PCT)) { issues.push(`${p.ticker}: moved ${Number(r6) / 1e6}%, an unusually large move; needs a manual check before paying out`); continue; }
    startSnapshots.push(start);
    endSnapshots.push(end);
    inputs.push({ userId: p.userId, ticker: p.ticker, startE18: BigInt(start.priceE18!), endE18: BigInt(end.priceE18!) });
  }

  // same agreed window for every stock: each observation sits inside [agreed time, agreed time + max delay]
  if (!issues.length) {
    const ok = (snaps: PriceSnapshot[], at: number) => snaps.every((s) => (s.observationsTimestamp ?? -1) >= at);
    if (!ok(startSnapshots, window.startTimestamp) || !ok(endSnapshots, window.endTimestamp)) issues.push("an observation falls outside the agreed resolution window");
  }

  const meta = { source: SOURCE, simulated: false, methodology: observer.methodology.id, startSession: window.startSession, endSession: window.endSession, settledAt: now.toISOString(), window };

  if (issues.length) {
    const pending: Settlement = {
      duelId: duel.id, status: "needs_verification", winners: [], marginPct: 0, entries: [],
      explanation: "settlement is paused because a chainlink price was missing, late or invalid. no winner has been declared.",
      calculationVersion: "pct-return-v2", ...meta, issues,
    };
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.paused", detail: issues.join("; ") });
    return { outcome: "needs_verification", settlement: pending };
  }

  const result = compareReturns(inputs);
  const settlement = buildSettlement(duel.id, result, { ...meta, evidence: [...startSnapshots, ...endSnapshots].map(evidenceOf) });
  if (!(await repo.insertSettlementIfAbsent(settlement))) {
    const stored = (await repo.getSettlement(duel.id))!;
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.race", detail: "concurrent settlement detected, kept the first stored result" });
    return { outcome: "already_settled", settlement: stored };
  }
  await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.recorded", detail: `${result.status}: ${result.explanation}` });
  return { outcome: "settled", settlement, startSnapshots, endSnapshots };
}
