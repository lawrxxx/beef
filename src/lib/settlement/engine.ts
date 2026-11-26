import { formatUnits } from "viem";
import type { Settlement, SettlementEntry } from "@/lib/types";

// pure, deterministic winner calculation. no i/o, no clocks, no client input.
// prices are 18-decimal integers (chainlink v11 int192); all comparison maths is bigint.
// bump the version for any change in comparison behaviour.
export const CALCULATION_VERSION = "pct-return-v2";
export const PRICE_DECIMALS = 18;

/** returns are compared at this many decimals of a percentage point (0.0001 pts) */
export const COMPARISON_DECIMALS = 4;

export interface EngineInput {
  userId: string;
  ticker: string;
  /** 18-decimal prices; start is already split-adjusted onto the end's share basis */
  startE18: bigint;
  endE18: bigint;
}

/** percentage return × 1e6 = ((end − start) / start) × 100 × 1e6, truncated toward zero */
export function returnE6(start: bigint, end: bigint): bigint {
  if (start <= 0n || end < 0n) throw new RangeError(`invalid prices: start=${start} end=${end}`);
  return ((end - start) * 100_000_000n) / start;
}

/** the value returns are compared on: percent × 1e4 (0.0001 percentage points) */
export const comparable = (r6: bigint) => r6 / 100n;

/** display only: percentage return as a js number */
export const returnPctNumber = (r6: bigint) => Number(r6) / 1e6;

/** display only, for live views: percentage return from js numbers */
export function percentReturn(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < 0) throw new RangeError(`invalid prices: start=${start} end=${end}`);
  return ((end - start) / start) * 100;
}

export function fmtPct(n: number, digits = 2): string {
  const v = Math.abs(n) < 0.5 / 10 ** digits ? 0 : n;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

const pts = (c4: bigint) => {
  const neg = c4 < 0n; const a = neg ? -c4 : c4;
  return `${neg ? "-" : ""}${a / 10_000n}.${(a % 10_000n).toString().padStart(4, "0")}`;
};

export interface EngineResult {
  status: "settled" | "draw";
  winners: string[];
  winningTicker?: string;
  marginPct: number;
  /** margin in 0.0001 percentage points, exact */
  marginE4: string;
  entries: SettlementEntry[];
  explanation: string;
}

/**
 * ranks entries by percentage return (higher is better, so a smaller loss beats a
 * bigger loss). identical returns at 0.0001 points share a rank. if every entry ties,
 * the result is a draw. if several entries tie for first in a group, they share the win.
 */
export function compareReturns(inputs: EngineInput[]): EngineResult {
  if (inputs.length < 2) throw new RangeError("need at least two entries");
  if (new Set(inputs.map((i) => i.ticker)).size !== inputs.length) throw new RangeError("each participant must pick a different stock");

  const withReturns = inputs.map((i) => ({ ...i, r6: returnE6(i.startE18, i.endE18) }));
  const sorted = [...withReturns].sort((a, b) => (comparable(b.r6) > comparable(a.r6) ? 1 : comparable(b.r6) < comparable(a.r6) ? -1 : a.ticker.localeCompare(b.ticker)));

  const entries: SettlementEntry[] = [];
  let rank = 0;
  let prev: bigint | null = null;
  for (const e of sorted) {
    const c = comparable(e.r6);
    if (prev === null || c !== prev) rank += 1;
    prev = c;
    entries.push({
      userId: e.userId, ticker: e.ticker, rank,
      startPrice: Number(formatUnits(e.startE18, PRICE_DECIMALS)), endPrice: Number(formatUnits(e.endE18, PRICE_DECIMALS)),
      returnPct: returnPctNumber(e.r6),
      startE18: e.startE18.toString(), endE18: e.endE18.toString(), returnE6: e.r6.toString(),
    });
  }

  const top = entries.filter((e) => e.rank === 1);
  const second = entries.find((e) => e.rank === 2);
  const describe = (e: SettlementEntry) => `${e.ticker} returned ${fmtPct(e.returnPct, 4)}`;

  if (top.length === entries.length) {
    return {
      status: "draw", winners: [], marginPct: 0, marginE4: "0", entries,
      explanation: `${entries.map(describe).join(", ")}. the returns are identical to 0.0001 points, so this beef is a draw and stakes are returned.`,
    };
  }

  const marginE4 = comparable(BigInt(top[0].returnE6!)) - comparable(BigInt(second!.returnE6!));
  let explanation: string;
  if (entries.length === 2) {
    const [w, l] = entries;
    const bothDown = w.returnPct < 0 && l.returnPct < 0;
    explanation = `${describe(w)}, while ${describe(l)}. ${w.ticker} wins by ${pts(marginE4)} percentage points` + (bothDown ? `: both fell, but ${w.ticker} fell less.` : ".");
  } else {
    explanation = `${entries.map(describe).join(", ")}. ` + (top.length > 1
      ? `${top.map((t) => t.ticker).join(" and ")} tied for first, ${pts(marginE4)} points ahead of the next pick.`
      : `${top[0].ticker} finished first, ${pts(marginE4)} points ahead of ${second!.ticker}.`);
  }
  return {
    status: "settled", winners: top.map((t) => t.userId), winningTicker: top.length === 1 ? top[0].ticker : undefined,
    marginPct: Number(marginE4) / 1e4, marginE4: marginE4.toString(), entries, explanation,
  };
}

export function buildSettlement(
  duelId: string,
  result: EngineResult,
  meta: Pick<Settlement, "source" | "simulated" | "startSession" | "endSession" | "settledAt" | "methodology"> & Partial<Pick<Settlement, "window" | "evidence">> & { issues?: string[] },
): Settlement {
  return {
    duelId, status: result.status, winners: result.winners, winningTicker: result.winningTicker,
    marginPct: result.marginPct, marginE4: result.marginE4, entries: result.entries, explanation: result.explanation,
    calculationVersion: CALCULATION_VERSION, methodology: meta.methodology, source: meta.source, simulated: meta.simulated,
    startSession: meta.startSession, endSession: meta.endSession, settledAt: meta.settledAt,
    window: meta.window, evidence: meta.evidence, issues: meta.issues ?? [],
  };
}
