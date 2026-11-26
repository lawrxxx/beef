import { NextResponse } from "next/server";
import { chainlinkPrices } from "@/lib/server/chainlink";
import { relaySettlement } from "@/lib/server/relay";
import { lockStartPrices, settleDuel } from "@/lib/settlement/service";
import { getAdminSupabase } from "@/lib/supabase/server";
import { SupabaseSettlementRepository } from "@/lib/supabase/settlement-repo";
import { applySettlementStatus, loadSettleableDuel, saveSnapshots } from "@/lib/server/duel-db";

export const dynamic = "force-dynamic";

/**
 * scheduled job (vercel cron). locks prices for accepted duels and settles due duels.
 * requires `authorization: bearer $SETTLEMENT_CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.SETTLEMENT_CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getAdminSupabase();
  if (!db) return NextResponse.json({ error: "no database configured" }, { status: 503 });

  const now = new Date();
  const repo = new SupabaseSettlementRepository(db);
  const report = { locked: 0, settled: 0, paused: 0, expired: 0, errors: [] as string[] };

  await db.from("duels").update({ status: "expired" }).eq("status", "pending").lt("invite_expires_at", now.toISOString());

  // prices only ever come from chainlink data feeds on base mainnet (read-only)
  const provider = chainlinkPrices();

  // accepted duels lock their starting prices at the agreed market open (start_at)
  const { data: accepted } = await db.from("duels").select("id").eq("status", "accepted").limit(200);
  for (const { id } of accepted ?? []) {
    const d = await loadSettleableDuel(db, id);
    if (!d) continue;
    const r = await lockStartPrices(d, provider, now);
    if (r.ok) {
      await saveSnapshots(db, id, r.snapshots);
      await db.from("duels").update({ status: "active", lock_at: r.startAt }).eq("id", id).eq("status", "accepted");
      report.locked++;
    } else if (!r.pending) {
      await db.from("duels").update({ status: "awaiting_verification", lock_at: r.startAt }).eq("id", id).eq("status", "accepted");
      report.paused++;
      report.errors.push(`${id}: ${r.issues.join("; ")}`);
    }
  }

  const { data: due } = await db.from("duels").select("id").in("status", ["active", "awaiting_verification"]).lte("deadline", now.toISOString()).limit(100);
  for (const { id } of due ?? []) {
    try {
      const d = await loadSettleableDuel(db, id);
      if (!d) continue;
      const r = await settleDuel(d, provider, repo, now);
      if (r.outcome === "settled") { await saveSnapshots(db, id, [...r.startSnapshots, ...r.endSnapshots]); await applySettlementStatus(db, r.settlement); report.settled++; }
      if (r.outcome === "needs_verification") { await applySettlementStatus(db, r.settlement); report.paused++; }
    } catch (e) {
      report.errors.push(`${id}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  // settlement relay: pay out every completed duel whose escrow is still active (retries until confirmed)
  const { data: unpaid } = await db.from("duels").select("id").eq("status", "completed").in("escrow_state", ["active"]).is("settle_tx", null).limit(50);
  const relayed: string[] = [];
  for (const { id } of unpaid ?? []) {
    const r = await relaySettlement(id);
    if (r.status === "confirmed") relayed.push(`${id}: ${r.txHash}`);
    else if (r.status === "failed") report.errors.push(`${id}: relay ${r.reason}${r.txHash ? ` (${r.txHash})` : ""}`);
  }
  return NextResponse.json({ ...report, relayed });
}
