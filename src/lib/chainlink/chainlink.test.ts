import { describe, expect, it } from "vitest";
import { createPublicClient, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_VERIFIER_PROXY, SUPPORTED_TICKERS } from "./config";
import { CHAINLINK_DIRECTORY } from "./directory";
import { discoverStreams, type ApiFeed } from "./discovery";
import { SESSION_LABEL, sessionOf, streamForStatus } from "./market-status";
import { ReportError, decodeV11, isV11StreamId, qualityIssues } from "./report";
import { ChainlinkPrices, type StreamsApi } from "./prices";
import { VERIFIER_PROXY_ABI, verifyWithChainlink, type Verification } from "./verifier";
import { fixtureReport, fixtureStream } from "./fixtures";

// unit tests run on synthetic fixture reports (lib/chainlink/fixtures.ts). they test
// beef's handling of chainlink data, not chainlink's data.

const T0 = Date.parse("2026-12-01T20:59:59Z") / 1000;

const apiFeedsFor = (net: "testnet" | "mainnet", drop: string[] = []): ApiFeed[] =>
  SUPPORTED_TICKERS.flatMap((t) => (["regular", "extended", "overnight"] as const).map((s) => ({
    feedID: CHAINLINK_DIRECTORY[net][t][s].streamId, name: CHAINLINK_DIRECTORY[net][t][s].name, decimals: 18, asset: t, quoteAsset: "USD",
  }))).filter((f) => !drop.includes(f.feedID));

describe("stream directory", () => {
  it("has a v11 regular, extended and overnight stream per ticker, all distinct", () => {
    const ids = new Set<string>();
    for (const net of ["testnet", "mainnet"] as const) for (const t of SUPPORTED_TICKERS) for (const s of ["regular", "extended", "overnight"] as const) {
      const e = CHAINLINK_DIRECTORY[net][t][s];
      expect(isV11StreamId(e.streamId)).toBe(true);
      expect(e.name.startsWith(`${t}/USD-Streams-`)).toBe(true);
      ids.add(e.streamId);
    }
    expect(ids.size).toBe(42);
  });
});

describe("stream discovery", () => {
  it("accepts streams chainlink's api lists that match chainlink's directory", () => {
    const r = discoverStreams(apiFeedsFor("testnet"), "testnet");
    expect(r.every((x) => x.status === "available")).toBe(true);
    const nvda = r.find((x) => x.ticker === "NVDA")!;
    expect(nvda.streams.regular?.streamId).toBe(CHAINLINK_DIRECTORY.testnet.NVDA.regular.streamId);
    expect(nvda.streams.overnight?.verifier).toBe("base_sepolia_verifier_proxy");
  });
  it("fails safely: a ticker missing one stream is unavailable, others unaffected", () => {
    const r = discoverStreams(apiFeedsFor("testnet", [CHAINLINK_DIRECTORY.testnet.TSLA.overnight.streamId]), "testnet");
    expect(r.find((x) => x.ticker === "TSLA")!.status).toBe("unavailable");
    expect(r.find((x) => x.ticker === "TSLA")!.problems[0]).toMatch(/overnight.*isn't accessible/);
    expect(r.filter((x) => x.status === "available")).toHaveLength(6);
  });
  it("rejects conflicting ids the api reports for a ticker and session (no guessing)", () => {
    const feeds = [...apiFeedsFor("testnet"), { feedID: "0x000b" + "ab".repeat(30), name: "AAPL/USD-Streams-RegularHoursEquityPrice", decimals: 18, asset: "AAPL", quoteAsset: "USD" }];
    const aapl = discoverStreams(feeds, "testnet").find((x) => x.ticker === "AAPL")!;
    expect(aapl.status).toBe("unavailable");
    expect(aapl.problems[0]).toMatch(/isn't in chainlink's directory/);
  });
  it("mainnet streams don't claim the base sepolia verifier; no access means nothing available", () => {
    expect(discoverStreams(apiFeedsFor("mainnet"), "mainnet")[0].streams.regular?.verifier).toBe("none_for_network");
    expect(discoverStreams([], "testnet").every((x) => x.status === "unavailable")).toBe(true);
  });
});

describe("market status", () => {
  it("maps all six values and picks the stream", () => {
    expect([0, 1, 2, 3, 4, 5].map(sessionOf)).toEqual(["unknown", "pre_market", "regular", "post_market", "overnight", "closed"]);
    expect([1, 2, 3, 4].map(streamForStatus)).toEqual(["extended", "regular", "extended", "overnight"]);
    expect([0, 5, 6, 99].map(streamForStatus)).toEqual([null, null, null, null]);
    expect(sessionOf(7)).toBe("unknown");
    expect(SESSION_LABEL.post_market).toBe("after hours");
  });
});

describe("report decoding (official sdk) and validation", () => {
  const id = fixtureStream("NVDA");
  it("decodes a v11 report", () => {
    const p = decodeV11(fixtureReport({ streamId: id, observationsTimestamp: T0, mid: "182.41", marketStatus: 2 }), id);
    expect(p.mid).toBe(182_410_000_000_000_000_000n);
    expect([p.marketStatus, p.session, p.observationsTimestamp]).toEqual([2, "regular", T0]);
    expect(p.reportHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("rejects a report for another stream and non-v11 / invalid stream ids", () => {
    const other = fixtureReport({ streamId: fixtureStream("AAPL"), observationsTimestamp: T0, mid: "1" });
    expect(() => decodeV11(other, id)).toThrow(ReportError);
    expect(() => decodeV11({ ...other, feedID: "0x0003" + "00".repeat(30) }, "0x0003" + "00".repeat(30))).toThrow(/v11/);
    expect(() => decodeV11({ ...other, feedID: "0xnope" }, "0xnope")).toThrow(ReportError);
  });
  it("flags zero mids, crossed and wide quotes, stale mids and expired reports", () => {
    const at = (o: Partial<Parameters<typeof fixtureReport>[0]>) => decodeV11(fixtureReport({ streamId: id, observationsTimestamp: T0, mid: "100", ...o }), id);
    expect(qualityIssues(at({ mid: "0", bid: "0", ask: "0" }), { nowS: T0, maxMidAgeS: 120 })).toContain("non_positive_mid");
    expect(qualityIssues(at({ bid: "101", ask: "99" }), { nowS: T0, maxMidAgeS: 120 })).toContain("crossed_quote");
    expect(qualityIssues(at({ bid: "95", ask: "105" }), { nowS: T0, maxMidAgeS: 120 })).toContain("wide_spread");
    expect(qualityIssues(at({ midAgeS: 600 }), { nowS: T0, maxMidAgeS: 120 })).toContain("stale_mid");
    expect(qualityIssues(at({ expiresAt: T0 - 1 }), { nowS: T0, maxMidAgeS: 120 })).toContain("expired");
    expect(qualityIssues(at({}), { nowS: T0, maxMidAgeS: 120 })).toEqual([]);
  });
});

// a fake api serving fixture reports; keyed by stream id (and timestamp for history)
function fakeApi(latest: Record<string, ReturnType<typeof fixtureReport>>, byTs: Record<string, ReturnType<typeof fixtureReport>> = {}): StreamsApi {
  return {
    async getLatestReport(id) { const r = latest[id]; if (!r) throw new Error("404 not found"); return r; },
    async getReportByTimestamp(id, ts) { const r = byTs[`${id}@${ts}`]; if (!r) throw new Error("404 no report at timestamp"); return r; },
  };
}
const allStreams = async (t: (typeof SUPPORTED_TICKERS)[number]) => ({
  regular: { ticker: t, session: "regular" as const, streamId: fixtureStream(t, "regular"), name: "", schema: "v11" as const, decimals: 18, network: "testnet" as const, verifier: "base_sepolia_verifier_proxy" as const },
  extended: { ticker: t, session: "extended" as const, streamId: fixtureStream(t, "extended"), name: "", schema: "v11" as const, decimals: 18, network: "testnet" as const, verifier: "base_sepolia_verifier_proxy" as const },
  overnight: { ticker: t, session: "overnight" as const, streamId: fixtureStream(t, "overnight"), name: "", schema: "v11" as const, decimals: 18, network: "testnet" as const, verifier: "base_sepolia_verifier_proxy" as const },
});
const verified = async (): Promise<Verification> => ({ status: "verified", method: "chainlink_verifier_proxy_eth_call", verifier: BASE_SEPOLIA_VERIFIER_PROXY, chainId: 84532, configDigest: null, checkedAt: "", detail: "" });

describe("live prices: session switching by marketStatus", () => {
  const now = () => new Date(T0 * 1000);
  const reg = (status: number, mid = "180") => fixtureReport({ streamId: fixtureStream("NVDA"), observationsTimestamp: T0, mid, marketStatus: status });
  const ext = fixtureReport({ streamId: fixtureStream("NVDA", "extended"), observationsTimestamp: T0, mid: "181", marketStatus: 3 });
  const ovn = fixtureReport({ streamId: fixtureStream("NVDA", "overnight"), observationsTimestamp: T0, mid: "179", marketStatus: 4 });
  const prices = (status: number) => new ChainlinkPrices({ api: fakeApi({ [fixtureStream("NVDA")]: reg(status), [fixtureStream("NVDA", "extended")]: ext, [fixtureStream("NVDA", "overnight")]: ovn }), streams: allStreams, verify: verified, now });

  it("regular → regular stream, pre/post → extended, overnight → overnight", async () => {
    expect((await prices(2).live("NVDA"))).toMatchObject({ status: "live", streamSession: "regular", price: "180.0000", session: "regular" });
    expect((await prices(1).live("NVDA"))).toMatchObject({ streamSession: "extended", price: "181.0000", session: "pre_market" });
    expect((await prices(3).live("NVDA"))).toMatchObject({ streamSession: "extended", session: "post_market" });
    expect((await prices(4).live("NVDA"))).toMatchObject({ streamSession: "overnight", price: "179.0000", session: "overnight" });
  });
  it("closed shows the last regular-hours price, never as live; unknown yields no price", async () => {
    expect(await prices(5).live("NVDA")).toMatchObject({ status: "closed", session: "closed", price: "180.0000" });
    expect(await prices(0).live("NVDA")).toMatchObject({ status: "unknown", price: null });
  });
  it("stale mid is labelled stale, a zero mid is rejected, missing reports and unsupported tickers fail safely", async () => {
    const stale = fixtureReport({ streamId: fixtureStream("NVDA"), observationsTimestamp: T0, mid: "180", marketStatus: 2, midAgeS: 3600 });
    const p1 = new ChainlinkPrices({ api: fakeApi({ [fixtureStream("NVDA")]: stale }), streams: allStreams, verify: verified, now });
    expect((await p1.live("NVDA")).status).toBe("stale");
    const zero = fixtureReport({ streamId: fixtureStream("NVDA"), observationsTimestamp: T0, mid: "0", bid: "0", ask: "0", marketStatus: 2 });
    expect((await new ChainlinkPrices({ api: fakeApi({ [fixtureStream("NVDA")]: zero }), streams: allStreams, verify: verified, now }).live("NVDA")).status).toBe("unavailable");
    expect((await new ChainlinkPrices({ api: fakeApi({}), streams: allStreams, verify: verified, now }).live("NVDA")).status).toBe("unavailable");
    expect((await prices(2).live("AMD")).reason).toMatch(/aren't set up/);
    expect((await new ChainlinkPrices({ api: fakeApi({}), streams: async () => null, verify: verified, now }).live("NVDA")).reason).toMatch(/no verified chainlink streams/);
  });
});

describe("verifier (chainlink's verifier proxy)", () => {
  const id = fixtureStream("NVDA");
  const p = decodeV11(fixtureReport({ streamId: id, observationsTimestamp: T0, mid: "100" }), id);
  it("reports an unregistered DON config without claiming verification", async () => {
    const client = { readContract: async () => "0x0000000000000000000000000000000000000000", call: async () => ({ data: undefined }) } as any;
    expect((await verifyWithChainlink(client, p)).status).toBe("unsupported_config");
  });
  it("a revert is a failed verification, never a pass", async () => {
    const client = { readContract: async () => "0x1111111111111111111111111111111111111111", call: async () => { throw Object.assign(new Error("x"), { shortMessage: "execution reverted" }); } } as any;
    const v = await verifyWithChainlink(client, p);
    expect(v.status).toBe("reverted");
    expect(v.method).toBe("chainlink_verifier_proxy_eth_call");
  });
  it("uses the verifier proxy from chainlink's docs", () => {
    expect(BASE_SEPOLIA_VERIFIER_PROXY).toBe("0x8Ac491b7c118a0cdcF048e0f707247fD8C9575f9");
    expect(VERIFIER_PROXY_ABI.map((f) => f.name)).toContain("verify");
  });

  // optional live check against base sepolia: chainlink's real verifier must refuse an unsigned fixture
  it.runIf(process.env.CHAINLINK_LIVE_VERIFIER_TEST === "1")("live: chainlink's base sepolia verifier refuses an unsigned fixture", async () => {
    const client = createPublicClient({ chain: baseSepolia, transport: http() });
    expect(await client.readContract({ address: BASE_SEPOLIA_VERIFIER_PROXY, abi: VERIFIER_PROXY_ABI, functionName: "typeAndVersion" })).toBe("VerifierProxy 2.0.0");
    const v = await verifyWithChainlink(client, p);
    expect(v.status).not.toBe("verified");
  }, 30_000);
});

export const _unused: Hex | undefined = undefined;
