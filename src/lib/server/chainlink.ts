import "server-only";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ChainlinkFeedPrices } from "@/lib/chainlink/feeds";
import type { LiveQuote } from "@/lib/chainlink/prices";

// chainlink data feeds for coinbase tokenized stocks, read from base mainnet (chain 8453)
// with a read-only client. beef never sends a transaction on base mainnet: escrow and every
// beef transaction stay on base sepolia (see lib/server/relay.ts for the settlement relay).

export const baseMainnet = createPublicClient({ chain: base, transport: http(process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org") });

let feeds: ChainlinkFeedPrices | null = null;
/** the chainlink price source (data feeds on base mainnet) */
export function chainlinkPrices(): ChainlinkFeedPrices {
  return (feeds ??= new ChainlinkFeedPrices({ client: baseMainnet }));
}

const liveCache = new Map<string, { at: number; q: LiveQuote }>();
/** live quotes with a short cache so many viewers don't multiply rpc calls */
export async function liveQuotes(tickers: string[]): Promise<LiveQuote[]> {
  const prices = chainlinkPrices();
  return Promise.all(tickers.map(async (t) => {
    const hit = liveCache.get(t);
    if (hit && Date.now() - hit.at < 30_000) return hit.q;
    const q = await prices.live(t);
    liveCache.set(t, { at: Date.now(), q });
    return q;
  }));
}
