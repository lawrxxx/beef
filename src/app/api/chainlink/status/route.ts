import { NextResponse } from "next/server";
import { CHAINLINK_FEEDS, FEEDS_CHAIN_ID, FEED_DECIMALS, FEEDS_METHODOLOGY, RESOLUTION_MAX_DELAY_S } from "@/lib/chainlink/feeds";

export const dynamic = "force-dynamic";

/** public summary of the price oracle setup */
export async function GET() {
  return NextResponse.json({
    source: "chainlink data feeds · coinbase tokenized stocks on base mainnet, read-only",
    chainId: FEEDS_CHAIN_ID, decimals: FEED_DECIMALS, resolutionMaxDelayS: RESOLUTION_MAX_DELAY_S,
    methodology: FEEDS_METHODOLOGY,
    feeds: Object.fromEntries(Object.entries(CHAINLINK_FEEDS).map(([t, f]) => [t, f.feed])),
    escrowChainId: 84532,
    relay: "trusted settlement relay: beef's server reads base mainnet feeds, signs the result and submits it to the base sepolia escrow. base sepolia does not verify the mainnet feed itself.",
  });
}
