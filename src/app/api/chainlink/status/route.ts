import { NextResponse } from "next/server";
import { BASE_SEPOLIA_VERIFIER_PROXY, SUPPORTED_TICKERS, chainlinkServerConfig } from "@/lib/chainlink/config";
import { METHODOLOGY } from "@/lib/chainlink/prices";
import { getAdminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** public, secret-free summary of the price oracle setup */
export async function GET() {
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
