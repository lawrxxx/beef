import type { Duel, DuelStatus } from "@/lib/types";
import type { BeefState } from "@/lib/store/store";
import { isMarketOpen, nextTradingDay, sessionDateOf, sessionOpenUtc, isTradingDay } from "@/lib/market/calendar";
import { dailyMatchup } from "@/data/seed";

export const STATUS_LABEL: Record<DuelStatus, string> = {
  pending: "waiting for opponent",
  accepted: "locks at the close",
  active: "live",
  awaiting_verification: "verifying prices",
  completed: "settled",
  cancelled: "cancelled",
  declined: "declined",
  expired: "expired",
};

export const STATUS_STYLE: Record<DuelStatus, string> = {
  pending: "bg-gold-soft text-gold",
  accepted: "bg-gold-soft text-gold",
  active: "bg-gain-soft text-gain",
  awaiting_verification: "bg-gold-soft text-gold",
  completed: "bg-black/[.05] text-ink-soft",
  cancelled: "bg-black/[.05] text-muted",
  declined: "bg-black/[.05] text-muted",
  expired: "bg-black/[.05] text-muted",
};

export function trendingTickers(s: BeefState, limit = 8): { ticker: string; mentions: number }[] {
  const counts = new Map<string, number>();
  const bump = (t: string, n = 1) => counts.set(t, (counts.get(t) ?? 0) + n);
  s.posts.forEach((p) => p.tickers.forEach((t) => bump(t)));
  s.duels.filter((d) => ["active", "pending", "accepted"].includes(d.status)).forEach((d) => d.participants.forEach((p) => bump(p.ticker, 2)));
  return Array.from(counts.entries()).map(([ticker, mentions]) => ({ ticker, mentions })).sort((a, b) => b.mentions - a.mentions).slice(0, limit);
}

export function isParticipant(d: Duel, userId: string | null) {
  return !!userId && d.participants.some((p) => p.userId === userId);
}

export function canAccept(d: Duel, userId: string | null) {
  if (!userId || d.status !== "pending") return false;
  if (d.participants.some((p) => p.userId === userId && !p.accepted)) return true;
  return d.open && !d.participants.some((p) => p.userId === userId) && d.participants.some((p) => p.userId === "");
}

/** beef of the day sessions: the open one (pickable) and the locked one (settling today) */
export function dailySessions(now = new Date()) {
  const today = sessionDateOf(now);
  const openToday = isTradingDay(today) && now < sessionOpenUtc(today);
  const pickSession = openToday ? today : nextTradingDay(today);
  const lockedSession = isMarketOpen(now) ? today : null;
  return { pickSession, lockedSession };
}

export function dailyFor(s: BeefState, session: string) {
  const existing = s.daily.find((d) => d.session === session);
  if (existing) return existing;
  const [a, b] = dailyMatchup(session);
  return { id: session, session, a, b, picks: {} as Record<string, string> };
}
