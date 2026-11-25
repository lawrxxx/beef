import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLog, Settlement } from "@/lib/types";
import type { SettlementRepository } from "@/lib/settlement/service";

// postgres-backed settlement repository. idempotency comes from the unique
// constraint on duel_settlements.duel_id: a second insert fails with 23505.
export class SupabaseSettlementRepository implements SettlementRepository {
  constructor(private db: SupabaseClient) {}

  async getSettlement(duelId: string): Promise<Settlement | null> {
    const { data } = await this.db.from("duel_settlements").select("payload").eq("duel_id", duelId).maybeSingle();
    return (data?.payload as Settlement) ?? null;
  }

  async insertSettlementIfAbsent(s: Settlement): Promise<boolean> {
    const { error } = await this.db.from("duel_settlements").insert({
      duel_id: s.duelId,
      status: s.status,
      winner_ids: s.winners,
      winning_ticker: s.winningTicker ?? null,
      margin_pct: s.marginPct,
      calculation_version: s.calculationVersion,
      methodology: s.methodology,
      source: s.source,
      simulated: s.simulated,
      start_session: s.startSession,
      end_session: s.endSession,
      explanation: s.explanation,
      payload: s,
      settled_at: s.settledAt,
    });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  }

  async appendAudit(log: Omit<AuditLog, "id">): Promise<void> {
    await this.db.from("settlement_audit_logs").insert({ duel_id: log.duelId, at: log.at, action: log.action, detail: log.detail });
  }

  async listAudit(duelId: string): Promise<AuditLog[]> {
    const { data } = await this.db.from("settlement_audit_logs").select("*").eq("duel_id", duelId).order("at");
    return (data ?? []).map((r: any) => ({ id: String(r.id), duelId: r.duel_id, at: r.at, action: r.action, detail: r.detail }));
  }
}
