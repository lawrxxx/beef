import type { Hex } from "viem";
import { LIVE_STALE_AFTER_S, SETTLEMENT_MAX_MID_AGE_S, MARKET_STATUS, isSupportedTicker, type SupportedTicker } from "./config";
import type { DiscoveredStream } from "./discovery";
import type { StreamSession } from "./directory";
import { SESSION_LABEL, sessionOf, streamForStatus, type MarketSession } from "./market-status";
import { ReportError, decodeV11, priceString, qualityIssues, type RawReport, type V11Price } from "./report";
import type { Verification } from "./verifier";

// prices from chainlink data streams, two ways:
// - live(): the latest report, switched by marketStatus (regular → extended → overnight),
//   for display while a duel runs. never used to settle.
// - reference(): the regular-hours report at a fixed observation time, verified by
//   chainlink's verifier, for locking starting prices and settling. see METHODOLOGY.

/** the parts of the sdk client this module uses (DataStreamsClient satisfies it) */
export interface StreamsApi {
  getLatestReport(streamId: string): Promise<RawReport>;
  getReportByTimestamp(streamId: string, timestamp: number): Promise<RawReport>;
}

export type StreamsFor = (ticker: SupportedTicker) => Promise<Partial<Record<StreamSession, DiscoveredStream>> | null>;
export type Verify = (p: V11Price) => Promise<Verification>;

/** every report a lock or settlement relies on is kept with its metadata for audit (live display reports aren't stored) */
export interface StoredReport {
  ticker: string;
  purpose: "live" | "reference";
  session?: string;
  referenceTimestamp?: number;
  price: V11Price;
  verification: Verification | null;
}
export type SaveReport = (r: StoredReport) => Promise<void>;

export const METHODOLOGY = {
  id: "chainlink_regular_hours_mid_v1",
  summary:
    "starting and ending prices are the mid from each stock's chainlink 24/5 regular-hours stream (rwa advanced v11), " +
    "taken from the report observed one second before the official 4:00pm et close (1:00pm on early-close days) of the lock and end sessions. " +
    "both stocks use the same two timestamps. a report counts only if chainlink's base sepolia verifier accepts its signatures, " +
    "marketStatus is 2 (regular hours), the mid is positive, the quote isn't crossed or unusually wide, and the mid updated within 2 minutes of the timestamp. " +
    "otherwise settlement pauses for verification. return = (end − start) / start × 100, compared at 0.0001 percentage points.",
} as const;

export interface LiveQuote {
  ticker: string;
  source: "chainlink";
  status: "live" | "stale" | "closed" | "unknown" | "unavailable";
  session: MarketSession;
  sessionLabel: string;
  marketStatus: number | null;
  streamId: Hex | null;
  streamSession: StreamSession | null;
  /** display strings, 4 decimals; bigint values as decimal strings with 18 decimals */
  price: string | null;
  priceE18: string | null;
  bidE18: string | null;
  askE18: string | null;
  observationsTimestamp: number | null;
  lastSeenAt: string | null;
  reason?: string;
}

const unavailable = (ticker: string, reason: string): LiveQuote => ({
  ticker, source: "chainlink", status: "unavailable", session: "unknown", sessionLabel: SESSION_LABEL.unknown, marketStatus: null,
  streamId: null, streamSession: null, price: null, priceE18: null, bidE18: null, askE18: null, observationsTimestamp: null, lastSeenAt: null, reason,
});

const quoteOf = (ticker: string, p: V11Price, streamSession: StreamSession, status: LiveQuote["status"], marketStatus: number, reason?: string): LiveQuote => ({
  ticker, source: "chainlink", status, session: sessionOf(marketStatus), sessionLabel: SESSION_LABEL[sessionOf(marketStatus)], marketStatus,
  streamId: p.streamId, streamSession, price: priceString(p.mid), priceE18: p.mid.toString(), bidE18: p.bid.toString(), askE18: p.ask.toString(),
  observationsTimestamp: p.observationsTimestamp, lastSeenAt: new Date(Number(p.lastSeenTimestampNs / 1_000_000n)).toISOString(), reason,
});

/** what settlement needs from one price observation, whichever chainlink product it came from */
export interface PricePoint {
  /** data streams stream id, or the data feed's proxy address */
  streamId: Hex;
  /** 18-decimal price */
  mid: bigint;
  observationsTimestamp: number;
  /** data streams marketStatus; null for data feeds, which don't publish one */
  marketStatus: number | null;
  /** keccak of the signed report (streams) or of the feed round (feeds) */
  reportHash: Hex;
  roundId?: string;
}

export interface ReferencePrice {
  ok: boolean;
  ticker: string;
  session: string;
  /** unix seconds the report must be observed at */
  referenceTimestamp: number;
  streamId: Hex | null;
  price: PricePoint | null;
  verification: Verification | null;
  problems: string[];
}

export class ChainlinkPrices {
  readonly totalReturn = false;
  readonly methodology = METHODOLOGY;
  constructor(private deps: { api: StreamsApi; streams: StreamsFor; verify: Verify; save?: SaveReport; now?: () => Date }) {}
  private now() { return this.deps.now?.() ?? new Date(); }

  /** latest price, with the stream chosen by the regular stream's marketStatus */
  async live(ticker: string): Promise<LiveQuote> {
    if (!isSupportedTicker(ticker)) return unavailable(ticker, "chainlink streams aren't set up for this stock");
    const t = ticker.toUpperCase() as SupportedTicker;
    const streams = await this.deps.streams(t);
    if (!streams?.regular || !streams.extended || !streams.overnight) return unavailable(t, "no verified chainlink streams for this stock");
    const nowS = Math.floor(this.now().getTime() / 1000);
    let regular: V11Price;
    try {
      regular = decodeV11(await this.deps.api.getLatestReport(streams.regular.streamId), streams.regular.streamId);
    } catch (e) {
      return unavailable(t, e instanceof ReportError ? e.message : "couldn't reach chainlink");
    }
    const which = streamForStatus(regular.marketStatus);
    if (regular.marketStatus === MARKET_STATUS.CLOSED) {
      // closed is a real state: show the last regular-hours value, clearly not live
      return regular.mid > 0n ? quoteOf(t, regular, "regular", "closed", regular.marketStatus, "market closed: last regular-hours price") : unavailable(t, "market closed");
    }
    if (!which) return { ...unavailable(t, "chainlink reports the market status as unknown"), status: "unknown", marketStatus: regular.marketStatus };
    let p = regular;
    if (which !== "regular") {
      const s = streams[which]!;
      try { p = decodeV11(await this.deps.api.getLatestReport(s.streamId), s.streamId); }
      catch (e) { return unavailable(t, e instanceof ReportError ? e.message : "couldn't reach chainlink"); }
    }
    const issues = qualityIssues(p, { nowS, maxMidAgeS: LIVE_STALE_AFTER_S });
    if (issues.includes("non_positive_mid") || issues.includes("crossed_quote")) return unavailable(t, `chainlink price rejected (${issues.join(", ")})`);
    return quoteOf(t, p, which, issues.length ? "stale" : "live", regular.marketStatus, issues.length ? issues.join(", ") : undefined);
  }

  /**
   * the settlement price for one stock and session, per METHODOLOGY. returns problems
   * instead of throwing, so the caller can pause settlement with a reason.
   */
  async reference(ticker: string, session: string, closeUtc: Date): Promise<ReferencePrice> {
    const referenceTimestamp = Math.floor(closeUtc.getTime() / 1000) - 1;
    const base: ReferencePrice = { ok: false, ticker, session, referenceTimestamp, streamId: null, price: null, verification: null, problems: [] };
    if (!isSupportedTicker(ticker)) return { ...base, problems: [`${ticker}: no chainlink streams configured`] };
    const t = ticker.toUpperCase() as SupportedTicker;
    if (referenceTimestamp * 1000 > this.now().getTime()) return { ...base, problems: [`${t}: the ${session} close hasn't happened yet`] };
    const streams = await this.deps.streams(t);
    const regular = streams?.regular;
    if (!regular) return { ...base, problems: [`${t}: no verified chainlink regular-hours stream`] };
    let p: V11Price;
    try {
      p = decodeV11(await this.deps.api.getReportByTimestamp(regular.streamId, referenceTimestamp), regular.streamId);
    } catch (e) {
      return { ...base, streamId: regular.streamId, problems: [`${t}: no usable chainlink report at ${new Date(referenceTimestamp * 1000).toISOString()} (${e instanceof Error ? e.message : "request failed"})`] };
    }
    const problems: string[] = [];
    if (p.observationsTimestamp > referenceTimestamp || p.observationsTimestamp < referenceTimestamp - 5) {
      problems.push(`${t}: report observed at ${p.observationsTimestamp}, expected ${referenceTimestamp}`);
    }
    if (p.marketStatus !== MARKET_STATUS.REGULAR) problems.push(`${t}: market status was ${SESSION_LABEL[p.session]} (${p.marketStatus}) at the reference time, not regular hours`);
    for (const q of qualityIssues(p, { nowS: referenceTimestamp, refS: referenceTimestamp, maxMidAgeS: SETTLEMENT_MAX_MID_AGE_S })) {
      problems.push(`${t}: ${q === "stale_mid" ? `mid hadn't updated for over ${SETTLEMENT_MAX_MID_AGE_S}s (possible halt or outage)` : q.replace(/_/g, " ")}`);
    }
    const verification = await this.deps.verify(p);
    if (verification.status !== "verified") problems.push(`${t}: report not verified by chainlink (${verification.status}: ${verification.detail})`);
    await this.deps.save?.({ ticker: t, purpose: "reference", session, referenceTimestamp, price: p, verification });
    return { ...base, ok: problems.length === 0, streamId: p.streamId, price: p, verification, problems };
  }
}
