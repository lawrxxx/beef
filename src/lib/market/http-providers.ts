import type { ClosePrice, CorporateAction, Quote, StockAsset } from "@/lib/types";
import { ASSETS, getAsset } from "./assets";
import { isMarketOpen, isTradingDay, sessionCloseUtc } from "./calendar";
import { ProviderUnavailableError, type MarketDataProvider } from "./provider";

// real provider adapters. server-only: api keys come from process.env and are never
// sent to the browser. these share the same interface as the mock provider.

async function getJson(url: string, provider: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new ProviderUnavailableError(provider, `http ${res.status}`);
  return res.json();
}

function closeShell(ticker: string, session: string, source: string): Omit<ClosePrice, "close" | "status"> {
  return {
    ticker, session, source, simulated: false,
    timestamp: isTradingDay(session) ? sessionCloseUtc(session).toISOString() : "",
  };
}

abstract class BaseHttpProvider implements MarketDataProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  readonly simulated = false;
  constructor(protected key: string) {}
  async search(q: string): Promise<StockAsset[]> {
    // supported universe is curated; providers only supply prices
    const s = q.toLowerCase();
    return ASSETS.filter((a) => a.ticker.toLowerCase().includes(s) || a.name.toLowerCase().includes(s));
  }
  async getAsset(t: string) { return getAsset(t) ?? null; }
  abstract getQuote(ticker: string): Promise<Quote | null>;
  abstract getClose(ticker: string, session: string): Promise<ClosePrice>;
  async getHistory(ticker: string, from: string, to: string): Promise<ClosePrice[]> {
    const out: ClosePrice[] = [];
    let d = from;
    while (d <= to) {
      if (isTradingDay(d)) out.push(await this.getClose(ticker, d));
      const dt = new Date(d + "T00:00:00Z");
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
    return out;
  }
  async getCorporateActions(_t: string, _f: string, _to: string): Promise<CorporateAction[]> { return []; }
}

export class PolygonProvider extends BaseHttpProvider {
  readonly id = "polygon";
  readonly label = "polygon.io";
  async getQuote(ticker: string): Promise<Quote | null> {
    const j = await getJson(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${this.key}`,
      this.id,
    );
    const t = j?.ticker;
    if (!t) return null;
    const price = t.lastTrade?.p ?? t.day?.c;
    const prev = t.prevDay?.c;
    return {
      ticker, price, previousClose: prev, changePct: prev ? ((price - prev) / prev) * 100 : 0,
      asOf: new Date((t.updated ?? Date.now() * 1e6) / 1e6).toISOString(),
      source: this.id, simulated: false, marketOpen: isMarketOpen(new Date()),
    };
  }
  async getClose(ticker: string, session: string): Promise<ClosePrice> {
    const shell = closeShell(ticker, session, this.id);
    if (!isTradingDay(session)) return { ...shell, close: 0, status: "invalid" };
    try {
      // unadjusted: split adjustment is applied explicitly by the settlement service
      const j = await getJson(
        `https://api.polygon.io/v1/open-close/${ticker}/${session}?adjusted=false&apiKey=${this.key}`,
        this.id,
      );
      if (j?.status !== "OK" || typeof j.close !== "number") return { ...shell, close: 0, status: "missing" };
      return { ...shell, close: j.close, status: "ok" };
    } catch {
      return { ...shell, close: 0, status: "missing" };
    }
  }
  async getCorporateActions(ticker: string, from: string, to: string): Promise<CorporateAction[]> {
    const j = await getJson(
      `https://api.polygon.io/v3/reference/splits?ticker=${ticker}&execution_date.gt=${from}&execution_date.lte=${to}&apiKey=${this.key}`,
      this.id,
    );
    return (j?.results ?? []).map((r: any) => ({
      ticker, type: "split" as const, session: r.execution_date, ratio: r.split_to / r.split_from,
    }));
  }
}

export class FinnhubProvider extends BaseHttpProvider {
  readonly id = "finnhub";
  readonly label = "finnhub";
  async getQuote(ticker: string): Promise<Quote | null> {
    const j = await getJson(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${this.key}`, this.id);
    if (!j || !j.c) return null;
    return {
      ticker, price: j.c, previousClose: j.pc, changePct: j.dp ?? 0,
      asOf: new Date(j.t * 1000).toISOString(), source: this.id, simulated: false,
      marketOpen: isMarketOpen(new Date()),
    };
  }
  async getClose(ticker: string, session: string): Promise<ClosePrice> {
    const shell = closeShell(ticker, session, this.id);
    if (!isTradingDay(session)) return { ...shell, close: 0, status: "invalid" };
    try {
      const from = Math.floor(new Date(session + "T00:00:00Z").getTime() / 1000);
      const to = from + 86400 * 2;
      const j = await getJson(
        `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${this.key}`,
        this.id,
      );
      if (j?.s !== "ok" || !j.c?.length) return { ...shell, close: 0, status: "missing" };
      return { ...shell, close: j.c[0], status: "ok" };
    } catch {
      return { ...shell, close: 0, status: "missing" };
    }
  }
}

export class AlphaVantageProvider extends BaseHttpProvider {
  readonly id = "alphavantage";
  readonly label = "alpha vantage";
  async getQuote(ticker: string): Promise<Quote | null> {
    const j = await getJson(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${this.key}`,
      this.id,
    );
    const q = j?.["Global Quote"];
    if (!q?.["05. price"]) return null;
    const price = +q["05. price"], prev = +q["08. previous close"];
    return {
      ticker, price, previousClose: prev, changePct: prev ? ((price - prev) / prev) * 100 : 0,
      asOf: new Date().toISOString(), source: this.id, simulated: false, marketOpen: isMarketOpen(new Date()),
    };
  }
  async getClose(ticker: string, session: string): Promise<ClosePrice> {
    const shell = closeShell(ticker, session, this.id);
    if (!isTradingDay(session)) return { ...shell, close: 0, status: "invalid" };
    try {
      const j = await getJson(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=full&apikey=${this.key}`,
        this.id,
      );
      const row = j?.["Time Series (Daily)"]?.[session];
      if (!row) return { ...shell, close: 0, status: "missing" };
      return { ...shell, close: +row["4. close"], status: "ok" };
    } catch {
      return { ...shell, close: 0, status: "missing" };
    }
  }
}
