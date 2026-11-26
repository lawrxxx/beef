import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceSnapshot, Settlement } from "@/lib/types";
import type { SettleableDuel } from "@/lib/settlement/service";

/** loads a duel from postgres in the shape the settlement service needs */
export async function loadSettleableDuel(db: SupabaseClient, duelId: string): Promise<SettleableDuel | null> {
  const { data: d } = await db.from("duels").select("id,status,deadline,start_at").eq("id", duelId).maybeSingle();
  if (!d) return null;
  const { data: ps } = await db.from("duel_participants").select("user_id,ticker,accepted_at").eq("duel_id", duelId);
  if (!ps?.length) return null;
  const acceptedAt = ps.map((p: any) => p.accepted_at).filter(Boolean).sort().at(-1);
  if (!acceptedAt) return null;
  const { data: snaps } = await db.from("duel_price_snapshots").select("*").eq("duel_id", duelId).eq("kind", "start");
  return {
    id: d.id, status: d.status, deadline: new Date(d.deadline).toISOString(),
    acceptedAt: new Date(acceptedAt).toISOString(), startAt: d.start_at ? new Date(d.start_at).toISOString() : undefined,
    participants: ps.map((p: any) => ({ userId: p.user_id, ticker: p.ticker })),
    startSnapshots: (snaps ?? []).map((r: any): PriceSnapshot => ({
      ticker: r.ticker, kind: r.kind, price: Number(r.price), priceE18: r.price_e18 != null ? String(r.price_e18) : undefined,
      session: r.session, timestamp: new Date(r.price_timestamp).toISOString(), source: r.source, simulated: r.simulated,
      streamId: r.stream_id ?? undefined, observationsTimestamp: r.observations_ts != null ? Number(r.observations_ts) : undefined,
      marketStatus: r.market_status ?? undefined, reportHash: r.report_hash ?? undefined, verification: r.verification ?? undefined,
      roundId: r.round_id ?? undefined, answer: r.answer != null ? String(r.answer) : undefined, decimals: r.decimals ?? undefined, readBlock: r.read_block != null ? String(r.read_block) : undefined,
    })),
  };
}

export async function saveSnapshots(db: SupabaseClient, duelId: string, snaps: PriceSnapshot[]) {
  if (!snaps.length) return;
  await db.from("duel_price_snapshots").upsert(
    snaps.map((s) => ({
      duel_id: duelId, ticker: s.ticker, kind: s.kind, price: s.price, adjusted_price: s.adjustedPrice ?? null,
      session: s.session, price_timestamp: s.timestamp, source: s.source, simulated: s.simulated,
      price_e18: s.priceE18 ?? null, adjusted_e18: s.adjustedE18 ?? null, stream_id: s.streamId ?? null,
      observations_ts: s.observationsTimestamp ?? null, market_status: s.marketStatus ?? null, report_hash: s.reportHash ?? null,
      verification: s.verification ?? null,
      round_id: s.roundId ?? null, answer: s.answer ?? null, decimals: s.decimals ?? null, read_block: s.readBlock ?? null,
    })),
    { onConflict: "duel_id,ticker,kind", ignoreDuplicates: true },
  );
}

export async function applySettlementStatus(db: SupabaseClient, s: Settlement) {
  const status = s.status === "needs_verification" ? "awaiting_verification" : "completed";
  // only move forward from active/awaiting; completed rows are immutable (trigger enforced)
  await db.from("duels").update({ status }).eq("id", s.duelId).in("status", ["active", "awaiting_verification"]);
  if (status === "completed") {
    const users = s.entries.map((e) => e.userId);
    await db.from("notifications").insert(users.map((u) => ({
      user_id: u, kind: "duel_completed", text: s.status === "draw" ? "your duel ended in a draw" : s.winners.includes(u) ? "you won your duel" : "your duel is settled",
      href: `/duel/${s.duelId}`,
    })));
  }
}
