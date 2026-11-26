import { NextResponse } from "next/server";
import { chainlinkPrices } from "@/lib/server/chainlink";
import { lockStartPrices } from "@/lib/settlement/service";
import { getAdminSupabase } from "@/lib/supabase/server";
import { saveSnapshots } from "@/lib/server/duel-db";
import { resolveRequest } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await resolveRequest(req, "lock");
  if (!ctx.ok) return ctx.res;
  if (ctx.duel.status !== "accepted") return NextResponse.json({ error: `duel is ${ctx.duel.status}` }, { status: 409 });
  const prices = chainlinkPrices();
  if (!prices) return NextResponse.json({ error: "chainlink data streams isn't configured, so prices can't be locked" }, { status: 503 });
  const r = await lockStartPrices(ctx.duel, prices, ctx.now);
  if (r.ok) {
    const db = getAdminSupabase()!;
    await saveSnapshots(db, ctx.duel.id, r.snapshots);
    await db.from("duels").update({ status: "active", lock_at: r.lockAt, activated_at: r.lockAt }).eq("id", ctx.duel.id).eq("status", "accepted");
  }
  return NextResponse.json({ ok: r.ok, lockAt: r.lockAt, issues: r.issues });
}
