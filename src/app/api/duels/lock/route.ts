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
  const r = await lockStartPrices(ctx.duel, chainlinkPrices(), ctx.now);
  const db = getAdminSupabase()!;
  if (r.ok) {
    await saveSnapshots(db, ctx.duel.id, r.snapshots);
    await db.from("duels").update({ status: "active", lock_at: r.startAt }).eq("id", ctx.duel.id).eq("status", "accepted");
  } else if (!r.pending) {
    // a starting price was missing or invalid: pause, never guess
    await db.from("duels").update({ status: "awaiting_verification", lock_at: r.startAt }).eq("id", ctx.duel.id).eq("status", "accepted");
  }
  return NextResponse.json({ ok: r.ok, pending: r.pending, startAt: r.startAt, issues: r.issues });
}
