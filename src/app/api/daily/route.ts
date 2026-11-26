import { NextResponse } from "next/server";
import { getAsset } from "@/lib/market/assets";
import { prevTradingDay, sessionCloseUtc } from "@/lib/market/calendar";
import { returnE6, returnPctNumber } from "@/lib/settlement/engine";
import { chainlinkPrices } from "@/lib/server/chainlink";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * beef of the day results: each stock's return from the previous regular-hours close to
 * the session's close, using the same verified chainlink reference reports as settlement.
 * a matchup with any unverified or missing price is left out, never estimated.
 */
export async function GET(req: Request) {
  const rl = rateLimit(clientKey(req, "daily"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const prices = chainlinkPrices();
  if (!prices) return NextResponse.json({ provider: "chainlink-data-streams", available: false, results: {} });
  const sp = new URL(req.url).searchParams;
  const items = (sp.get("m") ?? "").split(";").slice(0, 3).map((x) => x.split(",")).filter((x) => x.length === 3);
  const now = Date.now();
  const out: Record<string, Record<string, number>> = {};
  for (const [session, a, b] of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session) || !getAsset(a) || !getAsset(b)) continue;
    if (sessionCloseUtc(session).getTime() > now) continue;
    const prev = prevTradingDay(session);
    const refs = await Promise.all([a, b].flatMap((t) => [prices.reference(t, prev, sessionCloseUtc(prev)), prices.reference(t, session, sessionCloseUtc(session))]));
    if (refs.some((r) => !r.ok || !r.price)) continue;
    out[session] = {
      [a]: returnPctNumber(returnE6(refs[0].price!.mid, refs[1].price!.mid)),
      [b]: returnPctNumber(returnE6(refs[2].price!.mid, refs[3].price!.mid)),
    };
  }
  return NextResponse.json({ provider: "chainlink-data-streams", available: true, results: out });
}
