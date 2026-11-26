import "server-only";
import { createClient, type DataStreamsClient } from "@chainlink/data-streams-sdk";
import { createPublicClient, http } from "viem";
import { CHAIN } from "@/lib/chain/config";
import { chainlinkServerConfig, type SupportedTicker } from "@/lib/chainlink/config";
import { discoverStreams, type DiscoveredStream, type TickerDiscovery } from "@/lib/chainlink/discovery";
import type { StreamSession } from "@/lib/chainlink/directory";
import { ChainlinkPrices, type LiveQuote, type StoredReport } from "@/lib/chainlink/prices";
import { verifyWithChainlink } from "@/lib/chainlink/verifier";
import { getAdminSupabase } from "@/lib/supabase/server";

// server wiring for chainlink data streams: the sdk client (credentials stay here),
// stream config from the database (written only by discovery), report storage, and
// verification against chainlink's base sepolia verifier proxy.

let client: DataStreamsClient | null | undefined;
export function streamsClient(): DataStreamsClient | null {
  if (client !== undefined) return client;
  const cfg = chainlinkServerConfig();
  client = cfg ? createClient({ apiKey: cfg.apiKey, userSecret: cfg.userSecret, endpoint: cfg.endpoint, wsEndpoint: cfg.wsEndpoint, timeout: 10_000, retryAttempts: 2 }) : null;
  return client;
}

const baseSepolia = createPublicClient({ chain: CHAIN, transport: http(process.env.BASE_SEPOLIA_RPC_URL || undefined) });

type StreamRows = Partial<Record<StreamSession, DiscoveredStream>>;
let streamCache: { at: number; rows: Map<string, StreamRows> } | null = null;

/** verified stream config for a ticker, from price_streams (filled by discovery) */
async function streamsFor(ticker: SupportedTicker): Promise<StreamRows | null> {
  const cfg = chainlinkServerConfig();
  const db = getAdminSupabase();
  if (!cfg || !db) return null;
  if (!streamCache || Date.now() - streamCache.at > 5 * 60_000) {
    const { data } = await db.from("price_streams").select("*").eq("network", cfg.network);
    const rows = new Map<string, StreamRows>();
    for (const r of data ?? []) {
      const cur = rows.get(r.ticker) ?? {};
      cur[r.session as StreamSession] = { ticker: r.ticker, session: r.session, streamId: r.stream_id, name: r.name, schema: "v11", decimals: r.decimals, network: r.network, verifier: r.verifier };
      rows.set(r.ticker, cur);
    }
    streamCache = { at: Date.now(), rows };
  }
  return streamCache.rows.get(ticker) ?? null;
}

async function saveReport(r: StoredReport) {
  const db = getAdminSupabase();
  if (!db) throw new Error("no database to store the chainlink report");
  const p = r.price;
  const { error } = await db.from("price_reports").upsert({
    report_hash: p.reportHash, ticker: r.ticker, stream_id: p.streamId, purpose: r.purpose, session: r.session ?? null, reference_ts: r.referenceTimestamp ?? null,
    observations_ts: p.observationsTimestamp, valid_from_ts: p.validFromTimestamp, expires_at: p.expiresAt, market_status: p.marketStatus,
    mid: p.mid.toString(), bid: p.bid.toString(), ask: p.ask.toString(), last_traded: p.lastTradedPrice.toString(), last_seen_ns: p.lastSeenTimestampNs.toString(),
    full_report: p.fullReport, verification: r.verification,
  }, { onConflict: "report_hash", ignoreDuplicates: true });
  if (error) throw new Error(`couldn't store the chainlink report: ${error.message}`);
}

/** chainlink prices, or null when data streams credentials or the database aren't configured */
export function chainlinkPrices(): ChainlinkPrices | null {
  const api = streamsClient();
  if (!api || !getAdminSupabase()) return null;
  return new ChainlinkPrices({ api, streams: streamsFor, verify: (p) => verifyWithChainlink(baseSepolia, p), save: saveReport });
}

const liveCache = new Map<string, { at: number; q: LiveQuote }>();
/** live quotes with a short cache so many viewers don't multiply api calls */
export async function liveQuotes(tickers: string[]): Promise<LiveQuote[]> {
  const prices = chainlinkPrices();
  return Promise.all(tickers.map(async (t) => {
    if (!prices) return { ticker: t, source: "chainlink" as const, status: "unavailable" as const, session: "unknown" as const, sessionLabel: "market status unknown", marketStatus: null, streamId: null, streamSession: null, price: null, priceE18: null, bidE18: null, askE18: null, observationsTimestamp: null, lastSeenAt: null, reason: "chainlink data streams isn't configured on this deployment" };
    const hit = liveCache.get(t);
    if (hit && Date.now() - hit.at < 10_000) return hit.q;
    const q = await prices.live(t);
    liveCache.set(t, { at: Date.now(), q });
    return q;
  }));
}

/** runs discovery against chainlink's api and stores the verified streams */
export async function runDiscovery(): Promise<{ network: string; results: TickerDiscovery[]; stored: number }> {
  const cfg = chainlinkServerConfig();
  const api = streamsClient();
  const db = getAdminSupabase();
  if (!cfg || !api) throw new Error("chainlink data streams credentials aren't configured");
  if (!db) throw new Error("no database configured");
  let feeds;
  try { feeds = await api.listFeeds(); }
  catch (e) {
    const err = e as Error & { statusCode?: number };
    throw Object.assign(new Error(`chainlink listFeeds failed${err.statusCode ? ` (http ${err.statusCode})` : ""}: ${err.message || err.name || "no message"}`), { statusCode: err.statusCode, cause: e });
  }
  const results = discoverStreams(feeds, cfg.network);
  const rows = results.filter((r) => r.status === "available").flatMap((r) => Object.values(r.streams)).map((s) => ({
    network: s!.network, ticker: s!.ticker, session: s!.session, stream_id: s!.streamId, name: s!.name, schema: s!.schema, decimals: s!.decimals, verifier: s!.verifier, discovered_at: new Date().toISOString(),
  }));
  // replace this network's config with exactly what was verified now
  await db.from("price_streams").delete().eq("network", cfg.network);
  if (rows.length) {
    const { error } = await db.from("price_streams").insert(rows);
    if (error) throw new Error(error.message);
  }
  streamCache = null;
  return { network: cfg.network, results, stored: rows.length };
}
