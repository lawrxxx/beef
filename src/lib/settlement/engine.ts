import type { Settlement, SettlementEntry } from "@/lib/types";

// pure, deterministic winner calculation. no i/o, no clocks, no client input.
// version bump required for any change in comparison behaviour.
export const CALCULATION_VERSION = "pct-return-v1";

/** returns are compared after rounding to this many decimals of a percentage point */
export const COMPARISON_DECIMALS = 4;

export interface EngineInput {
  userId: string;
  ticker: string;
  startPrice: number;
  endPrice: number;
}

/** percentage return = ((ending price - starting price) / starting price) × 100 */
export function percentReturn(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < 0) {
    throw new RangeError(`invalid prices: start=${start} end=${end}`);
  }
  return ((end - start) / start) * 100;
}

export function roundForComparison(pct: number): number {
  const f = 10 ** COMPARISON_DECIMALS;
  return Math.round(pct * f) / f;
}

export function fmtPct(n: number, digits = 2): string {
  const v = Math.abs(n) < 0.5 / 10 ** digits ? 0 : n;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export interface EngineResult {
  status: "settled" | "draw";
  winners: string[];
  winningTicker?: string;
  marginPct: number;
  entries: SettlementEntry[];
  explanation: string;
}

/**
 * ranks entries by percentage return (higher is better, so a smaller loss beats a
 * bigger loss). identical rounded returns share a rank. if every entry ties, the
 * result is a draw. if several entries tie for first in a group, they share the win.
 */
export function compareReturns(inputs: EngineInput[]): EngineResult {
  if (inputs.length < 2) throw new RangeError("need at least two entries");
  const tickers = new Set(inputs.map((i) => i.ticker));
  if (tickers.size !== inputs.length) throw new RangeError("each participant must pick a different stock");

  const withReturns = inputs.map((i) => ({
    ...i,
    returnPct: percentReturn(i.startPrice, i.endPrice),
  }));
  const sorted = [...withReturns].sort(
    (a, b) => roundForComparison(b.returnPct) - roundForComparison(a.returnPct),
  );

  // dense ranking on rounded returns
  const entries: SettlementEntry[] = [];
  let rank = 0;
  let prev: number | null = null;
  for (const e of sorted) {
    const r = roundForComparison(e.returnPct);
    if (prev === null || r !== prev) rank += 1;
    prev = r;
    entries.push({ userId: e.userId, ticker: e.ticker, startPrice: e.startPrice, endPrice: e.endPrice, returnPct: e.returnPct, rank });
  }

  const top = entries.filter((e) => e.rank === 1);
  const second = entries.find((e) => e.rank === 2);
  const allTied = top.length === entries.length;

  if (allTied) {
    const list = entries.map((e) => `${e.ticker} returned ${fmtPct(e.returnPct)}`).join(", ");
    return {
      status: "draw", winners: [], marginPct: 0, entries,
      explanation: `${list}. the returns are identical, so this beef is a draw and stakes are returned.`,
    };
  }

  const margin = roundForComparison(top[0].returnPct) - roundForComparison(second!.returnPct);
  const describe = (e: SettlementEntry) => `${e.ticker} returned ${fmtPct(e.returnPct)}`;
  let explanation: string;
  if (entries.length === 2) {
    const [w, l] = entries;
    const bothDown = w.returnPct < 0 && l.returnPct < 0;
    explanation =
      `${describe(w)}, while ${describe(l)}. ${w.ticker} wins by ${margin.toFixed(2)} percentage points` +
      (bothDown ? ` — both fell, but ${w.ticker} fell less.` : ".");
  } else {
    explanation =
      `${entries.map(describe).join(", ")}. ` +
      (top.length > 1
        ? `${top.map((t) => t.ticker).join(" and ")} tied for first, ${margin.toFixed(2)} points ahead of the next pick.`
        : `${top[0].ticker} finished first, ${margin.toFixed(2)} points ahead of ${second!.ticker}.`);
  }

  return {
    status: "settled",
    winners: top.map((t) => t.userId),
    winningTicker: top.length === 1 ? top[0].ticker : undefined,
    marginPct: margin,
    entries,
    explanation,
  };
}

export function buildSettlement(
  duelId: string,
  result: EngineResult,
  meta: Pick<Settlement, "source" | "simulated" | "startSession" | "endSession" | "settledAt"> & { issues?: string[] },
): Settlement {
  return {
    duelId,
    status: result.status,
    winners: result.winners,
    winningTicker: result.winningTicker,
    marginPct: result.marginPct,
    entries: result.entries,
    explanation: result.explanation,
    calculationVersion: CALCULATION_VERSION,
    methodology: "percent_return_official_close",
    source: meta.source,
    simulated: meta.simulated,
    startSession: meta.startSession,
    endSession: meta.endSession,
    settledAt: meta.settledAt,
    issues: meta.issues ?? [],
  };
}
