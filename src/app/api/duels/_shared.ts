import "server-only";
import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";
import { lockOrSettleBody } from "@/lib/server/validation";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { loadSettleableDuel } from "@/lib/server/duel-db";
import type { SettleableDuel } from "@/lib/settlement/service";

export type Ctx =
  | { ok: true; duel: SettleableDuel; now: Date; mode: "demo" | "supabase" }
  | { ok: false; res: NextResponse };

/** shared auth + validation for lock and settle */
export async function resolveRequest(req: Request, route: string): Promise<Ctx> {
  const rl = rateLimit(clientKey(req, route), 20, 60_000);
  if (!rl.ok) return { ok: false, res: NextResponse.json({ error: "too many requests, slow down" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } }) };

  const parsed = lockOrSettleBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return { ok: false, res: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, { status: 400 }) };
  const body = parsed.data;
  const provider = getMarketProvider();

  // time travel is a demo affordance for simulated data only
  let now = new Date();
  if (body.simulateAt) {
    if (!provider.simulated) return { ok: false, res: NextResponse.json({ error: "time simulation is only available with simulated market data" }, { status: 403 }) };
    const sim = new Date(body.simulateAt);
    if (sim > now) now = sim;
  }

  const admin = getAdminSupabase();
  if (admin) {
    // supabase mode: never trust duel terms from the browser. load them from the database
    // and require the caller to be a participant.
    const sb = await getServerSupabase();
    const { data } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    if (!data.user) return { ok: false, res: NextResponse.json({ error: "sign in required" }, { status: 401 }) };
    if (!body.duelId) return { ok: false, res: NextResponse.json({ error: "duelId required" }, { status: 400 }) };
    const duel = await loadSettleableDuel(admin, body.duelId);
    if (!duel) return { ok: false, res: NextResponse.json({ error: "duel not found" }, { status: 404 }) };
    if (!duel.participants.some((p) => p.userId === data.user!.id)) return { ok: false, res: NextResponse.json({ error: "not a participant" }, { status: 403 }) };
    return { ok: true, duel, now, mode: "supabase" };
  }

  if (!body.duel) return { ok: false, res: NextResponse.json({ error: "duel required" }, { status: 400 }) };
  return { ok: true, duel: body.duel, now, mode: "demo" };
}
