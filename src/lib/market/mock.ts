import type { ClosePrice, CorporateAction, Quote, StockAsset } from "@/lib/types";
import { ASSETS, MOCK_CORPORATE_ACTIONS, MOCK_DATA_GAPS, MOCK_SCENARIOS, getAsset } from "./assets";
import {
  CALENDAR_RANGE, isMarketOpen, prevTradingDay, isTradingDay, lastCloseAtOrBefore, sessionCloseUtc,
  sessionDateOf, sessionOpenUtc, tradingDaysBetween,
} from "./calendar";
import type { MarketDataProvider } from "./provider";

// deterministic simulated market data. same ticker + session => same price, always.
// nothing here is live market data and the ui labels it as simulated.

const ANCHOR = "2025-01-02";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** deterministic standard normal from a string seed */
function gauss(seed: string): number {
  const u1 = (hash(seed + ":a") + 1) / 4294967297;
  const u2 = (hash(seed + ":b") + 1) / 4294967297;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// memoized raw (unadjusted for splits) close series per ticker
const seriesCache = new Map<string, Map<string, number>>();

function series(asset: StockAsset): Map<string, number> {
  const cached = seriesCache.get(asset.ticker);
  if (cached) return cached;
  const days = tradingDaysBetween(ANCHOR, CALENDAR_RANGE.to);
  const out = new Map<string, number>();
  // mean-reverting walk in log space around basePrice, so levels stay realistic
  let x = 0;
  let splitFactor = 1;
  const scen = MOCK_SCENARIOS.filter((x) => x.ticker === asset.ticker);
  for (const d of days) {
    const split = MOCK_CORPORATE_ACTIONS.find((c) => c.ticker === asset.ticker && c.session === d);
    if (split) splitFactor *= split.ratio;
    x = 0.98 * x + asset.drift + asset.vol * gauss(`${asset.ticker}:${d}`);
    const p = asset.basePrice * Math.exp(x);
    let close = round2(p / splitFactor);
    const start = scen.find((x) => x.from === d);
    if (start) close = Math.round(close);
    const end = scen.find((x) => x.to === d);
    if (end) close = round2((out.get(end.from) ?? close) * (1 + end.pct / 100));
    out.set(d, close);
  }
  seriesCache.set(asset.ticker, out);
  return out;
}

/** synchronous close lookup (ok data only). used by seed data. */
export function mockCloseSync(ticker: string, session: string): number | null {
  if (MOCK_DATA_GAPS.some((g) => g.ticker === ticker && g.session === session)) return null;
  return rawClose(ticker, session);
}

function rawClose(ticker: string, session: string): number | null {
  const a = getAsset(ticker);
  if (!a) return null;
  return series(a).get(session) ?? null;
}

export class MockMarketProvider implements MarketDataProvider {
  readonly id = "mock";
  readonly label = "beef simulated market";
  readonly simulated = true;

  async search(query: string): Promise<StockAsset[]> {
    const q = query.trim().toLowerCase();
    if (!q) return ASSETS;
    return ASSETS.filter(
      (a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.sector.includes(q),
    );
  }

  async getAsset(ticker: string) {
    return getAsset(ticker) ?? null;
  }

  async getClose(ticker: string, session: string): Promise<ClosePrice> {
    const base = {
      ticker: ticker.toUpperCase(),
      session,
      timestamp: isTradingDay(session) ? sessionCloseUtc(session).toISOString() : "",
      source: this.id,
      simulated: true,
    };
    if (!getAsset(ticker)) return { ...base, close: 0, status: "invalid" };
    if (!isTradingDay(session)) return { ...base, close: 0, status: "invalid" };
    const gap = MOCK_DATA_GAPS.find((g) => g.ticker === base.ticker && g.session === session);
    if (gap) return { ...base, close: 0, status: gap.status };
    const c = rawClose(ticker, session);
    if (c == null) return { ...base, close: 0, status: "missing" };
    return { ...base, close: c, status: "ok" };
  }

  async getHistory(ticker: string, from: string, to: string): Promise<ClosePrice[]> {
    const days = tradingDaysBetween(from, to);
    return Promise.all(days.map((d) => this.getClose(ticker, d)));
  }

  async getCorporateActions(ticker: string, from: string, to: string): Promise<CorporateAction[]> {
    return MOCK_CORPORATE_ACTIONS.filter(
      (c) => c.ticker === ticker.toUpperCase() && c.session > from && c.session <= to,
    );
  }

  async getQuote(ticker: string, at: Date = new Date()): Promise<Quote | null> {
    const asset = getAsset(ticker);
    if (!asset) return null;
    const open = isMarketOpen(at);
    const lastSession = lastCloseAtOrBefore(at);
    const prev = rawClose(ticker, lastSession) ?? asset.basePrice;
    let price = prev;
    let prevClose = prev;
    if (open) {
      // interpolate toward today's simulated close with a little deterministic wiggle
      const today = sessionDateOf(at);
      const target = rawClose(ticker, today) ?? prev;
      const o = sessionOpenUtc(today).getTime();
      const c = sessionCloseUtc(today).getTime();
      const f = Math.min(1, Math.max(0, (at.getTime() - o) / (c - o)));
      const minuteSeed = `${ticker}:${Math.floor(at.getTime() / 60000)}`;
      const wiggle = 1 + asset.vol * 0.15 * gauss(minuteSeed) * (1 - f);
      price = round2((prev + (target - prev) * f) * wiggle);
      prevClose = prev;
    } else {
      // closed: show last close vs the close before it
      const before = rawClose(ticker, prevTradingDay(lastSession));
      prevClose = before ?? prev;
    }
    return {
      ticker: asset.ticker,
      price,
      previousClose: prevClose,
      changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      asOf: open ? at.toISOString() : sessionCloseUtc(lastSession).toISOString(),
      source: this.id,
      simulated: true,
      marketOpen: open,
    };
  }
}
