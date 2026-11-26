import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { compareReturns, returnE6 } from "./engine";
import { InMemorySettlementRepository, lockStartPrices, settleDuel, type SettleableDuel } from "./service";
import { deadlineOptions, lastCloseAtOrBefore, nextCloseAfter, resolveEndSession, sessionCloseUtc } from "@/lib/market/calendar";
import { BASE_SEPOLIA_VERIFIER_PROXY, type SupportedTicker } from "@/lib/chainlink/config";
import { ChainlinkPrices, type StreamsApi } from "@/lib/chainlink/prices";
import type { Verification } from "@/lib/chainlink/verifier";
import { fixtureReport, fixtureStream } from "@/lib/chainlink/fixtures";

// isolated unit tests. prices are synthetic fixture reports (lib/chainlink/fixtures.ts),
// never real market data.

const A = "alice", B = "bob";
const e18 = (v: string) => parseUnits(v, 18);
const input = (userId: string, ticker: string, start: string, end: string) => ({ userId, ticker, startE18: e18(start), endE18: e18(end) });

describe("percent return (bigint)", () => {
  it("matches the brief example: (189 − 180) / 180 × 100 = 5%", () => {
    expect(returnE6(e18("180"), e18("189"))).toBe(5_000_000n);
  });
  it("negative returns and invalid prices", () => {
    expect(returnE6(e18("100"), e18("97.5"))).toBe(-2_500_000n);
    expect(() => returnE6(0n, e18("1"))).toThrow(RangeError);
    expect(() => returnE6(e18("1"), -1n)).toThrow(RangeError);
  });
  it("no float error: 0.1 → 0.3 is exactly +200%", () => {
    expect(returnE6(e18("0.1"), e18("0.3"))).toBe(200_000_000n);
  });
});

describe("compareReturns", () => {
  it("both rise: higher return wins, not higher price", () => {
    const r = compareReturns([input(A, "NVDA", "180", "189"), input(B, "AAPL", "250", "257.5")]);
    expect(r.winners).toEqual([A]);
    expect(r.marginE4).toBe("20000"); // 5% − 3% = 2.0000 pts
  });
  it("both fall: the smaller loss wins", () => {
    const r = compareReturns([input(A, "TSLA", "400", "380"), input(B, "META", "600", "588")]);
    expect(r.winners).toEqual([B]);
    expect(r.explanation).toMatch(/fell less/);
  });
  it("identical returns draw, even at different prices", () => {
    const r = compareReturns([input(A, "MSFT", "500", "515"), input(B, "GOOGL", "280", "288.4")]);
    expect([r.status, r.winners]).toEqual(["draw", []]);
  });
  it("returns within 0.0001 pts compare as equal (truncated, deterministic)", () => {
    // +1.00004% vs +1.00001% → both 1.0000 at 4 decimals
    const r = compareReturns([input(A, "NVDA", "100", "101.00004"), input(B, "AAPL", "100", "101.00001")]);
    expect(r.status).toBe("draw");
  });
  it("group: everyone ranked, ties for first share the win; same stock twice is refused", () => {
    const r = compareReturns([input(A, "NVDA", "100", "110"), input(B, "AAPL", "100", "110"), input("carol", "TSLA", "100", "105")]);
    expect(r.winners.sort()).toEqual([A, B]);
    expect(() => compareReturns([input(A, "NVDA", "1", "2"), input(B, "NVDA", "1", "2")])).toThrow();
  });
});

describe("calendar (holidays, early closes, dst)", () => {
  it("thanksgiving is skipped and the friday early close is 1pm et", () => {
    expect(nextCloseAfter(new Date("2026-11-25T17:00:00Z"))).toBe("2026-11-25");
    expect(nextCloseAfter(new Date("2026-11-26T02:00:00Z"))).toBe("2026-11-27");
    expect(sessionCloseUtc("2026-11-27").toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });
  it("dst: summer close 20:00 utc, winter 21:00 utc", () => {
    expect(sessionCloseUtc("2026-07-15").toISOString()).toBe("2026-07-15T20:00:00.000Z");
    expect(sessionCloseUtc("2026-12-15").toISOString()).toBe("2026-12-15T21:00:00.000Z");
  });
  it("weekend deadline rolls back; a deadline on the lock rolls forward; presets follow the lock", () => {
    expect(lastCloseAtOrBefore(new Date("2026-12-06T15:00:00Z"))).toBe("2026-12-04");
    expect(resolveEndSession(new Date("2026-12-01T21:00:00Z"), "2026-12-01")).toBe("2026-12-02");
    const now = new Date("2026-11-25T17:00:00Z");
    for (const o of deadlineOptions(now)) expect(o.session > nextCloseAfter(now)).toBe(true);
  });
});

// ---------- settlement service on chainlink fixture reports ----------

const LOCK = "2026-12-01", END = "2026-12-04"; // tue → fri
const refTs = (session: string) => Math.floor(sessionCloseUtc(session).getTime() / 1000) - 1;
type Fx = { mid: string; status?: number; midAgeS?: number; bid?: string; ask?: string };

function oracle(data: Record<string, Fx>, opts: { verification?: Verification["status"]; now?: Date } = {}) {
  const byTs: Record<string, ReturnType<typeof fixtureReport>> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!v) continue; // a deliberately missing report
    const [t, session] = k.split("@") as [SupportedTicker, string];
    const id = fixtureStream(t);
    byTs[`${id}@${refTs(session)}`] = fixtureReport({ streamId: id, observationsTimestamp: refTs(session), mid: v.mid, marketStatus: v.status ?? 2, midAgeS: v.midAgeS, bid: v.bid, ask: v.ask });
  }
  const api: StreamsApi = {
    async getLatestReport() { throw new Error("not used"); },
    async getReportByTimestamp(id, ts) { const r = byTs[`${id}@${ts}`]; if (!r) throw new Error("404 no report"); return r; },
  };
  const calls = { verify: 0 };
  const prices = new ChainlinkPrices({
    api, now: () => opts.now ?? new Date("2026-12-10T00:00:00Z"),
    streams: async (t) => ({ regular: { ticker: t, session: "regular", streamId: fixtureStream(t), name: "", schema: "v11", decimals: 18, network: "testnet", verifier: "base_sepolia_verifier_proxy" } }),
    verify: async () => { calls.verify++; return { status: opts.verification ?? "verified", method: "chainlink_verifier_proxy_eth_call", verifier: BASE_SEPOLIA_VERIFIER_PROXY, chainId: 84532, configDigest: null, checkedAt: "", detail: "fixture" }; },
  });
  return { prices, calls };
}

const duel = (over: Partial<SettleableDuel> = {}): SettleableDuel => ({
  id: "d1", status: "active", acceptedAt: "2026-12-01T15:00:00Z", deadline: "2026-12-04T21:00:00Z",
  participants: [{ userId: A, ticker: "NVDA" }, { userId: B, ticker: "AAPL" }], ...over,
});
const AFTER = new Date("2026-12-05T00:00:00Z");
const happy = { [`NVDA@${LOCK}`]: { mid: "180" }, [`NVDA@${END}`]: { mid: "189" }, [`AAPL@${LOCK}`]: { mid: "250" }, [`AAPL@${END}`]: { mid: "257.5" } };

describe("settlement service (chainlink regular-hours mid)", () => {
  it("settles once with full evidence, then is idempotent", async () => {
    const repo = new InMemorySettlementRepository();
    const { prices } = oracle(happy);
    const r = await settleDuel(duel(), prices, repo, AFTER);
    expect(r.outcome).toBe("settled");
    if (r.outcome !== "settled") return;
    expect(r.settlement.winners).toEqual([A]);
    expect(r.settlement.methodology).toBe("chainlink_regular_hours_mid_v1");
    expect(r.settlement.window).toEqual({ startSession: LOCK, endSession: END, startTimestamp: refTs(LOCK), endTimestamp: refTs(END) });
    expect(r.settlement.evidence).toHaveLength(4);
    expect(r.settlement.evidence!.every((e) => e.verification === "verified" && e.marketStatus === 2 && /^0x/.test(e.reportHash))).toBe(true);
    expect((await settleDuel(duel(), prices, repo, AFTER)).outcome).toBe("already_settled");
  });
  it("both stocks use exactly the same two timestamps", async () => {
    const r = await settleDuel(duel(), oracle(happy).prices, new InMemorySettlementRepository(), AFTER);
    if (r.outcome !== "settled") throw new Error(r.outcome);
    const ts = (k: string) => new Set(r.settlement.evidence!.filter((e) => e.kind === k).map((e) => e.observationsTimestamp));
    expect([...ts("start")]).toEqual([refTs(LOCK)]);
    expect([...ts("end")]).toEqual([refTs(END)]);
  });
  it("concurrent settlement stores exactly one result", async () => {
    const repo = new InMemorySettlementRepository();
    const { prices } = oracle(happy);
    const rs = await Promise.all([settleDuel(duel(), prices, repo, AFTER), settleDuel(duel(), prices, repo, AFTER)]);
    expect(rs.map((r) => r.outcome).sort()).toEqual(["already_settled", "settled"]);
  });
  it("not before the deadline close; never for non-active duels", async () => {
    expect((await settleDuel(duel(), oracle(happy).prices, new InMemorySettlementRepository(), new Date("2026-12-04T20:00:00Z"))).outcome).toBe("not_due");
    expect((await settleDuel(duel({ status: "pending" }), oracle(happy).prices, new InMemorySettlementRepository(), AFTER)).outcome).toBe("rejected");
  });
  it("identical returns → draw; both negative → smaller loss wins", async () => {
    const draw = await settleDuel(duel(), oracle({ ...happy, [`AAPL@${END}`]: { mid: "262.5" } }).prices, new InMemorySettlementRepository(), AFTER);
    expect(draw.outcome === "settled" && draw.settlement.status).toBe("draw");
    const down = await settleDuel(duel(), oracle({ ...happy, [`NVDA@${END}`]: { mid: "171" }, [`AAPL@${END}`]: { mid: "245" } }).prices, new InMemorySettlementRepository(), AFTER);
    expect(down.outcome === "settled" && down.settlement.winners).toEqual([B]);
  });

  const pausedWith = async (data: Record<string, Fx>, re: RegExp, opts?: Parameters<typeof oracle>[1]) => {
    const repo = new InMemorySettlementRepository();
    const r = await settleDuel(duel(), oracle(data, opts).prices, repo, AFTER);
    expect(r.outcome).toBe("needs_verification");
    if (r.outcome === "needs_verification") {
      expect(r.settlement.winners).toEqual([]);
      expect(r.settlement.issues.join(" ")).toMatch(re);
    }
    expect(await repo.getSettlement("d1")).toBeNull(); // nothing recorded
  };
  it("pauses on a missing report", () => pausedWith({ ...happy, [`AAPL@${END}`]: undefined as never }, /no usable chainlink report/));
  it("pauses when chainlink's verifier doesn't accept the report", () => pausedWith(happy, /not verified by chainlink \(reverted/, { verification: "reverted" }));
  it("pauses when market status isn't regular hours (closed, unknown, post-market)", async () => {
    await pausedWith({ ...happy, [`NVDA@${END}`]: { mid: "189", status: 5 } }, /market closed \(5\)/);
    await pausedWith({ ...happy, [`NVDA@${END}`]: { mid: "189", status: 0 } }, /unknown \(0\)/);
    await pausedWith({ ...happy, [`NVDA@${END}`]: { mid: "189", status: 3 } }, /after hours \(3\)/);
  });
  it("pauses on a stale mid (possible trading halt)", () => pausedWith({ ...happy, [`AAPL@${END}`]: { mid: "257.5", midAgeS: 1800 } }, /hadn't updated.*halt/));
  it("pauses on a crossed or very wide quote", () => pausedWith({ ...happy, [`AAPL@${END}`]: { mid: "257.5", bid: "240", ask: "275" } }, /wide spread/));
  it("pauses on a big move with no recorded corporate action (possible unrecorded split)", () => pausedWith({ ...happy, [`NVDA@${END}`]: { mid: "18.9" } }, /possible split/));

  it("applies a recorded 10-for-1 split exactly to the starting price", async () => {
    const repo = new InMemorySettlementRepository([{ ticker: "NVDA", session: "2026-12-03", ratioNum: 10, ratioDen: 1 }]);
    const r = await settleDuel(duel(), oracle({ ...happy, [`NVDA@${END}`]: { mid: "18.9" } }).prices, repo, AFTER);
    if (r.outcome !== "settled") throw new Error(r.outcome);
    const nvda = r.settlement.entries.find((e) => e.ticker === "NVDA")!;
    expect([nvda.startE18, nvda.returnE6]).toEqual([e18("18").toString(), "5000000"]); // 180 / 10 → 18, +5%
    expect((await repo.listAudit("d1")).some((a) => a.action === "settle.adjust")).toBe(true);
  });

  it("uses the locked start snapshots instead of refetching", async () => {
    const repo = new InMemorySettlementRepository();
    const lock = await lockStartPrices(duel({ status: "accepted" }), oracle(happy).prices, AFTER);
    expect(lock.ok).toBe(true);
    // start reports no longer served: settlement must rely on the locked snapshots
    const endOnly = { [`NVDA@${END}`]: { mid: "189" }, [`AAPL@${END}`]: { mid: "257.5" } };
    const r = await settleDuel(duel({ startSnapshots: lock.snapshots }), oracle(endOnly).prices, repo, AFTER);
    expect(r.outcome).toBe("settled");
  });
  it("locks only after the lock close, and refuses unverified starting prices", async () => {
    expect((await lockStartPrices(duel({ status: "accepted" }), oracle(happy).prices, new Date("2026-12-01T20:00:00Z"))).issues[0]).toMatch(/waiting/);
    const bad = await lockStartPrices(duel({ status: "accepted" }), oracle(happy, { verification: "unsupported_config" }).prices, AFTER);
    expect([bad.ok, bad.snapshots]).toEqual([false, []]);
  });
  it("holiday deadline: thanksgiving rolls back to wednesday's close", () => {
    expect(resolveEndSession(new Date("2026-11-26T21:00:00Z"), "2026-11-23")).toBe("2026-11-25");
  });
});
