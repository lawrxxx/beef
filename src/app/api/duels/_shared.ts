import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { loadSettleableDuel } from "@/lib/server/duel-db";
import type { SettleableDuel } from "@/lib/settlement/service";

export type Ctx = { ok: true; duel: SettleableDuel; now: Date } | { ok: false; res: NextResponse };

const Body = z.object({ duelId: z.string().uuid() });

/**
 * shared auth + validation for lock and settle. the duel's terms always come from the
 * database (never from the browser), and only a participant may nudge their own duel.
 */
export async function resolveRequest(req: Request, route: string): Promise<Ctx> {
  const rl = rateLimit(clientKey(req, route), 20, 60_000);
  if (!rl.ok) return { ok: false, res: NextResponse.json({ error: "too many requests, slow down" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } }) };
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return { ok: false, res: NextResponse.json({ error: "duelId required" }, { status: 400 }) };
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, res: NextResponse.json({ error: "beef isn't connected to its database" }, { status: 503 }) };
  const sb = await getServerSupabase();
  const { data } = (await sb?.auth.getUser()) ?? { data: { user: null } };
  if (!data.user) return { ok: false, res: NextResponse.json({ error: "sign in required" }, { status: 401 }) };
  const duel = await loadSettleableDuel(admin, parsed.data.duelId);
  if (!duel) return { ok: false, res: NextResponse.json({ error: "duel not found" }, { status: 404 }) };
  if (!duel.participants.some((p) => p.userId === data.user!.id)) return { ok: false, res: NextResponse.json({ error: "not a participant" }, { status: 403 }) };
  return { ok: true, duel, now: new Date() };
}
