import type { StockAsset } from "@/lib/types";
import { SUPPORTED_TICKERS } from "@/lib/chainlink/config";

// the stocks beef can duel on: exactly the tickers with chainlink 24/5 us equities streams
// configured (see lib/chainlink). prices come only from chainlink data streams.
export const ASSETS: StockAsset[] = [
  { ticker: "NVDA", name: "NVIDIA", sector: "semiconductors" },
  { ticker: "AAPL", name: "Apple", sector: "tech" },
  { ticker: "TSLA", name: "Tesla", sector: "autos" },
  { ticker: "MSFT", name: "Microsoft", sector: "tech" },
  { ticker: "AMZN", name: "Amazon", sector: "consumer" },
  { ticker: "GOOGL", name: "Alphabet", sector: "tech" },
  { ticker: "META", name: "Meta Platforms", sector: "tech" },
].filter((a) => (SUPPORTED_TICKERS as readonly string[]).includes(a.ticker));

export const ASSET_MAP: Record<string, StockAsset> = Object.fromEntries(ASSETS.map((a) => [a.ticker, a]));

export function getAsset(ticker: string): StockAsset | undefined {
  return ASSET_MAP[ticker.toUpperCase()];
}
