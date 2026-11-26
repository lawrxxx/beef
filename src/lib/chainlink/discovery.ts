import { SUPPORTED_TICKERS, V11_PRICE_DECIMALS, type StreamsNetwork, type SupportedTicker } from "./config";
import { CHAINLINK_DIRECTORY, type StreamSession } from "./directory";
import { isV11StreamId } from "./report";

// stream discovery: asks chainlink which streams this account can read (sdk listFeeds →
// GET /api/v1/feeds), finds the regular / extended / overnight stream for each supported
// ticker, and keeps a stream only when chainlink's api and chainlink's published directory
// agree on its id. nothing is guessed: a ticker missing any of its three streams is
// unavailable for duels.

export interface ApiFeed { feedID: string; name: string; decimals: number; asset: string; quoteAsset: string }

export interface DiscoveredStream {
  ticker: SupportedTicker;
  session: StreamSession;
  streamId: `0x${string}`;
  name: string;
  schema: "v11";
  decimals: number;
  network: StreamsNetwork;
  /** onchain verification: chainlink's base sepolia verifier proxy, testnet reports only */
  verifier: "base_sepolia_verifier_proxy" | "none_for_network";
}

export interface TickerDiscovery {
  ticker: SupportedTicker;
  status: "available" | "unavailable";
  streams: Partial<Record<StreamSession, DiscoveredStream>>;
  problems: string[];
}

const SESSION_RE: Record<StreamSession, RegExp> = {
  regular: /RegularHours/i,
  extended: /ExtendedHours/i,
  overnight: /OvernightHours/i,
};
const SESSIONS: StreamSession[] = ["regular", "extended", "overnight"];

const assetOf = (f: ApiFeed) => (f.asset || f.name.split("/")[0] || "").toUpperCase();

export function discoverStreams(feeds: ApiFeed[], network: StreamsNetwork): TickerDiscovery[] {
  const byId = new Map(feeds.map((f) => [f.feedID.toLowerCase(), f]));
  return SUPPORTED_TICKERS.map((ticker) => {
    const problems: string[] = [];
    const streams: TickerDiscovery["streams"] = {};
    for (const session of SESSIONS) {
      const ref = CHAINLINK_DIRECTORY[network][ticker][session];
      const api = byId.get(ref.streamId.toLowerCase());
      // a stream the api lists for this ticker + session under a different id is a conflict
      const conflicting = feeds.filter((f) => assetOf(f) === ticker && SESSION_RE[session].test(f.name) && f.feedID.toLowerCase() !== ref.streamId.toLowerCase());
      if (conflicting.length) problems.push(`${session}: chainlink's api lists ${conflicting.map((c) => c.feedID).join(", ")}, which isn't in chainlink's directory`);
      if (!api) { problems.push(`${session}: ${ref.name} (${ref.streamId}) isn't accessible to this account`); continue; }
      if (assetOf(api) !== ticker) { problems.push(`${session}: stream ${api.feedID} is for ${assetOf(api)}, not ${ticker}`); continue; }
      if (!SESSION_RE[session].test(api.name)) { problems.push(`${session}: stream ${api.feedID} is named "${api.name}"`); continue; }
      if (!isV11StreamId(api.feedID)) { problems.push(`${session}: stream ${api.feedID} isn't rwa advanced (v11)`); continue; }
      if (api.decimals && api.decimals !== V11_PRICE_DECIMALS) { problems.push(`${session}: unexpected decimals ${api.decimals}`); continue; }
      streams[session] = {
        ticker, session, streamId: ref.streamId, name: api.name, schema: "v11", decimals: V11_PRICE_DECIMALS, network,
        verifier: network === "testnet" ? "base_sepolia_verifier_proxy" : "none_for_network",
      };
    }
    const complete = SESSIONS.every((s) => streams[s]) && problems.length === 0;
    return { ticker, status: complete ? "available" : "unavailable", streams, problems };
  });
}
