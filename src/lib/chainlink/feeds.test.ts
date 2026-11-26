import { describe, expect, it } from "vitest";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { CHAINLINK_FEEDS, ChainlinkFeedPrices, calendarSession, type FeedClient } from "./feeds";
import { SUPPORTED_TICKERS } from "./config";
import { sessionCloseUtc } from "@/lib/market/calendar";

// fake aggregator for isolated unit tests: rounds with made-up values (not market data)
function fakeFeed(rounds: { answer: bigint; updatedAt: number }[], opts: { description?: (a: Address) => string; decimals?: number } = {}): FeedClient {
  const phase = 1n << 64n;
  const byId = new Map(rounds.map((r, i) => [phase | BigInt(i + 1), r]));
  const latestId = phase | BigInt(rounds.length);
  const desc = (a: Address) => opts.description?.(a) ?? `Coinbase ${Object.entries(CHAINLINK_FEEDS).find(([, v]) => v.feed === a)![0]}`;
  const row = (id: bigint) => { const r = byId.get(id); if (!r) throw new Error("no round"); return [id, r.answer, BigInt(r.updatedAt), BigInt(r.updatedAt), id] as const; };
  return {
    readContract: (async ({ address, functionName, args }: any) => {
      if (functionName === "description") return desc(address);
      if (functionName === "decimals") return opts.decimals ?? 8;
      if (functionName === "latestRoundData") return row(latestId);
      if (functionName === "getRoundData") return row(args[0]);
      throw new Error(functionName);
    }) as any,
    multicall: (async ({ contracts }: any) => contracts.map((c: any) => { try { return { status: "success", result: row(c.args[0]) }; } catch (e) { return { status: "failure", error: e }; } })) as any,
  };
}

const CLOSE_TUE = sessionCloseUtc("2026-12-01"), CLOSE_FRI = sessionCloseUtc("2026-12-04");
const s = (d: Date, offS: number) => Math.floor(d.getTime() / 1000) + offS;

describe("chainlink data feeds (base mainnet)", () => {
  it("has a feed for every supported ticker", () => {
    expect(Object.keys(CHAINLINK_FEEDS).sort()).toEqual([...SUPPORTED_TICKERS].sort());
  });
  it("reference = latest round updated at or before the close, converted to 18 decimals", async () => {
    const client = fakeFeed([
      { answer: 179_00000000n, updatedAt: s(CLOSE_TUE, -7200) },
      { answer: 180_00000000n, updatedAt: s(CLOSE_TUE, -60) },
      { answer: 185_00000000n, updatedAt: s(CLOSE_TUE, 600) }, // after the close: ignored
      ...Array.from({ length: 120 }, (_, i) => ({ answer: 186_00000000n, updatedAt: s(CLOSE_TUE, 3600 + i * 60) })), // forces a multi-batch walk
    ]);
    const r = await new ChainlinkFeedPrices({ client, now: () => new Date("2026-12-10") }).reference("NVDA", "2026-12-01", CLOSE_TUE);
    expect(r.ok).toBe(true);
    expect(r.price!.mid).toBe(180_000000000000000000n);
    expect(r.price!.observationsTimestamp).toBe(s(CLOSE_TUE, -60));
    expect(r.verification).toMatchObject({ status: "onchain", method: "chainlink_data_feed_read", chainId: 8453 });
  });
  it("pauses on a stale (frozen or halted) feed, a missing round, a wrong feed, or a non-positive value", async () => {
    const now = () => new Date("2026-12-10");
    const stale = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 1_00000000n, updatedAt: s(CLOSE_TUE, -30 * 3600) }]), now }).reference("NVDA", "2026-12-01", CLOSE_TUE);
    expect(stale.problems.join()).toMatch(/hadn't updated for over 25 hours/);
    const none = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 1_00000000n, updatedAt: s(CLOSE_TUE, 60) }]), now }).reference("NVDA", "2026-12-01", CLOSE_TUE);
    expect(none.problems.join()).toMatch(/no chainlink feed round/);
    const wrong = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 1n, updatedAt: s(CLOSE_TUE, -1) }], { description: () => "Coinbase AMD" }), now }).reference("NVDA", "2026-12-01", CLOSE_TUE);
    expect(wrong.problems.join()).toMatch(/not "Coinbase NVDA"/);
    const neg = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: -5n, updatedAt: s(CLOSE_TUE, -1) }]), now }).reference("NVDA", "2026-12-01", CLOSE_TUE);
    expect(neg.ok).toBe(false);
  });
  it("live: open/closed/stale labelling from the calendar and the 24h heartbeat", async () => {
    const at = new Date("2026-12-01T18:00:00Z"); // tue 1pm et, regular hours
    const fresh = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 150_12345678n, updatedAt: s(at, -600) }]), now: () => at }).live("NVDA");
    expect(fresh).toMatchObject({ status: "live", session: "regular", price: "150.1234" });
    const old = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 150_00000000n, updatedAt: s(at, -30 * 3600) }]), now: () => at }).live("NVDA");
    expect(old.status).toBe("stale");
    const sat = new Date("2026-12-05T18:00:00Z");
    expect((await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 150_00000000n, updatedAt: s(sat, -86400) }]), now: () => sat }).live("NVDA")).status).toBe("closed");
    expect(calendarSession(new Date("2026-12-01T13:00:00Z"))).toBe("pre_market");
    expect(calendarSession(new Date("2026-12-01T22:00:00Z"))).toBe("post_market");
  });
  it("observe: first round at or after the agreed time, within the max delay", async () => {
    const T = CLOSE_TUE;
    const rounds = [{ answer: 100_00000000n, updatedAt: s(T, -60) }, { answer: 101_00000000n, updatedAt: s(T, 300) }];
    const ok = await new ChainlinkFeedPrices({ client: fakeFeed(rounds), now: () => new Date("2026-12-10") }).observe("NVDA", T);
    expect([ok.status, ok.price?.mid, ok.answer, ok.decimals]).toEqual(["ok", 101_000000000000000000n, "10100000000", 8]);
    const pending = await new ChainlinkFeedPrices({ client: fakeFeed(rounds.slice(0, 1)), now: () => new Date(T.getTime() + 600_000) }).observe("NVDA", T);
    expect(pending.status).toBe("pending");
    const late = await new ChainlinkFeedPrices({ client: fakeFeed([rounds[0], { answer: 1n, updatedAt: s(T, 9 * 3600) }]), now: () => new Date("2026-12-10") }).observe("NVDA", T);
    expect([late.status, late.problems[0]]).toEqual(["failed", expect.stringMatching(/within 8h/)]);
    const exact = await new ChainlinkFeedPrices({ client: fakeFeed([{ answer: 7_00000000n, updatedAt: s(T, 0) }]), now: () => new Date("2026-12-10") }).observe("NVDA", T);
    expect(exact.price?.observationsTimestamp).toBe(s(T, 0));
  });

  // optional live read of the real feeds on base mainnet (read-only; no transactions)
  it.runIf(process.env.CHAINLINK_LIVE_FEEDS_TEST === "1")("live: every feed reads on base mainnet and has a round at the last close", async () => {
    const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
    const prices = new ChainlinkFeedPrices({ client });
    const close = sessionCloseUtc("2026-11-25");
    for (const t of SUPPORTED_TICKERS) {
      const q = await prices.live(t);
      expect(q.price, `${t}: ${q.reason}`).not.toBeNull();
      const r = await prices.reference(t, "2026-11-25", close);
      expect(r.price, `${t}: ${r.problems.join("; ")}`).not.toBeNull();
      console.log(t, "live", q.price, q.status, "| close 2026-11-25:", Number(r.price!.mid / 10n ** 14n) / 1e4, "updated", new Date(r.price!.observationsTimestamp * 1000).toISOString(), r.ok ? "ok" : r.problems.join("; "));
    }
  }, 120_000);
});
