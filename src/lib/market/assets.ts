import type { CorporateAction, StockAsset } from "@/lib/types";

// supported tickers. basePrice/vol/drift only drive the deterministic mock provider.
export const ASSETS: StockAsset[] = [
  { ticker: "NVDA", name: "NVIDIA", sector: "semiconductors", basePrice: 182, vol: 0.026, drift: 0, tokenized: true },
  { ticker: "AAPL", name: "Apple", sector: "tech", basePrice: 268, vol: 0.014, drift: 0, tokenized: true },
  { ticker: "TSLA", name: "Tesla", sector: "autos", basePrice: 395, vol: 0.033, drift: 0, tokenized: true },
  { ticker: "MSFT", name: "Microsoft", sector: "tech", basePrice: 505, vol: 0.013, drift: 0, tokenized: true },
  { ticker: "AMZN", name: "Amazon", sector: "consumer", basePrice: 228, vol: 0.017, drift: 0, tokenized: true },
  { ticker: "GOOGL", name: "Alphabet", sector: "tech", basePrice: 285, vol: 0.017, drift: 0, tokenized: true },
  { ticker: "META", name: "Meta Platforms", sector: "tech", basePrice: 640, vol: 0.02, drift: 0, tokenized: true },
  { ticker: "AMD", name: "Advanced Micro Devices", sector: "semiconductors", basePrice: 215, vol: 0.028, drift: 0 },
  { ticker: "AVGO", name: "Broadcom", sector: "semiconductors", basePrice: 345, vol: 0.024, drift: 0 },
  { ticker: "TSM", name: "Taiwan Semiconductor", sector: "semiconductors", basePrice: 290, vol: 0.02, drift: 0 },
  { ticker: "NFLX", name: "Netflix", sector: "media", basePrice: 112, vol: 0.019, drift: 0 },
  { ticker: "PLTR", name: "Palantir", sector: "software", basePrice: 175, vol: 0.035, drift: 0 },
  { ticker: "COIN", name: "Coinbase", sector: "fintech", basePrice: 310, vol: 0.038, drift: 0 },
  { ticker: "GME", name: "GameStop", sector: "retail", basePrice: 23, vol: 0.045, drift: 0 },
  { ticker: "AMC", name: "AMC Entertainment", sector: "media", basePrice: 3.2, vol: 0.05, drift: 0 },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "banks", basePrice: 305, vol: 0.012, drift: 0 },
  { ticker: "KO", name: "Coca-Cola", sector: "staples", basePrice: 69, vol: 0.008, drift: 0 },
  { ticker: "COST", name: "Costco", sector: "retail", basePrice: 920, vol: 0.011, drift: 0 },
  { ticker: "DIS", name: "Disney", sector: "media", basePrice: 114, vol: 0.015, drift: 0 },
  { ticker: "SMCI", name: "Super Micro Computer", sector: "semiconductors", basePrice: 42, vol: 0.05, drift: 0 },
];

export const ASSET_MAP: Record<string, StockAsset> = Object.fromEntries(
  ASSETS.map((a) => [a.ticker, a]),
);

export function getAsset(ticker: string): StockAsset | undefined {
  return ASSET_MAP[ticker.toUpperCase()];
}

/** simulated corporate actions, used to exercise split adjustment */
export const MOCK_CORPORATE_ACTIONS: CorporateAction[] = [
  { ticker: "AVGO", type: "split", session: "2026-12-07", ratio: 4 },
];

/**
 * simulated data gaps used to exercise the "pause settlement" path.
 * smci is marked halted for a session to exercise the verification path.
 */
export const MOCK_DATA_GAPS: { ticker: string; session: string; status: "halted" | "missing" }[] = [
  { ticker: "SMCI", session: "2026-11-20", status: "halted" },
];

/**
 * scripted simulated outcomes used by the settlement tests. at `from` the close is
 * rounded to whole dollars, and at `to` it is exactly from × (1 + pct/100).
 * - both rise:   nvda +5% vs aapl +3%
 * - both fall:   tsla −5% vs meta −2%
 * - identical:   msft +3% vs googl +3%
 */
export const MOCK_SCENARIOS: { ticker: string; from: string; to: string; pct: number }[] = [
  { ticker: "NVDA", from: "2026-10-30", to: "2026-11-06", pct: 5 },
  { ticker: "AAPL", from: "2026-10-30", to: "2026-11-06", pct: 3 },
  { ticker: "TSLA", from: "2026-11-09", to: "2026-11-13", pct: -5 },
  { ticker: "META", from: "2026-11-09", to: "2026-11-13", pct: -2 },
  { ticker: "MSFT", from: "2026-11-02", to: "2026-11-06", pct: 3 },
  { ticker: "GOOGL", from: "2026-11-02", to: "2026-11-06", pct: 3 },
];
