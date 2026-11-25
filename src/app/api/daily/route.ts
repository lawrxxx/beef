import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";
import { getAsset } from "@/lib/market/assets";
import { prevTradingDay, sessionCloseUtc } from "@/lib/market/calendar";
import { percentReturn } from "@/lib/settlement/engine";

export const dynamic = "force-dynamic";

/**
 * beef of the day results. each matchup compares returns from the previous official
 * close to the session's official close. only sessions that have closed are returned.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const items = (sp.get("m") ?? "").split(";").slice(0, 10).map((x) => x.split(",")).filter((x) => x.length === 3);
  const p = getMarketProvider();
  const now = Date.now();
  const out: Record<string, Record<string, number>> = {};
  for (const [session, a, b] of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session) || !getAsset(a) || !getAsset(b)) continue;
    if (sessionCloseUtc(session).getTime() > now) continue;
    const prev = prevTradingDay(session);
    const rows = await Promise.all([a, b].flatMap((t) => [p.getClose(t, prev), p.getClose(t, session)]));
    if (rows.some((r) => r.status !== "ok")) continue;
    out[session] = { [a]: percentReturn(rows[0].close, rows[1].close), [b]: percentReturn(rows[2].close, rows[3].close) };
  }
  return NextResponse.json({ provider: p.id, simulated: p.simulated, results: out });
}
