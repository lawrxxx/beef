import type { AuditLog, PriceSnapshot, Settlement, SettlementEvidence } from "@/lib/types";
import { nextCloseAfter, resolveEndSession, sessionCloseUtc } from "@/lib/market/calendar";
import type { ReferencePrice } from "@/lib/chainlink/prices";
import { UNEXPLAINED_MOVE_PCT } from "@/lib/chainlink/config";
import { priceNumber } from "@/lib/chainlink/report";
import { buildSettlement, compareReturns, returnE6, type EngineInput } from "./engine";

// server-side settlement service. the browser never decides a winner: it can only ask
// this service to lock or settle, and the service gets its own prices from chainlink.
// any doubt about the data pauses settlement ("needs_verification"); nothing is guessed.

export interface SettleableDuel {
  id: string;
  status: string;
  participants: { userId: string; ticker: string }[];
  /** when the final participant accepted (iso utc) */
  acceptedAt: string;
  /** agreed deadline (iso utc) */
  deadline: string;
  /** starting snapshots locked at activation (immutable once written) */
  startSnapshots?: PriceSnapshot[];
}

/** where reference prices come from (ChainlinkPrices implements it) */
export interface ReferenceOracle {
  reference(ticker: string, session: string, closeUtc: Date): Promise<ReferencePrice>;
  /** total-return prices already reflect splits and dividends: recorded corporate actions aren't applied again */
  readonly totalReturn: boolean;
  readonly methodology: { id: string };
}

/** a recorded split / reverse split: shares after = shares before × num / den */
export interface CorporateAction { ticker: string; session: string; ratioNum: number; ratioDen: number }

export interface SettlementRepository {
  getSettlement(duelId: string): Promise<Settlement | null>;
  /** must be atomic: returns false if a settlement for this duel already exists */
  insertSettlementIfAbsent(s: Settlement): Promise<boolean>;
  appendAudit(log: Omit<AuditLog, "id">): Promise<void>;
  listAudit(duelId: string): Promise<AuditLog[]>;
  /** corporate actions effective after `from` and up to and including `to` */
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

export const SOURCE = "chainlink-data-streams";

export function lockSessionFor(acceptedAt: string): string {
  return nextCloseAfter(new Date(acceptedAt));
}

function snapshotOf(r: ReferencePrice, kind: "start" | "end"): PriceSnapshot {
  const p = r.price!;
  return {
    ticker: r.ticker, kind, price: priceNumber(p.mid), priceE18: p.mid.toString(), session: r.session,
    timestamp: new Date(r.referenceTimestamp * 1000).toISOString(), source: SOURCE, simulated: false,
    streamId: p.streamId, observationsTimestamp: p.observationsTimestamp, marketStatus: p.marketStatus ?? undefined, reportHash: p.reportHash, roundId: p.roundId,
    verification: r.verification ? { status: r.verification.status, method: r.verification.method, verifier: r.verification.verifier, configDigest: r.verification.configDigest, checkedAt: r.verification.checkedAt } : undefined,
  };
}

const evidenceOf = (s: PriceSnapshot): SettlementEvidence => ({
  ticker: s.ticker, kind: s.kind, streamId: s.streamId!, observationsTimestamp: s.observationsTimestamp!, marketStatus: s.marketStatus ?? null,
  midE18: s.priceE18!, reportHash: s.reportHash!, roundId: s.roundId, verification: s.verification?.status ?? "none",
});

/** a stored start snapshot is usable only if it came from a verified chainlink report for the lock session */
function validStoredStart(s: PriceSnapshot | undefined, lockSession: string): s is PriceSnapshot {
  return !!s && s.source === SOURCE && s.session === lockSession && !!s.priceE18 && BigInt(s.priceE18) > 0n
    && !!s.streamId && !!s.reportHash && (s.verification?.status === "verified" || s.verification?.status === "onchain");
}

export interface LockResult { ok: boolean; lockSession: string; lockAt: string; snapshots: PriceSnapshot[]; issues: string[] }

/** records starting prices at the first official close after everyone joined */
export async function lockStartPrices(duel: SettleableDuel, oracle: ReferenceOracle, now: Date): Promise<LockResult> {
  const lockSession = lockSessionFor(duel.acceptedAt);
  const close = sessionCloseUtc(lockSession);
  const lockAt = close.toISOString();
  if (now.getTime() < close.getTime()) return { ok: false, lockSession, lockAt, snapshots: [], issues: ["waiting for the market close that locks starting prices"] };
  const refs = await Promise.all(duel.participants.map((p) => oracle.reference(p.ticker, lockSession, close)));
  const issues = refs.flatMap((r) => r.problems);
  return { ok: issues.length === 0, lockSession, lockAt, snapshots: issues.length ? [] : refs.map((r) => snapshotOf(r, "start")), issues };
}

export type SettleOutcome =
  | { outcome: "settled"; settlement: Settlement; endSnapshots: PriceSnapshot[]; startSnapshots: PriceSnapshot[] }
  | { outcome: "already_settled"; settlement: Settlement }
  | { outcome: "needs_verification"; settlement: Settlement }
  | { outcome: "not_due"; dueAt: string }
  | { outcome: "rejected"; reason: string };

/**
 * idempotent settlement:
 * 1 deadline reached · 2 starting prices = the locked snapshots (or the same rule, if missing)
 * 3 ending prices from chainlink at the end reference time · 4 integrity (chainlink verifier),
 * stream, status, freshness and quote checks · 5 split adjustment from recorded corporate actions
 * 6 bigint returns · 7 compare · 8 record once (insert-if-absent).
 */
export async function settleDuel(duel: SettleableDuel, oracle: ReferenceOracle, repo: SettlementRepository, now: Date): Promise<SettleOutcome> {
  const existing = await repo.getSettlement(duel.id);
  if (existing && existing.status !== "needs_verification") {
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.skipped", detail: "already settled, returning stored result" });
    return { outcome: "already_settled", settlement: existing };
  }
  if (!["active", "awaiting_verification"].includes(duel.status)) return { outcome: "rejected", reason: `duel is ${duel.status}, only active duels can settle` };
  if (duel.participants.length < 2) return { outcome: "rejected", reason: "not enough participants" };

  const lockSession = lockSessionFor(duel.acceptedAt);
  const endSession = resolveEndSession(new Date(duel.deadline), lockSession);
  const startClose = sessionCloseUtc(lockSession), endClose = sessionCloseUtc(endSession);
  const window = { startSession: lockSession, endSession, startTimestamp: Math.floor(startClose.getTime() / 1000) - 1, endTimestamp: Math.floor(endClose.getTime() / 1000) - 1 };
  if (now.getTime() < endClose.getTime()) return { outcome: "not_due", dueAt: endClose.toISOString() };

  await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.start", detail: `${oracle.methodology.id}: ${lockSession} ${window.startTimestamp} → ${endSession} ${window.endTimestamp}` });

  const issues: string[] = [];
  const startSnapshots: PriceSnapshot[] = [];
  const endSnapshots: PriceSnapshot[] = [];
  const inputs: EngineInput[] = [];

  for (const p of duel.participants) {
    const stored = duel.startSnapshots?.find((s) => s.ticker === p.ticker && s.kind === "start");
    let start: PriceSnapshot;
    if (validStoredStart(stored, lockSession)) start = stored;
    else {
      const r = await oracle.reference(p.ticker, lockSession, startClose);
      if (!r.ok) { issues.push(...r.problems); continue; }
      start = snapshotOf(r, "start");
    }
    const endRef = await oracle.reference(p.ticker, endSession, endClose);
    if (!endRef.ok) { issues.push(...endRef.problems); continue; }
    const end = snapshotOf(endRef, "end");
    if (start.streamId !== end.streamId) { issues.push(`${p.ticker}: start and end prices came from different streams`); continue; }

    // splits: express the starting price on the ending share basis, exactly
    const actions = oracle.totalReturn ? [] : await repo.corporateActions(p.ticker, lockSession, endSession);
    let num = 1n, den = 1n;
    for (const a of actions) { num *= BigInt(a.ratioNum); den *= BigInt(a.ratioDen); }
    const startE18 = BigInt(start.priceE18!);
    const adjusted = (startE18 * den) / num;
    if (num !== den) {
      start = { ...start, adjustedE18: adjusted.toString(), adjustedPrice: priceNumber(adjusted) };
      await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.adjust", detail: `${p.ticker} corporate action ×${num}/${den}: start ${start.priceE18} → ${adjusted}` });
    }
    // a huge move with no recorded corporate action may be an unrecorded split: don't guess
    const r6 = returnE6(adjusted, BigInt(end.priceE18!));
    const absPct = (r6 < 0n ? -r6 : r6) / 1_000_000n;
    if (absPct >= BigInt(UNEXPLAINED_MOVE_PCT) && (oracle.totalReturn || actions.length === 0)) {
      issues.push(oracle.totalReturn
        ? `${p.ticker}: moved ${Number(r6) / 1e6}%, an unusually large move; needs a manual check before paying out`
        : `${p.ticker}: moved ${Number(r6) / 1e6}% with no recorded corporate action (possible split); needs a manual check`);
      continue;
    }
    startSnapshots.push(start);
    endSnapshots.push(end);
    inputs.push({ userId: p.userId, ticker: p.ticker, startE18: adjusted, endE18: BigInt(end.priceE18!) });
  }

  const meta = { source: SOURCE, simulated: false, methodology: oracle.methodology.id, startSession: lockSession, endSession, settledAt: now.toISOString(), window };

  if (issues.length) {
    const pending: Settlement = {
      duelId: duel.id, status: "needs_verification", winners: [], marginPct: 0, entries: [],
      explanation: "settlement is paused because the chainlink price data couldn't be fully verified yet. no winner has been declared.",
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
