import { getAddress } from "viem";

// chainlink data streams: the only source of stock prices for duels.
//
// everything here was checked against chainlink's docs on 2026-11-26:
// - us equities 24/5 streams use the rwa advanced (v11) schema, three streams per asset
//   (regular, extended, overnight), selected with `marketStatus`
//   https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide
// - testnet api / websocket endpoints are the defaults of @chainlink/data-streams-sdk 2.0.0
// - the base sepolia verifier proxy comes from the data streams supported-networks table
//   https://docs.chain.link/data-streams/supported-networks and answers
//   typeAndVersion() = "VerifierProxy 2.0.0" onchain.
//
// credentials (api key + user secret) are server-only and never reach the browser.

export const SUPPORTED_TICKERS = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "GOOGL", "META"] as const;
export type SupportedTicker = (typeof SUPPORTED_TICKERS)[number];
export const isSupportedTicker = (t: string): t is SupportedTicker => (SUPPORTED_TICKERS as readonly string[]).includes(t.toUpperCase());

/** "testnet" pairs with the base sepolia verifier. mainnet streams can't be verified there. */
export type StreamsNetwork = "testnet" | "mainnet";

export const STREAMS_ENDPOINTS: Record<StreamsNetwork, { api: string; ws: string }> = {
  testnet: { api: "https://api.testnet-dataengine.chain.link", ws: "wss://ws.testnet-dataengine.chain.link" },
  mainnet: { api: "https://api.dataengine.chain.link", ws: "wss://ws.dataengine.chain.link" },
};

/** chainlink data streams verifier proxy on base sepolia (chain 84532), from chainlink's docs */
export const BASE_SEPOLIA_VERIFIER_PROXY = getAddress("0x8Ac491b7c118a0cdcF048e0f707247fD8C9575f9");

/** rwa advanced (v11): prices are int192 with 18 decimals */
export const V11_PRICE_DECIMALS = 18;
export const V11_SCHEMA_PREFIX = "0x000b";

export const MARKET_STATUS = { UNKNOWN: 0, PRE_MARKET: 1, REGULAR: 2, POST_MARKET: 3, OVERNIGHT: 4, CLOSED: 5 } as const;

export interface ChainlinkServerConfig {
  network: StreamsNetwork;
  apiKey: string;
  userSecret: string;
  endpoint: string;
  wsEndpoint: string;
}

/** server-only: the data streams credentials, or null when they aren't configured */
export function chainlinkServerConfig(env: Record<string, string | undefined> = process.env): ChainlinkServerConfig | null {
  const apiKey = env.CHAINLINK_DS_API_KEY?.trim();
  const userSecret = env.CHAINLINK_DS_USER_SECRET?.trim();
  if (!apiKey || !userSecret) return null;
  const network: StreamsNetwork = env.CHAINLINK_DS_NETWORK === "mainnet" ? "mainnet" : "testnet";
  return {
    network, apiKey, userSecret,
    endpoint: env.CHAINLINK_DS_API_URL?.trim() || STREAMS_ENDPOINTS[network].api,
    wsEndpoint: env.CHAINLINK_DS_WS_URL?.trim() || STREAMS_ENDPOINTS[network].ws,
  };
}

/** price is "live" only while the mid updated this recently (lastSeenTimestampNs) */
export const LIVE_STALE_AFTER_S = Number(process.env.CHAINLINK_LIVE_STALE_S ?? 300);
/** settlement: the mid must have updated within this many seconds of the reference time */
export const SETTLEMENT_MAX_MID_AGE_S = Number(process.env.CHAINLINK_SETTLEMENT_MAX_AGE_S ?? 120);
/** settlement: a bid/ask spread wider than this share of mid means the quote is unsafe */
export const MAX_SPREAD_BPS = Number(process.env.CHAINLINK_MAX_SPREAD_BPS ?? 200); // 2%
/** settlement: a move bigger than this between start and end with no recorded corporate action pauses settlement (possible split) */
export const UNEXPLAINED_MOVE_PCT = Number(process.env.CHAINLINK_UNEXPLAINED_MOVE_PCT ?? 40);

/**
 * verification policy for settlement. "required" (default): a price only settles a duel
 * after chainlink's verifier proxy on base sepolia accepts the signed report.
 * there is deliberately no setting that skips verification silently.
 */
export const VERIFICATION_REQUIRED = true as const;
