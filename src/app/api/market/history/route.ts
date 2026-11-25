import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";
import { getAsset } from "@/lib/market/assets";
import { addDays, lastCloseAtOrBefore } from "@/lib/market/calendar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const ticker = (sp.get("ticker") ?? "").toUpperCase();
  if (!getAsset(ticker)) return NextResponse.json({ error: "unsupported ticker" }, { status: 400 });
  const to = sp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to")!) ? sp.get("to")! : lastCloseAtOrBefore(new Date());
  const from = sp.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from")!) ? sp.get("from")! : addDays(to, -30);
  if (from > to || to > lastCloseAtOrBefore(new Date(Date.now() + 400 * 864e5))) return NextResponse.json({ error: "bad range" }, { status: 400 });
  const p = getMarketProvider();
  const rows = (await p.getHistory(ticker, from, to)).filter((r) => r.status === "ok").map((r) => ({ session: r.session, close: r.close }));
  return NextResponse.json({ ticker, provider: p.id, simulated: p.simulated, rows });
}
