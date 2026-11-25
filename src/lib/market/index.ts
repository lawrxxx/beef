import { MockMarketProvider } from "./mock";
import { AlphaVantageProvider, FinnhubProvider, PolygonProvider } from "./http-providers";
import type { MarketDataProvider } from "./provider";

export * from "./provider";

let cached: MarketDataProvider | null = null;

/**
 * selects the market data provider from MARKET_DATA_PROVIDER.
 * falls back to the simulated provider when a key is missing, and says so.
 */
export function getMarketProvider(): MarketDataProvider {
  if (cached) return cached;
  const id = (process.env.MARKET_DATA_PROVIDER ?? "mock").toLowerCase();
  if (id === "polygon" && process.env.POLYGON_API_KEY) cached = new PolygonProvider(process.env.POLYGON_API_KEY);
  else if (id === "finnhub" && process.env.FINNHUB_API_KEY) cached = new FinnhubProvider(process.env.FINNHUB_API_KEY);
  else if (id === "alphavantage" && process.env.ALPHAVANTAGE_API_KEY)
    cached = new AlphaVantageProvider(process.env.ALPHAVANTAGE_API_KEY);
  else {
    if (id !== "mock") console.warn(`[market] ${id} selected but no api key set, using simulated data`);
    cached = new MockMarketProvider();
  }
  return cached;
}

/** for tests */
export function setMarketProvider(p: MarketDataProvider | null) {
  cached = p;
}
