import { decodeReport, getReportVersion, type DecodedV11Report } from "@chainlink/data-streams-sdk";
import { formatUnits, keccak256, type Hex } from "viem";
import { MAX_SPREAD_BPS, V11_PRICE_DECIMALS, V11_SCHEMA_PREFIX } from "./config";
import { sessionOf, type MarketSession } from "./market-status";

// decoding and validation of rwa advanced (v11) reports. decoding uses the official sdk
// (`decodeReport`), which also checks that the report is signed for the stream we asked
// for. validation here is about data quality, not signatures: signature checks happen
// in chainlink's verifier proxy (see verifier.ts).

export interface RawReport {
  feedID: string;
  fullReport: string;
  validFromTimestamp: number;
  observationsTimestamp: number;
}

export interface V11Price {
  streamId: Hex;
  /** report hash: keccak256 of the full signed report, for audit references */
  reportHash: Hex;
  fullReport: Hex;
  validFromTimestamp: number;
  observationsTimestamp: number;
  expiresAt: number;
  /** int192 values, 18 decimals */
  mid: bigint;
  bid: bigint;
  ask: bigint;
  lastTradedPrice: bigint;
  /** last update of the mid, nanoseconds */
  lastSeenTimestampNs: bigint;
  marketStatus: number;
  session: MarketSession;
}

export class ReportError extends Error {
  constructor(public code: "decode" | "schema" | "stream_mismatch" | "invalid_price", message: string) { super(message); }
}

export const isV11StreamId = (id: string) => /^0x[0-9a-f]{64}$/i.test(id) && id.toLowerCase().startsWith(V11_SCHEMA_PREFIX);

/** decodes a signed report with the official sdk. throws ReportError on anything unexpected. */
export function decodeV11(raw: RawReport, expectedStreamId: string): V11Price {
  if (raw.feedID.toLowerCase() !== expectedStreamId.toLowerCase()) throw new ReportError("stream_mismatch", `asked for ${expectedStreamId}, got a report for ${raw.feedID}`);
  if (!isV11StreamId(expectedStreamId)) throw new ReportError("schema", `stream ${expectedStreamId} isn't an rwa advanced (v11) stream`);
  let d: DecodedV11Report;
  try {
    if (getReportVersion(expectedStreamId) !== "V11") throw new Error("not v11");
    d = decodeReport(raw.fullReport, expectedStreamId) as DecodedV11Report;
  } catch (e) {
    throw new ReportError("decode", e instanceof Error ? e.message : "couldn't decode the report");
  }
  if (d.version !== "V11") throw new ReportError("schema", `expected v11, got ${d.version}`);
  if (d.feedID.toLowerCase() !== expectedStreamId.toLowerCase()) throw new ReportError("stream_mismatch", `report is signed for ${d.feedID}`);
  return {
    streamId: expectedStreamId.toLowerCase() as Hex,
    reportHash: keccak256(raw.fullReport as Hex),
    fullReport: raw.fullReport as Hex,
    validFromTimestamp: Number(d.validFromTimestamp),
    observationsTimestamp: Number(d.observationsTimestamp),
    expiresAt: Number(d.expiresAt),
    mid: d.mid, bid: d.bid, ask: d.ask, lastTradedPrice: d.lastTradedPrice,
    lastSeenTimestampNs: d.lastSeenTimestampNs,
    marketStatus: d.marketStatus,
    session: sessionOf(d.marketStatus),
  };
}

export type QualityIssue = "non_positive_mid" | "crossed_quote" | "wide_spread" | "stale_mid" | "expired";

/**
 * data-quality checks from chainlink's 24/5 guide: reject zero or negative mids, crossed
 * or very wide quotes (an outlier quote distorting the mid), stale mids and expired reports.
 */
export function qualityIssues(p: V11Price, opts: { nowS: number; maxMidAgeS: number; refS?: number }): QualityIssue[] {
  const out: QualityIssue[] = [];
  if (p.mid <= 0n) out.push("non_positive_mid");
  if (p.bid > 0n && p.ask > 0n) {
    if (p.bid > p.ask) out.push("crossed_quote");
    else if (p.mid > 0n && ((p.ask - p.bid) * 10_000n) / p.mid > BigInt(MAX_SPREAD_BPS)) out.push("wide_spread");
  }
  const ref = BigInt(opts.refS ?? opts.nowS) * 1_000_000_000n;
  if (p.lastSeenTimestampNs <= 0n || ref - p.lastSeenTimestampNs > BigInt(opts.maxMidAgeS) * 1_000_000_000n) out.push("stale_mid");
  if (opts.refS === undefined && p.expiresAt > 0 && p.expiresAt < opts.nowS) out.push("expired");
  return out;
}

/** display only: 18-decimal price → "182.4100" style string with fixed decimals */
export function priceString(units: bigint, decimals = 4): string {
  const s = formatUnits(units, V11_PRICE_DECIMALS);
  const [i, f = ""] = s.split(".");
  return decimals ? `${i}.${(f + "0".repeat(decimals)).slice(0, decimals)}` : i;
}

/** display only, never for settlement maths */
export const priceNumber = (units: bigint) => Number(formatUnits(units, V11_PRICE_DECIMALS));
