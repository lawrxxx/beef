import { NextResponse } from "next/server";
import { chainlinkPrices } from "@/lib/server/chainlink";
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

  // prices only ever come from chainlink; without it nothing locks or settles (and nothing is guessed)
  const provider = chainlinkPrices();
  if (!provider) return NextResponse.json({ ...report, error: "chainlink data streams isn't configured, so no prices were locked or settled" }, { status: 503 });

  // accept_duel only marks a duel accepted; the lock close is computed here from the
  // acceptance time (lockStartPrices waits if that close hasn't happened yet)
  const { data: accepted } = await db.from("duels").select("id").eq("status", "accepted").limit(200);
  for (const { id } of accepted ?? []) {
    const d = await loadSettleableDuel(db, id);
    if (!d) continue;
    const r = await lockStartPrices(d, provider, now);
    if (r.ok) {
      await saveSnapshots(db, id, r.snapshots);
      await db.from("duels").update({ status: "active", lock_at: r.lockAt, activated_at: r.lockAt }).eq("id", id).eq("status", "accepted");
      report.locked++;
    } else if (!r.issues[0]?.startsWith("waiting")) {
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
  return NextResponse.json(report);
}
