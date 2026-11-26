import { encodeAbiParameters, getAddress, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { isMarketOpen, marketTimeToUtc, sessionDateOf, isTradingDay, closeHour } from "@/lib/market/calendar";
import { SESSION_LABEL, type MarketSession } from "./market-status";
import { isSupportedTicker, type SupportedTicker } from "./config";
import type { LiveQuote, PricePoint, ReferencePrice } from "./prices";
import type { Verification } from "./verifier";

// chainlink data feeds for coinbase tokenized stocks on base mainnet (chain 8453).
// free to read onchain (latestRoundData / getRoundData), no api key. beef only reads them;
// it never sends a mainnet transaction. escrow and stakes stay on base sepolia.
//
// sources, checked 2026-11-26:
// - https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks
//   "all feeds return 8 decimals, cover US equities (24/5 market hours), and update on a
//   0.5% price deviation or a 24-hour heartbeat. values are total-return."
// - feed addresses from coinbase's public api GET /v1/tokenized-stocks/nav-feeds, matched to
//   tickers via GET /v1/tokenized-stocks. each feed answers description() = "Coinbase <TICKER>".

export const FEEDS_CHAIN_ID = 8453 as const;
export const FEED_DECIMALS = 8;
/** feeds publish at least every 24h while the market is open; allow an hour of slack */
export const FEED_HEARTBEAT_S = 24 * 3600;
export const FEED_MAX_AGE_S = FEED_HEARTBEAT_S + 3600;

export const CHAINLINK_FEEDS: Record<SupportedTicker, { feed: Address; token: Address; symbol: string }> = {
  NVDA: { feed: getAddress("0x04689a41629776563E6822F76f2e57D148d28513"), token: getAddress("0xb20000000000000000000078ee7ce2fE4908108C"), symbol: "NVDAc" },
  AAPL: { feed: getAddress("0x787f13dEa48Db0897CbCDD985de77809D837F988"), token: getAddress("0xb200000000000000000000C2e324d24d7eEcd1fb"), symbol: "AAPLc" },
  TSLA: { feed: getAddress("0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"), token: getAddress("0xb2000000000000000000001e800a7f5189430cD0"), symbol: "TSLAc" },
  MSFT: { feed: getAddress("0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c"), token: getAddress("0xB200000000000000000000Ab99cFa739E253872B"), symbol: "MSFTc" },
  AMZN: { feed: getAddress("0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295"), token: getAddress("0xb200000000000000000000d9192b6B456483C2E8"), symbol: "AMZNc" },
  GOOGL: { feed: getAddress("0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2"), token: getAddress("0xb2000000000000000000002D0BA3164cc74f58B7"), symbol: "GOOGLc" },
  META: { feed: getAddress("0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D"), token: getAddress("0xb2000000000000000000008bC8786B856E61707C"), symbol: "METAc" },
};

export const AGGREGATOR_ABI = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const FEEDS_METHODOLOGY = {
  id: "chainlink_data_feeds_total_return_v1",
  summary:
    "starting and ending prices are the values of each stock's chainlink data feed on base mainnet (coinbase tokenized stocks, total-return, 8 decimals) " +
    "in effect at the official 4:00pm et close (1:00pm on early-close days) of the lock and end sessions: the latest feed round updated at or before the close. " +
    "both stocks use the same two timestamps. a price counts only if the feed's description and decimals match, the value is positive and the round was updated within 25 hours of the close " +
    "(feeds publish on a 0.5% move or a 24-hour heartbeat). otherwise settlement pauses for verification. feeds are total-return, so splits and dividends are already reflected. " +
    "return = (end − start) / start × 100, compared at 0.0001 percentage points.",
} as const;

type Round = { roundId: bigint; answer: bigint; updatedAt: bigint };
export type FeedClient = Pick<PublicClient, "readContract" | "multicall">;

/** 8-decimal feed answer → 18-decimal price used everywhere else */
const toE18 = (answer: bigint) => answer * 10n ** 10n;

/** a stable reference for one feed round, used in snapshots and the settlement attestation */
export const roundRef = (feed: Address, r: Round): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint80" }, { type: "int256" }, { type: "uint256" }], [BigInt(FEEDS_CHAIN_ID), feed, r.roundId, r.answer, r.updatedAt]));

/** extended-hours session from the calendar (data feeds don't publish a market status) */
export function calendarSession(at: Date): MarketSession {
  const day = sessionDateOf(at);
  if (!isTradingDay(day)) return "closed";
  if (isMarketOpen(at)) return "regular";
  const t = at.getTime();
  if (t >= marketTimeToUtc(day, 4).getTime() && t < marketTimeToUtc(day, 9, 30).getTime()) return "pre_market";
  if (t >= marketTimeToUtc(day, closeHour(day)).getTime() && t < marketTimeToUtc(day, 20).getTime()) return "post_market";
  return "closed";
}

export class ChainlinkFeedPrices {
  readonly totalReturn = true;
  readonly methodology = FEEDS_METHODOLOGY;
  private checked = new Map<string, true>();
  constructor(private deps: { client: FeedClient; now?: () => Date }) {}
  private now() { return this.deps.now?.() ?? new Date(); }

  /** the feed must be the one for this ticker: "Coinbase <TICKER>", 8 decimals */
  private async feedFor(ticker: SupportedTicker): Promise<Address> {
    const { feed } = CHAINLINK_FEEDS[ticker];
    if (this.checked.has(feed)) return feed;
    const [desc, dec] = await Promise.all([
      this.deps.client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "description" }),
      this.deps.client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "decimals" }),
    ]);
    if (desc !== `Coinbase ${ticker}`) throw new Error(`feed ${feed} describes itself as "${desc}", not "Coinbase ${ticker}"`);
    if (Number(dec) !== FEED_DECIMALS) throw new Error(`feed ${feed} has ${dec} decimals, expected ${FEED_DECIMALS}`);
    this.checked.set(feed, true);
    return feed;
  }

  private async latest(feed: Address): Promise<Round> {
    const r = await this.deps.client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "latestRoundData" });
    return { roundId: r[0], answer: r[1], updatedAt: r[3] };
  }

  /** latest round updated at or before `atS`, walking back through this phase's rounds */
  async roundAtOrBefore(feed: Address, atS: number, maxRounds = 3000): Promise<Round | null> {
    const latest = await this.latest(feed);
    if (latest.updatedAt <= BigInt(atS)) return latest;
    const phase = latest.roundId >> 64n;
    let agg = latest.roundId & ((1n << 64n) - 1n);
    const batch = 50n;
    for (let seen = 0n; seen < BigInt(maxRounds) && agg > 1n; seen += batch) {
      const ids: bigint[] = [];
      for (let i = 1n; i <= batch && agg - i >= 1n; i++) ids.push((phase << 64n) | (agg - i));
      const res = await this.deps.client.multicall({ contracts: ids.map((id) => ({ address: feed, abi: AGGREGATOR_ABI, functionName: "getRoundData" as const, args: [id] as const })), allowFailure: true });
      for (const x of res) {
        if (x.status !== "success") continue;
        const [roundId, answer, , updatedAt] = x.result as readonly [bigint, bigint, bigint, bigint, bigint];
        if (updatedAt > 0n && updatedAt <= BigInt(atS)) return { roundId, answer, updatedAt };
      }
      agg -= BigInt(ids.length);
    }
    return null; // older than this phase or the search window: never guess
  }

  async live(ticker: string): Promise<LiveQuote> {
    const base: LiveQuote = { ticker, source: "chainlink", status: "unavailable", session: "unknown", sessionLabel: SESSION_LABEL.unknown, marketStatus: null, streamId: null, streamSession: null, price: null, priceE18: null, bidE18: null, askE18: null, observationsTimestamp: null, lastSeenAt: null };
    if (!isSupportedTicker(ticker)) return { ...base, reason: "no chainlink feed for this stock" };
    const t = ticker.toUpperCase() as SupportedTicker;
    try {
      const feed = await this.feedFor(t);
      const r = await this.latest(feed);
      if (r.answer <= 0n) return { ...base, reason: "chainlink feed returned a non-positive value" };
      const now = this.now();
      const session = calendarSession(now);
      const ageS = Math.floor(now.getTime() / 1000) - Number(r.updatedAt);
      const status: LiveQuote["status"] = session === "closed" ? "closed" : ageS > FEED_MAX_AGE_S ? "stale" : "live";
      const e18 = toE18(r.answer);
      const whole = e18 / 10n ** 18n, frac = (e18 % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
      return {
        ...base, status, session, sessionLabel: SESSION_LABEL[session], streamId: feed, price: `${whole}.${frac}`, priceE18: e18.toString(),
        observationsTimestamp: Number(r.updatedAt), lastSeenAt: new Date(Number(r.updatedAt) * 1000).toISOString(),
        reason: status === "stale" ? "the feed hasn't updated within its 24-hour heartbeat" : status === "closed" ? "market closed: last feed value" : "chainlink feed (updates on a 0.5% move)",
      };
    } catch (e) {
      return { ...base, reason: e instanceof Error ? e.message : "couldn't read the chainlink feed" };
    }
  }

  /** the settlement price for one stock and session, per FEEDS_METHODOLOGY */
  async reference(ticker: string, session: string, closeUtc: Date): Promise<ReferencePrice> {
    const referenceTimestamp = Math.floor(closeUtc.getTime() / 1000);
    const out: ReferencePrice = { ok: false, ticker, session, referenceTimestamp, streamId: null, price: null, verification: null, problems: [] };
    if (!isSupportedTicker(ticker)) return { ...out, problems: [`${ticker}: no chainlink feed configured`] };
    const t = ticker.toUpperCase() as SupportedTicker;
    if (referenceTimestamp * 1000 > this.now().getTime()) return { ...out, problems: [`${t}: the ${session} close hasn't happened yet`] };
    let feed: Address;
    try { feed = await this.feedFor(t); } catch (e) { return { ...out, problems: [`${t}: ${e instanceof Error ? e.message : "feed check failed"}`] }; }
    let r: Round | null;
    try { r = await this.roundAtOrBefore(feed, referenceTimestamp); } catch (e) { return { ...out, streamId: feed, problems: [`${t}: couldn't read feed history (${e instanceof Error ? e.message : "rpc error"})`] }; }
    if (!r) return { ...out, streamId: feed, problems: [`${t}: no chainlink feed round at or before ${closeUtc.toISOString()}`] };
    const problems: string[] = [];
    if (r.answer <= 0n) problems.push(`${t}: feed value isn't positive`);
    if (referenceTimestamp - Number(r.updatedAt) > FEED_MAX_AGE_S) problems.push(`${t}: the feed hadn't updated for over 25 hours before the close (frozen for a corporate action, halted, or stale)`);
    const price: PricePoint = { streamId: feed, mid: toE18(r.answer), observationsTimestamp: Number(r.updatedAt), marketStatus: null, reportHash: roundRef(feed, r), roundId: r.roundId.toString() };
    const verification: Verification = {
      status: "onchain", method: "chainlink_data_feed_read", verifier: feed, chainId: FEEDS_CHAIN_ID, configDigest: null, checkedAt: this.now().toISOString(),
      detail: `read from chainlink's aggregator proxy on base mainnet, round ${r.roundId}`,
    };
    return { ...out, ok: problems.length === 0, streamId: feed, price, verification, problems };
  }
}
