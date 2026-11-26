import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { compareReturns, returnE6 } from "./engine";
import { InMemorySettlementRepository, lockStartPrices, settleDuel, type SettleableDuel } from "./service";
import type { SupportedTicker } from "@/lib/chainlink/config";
import { ExpirationError, deadlineLine, scheduleFor, validateCustomDeadline } from "@/lib/expiration";
import { CHAINLINK_FEEDS, ChainlinkFeedPrices, type FeedClient } from "@/lib/chainlink/feeds";
import { deadlineOptions, lastCloseAtOrBefore, nextCloseAfter, resolveEndSession, sessionCloseUtc } from "@/lib/market/calendar";

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

// ---------- expiration rules and the market calendar ----------

const Z = (iso: string) => new Date(iso);
const sched = (t: "next_open" | "one_week", at: string) => { const r = scheduleFor(t, Z(at)); return [r.startAt.toISOString(), r.deadline.toISOString()]; };

describe("expiration: next market open / one week / custom", () => {
  it("during market hours: starts at the next day's open; next_open ends one session later", () => {
    expect(sched("next_open", "2026-11-30T15:00:00Z")).toEqual(["2026-12-01T14:30:00.000Z", "2026-12-02T14:30:00.000Z"]); // mon 10am et
  });
  it("after hours and weekends roll to the next trading day's 9:30 open", () => {
    expect(sched("next_open", "2026-11-30T22:00:00Z")[0]).toBe("2026-12-01T14:30:00.000Z"); // mon 5pm et
    expect(sched("next_open", "2026-12-04T22:00:00Z")).toEqual(["2026-12-07T14:30:00.000Z", "2026-12-08T14:30:00.000Z"]); // fri 5pm → mon, tue
    expect(sched("next_open", "2026-12-05T15:00:00Z")[0]).toBe("2026-12-07T14:30:00.000Z"); // saturday
  });
  it("holidays are skipped (thanksgiving); early-close days still open at 9:30", () => {
    expect(sched("next_open", "2026-11-25T22:00:00Z")).toEqual(["2026-11-27T14:30:00.000Z", "2026-11-30T14:30:00.000Z"]);
  });
  it("one week: activation + 7 days, rolled to the next open at or after it (holiday aware)", () => {
    expect(sched("one_week", "2026-11-30T15:00:00Z")[1]).toBe("2026-12-08T14:30:00.000Z"); // mon 10am + 7d → tue open
    expect(sched("one_week", "2026-11-19T18:00:00Z")[1]).toBe("2026-11-27T14:30:00.000Z"); // lands on thanksgiving → fri open
  });
  it("daylight saving: 9:30 et is 13:30z in summer time and 14:30z in winter", () => {
    expect(sched("next_open", "2026-10-30T22:00:00Z")[0]).toBe("2026-11-02T14:30:00.000Z"); // dst ends nov 1
    expect(sched("next_open", "2026-03-06T22:00:00Z")[0]).toBe("2026-03-09T13:30:00.000Z"); // dst starts mar 8
  });
  it("custom deadlines are validated against the calendar", () => {
    const now = Z("2026-11-30T15:00:00Z");
    expect(validateCustomDeadline(Z("2026-12-04T19:00:00Z"), now)).toBeNull(); // fri 2pm et
    expect(validateCustomDeadline(Z("2026-12-05T16:00:00Z"), now)).toMatch(/closed that day/); // saturday
    expect(validateCustomDeadline(Z("2026-12-25T16:00:00Z"), now)).toMatch(/closed that day/); // christmas
    expect(validateCustomDeadline(Z("2026-12-04T22:00:00Z"), now)).toMatch(/regular hours/); // 5pm et
    expect(validateCustomDeadline(Z("2026-11-27T19:00:00Z"), Z("2026-11-20T15:00:00Z"))).toMatch(/1:00pm \(early close\)/); // 2pm on the early close
    expect(validateCustomDeadline(Z("2026-11-27T17:00:00Z"), Z("2026-11-20T15:00:00Z"))).toBeNull(); // 12pm on the early close
    expect(validateCustomDeadline(Z("2026-11-30T14:00:00Z"), now)).toMatch(/future/);
    expect(validateCustomDeadline(Z("2026-12-01T14:00:00Z"), now)).toMatch(/regular hours/); // tue 9am et: before the open
    expect(validateCustomDeadline(Z("2026-12-01T14:40:00Z"), Z("2026-12-01T14:35:00Z"))).toMatch(/after the market open that starts/);
    expect(validateCustomDeadline(Z("2028-03-01T16:00:00Z"), now)).toMatch(/between/);
    expect(() => scheduleFor("custom", now, "2026-12-05T16:00:00Z")).toThrow(ExpirationError);
  });
  it("deadline text: exact once activated or custom; 'if accepted now' before activation", () => {
    const now = Z("2026-11-30T15:00:00Z");
    expect(deadlineLine({ deadline: "2026-12-04T19:00:00Z", expirationType: "custom" }, now)).toBe("fri, dec 4, 2:00 pm et");
    expect(deadlineLine({ deadline: "x", expirationType: "next_open" }, now)).toBe("next market open (if accepted now: wed, dec 2, 9:30 am et)");
    expect(deadlineLine({ deadline: "2026-12-08T14:30:00Z", expirationType: "one_week", startAt: "2026-12-01T14:30:00Z" }, now)).toBe("tue, dec 8, 9:30 am et");
  });
});

// ---------- settlement on chainlink data feeds (fake aggregators, made-up values) ----------

type FeedRounds = Partial<Record<string, { answer: string; at: string }[]>>;
function feedClient(rounds: FeedRounds): FeedClient {
  const phase = 1n << 64n;
  const byFeed = new Map<string, { answer: bigint; updatedAt: bigint }[]>();
  for (const [t, rs] of Object.entries(rounds)) byFeed.set(CHAINLINK_FEEDS[t as SupportedTicker].feed.toLowerCase(), (rs ?? []).map((r) => ({ answer: parseUnits(r.answer, 8), updatedAt: BigInt(Date.parse(r.at) / 1000) })));
  const row = (a: string, id: bigint) => { const rs = byFeed.get(a.toLowerCase()) ?? []; const r = rs[Number(id & ((1n << 64n) - 1n)) - 1]; if (!r) throw new Error("no round"); return [id, r.answer, r.updatedAt, r.updatedAt, id] as const; };
  const tickerOf = (a: string) => Object.entries(CHAINLINK_FEEDS).find(([, v]) => v.feed.toLowerCase() === a.toLowerCase())![0];
  return {
    readContract: (async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly bigint[] }) => {
      if (functionName === "description") return `Coinbase ${tickerOf(address)}`;
      if (functionName === "decimals") return 8;
      if (functionName === "latestRoundData") { const n = byFeed.get(address.toLowerCase())?.length ?? 0; if (!n) throw new Error("no data"); return row(address, phase | BigInt(n)); }
      if (functionName === "getRoundData") return row(address, args![0]);
      throw new Error(functionName);
    }) as never,
    multicall: (async ({ contracts }: { contracts: { address: string; args: readonly bigint[] }[] }) => contracts.map((c) => { try { return { status: "success", result: row(c.address, c.args[0]) }; } catch (e) { return { status: "failure", error: e }; } })) as never,
  };
}

const START = "2026-12-01T14:30:00Z", END = "2026-12-04T19:00:00Z"; // tue open → fri 2pm et (custom)
const duel = (over: Partial<SettleableDuel> = {}): SettleableDuel => ({
  id: "d1", status: "active", acceptedAt: "2026-11-30T15:00:00Z", startAt: START, deadline: END,
  participants: [{ userId: A, ticker: "NVDA" }, { userId: B, ticker: "AAPL" }], ...over,
});
const at = (iso: string, mins: number) => new Date(Date.parse(iso) + mins * 60_000).toISOString();
const happy: FeedRounds = {
  NVDA: [{ answer: "179", at: at(START, -10) }, { answer: "180", at: at(START, 1) }, { answer: "185", at: at(END, -10) }, { answer: "189", at: at(END, 5) }],
  AAPL: [{ answer: "249", at: at(START, -30) }, { answer: "250", at: at(START, 3) }, { answer: "257.5", at: at(END, 12) }],
};
const prices = (r: FeedRounds, now = "2026-12-10T00:00:00Z") => new ChainlinkFeedPrices({ client: feedClient(r), now: () => new Date(now) });
const AFTER = new Date("2026-12-10T00:00:00Z");

describe("settlement on chainlink data feeds at agreed times", () => {
  it("uses the first round at or after the start and the deadline, records full evidence, once", async () => {
    const repo = new InMemorySettlementRepository();
    const r = await settleDuel(duel(), prices(happy), repo, AFTER);
    if (r.outcome !== "settled") throw new Error(r.outcome);
    expect(r.settlement.winners).toEqual([A]); // nvda +5% vs aapl +3%
    expect(r.settlement.entries.find((e) => e.ticker === "NVDA")).toMatchObject({ startE18: parseUnits("180", 18).toString(), endE18: parseUnits("189", 18).toString() });
    expect(r.settlement.methodology).toBe("chainlink_data_feeds_open_v2");
    expect(r.settlement.window).toMatchObject({ startTimestamp: Date.parse(START) / 1000, endTimestamp: Date.parse(END) / 1000 });
    expect(r.startSnapshots[0]).toMatchObject({ decimals: 8, answer: "18000000000", roundId: String((1n << 64n) | 2n) });
    expect(r.settlement.evidence!.every((e) => e.verification === "onchain" && !!e.roundId)).toBe(true);
    expect((await settleDuel(duel(), prices(happy), repo, AFTER)).outcome).toBe("already_settled");
  });
  it("concurrent settlement stores one result", async () => {
    const repo = new InMemorySettlementRepository();
    const rs = await Promise.all([settleDuel(duel(), prices(happy), repo, AFTER), settleDuel(duel(), prices(happy), repo, AFTER)]);
    expect(rs.map((x) => x.outcome).sort()).toEqual(["already_settled", "settled"]);
  });
  it("waits (no record) until the deadline and until the first post-deadline update arrives", async () => {
    expect((await settleDuel(duel(), prices(happy), new InMemorySettlementRepository(), new Date(at(END, -1)))).outcome).toBe("not_due");
    const early = { ...happy, AAPL: happy.AAPL!.slice(0, 2) }; // aapl hasn't updated since the deadline
    const r = await settleDuel(duel(), prices(early, at(END, 30)), new InMemorySettlementRepository(), new Date(at(END, 30)));
    expect(r.outcome).toBe("not_due");
  });
  const paused = async (rounds: FeedRounds, re: RegExp, d = duel()) => {
    const repo = new InMemorySettlementRepository();
    const r = await settleDuel(d, prices(rounds), repo, AFTER);
    expect(r.outcome).toBe("needs_verification");
    if (r.outcome === "needs_verification") expect(r.settlement.issues.join(" ")).toMatch(re);
    expect(await repo.getSettlement(d.id)).toBeNull();
  };
  it("pauses when a feed doesn't update within the max delay (stale feed, halt or closure)", () => paused({ ...happy, AAPL: [...happy.AAPL!.slice(0, 2), { answer: "257.5", at: at(END, 9 * 60) }] }, /no chainlink feed update within 8h/));
  it("pauses on missing feed data", () => paused({ NVDA: happy.NVDA }, /AAPL: couldn't (reach|read)/));
  it("pauses on a non-positive value", () => paused({ ...happy, AAPL: [...happy.AAPL!.slice(0, 2), { answer: "0", at: at(END, 2) }] }, /isn't positive/));
  it("never uses an observation outside the agreed window", () => paused({ ...happy, NVDA: [{ answer: "180", at: at(START, 9 * 60) }, { answer: "189", at: at(END, 5) }] }, /NVDA: no chainlink feed update within 8h after 2026-12-01/));
  it("identical returns → draw; both negative → smaller loss wins", async () => {
    const draw = { ...happy, AAPL: [{ answer: "250", at: at(START, 3) }, { answer: "262.5", at: at(END, 1) }] };
    const d1 = await settleDuel(duel(), prices(draw), new InMemorySettlementRepository(), AFTER);
    expect(d1.outcome === "settled" && d1.settlement.status).toBe("draw");
    const down = { NVDA: [{ answer: "400", at: at(START, 1) }, { answer: "380", at: at(END, 1) }], AAPL: [{ answer: "600", at: at(START, 1) }, { answer: "588", at: at(END, 1) }] };
    const d2 = await settleDuel(duel(), prices(down), new InMemorySettlementRepository(), AFTER);
    expect(d2.outcome === "settled" && d2.settlement.winners).toEqual([B]);
  });
  it("locks starting prices only at/after the start; waits for the first update; uses the locked snapshot later", async () => {
    const accepted = duel({ status: "accepted" });
    expect((await lockStartPrices(accepted, prices(happy), new Date(at(START, -5)))).pending).toBe(true);
    const noneYet = { NVDA: happy.NVDA!.slice(0, 1), AAPL: happy.AAPL!.slice(0, 1) };
    expect((await lockStartPrices(accepted, prices(noneYet, at(START, 20)), new Date(at(START, 20)))).pending).toBe(true);
    const lock = await lockStartPrices(accepted, prices(happy), AFTER);
    expect([lock.ok, lock.snapshots.map((x) => x.price)]).toEqual([true, [180, 250]]);
    // start rounds no longer served: settlement relies on the locked snapshots
    const endOnly = { NVDA: [{ answer: "189", at: at(END, 5) }], AAPL: [{ answer: "257.5", at: at(END, 12) }] };
    const r = await settleDuel(duel({ startSnapshots: lock.snapshots }), prices(endOnly), new InMemorySettlementRepository(), AFTER);
    expect(r.outcome).toBe("settled");
  });
  it("older duels without a stored start derive it from acceptance the same way", async () => {
    const r = await settleDuel(duel({ startAt: undefined, acceptedAt: "2026-11-30T15:00:00Z" }), prices(happy), new InMemorySettlementRepository(), AFTER);
    expect(r.outcome).toBe("settled");
  });
});
