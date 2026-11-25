import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";
import { settleDuel, type SettlementRepository } from "@/lib/settlement/service";
import { getAdminSupabase } from "@/lib/supabase/server";
import { SupabaseSettlementRepository } from "@/lib/supabase/settlement-repo";
import { applySettlementStatus, saveSnapshots } from "@/lib/server/duel-db";
import { demoRepo } from "@/lib/server/demo-repo";
import { resolveRequest } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await resolveRequest(req, "settle");
  if (!ctx.ok) return ctx.res;
  const admin = getAdminSupabase();
  const repo: SettlementRepository = ctx.mode === "supabase" && admin ? new SupabaseSettlementRepository(admin) : demoRepo;
  try {
    const r = await settleDuel(ctx.duel, getMarketProvider(), repo, ctx.now);
    if (ctx.mode === "supabase" && admin && (r.outcome === "settled" || r.outcome === "needs_verification")) {
      if (r.outcome === "settled") await saveSnapshots(admin, ctx.duel.id, [...r.startSnapshots, ...r.endSnapshots]);
      await applySettlementStatus(admin, r.settlement);
    }
    const audit = await repo.listAudit(ctx.duel.id);
    return NextResponse.json({ ...r, audit });
  } catch (e) {
    return NextResponse.json({ outcome: "rejected", reason: e instanceof Error ? e.message : "settlement failed" }, { status: 422 });
  }
}
