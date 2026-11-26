import type { DuelTerms } from "@/lib/types";
import { CALCULATION_VERSION } from "@/lib/settlement/engine";

/** the terms every beef duel records at creation (immutable once accepted) */
export const DEFAULT_TERMS: DuelTerms = {
  methodology: "chainlink_data_feeds_total_return_v1",
  provider: "chainlink-data-streams",
  marketTimezone: "America/New_York",
  priceRule: "starting prices lock at the first official close after everyone has joined, and ending prices at the close of the deadline session: each is the value of the stock's chainlink data feed on base mainnet in effect at the close (total-return, so splits and dividends are included).",
  settlementRule: "higher percentage return wins. identical returns (to 0.0001 points) are a draw and every stake is returned. weekend or holiday deadlines use the last close at or before the deadline; if that is not after the lock, the next trading session.",
  calculationVersion: CALCULATION_VERSION,
  funding: "base_sepolia_usdc",
};
