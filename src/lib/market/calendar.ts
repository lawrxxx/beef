// us equity market calendar (nyse/nasdaq regular sessions).
// all instants are handled as utc; session dates are yyyy-mm-dd in America/New_York.

export const MARKET_TZ = "America/New_York";

const HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** sessions that close at 13:00 et */
const EARLY_CLOSES = new Set([
  "2025-07-03", "2025-11-28", "2025-12-24",
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

export const CALENDAR_RANGE = { from: "2025-01-01", to: "2027-12-31" };

/** offset in minutes of tz at a utc instant (e.g. -300 for est) */
function tzOffsetMinutes(date: Date, tz = MARKET_TZ): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** convert a wall-clock time in the market timezone to a utc Date */
export function marketTimeToUtc(session: string, hour: number, minute = 0): Date {
  const [y, m, d] = session.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  // two passes handles dst boundaries
  let utc = new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000);
  utc = new Date(guess.getTime() - tzOffsetMinutes(utc) * 60000);
  return utc;
}

/** session date (yyyy-mm-dd) in the market timezone for a utc instant */
export function sessionDateOf(date: Date): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return dtf.format(date);
}

export function addDays(session: string, n: number): string {
  const [y, m, d] = session.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function isWeekend(session: string): boolean {
  const [y, m, d] = session.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

export function isHoliday(session: string): boolean {
  return HOLIDAYS.has(session);
}

export function isTradingDay(session: string): boolean {
  return !isWeekend(session) && !isHoliday(session);
}

export function closeHour(session: string): number {
  return EARLY_CLOSES.has(session) ? 13 : 16;
}

export function isEarlyClose(session: string): boolean {
  return EARLY_CLOSES.has(session);
}

export function sessionOpenUtc(session: string): Date {
  return marketTimeToUtc(session, 9, 30);
}

export function sessionCloseUtc(session: string): Date {
  return marketTimeToUtc(session, closeHour(session), 0);
}

export function nextTradingDay(session: string): string {
  let s = addDays(session, 1);
  while (!isTradingDay(s)) s = addDays(s, 1);
  return s;
}

export function prevTradingDay(session: string): string {
  let s = addDays(session, -1);
  while (!isTradingDay(s)) s = addDays(s, -1);
  return s;
}

/** last session whose official close is at or before the instant */
export function lastCloseAtOrBefore(at: Date): string {
  const s = sessionDateOf(at);
  if (isTradingDay(s) && sessionCloseUtc(s).getTime() <= at.getTime()) return s;
  return prevTradingDay(s);
}

/** first session whose official close is strictly after the instant */
export function nextCloseAfter(at: Date): string {
  const s = sessionDateOf(at);
  if (isTradingDay(s) && sessionCloseUtc(s).getTime() > at.getTime()) return s;
  return nextTradingDay(s);
}

export function isMarketOpen(at: Date): boolean {
  const s = sessionDateOf(at);
  if (!isTradingDay(s)) return false;
  const t = at.getTime();
  return t >= sessionOpenUtc(s).getTime() && t < sessionCloseUtc(s).getTime();
}

/** trading sessions in [from, to] inclusive */
export function tradingDaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let s = from;
  while (s <= to) {
    if (isTradingDay(s)) out.push(s);
    s = addDays(s, 1);
  }
  return out;
}

export function weekdayOf(session: string): number {
  const [y, m, d] = session.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface DeadlineOption {
  id: string;
  label: string;
  session: string;
  deadline: string; // iso utc
  note?: string;
}

/**
 * deadline presets, always aligned to an official close.
 * prices lock at the first close after acceptance, so every deadline is at least
 * one full session after that lock.
 */
export function deadlineOptions(now: Date): DeadlineOption[] {
  const lock = nextCloseAfter(now);
  const opts: DeadlineOption[] = [];
  const push = (id: string, label: string, session: string) => {
    if (opts.some((o) => o.session === session)) return;
    opts.push({
      id, label, session,
      deadline: sessionCloseUtc(session).toISOString(),
      note: isEarlyClose(session) ? "early close, 1:00pm et" : undefined,
    });
  };

  // this friday (or next friday if we are past it)
  let f = nextTradingDay(lock);
  while (weekdayOf(f) !== 5 || f <= lock) f = addDays(f, 1);
  // friday holiday -> roll back to the last trading day of that week
  while (!isTradingDay(f)) f = addDays(f, -1);
  if (f > lock) push("friday", "until friday", f);
  // added after friday so that when they coincide the friendlier label wins
  push("next", "next session", nextTradingDay(lock));

  let w = addDays(lock, 7);
  while (!isTradingDay(w)) w = addDays(w, -1);
  push("week", "1 week", w);

  let m = addDays(lock, 30);
  while (!isTradingDay(m)) m = addDays(m, -1);
  push("month", "1 month", m);

  return opts.sort((a, b) => a.session.localeCompare(b.session));
}

/**
 * resolve an arbitrary deadline to the settlement session.
 * rule: last official close at or before the deadline. if that is not after the
 * lock session, roll forward to the next trading session (agreed in the terms).
 */
export function resolveEndSession(deadline: Date, lockSession: string): string {
  const s = lastCloseAtOrBefore(deadline);
  return s > lockSession ? s : nextTradingDay(lockSession);
}
