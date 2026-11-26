import { NextResponse } from "next/server";
import { BASE_SEPOLIA_VERIFIER_PROXY, SUPPORTED_TICKERS, chainlinkServerConfig } from "@/lib/chainlink/config";
import { METHODOLOGY } from "@/lib/chainlink/prices";
import { getAdminSupabase } from "@/lib/supabase/server";
import { PRICE_SOURCE } from "@/lib/server/chainlink";
import { CHAINLINK_FEEDS, FEEDS_METHODOLOGY } from "@/lib/chainlink/feeds";

export const dynamic = "force-dynamic";

/** public, secret-free summary of the price oracle setup */
export async function GET() {
  if (PRICE_SOURCE === "data_feeds") {
    return NextResponse.json({
      source: "chainlink data feeds · coinbase tokenized stocks on base mainnet (8453), read-only",
      priceSource: PRICE_SOURCE, configured: true, methodology: FEEDS_METHODOLOGY,
      feeds: Object.fromEntries(Object.entries(CHAINLINK_FEEDS).map(([t, f]) => [t, f.feed])),
    });
  }
  const cfg = chainlinkServerConfig();
  const db = getAdminSupabase();
  const { data } = db && cfg ? await db.from("price_streams").select("ticker,session,stream_id,discovered_at").eq("network", cfg.network) : { data: [] };
  const tickers = SUPPORTED_TICKERS.map((t) => {
    const rows = (data ?? []).filter((r) => r.ticker === t);
    return { ticker: t, available: rows.length === 3, streams: Object.fromEntries(rows.map((r) => [r.session, r.stream_id])) };
  });
  return NextResponse.json({
    source: "chainlink data streams (24/5 us equities, rwa advanced v11)",
    configured: !!cfg, network: cfg?.network ?? null,
    verifier: { chainId: 84532, verifierProxy: BASE_SEPOLIA_VERIFIER_PROXY, method: "VerifierProxy.verify via eth_call (read-only)" },
    methodology: METHODOLOGY,
    tickers,
    lastDiscovery: (data ?? []).map((r) => r.discovered_at).sort().at(-1) ?? null,
  });
}
