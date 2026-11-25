import type { ClosePrice, CorporateAction, Quote, StockAsset } from "@/lib/types";

/**
 * provider abstraction. the duel engine and settlement service only talk to this
 * interface, so polygon / finnhub / alpha vantage can be swapped in without
 * touching settlement code.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  readonly simulated: boolean;
  search(query: string): Promise<StockAsset[]>;
  getAsset(ticker: string): Promise<StockAsset | null>;
  getQuote(ticker: string, at?: Date): Promise<Quote | null>;
  /** official close for a session (yyyy-mm-dd, market tz) */
  getClose(ticker: string, session: string): Promise<ClosePrice>;
  getHistory(ticker: string, from: string, to: string): Promise<ClosePrice[]>;
  getCorporateActions(ticker: string, from: string, to: string): Promise<CorporateAction[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(provider: string, reason: string) {
    super(`${provider} unavailable: ${reason}`);
  }
}
