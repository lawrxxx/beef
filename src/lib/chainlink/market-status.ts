import { MARKET_STATUS } from "./config";
import type { StreamSession } from "./directory";

// 24/5 us equities marketStatus (rwa advanced v11), per chainlink's schema docs:
// 0 unknown · 1 pre-market · 2 regular · 3 post-market · 4 overnight · 5 closed.
// the status is read from the regular-hours stream and decides which stream to use.
// unknown, closed or any other value never yields a usable price.

export type MarketSession = "pre_market" | "regular" | "post_market" | "overnight" | "closed" | "unknown";

export function sessionOf(status: number): MarketSession {
  switch (status) {
    case MARKET_STATUS.PRE_MARKET: return "pre_market";
    case MARKET_STATUS.REGULAR: return "regular";
    case MARKET_STATUS.POST_MARKET: return "post_market";
    case MARKET_STATUS.OVERNIGHT: return "overnight";
    case MARKET_STATUS.CLOSED: return "closed";
    default: return "unknown"; // 0 and anything chainlink hasn't defined
  }
}

/** which of the three streams carries the price for a status, or null when no price is valid */
export function streamForStatus(status: number): StreamSession | null {
  switch (status) {
    case MARKET_STATUS.PRE_MARKET:
    case MARKET_STATUS.POST_MARKET: return "extended";
    case MARKET_STATUS.REGULAR: return "regular";
    case MARKET_STATUS.OVERNIGHT: return "overnight";
    default: return null; // unknown (0), closed (5), undefined values
  }
}

export const SESSION_LABEL: Record<MarketSession, string> = {
  pre_market: "pre-market",
  regular: "regular hours",
  post_market: "after hours",
  overnight: "overnight",
  closed: "market closed",
  unknown: "market status unknown",
};
