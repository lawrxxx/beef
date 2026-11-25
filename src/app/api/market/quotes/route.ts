import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";
import { getAsset } from "@/lib/market/assets";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = rateLimit(clientKey(req, "quotes"), 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "")
    .split(",").map((t) => t.trim().toUpperCase()).filter((t) => getAsset(t)).slice(0, 30);
  const p = getMarketProvider();
  try {
    const quotes = (await Promise.all(tickers.map((t) => p.getQuote(t)))).filter(Boolean);
    return NextResponse.json({ provider: p.id, label: p.label, simulated: p.simulated, quotes });
  } catch (e) {
    return NextResponse.json({ error: "market data provider unavailable", provider: p.id }, { status: 503 });
  }
}
