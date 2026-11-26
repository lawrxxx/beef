import { NextResponse } from "next/server";
import { chainlinkPrices } from "@/lib/server/chainlink";
import { settleDuel } from "@/lib/settlement/service";
import { getAdminSupabase } from "@/lib/supabase/server";
import { SupabaseSettlementRepository } from "@/lib/supabase/settlement-repo";
import { applySettlementStatus, saveSnapshots } from "@/lib/server/duel-db";
import { resolveRequest } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await resolveRequest(req, "settle");
  if (!ctx.ok) return ctx.res;
  const admin = getAdminSupabase()!;
  const repo = new SupabaseSettlementRepository(admin);
  const prices = chainlinkPrices();
  if (!prices) return NextResponse.json({ outcome: "rejected", reason: "chainlink data streams isn't configured" }, { status: 503 });
  try {
    const r = await settleDuel(ctx.duel, prices, repo, ctx.now);
    if (r.outcome === "settled") await saveSnapshots(admin, ctx.duel.id, [...r.startSnapshots, ...r.endSnapshots]);
    if (r.outcome === "settled" || r.outcome === "needs_verification") await applySettlementStatus(admin, r.settlement);
    return NextResponse.json({ outcome: r.outcome, reason: "reason" in r ? r.reason : undefined });
  } catch (e) {
    return NextResponse.json({ outcome: "rejected", reason: e instanceof Error ? e.message : "settlement failed" }, { status: 422 });
  }
}
