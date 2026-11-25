import type { DuelTerms } from "@/lib/types";
import { CALCULATION_VERSION } from "@/lib/settlement/engine";

/** the terms every beef duel records at creation (immutable once accepted) */
export const DEFAULT_TERMS: DuelTerms = {
  methodology: "percent_return_official_close",
  provider: process.env.NEXT_PUBLIC_MARKET_DATA_PROVIDER || "mock",
  marketTimezone: "America/New_York",
  priceRule: "starting prices lock at the first official close after everyone has joined. ending prices are the official close of the deadline session.",
  settlementRule: "higher percentage return wins. identical returns (to 0.0001 points) are a draw and every stake is returned. weekend or holiday deadlines use the last close at or before the deadline; if that is not after the lock, the next trading session.",
  calculationVersion: CALCULATION_VERSION,
  funding: "base_sepolia_usdc",
};
