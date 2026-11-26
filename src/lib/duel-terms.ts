import type { DuelTerms } from "@/lib/types";
import { CALCULATION_VERSION } from "@/lib/settlement/engine";

/** the terms every beef duel records at creation (immutable once accepted) */
export const DEFAULT_TERMS: DuelTerms = {
  methodology: "chainlink_regular_hours_mid_v1",
  provider: "chainlink-data-streams",
  marketTimezone: "America/New_York",
  priceRule: "starting prices lock at the first official close after everyone has joined, and ending prices at the close of the deadline session: each is the mid from the stock's chainlink 24/5 regular-hours stream observed one second before the close, verified by chainlink's base sepolia verifier.",
  settlementRule: "higher percentage return wins. identical returns (to 0.0001 points) are a draw and every stake is returned. weekend or holiday deadlines use the last close at or before the deadline; if that is not after the lock, the next trading session.",
  calculationVersion: CALCULATION_VERSION,
  funding: "base_sepolia_usdc",
};
