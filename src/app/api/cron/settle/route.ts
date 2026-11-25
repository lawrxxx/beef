import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";
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
  if (!db) return NextResponse.json({ mode: "demo", message: "no database configured; demo clients settle via /api/duels/settle" });

  const now = new Date();
  const provider = getMarketProvider();
  const repo = new SupabaseSettlementRepository(db);
  const report = { locked: 0, settled: 0, paused: 0, expired: 0, errors: [] as string[] };

  await db.from("duels").update({ status: "expired" }).eq("status", "pending").lt("invite_expires_at", now.toISOString());

  const { data: accepted } = await db.from("duels").select("id").eq("status", "accepted").lte("lock_at", now.toISOString()).limit(100);
  for (const { id } of accepted ?? []) {
    const d = await loadSettleableDuel(db, id);
    if (!d) continue;
    const r = await lockStartPrices(d, provider, now);
    if (r.ok) {
      await saveSnapshots(db, id, r.snapshots);
      await db.from("duels").update({ status: "active", activated_at: r.lockAt }).eq("id", id).eq("status", "accepted");
      report.locked++;
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
  return NextResponse.json(report);
}
