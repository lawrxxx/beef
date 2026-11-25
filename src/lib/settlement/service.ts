import type { AuditLog, ClosePrice, PriceSnapshot, Settlement } from "@/lib/types";
import type { MarketDataProvider } from "@/lib/market/provider";
import { nextCloseAfter, resolveEndSession, sessionCloseUtc } from "@/lib/market/calendar";
import { buildSettlement, compareReturns } from "./engine";

// server-side settlement service. the browser never decides a winner: it can only
// ask this service to lock or settle, and the service fetches its own prices.

export interface SettleableDuel {
  id: string;
  status: string;
  participants: { userId: string; ticker: string }[];
  /** when the final participant accepted (iso utc) */
  acceptedAt: string;
  /** agreed deadline (iso utc) */
  deadline: string;
}

export interface SettlementRepository {
  getSettlement(duelId: string): Promise<Settlement | null>;
  /** must be atomic: returns false if a settlement for this duel already exists */
  insertSettlementIfAbsent(s: Settlement): Promise<boolean>;
  appendAudit(log: Omit<AuditLog, "id">): Promise<void>;
  listAudit(duelId: string): Promise<AuditLog[]>;
}

export class InMemorySettlementRepository implements SettlementRepository {
  private settlements = new Map<string, Settlement>();
  private audits: AuditLog[] = [];
  private seq = 0;
  async getSettlement(id: string) { return this.settlements.get(id) ?? null; }
  async insertSettlementIfAbsent(s: Settlement) {
    if (this.settlements.has(s.duelId)) return false;
    this.settlements.set(s.duelId, s);
    return true;
  }
  async appendAudit(log: Omit<AuditLog, "id">) {
    this.audits.push({ ...log, id: `aud_${++this.seq}` });
  }
  async listAudit(id: string) { return this.audits.filter((a) => a.duelId === id); }
}

function validateClose(c: ClosePrice, now: Date): string | null {
  if (c.status === "halted") return `${c.ticker}: trading halted on ${c.session}`;
  if (c.status === "missing") return `${c.ticker}: no official close available for ${c.session}`;
  if (c.status === "invalid") return `${c.ticker}: invalid price data for ${c.session}`;
  if (!(c.close > 0) || !Number.isFinite(c.close)) return `${c.ticker}: non-positive close on ${c.session}`;
  const expected = sessionCloseUtc(c.session).toISOString();
  if (c.timestamp !== expected) return `${c.ticker}: timestamp ${c.timestamp} does not match the official close ${expected}`;
  if (new Date(c.timestamp).getTime() > now.getTime()) return `${c.ticker}: close for ${c.session} is in the future`;
  return null;
}

export function lockSessionFor(acceptedAt: string): string {
  return nextCloseAfter(new Date(acceptedAt));
}

export interface LockResult {
  ok: boolean;
  lockSession: string;
  lockAt: string;
  snapshots: PriceSnapshot[];
  issues: string[];
}

/** records starting prices at the first official close after both sides accepted */
export async function lockStartPrices(
  duel: SettleableDuel, provider: MarketDataProvider, now: Date,
): Promise<LockResult> {
  const lockSession = lockSessionFor(duel.acceptedAt);
  const lockAt = sessionCloseUtc(lockSession).toISOString();
  if (now.getTime() < new Date(lockAt).getTime()) {
    return { ok: false, lockSession, lockAt, snapshots: [], issues: ["waiting for the market close that locks starting prices"] };
  }
  const issues: string[] = [];
  const snapshots: PriceSnapshot[] = [];
  for (const p of duel.participants) {
    const c = await provider.getClose(p.ticker, lockSession);
    const err = validateClose(c, now);
    if (err) issues.push(err);
    else snapshots.push({
      ticker: p.ticker, kind: "start", price: c.close, session: c.session,
      timestamp: c.timestamp, source: c.source, simulated: c.simulated,
    });
  }
  return { ok: issues.length === 0, lockSession, lockAt, snapshots: issues.length ? [] : snapshots, issues };
}

export type SettleOutcome =
  | { outcome: "settled"; settlement: Settlement; endSnapshots: PriceSnapshot[]; startSnapshots: PriceSnapshot[] }
  | { outcome: "already_settled"; settlement: Settlement }
  | { outcome: "needs_verification"; settlement: Settlement }
  | { outcome: "not_due"; dueAt: string }
  | { outcome: "rejected"; reason: string };

/**
 * idempotent settlement.
 * 1 deadline reached · 2 fetch ending closes · 3 validate source · 4 verify timestamps
 * 5 apply split adjustments · 6 calculate returns · 7 compare · 8 decide
 * 9 record (insert-if-absent) · 10 status update + 11 notifications happen in the caller.
 */
export async function settleDuel(
  duel: SettleableDuel, provider: MarketDataProvider, repo: SettlementRepository, now: Date,
): Promise<SettleOutcome> {
  const existing = await repo.getSettlement(duel.id);
  if (existing && existing.status !== "needs_verification") {
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.skipped", detail: "already settled, returning stored result" });
    return { outcome: "already_settled", settlement: existing };
  }
  if (!["active", "awaiting_verification"].includes(duel.status)) {
    return { outcome: "rejected", reason: `duel is ${duel.status}, only active duels can settle` };
  }
  if (duel.participants.length < 2) return { outcome: "rejected", reason: "not enough participants" };

  const lockSession = lockSessionFor(duel.acceptedAt);
  const endSession = resolveEndSession(new Date(duel.deadline), lockSession);
  const dueAt = sessionCloseUtc(endSession).toISOString();
  if (now.getTime() < new Date(dueAt).getTime()) return { outcome: "not_due", dueAt };

  await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.start", detail: `window ${lockSession} → ${endSession} via ${provider.id}` });

  const issues: string[] = [];
  const startSnapshots: PriceSnapshot[] = [];
  const endSnapshots: PriceSnapshot[] = [];
  const inputs: { userId: string; ticker: string; startPrice: number; endPrice: number }[] = [];

  for (const p of duel.participants) {
    const [s, e] = await Promise.all([provider.getClose(p.ticker, lockSession), provider.getClose(p.ticker, endSession)]);
    const errs = [validateClose(s, now), validateClose(e, now)].filter(Boolean) as string[];
    if (s.source !== provider.id || e.source !== provider.id) errs.push(`${p.ticker}: price source mismatch`);
    if (errs.length) { issues.push(...errs); continue; }

    // split adjustment: express the starting price on the ending share basis
    const actions = await provider.getCorporateActions(p.ticker, lockSession, endSession);
    const factor = actions.filter((a) => a.type === "split").reduce((f, a) => f * a.ratio, 1);
    const adjustedStart = Math.round((s.close / factor) * 1e6) / 1e6;
    if (factor !== 1) {
      await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.adjust", detail: `${p.ticker} split ×${factor}: start ${s.close} → ${adjustedStart}` });
    }

    startSnapshots.push({ ticker: p.ticker, kind: "start", price: s.close, adjustedPrice: factor !== 1 ? adjustedStart : undefined, session: s.session, timestamp: s.timestamp, source: s.source, simulated: s.simulated });
    endSnapshots.push({ ticker: p.ticker, kind: "end", price: e.close, session: e.session, timestamp: e.timestamp, source: e.source, simulated: e.simulated });
    inputs.push({ userId: p.userId, ticker: p.ticker, startPrice: adjustedStart, endPrice: e.close });
  }

  const meta = { source: provider.id, simulated: provider.simulated, startSession: lockSession, endSession, settledAt: now.toISOString() };

  if (issues.length) {
    // never silently declare a winner without reliable data
    const pending: Settlement = {
      duelId: duel.id, status: "needs_verification", winners: [], marginPct: 0, entries: [],
      explanation: "settlement is paused because reliable price data is not available yet. no winner has been declared.",
      calculationVersion: "pct-return-v1", methodology: "percent_return_official_close", ...meta, issues,
    };
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.paused", detail: issues.join("; ") });
    return { outcome: "needs_verification", settlement: pending };
  }

  const result = compareReturns(inputs);
  const settlement = buildSettlement(duel.id, result, meta);
  const inserted = await repo.insertSettlementIfAbsent(settlement);
  if (!inserted) {
    const stored = (await repo.getSettlement(duel.id))!;
    await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.race", detail: "concurrent settlement detected, kept the first stored result" });
    return { outcome: "already_settled", settlement: stored };
  }
  await repo.appendAudit({ duelId: duel.id, at: now.toISOString(), action: "settle.recorded", detail: `${result.status}: ${result.explanation}` });
  return { outcome: "settled", settlement, startSnapshots, endSnapshots };
}
