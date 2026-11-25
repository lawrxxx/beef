/**
 * tokenized stock providers are configurable and their capabilities are declared,
 * not assumed. nothing here claims a token is transferable, has dex liquidity
 * (e.g. aerodrome) or has an oracle feed until it has been verified for that provider.
 */
export type Capability = "verified" | "unverified" | "unsupported";

export interface TokenizedStockProvider {
  id: string;
  name: string;
  network: "base" | "base-sepolia";
  /** ticker -> token address, filled in only after verification */
  tokens: Record<string, `0x${string}` | null>;
  capabilities: {
    transferable: Capability;
    permissionless: Capability; // kyc / allow-list restrictions
    dexLiquidity: Capability;
    oracleFeed: Capability;
    jurisdictions: string; // free text, from the provider's terms
  };
}

export const TOKENIZED_PROVIDERS: TokenizedStockProvider[] = [
  {
    id: "placeholder",
    name: "tokenized stock provider (not configured)",
    network: "base-sepolia",
    tokens: { NVDA: null, AAPL: null, TSLA: null, MSFT: null, AMZN: null, GOOGL: null, META: null },
    capabilities: {
      transferable: "unverified",
      permissionless: "unverified",
      dexLiquidity: "unverified",
      oracleFeed: "unverified",
      jurisdictions: "unknown – review the provider's terms before enabling",
    },
  },
];

/**
 * beef settles on price comparisons, not by moving stock tokens. tokenized assets
 * are only relevant if a future version lets users stake with them, which requires
 * every capability above to be "verified".
 */
export function canStakeWithTokenizedStock(p: TokenizedStockProvider, ticker: string): boolean {
  const c = p.capabilities;
  return !!p.tokens[ticker] && [c.transferable, c.permissionless, c.oracleFeed].every((x) => x === "verified");
}
