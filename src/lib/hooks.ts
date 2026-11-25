"use client";

import { useEffect, useMemo, useState } from "react";
import type { Duel, Quote } from "@/lib/types";
import { useBeef, type BeefState } from "@/lib/store/store";
import { computeStats, outcomeFor, ACHIEVEMENTS } from "@/lib/score";
import { percentReturn } from "@/lib/settlement/engine";

/** current time, 0 during ssr/hydration so server and client markup match */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// ---------- quotes ----------

type QuoteState = { quotes: Record<string, Quote>; loading: boolean; error: string | null; simulated: boolean; provider: string };
const quoteCache: Record<string, Quote> = {};

export function useQuotes(tickers: string[], refreshMs = 30_000): QuoteState {
  const key = Array.from(new Set(tickers)).sort().join(",");
  // initial state never reads the cache: hydration must match the server render
  const [st, setSt] = useState<QuoteState>({ quotes: {}, loading: tickers.length > 0, error: null, simulated: true, provider: "mock" });
  useEffect(() => {
    if (!key) { setSt((s) => ({ ...s, loading: false })); return; }
    let alive = true;
    const cached = key.split(",").filter((t) => quoteCache[t]);
    if (cached.length) setSt((s0) => ({ ...s0, quotes: { ...Object.fromEntries(cached.map((t) => [t, quoteCache[t]])), ...s0.quotes } }));
    const load = async () => {
      try {
        const res = await fetch(`/api/market/quotes?tickers=${key}`);
        if (!res.ok) throw new Error(res.status === 429 ? "too many requests" : "market data unavailable");
        const j = await res.json();
        if (!alive) return;
        const map: Record<string, Quote> = {};
        for (const q of j.quotes as Quote[]) { map[q.ticker] = q; quoteCache[q.ticker] = q; }
        setSt({ quotes: map, loading: false, error: null, simulated: j.simulated, provider: j.provider });
      } catch (e) {
        if (alive) setSt((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "error" }));
      }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => { alive = false; clearInterval(id); };
  }, [key, refreshMs]);
  return st;
}

// ---------- selectors ----------

export function useMe() {
  const s = useBeef();
  return useMemo(() => (s.session.userId ? s.users.find((u) => u.id === s.session.userId) ?? null : null), [s.users, s.session.userId]);
}

export function userById(s: BeefState, id: string) {
  return s.users.find((u) => u.id === id);
}

export function activityCount(s: BeefState, userId: string, since = 0) {
  const after = (iso: string) => new Date(iso).getTime() >= since;
  return (
    s.posts.filter((p) => p.authorId === userId && after(p.createdAt)).length +
    s.comments.filter((c) => c.authorId === userId && after(c.createdAt)).length +
    s.daily.filter((d) => d.picks[userId] && after(d.session + "T21:00:00Z")).length
  );
}

export function statsFor(s: BeefState, userId: string, since = 0) {
  return computeStats(userId, s.duels, activityCount(s, userId, since), since);
}

export function useStats(userId: string | null | undefined) {
  const s = useBeef();
  return useMemo(() => (userId ? statsFor(s, userId) : null), [s, userId]);
}

export function achievementsFor(s: BeefState, userId: string, correctPicks: number) {
  const st = statsFor(s, userId);
  const extra = {
    posts: s.posts.filter((p) => p.authorId === userId).length,
    comments: s.comments.filter((c) => c.authorId === userId).length,
    communities: s.memberships.filter((m) => m.userId === userId).length,
    correctPicks,
  };
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: a.test(st, extra) }));
}

export interface Rivalry {
  opponentId: string;
  duels: Duel[];
  wins: number;
  losses: number;
  draws: number;
  streak: { who: "me" | "them" | null; count: number };
}

/** head-to-head between two users across completed 1v1 duels */
export function rivalry(s: BeefState, a: string, b: string): Rivalry {
  const duels = s.duels
    .filter((d) => d.participants.length === 2 && d.participants.some((p) => p.userId === a) && d.participants.some((p) => p.userId === b))
    .sort((x, y) => y.deadline.localeCompare(x.deadline));
  let wins = 0, losses = 0, draws = 0;
  const outcomes: ("win" | "loss" | "draw")[] = [];
  for (const d of duels) {
    const o = outcomeFor(d, a);
    if (!o) continue;
    outcomes.push(o);
    if (o === "win") wins++; else if (o === "loss") losses++; else draws++;
  }
  let streak: Rivalry["streak"] = { who: null, count: 0 };
  for (const o of outcomes) {
    if (o === "draw") break;
    const who = o === "win" ? "me" : "them";
    if (streak.who === null) streak = { who, count: 1 };
    else if (streak.who === who) streak.count++;
    else break;
  }
  return { opponentId: b, duels, wins, losses, draws, streak };
}

export function rivalsOf(s: BeefState, userId: string): Rivalry[] {
  const opp = new Set<string>();
  s.duels.forEach((d) => {
    if (d.participants.length === 2 && d.participants.some((p) => p.userId === userId)) {
      d.participants.forEach((p) => p.userId && p.userId !== userId && opp.add(p.userId));
    }
  });
  return Array.from(opp).map((o) => rivalry(s, userId, o)).filter((r) => r.duels.length > 0).sort((x, y) => y.duels.length - x.duels.length);
}

/** live (display-only) performance. the winner is only ever decided by the server. */
export function livePerformance(d: Duel, quotes: Record<string, Quote>) {
  return d.participants.map((p) => {
    const start = d.startSnapshots.find((s) => s.ticker === p.ticker);
    const end = d.endSnapshots.find((s) => s.ticker === p.ticker);
    const entry = d.settlement?.entries.find((e) => e.ticker === p.ticker);
    const q = quotes[p.ticker];
    const startPrice = start?.adjustedPrice ?? start?.price;
    const current = end?.price ?? q?.price;
    const ret = entry ? entry.returnPct : startPrice && current ? percentReturn(startPrice, current) : null;
    return { ...p, startPrice: start?.price, adjustedStart: start?.adjustedPrice, current, ret, quote: q };
  });
}

export function correctPicks(s: BeefState, userId: string, closes: Record<string, Record<string, number>>) {
  // closes: session -> ticker -> return%
  return s.daily.filter((d) => {
    const pick = d.picks[userId];
    const r = closes[d.session];
    if (!pick || !r || r[d.a] == null || r[d.b] == null || r[d.a] === r[d.b]) return false;
    return (r[d.a] > r[d.b] ? d.a : d.b) === pick;
  }).length;
}
