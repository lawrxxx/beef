import { NextResponse } from "next/server";
import { getAsset } from "@/lib/market/assets";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { PRICE_SOURCE, liveQuotes } from "@/lib/server/chainlink";

export const dynamic = "force-dynamic";

/** latest chainlink prices (display only; settlement uses the reference price at each close) */
export async function GET(req: Request) {
  const rl = rateLimit(clientKey(req, "quotes"), 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const tickers = (new URL(req.url).searchParams.get("tickers") ?? "")
    .split(",").map((t) => t.trim().toUpperCase()).filter((t) => getAsset(t)).slice(0, 10);
  const quotes = await liveQuotes(tickers);
  return NextResponse.json({ provider: PRICE_SOURCE === "data_feeds" ? "chainlink-data-feeds" : "chainlink-data-streams", simulated: false, quotes });
}
