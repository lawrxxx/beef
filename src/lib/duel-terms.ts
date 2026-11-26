import type { DuelTerms } from "@/lib/types";
import { CALCULATION_VERSION } from "@/lib/settlement/engine";

/** the terms every beef duel records at creation (immutable once accepted) */
export const DEFAULT_TERMS: DuelTerms = {
  methodology: "chainlink_data_feeds_open_v2",
  provider: "chainlink-data-feeds",
  marketTimezone: "America/New_York",
  priceRule: "starting prices lock at the first us market open (9:30am et) after both players accept; ending prices at the deadline. each is the first update of the stock's chainlink data feed on base mainnet at or after that time, within the maximum delay (total-return, so splits and dividends are included). these are chainlink feed observations, not official exchange auction prices.",
  settlementRule: "higher percentage return wins. identical returns (to 0.0001 points) are a draw and every stake is returned. deadlines always fall in regular trading hours (next market open, one week at the open, or a validated custom time); missing or late prices pause settlement.",
  calculationVersion: CALCULATION_VERSION,
  funding: "base_sepolia_usdc",
};
