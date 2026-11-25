import { describe, expect, it } from "vitest";
import { compareReturns, percentReturn } from "./engine";
import { InMemorySettlementRepository, lockStartPrices, settleDuel } from "./service";
import { MockMarketProvider } from "@/lib/market/mock";
import type { MarketDataProvider } from "@/lib/market/provider";
import {
  deadlineOptions, lastCloseAtOrBefore, nextCloseAfter, resolveEndSession, sessionCloseUtc,
} from "@/lib/market/calendar";
import type { ClosePrice } from "@/lib/types";

const A = "alice", B = "bob";

describe("percent return", () => {
  it("matches the brief example", () => {
    expect(percentReturn(180, 189)).toBeCloseTo(5, 10);
    expect(percentReturn(250, 257.5)).toBeCloseTo(3, 10);
  });
  it("rejects invalid prices", () => {
    expect(() => percentReturn(0, 10)).toThrow();
    expect(() => percentReturn(NaN, 10)).toThrow();
    expect(() => percentReturn(10, -1)).toThrow();
  });
});

describe("compareReturns", () => {
  it("both rise: higher return wins, not higher price", () => {
    const r = compareReturns([
      { userId: A, ticker: "NVDA", startPrice: 180, endPrice: 189 },
      { userId: B, ticker: "AAPL", startPrice: 250, endPrice: 257.5 },
    ]);
    expect(r.status).toBe("settled");
    expect(r.winners).toEqual([A]);
    expect(r.winningTicker).toBe("NVDA");
    expect(r.marginPct).toBeCloseTo(2, 6);
    expect(r.explanation).toContain("NVDA returned +5.00%, while AAPL returned +3.00%. NVDA wins by 2.00 percentage points");
  });

  it("both fall: less negative wins", () => {
    const r = compareReturns([
      { userId: A, ticker: "NVDA", startPrice: 200, endPrice: 190 }, // -5%
      { userId: B, ticker: "AAPL", startPrice: 250, endPrice: 245 }, // -2%
    ]);
    expect(r.winners).toEqual([B]);
    expect(r.marginPct).toBeCloseTo(3, 6);
    expect(r.explanation).toContain("fell less");
  });

  it("identical returns draw even at different prices", () => {
    const r = compareReturns([
      { userId: A, ticker: "MSFT", startPrice: 400, endPrice: 412 },
      { userId: B, ticker: "GOOGL", startPrice: 150, endPrice: 154.5 },
    ]);
    expect(r.status).toBe("draw");
    expect(r.winners).toEqual([]);
  });

  it("dollar gains don't matter", () => {
    // tsla gains $20 (2%), amd gains $5 (4%) -> amd wins
    const r = compareReturns([
      { userId: A, ticker: "TSLA", startPrice: 1000, endPrice: 1020 },
      { userId: B, ticker: "AMD", startPrice: 125, endPrice: 130 },
    ]);
    expect(r.winners).toEqual([B]);
  });

  it("one up, one down: the gain wins", () => {
    const r = compareReturns([
      { userId: A, ticker: "NVDA", startPrice: 100, endPrice: 99 },
      { userId: B, ticker: "AAPL", startPrice: 100, endPrice: 100.5 },
    ]);
    expect(r.winners).toEqual([B]);
    expect(r.marginPct).toBeCloseTo(1.5, 6);
  });

  it("flat vs flat is a draw", () => {
    expect(compareReturns([
      { userId: A, ticker: "KO", startPrice: 60, endPrice: 60 },
      { userId: B, ticker: "JPM", startPrice: 300, endPrice: 300 },
    ]).status).toBe("draw");
  });

  it("rejects identical stock selections", () => {
    expect(() => compareReturns([
      { userId: A, ticker: "NVDA", startPrice: 1, endPrice: 2 },
      { userId: B, ticker: "NVDA", startPrice: 1, endPrice: 2 },
    ])).toThrow();
  });

  it("group beef ranks everyone and shares ties for first", () => {
    const r = compareReturns([
      { userId: "a", ticker: "NVDA", startPrice: 100, endPrice: 110 },
      { userId: "b", ticker: "AAPL", startPrice: 200, endPrice: 220 },
      { userId: "c", ticker: "TSLA", startPrice: 100, endPrice: 95 },
    ]);
    expect(r.winners.sort()).toEqual(["a", "b"]);
    expect(r.entries.find((e) => e.userId === "c")!.rank).toBe(2);
  });
});

describe("calendar", () => {
  it("handles thanksgiving and the early close", () => {
    // wed 2026-11-25 at noon et -> next close is that day 4pm
    const wedNoon = new Date("2026-11-25T17:00:00Z");
    expect(nextCloseAfter(wedNoon)).toBe("2026-11-25");
    // after wed close, thursday is a holiday, friday is an early close
    const wedNight = new Date("2026-11-26T02:00:00Z");
    expect(nextCloseAfter(wedNight)).toBe("2026-11-27");
    expect(sessionCloseUtc("2026-11-27").toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });
  it("dst: summer close is 20:00 utc, winter 21:00 utc", () => {
    expect(sessionCloseUtc("2026-07-15").toISOString()).toBe("2026-07-15T20:00:00.000Z");
    expect(sessionCloseUtc("2026-12-15").toISOString()).toBe("2026-12-15T21:00:00.000Z");
  });
  it("weekend deadline rolls back to friday close", () => {
    expect(lastCloseAtOrBefore(new Date("2026-12-06T15:00:00Z"))).toBe("2026-12-04");
  });
  it("deadline on/before lock rolls forward to the next session", () => {
    expect(resolveEndSession(new Date("2026-12-01T21:00:00Z"), "2026-12-01")).toBe("2026-12-02");
  });
  it("presets are all after the lock session", () => {
    const now = new Date("2026-11-25T17:00:00Z");
    const lock = nextCloseAfter(now);
    for (const o of deadlineOptions(now)) expect(o.session > lock).toBe(true);
  });
});

describe("mock provider", () => {
  it("is deterministic", async () => {
    const p1 = new MockMarketProvider(), p2 = new MockMarketProvider();
    const a = await p1.getClose("NVDA", "2026-11-20");
    const b = await p2.getClose("NVDA", "2026-11-20");
    expect(a.close).toBe(b.close);
    expect(a.simulated).toBe(true);
  });
  it("returns invalid for weekends and unknown tickers", async () => {
    const p = new MockMarketProvider();
    expect((await p.getClose("NVDA", "2026-11-21")).status).toBe("invalid");
    expect((await p.getClose("ZZZZ", "2026-11-20")).status).toBe("invalid");
  });
});

const duelBase = {
  id: "d1",
  status: "active",
  participants: [{ userId: A, ticker: "NVDA" }, { userId: B, ticker: "AAPL" }],
  acceptedAt: "2026-11-02T15:00:00Z", // lock = 2026-11-02 close
  deadline: "2026-11-06T21:00:00Z",
};

describe("settlement service", () => {
  const now = new Date("2026-11-10T00:00:00Z");

  it("settles once and is idempotent", async () => {
    const repo = new InMemorySettlementRepository();
    const p = new MockMarketProvider();
    const first = await settleDuel(duelBase, p, repo, now);
    expect(first.outcome).toBe("settled");
    const second = await settleDuel(duelBase, p, repo, now);
    expect(second.outcome).toBe("already_settled");
    if (first.outcome === "settled" && second.outcome === "already_settled") {
      expect(second.settlement).toEqual(first.settlement);
    }
    const audit = await repo.listAudit("d1");
    expect(audit.some((a) => a.action === "settle.skipped")).toBe(true);
  });

  it("concurrent settlement stores exactly one result", async () => {
    const repo = new InMemorySettlementRepository();
    const p = new MockMarketProvider();
    const results = await Promise.all([1, 2, 3].map(() => settleDuel(duelBase, p, repo, now)));
    expect(results.filter((r) => r.outcome === "settled").length).toBe(1);
  });

  it("refuses to settle before the deadline close", async () => {
    const r = await settleDuel(duelBase, new MockMarketProvider(), new InMemorySettlementRepository(), new Date("2026-11-06T20:00:00Z"));
    expect(r.outcome).toBe("not_due");
  });

  it("refuses non-active duels", async () => {
    const r = await settleDuel({ ...duelBase, status: "cancelled" }, new MockMarketProvider(), new InMemorySettlementRepository(), now);
    expect(r.outcome).toBe("rejected");
  });

  it("pauses on missing data instead of declaring a winner", async () => {
    const mock = new MockMarketProvider();
    const broken: MarketDataProvider = {
      ...mock, id: mock.id, label: mock.label, simulated: true,
      search: mock.search.bind(mock), getAsset: mock.getAsset.bind(mock), getQuote: mock.getQuote.bind(mock),
      getHistory: mock.getHistory.bind(mock), getCorporateActions: mock.getCorporateActions.bind(mock),
      async getClose(t: string, s: string): Promise<ClosePrice> {
        const c = await mock.getClose(t, s);
        return t === "AAPL" && s === "2026-11-06" ? { ...c, status: "missing", close: 0 } : c;
      },
    };
    const repo = new InMemorySettlementRepository();
    const r = await settleDuel(duelBase, broken, repo, now);
    expect(r.outcome).toBe("needs_verification");
    if (r.outcome === "needs_verification") expect(r.settlement.winners).toEqual([]);
    // once data is back, settlement goes through
    const again = await settleDuel({ ...duelBase, status: "awaiting_verification" }, mock, repo, now);
    expect(again.outcome).toBe("settled");
  });

  it("pauses when the provider request fails (outage / timeout)", async () => {
    const mock = new MockMarketProvider();
    const down: MarketDataProvider = {
      id: mock.id, label: mock.label, simulated: true,
      search: mock.search.bind(mock), getAsset: mock.getAsset.bind(mock), getQuote: mock.getQuote.bind(mock),
      getHistory: mock.getHistory.bind(mock), getCorporateActions: mock.getCorporateActions.bind(mock),
      async getClose() { throw new Error("timeout"); },
    };
    const repo = new InMemorySettlementRepository();
    const r = await settleDuel(duelBase, down, repo, now);
    expect(r.outcome).toBe("needs_verification");
    if (r.outcome === "needs_verification") expect(r.settlement.issues.join(" ")).toContain("price request failed");
    expect(await repo.getSettlement(duelBase.id)).toBeNull(); // nothing recorded
    const lock = await lockStartPrices(duelBase, down, new Date("2026-11-02T21:30:00Z"));
    expect(lock.ok).toBe(false);
  });

  it("both stocks always share the same window", async () => {
    const r = await settleDuel(duelBase, new MockMarketProvider(), new InMemorySettlementRepository(), now);
    if (r.outcome !== "settled") throw new Error("expected settled");
    expect(new Set(r.startSnapshots.map((x) => x.session)).size).toBe(1);
    expect(new Set(r.endSnapshots.map((x) => x.session)).size).toBe(1);
    expect(r.settlement.startSession).toBe(r.startSnapshots[0].session);
  });

  it("pauses on a trading halt (smci simulated halt)", async () => {
    const r = await settleDuel(
      { ...duelBase, id: "d2", participants: [{ userId: A, ticker: "SMCI" }, { userId: B, ticker: "AMD" }], acceptedAt: "2026-11-16T15:00:00Z", deadline: "2026-11-20T21:00:00Z" },
      new MockMarketProvider(), new InMemorySettlementRepository(), new Date("2026-11-23T00:00:00Z"),
    );
    expect(r.outcome).toBe("needs_verification");
  });

  it("applies split adjustments (avgo 4:1 simulated)", async () => {
    const p = new MockMarketProvider();
    const r = await settleDuel(
      { ...duelBase, id: "d3", participants: [{ userId: A, ticker: "AVGO" }, { userId: B, ticker: "MSFT" }], acceptedAt: "2026-12-01T15:00:00Z", deadline: "2026-12-11T21:00:00Z" },
      p, new InMemorySettlementRepository(), new Date("2026-12-14T00:00:00Z"),
    );
    expect(r.outcome).toBe("settled");
    if (r.outcome === "settled") {
      const s = r.startSnapshots.find((x) => x.ticker === "AVGO")!;
      expect(s.adjustedPrice).toBeCloseTo(s.price / 4, 4);
      const e = r.settlement.entries.find((x) => x.ticker === "AVGO")!;
      // adjusted return stays in a sane range rather than ~-75%
      expect(Math.abs(e.returnPct)).toBeLessThan(40);
    }
  });

  it("locks start prices only after the lock close", async () => {
    const p = new MockMarketProvider();
    const early = await lockStartPrices(duelBase, p, new Date("2026-11-02T20:00:00Z"));
    expect(early.ok).toBe(false);
    const ok = await lockStartPrices(duelBase, p, new Date("2026-11-02T21:30:00Z"));
    expect(ok.ok).toBe(true);
    expect(ok.snapshots).toHaveLength(2);
    expect(ok.lockSession).toBe("2026-11-02");
  });
});
