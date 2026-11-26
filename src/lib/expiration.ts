import { CALENDAR_RANGE, MARKET_TZ, inCalendarRange, isEarlyClose, isRegularSession, isTradingDay, nextOpenAfter, nextOpenAtOrAfter, sessionDateOf } from "@/lib/market/calendar";

// duel expiration. a duel starts at the first us market open after everyone has joined
// ("activation") and ends at the deadline. all instants are stored in utc.
//
// - next_open: ends at the next market open after the start (one trading session)
// - one_week:  seven calendar days after activation, rolled to the next market open at or after it
// - custom:    a date and time the creator picks, inside regular trading hours
//
// start and deadline for next_open / one_week depend on when the duel activates, so they're
// fixed at activation; until then the app shows them as "if accepted now".

export type ExpirationType = "next_open" | "one_week" | "custom";
export const EXPIRATION_TYPES: ExpirationType[] = ["next_open", "one_week", "custom"];

export const EXPIRATION_COPY: Record<ExpirationType, { label: string; description: string }> = {
  next_open: { label: "next market open", description: "ends at the next eligible us stock market opening." },
  one_week: { label: "one week", description: "ends one week from activation at market open." },
  custom: { label: "custom", description: "pick a date and time during regular trading hours." },
};

/** the market open that locks starting prices: the first open strictly after activation */
export const startOpenFor = (activation: Date) => nextOpenAfter(activation);

export class ExpirationError extends Error {}

/** validates a custom deadline against the market calendar and the start it must follow */
export function validateCustomDeadline(deadline: Date, activation: Date): string | null {
  if (Number.isNaN(deadline.getTime())) return "pick a valid date and time";
  if (deadline.getTime() <= activation.getTime()) return "the deadline has to be in the future";
  const session = sessionDateOf(deadline);
  if (!inCalendarRange(session)) return `pick a date between ${CALENDAR_RANGE.from} and ${CALENDAR_RANGE.to}`;
  if (!isTradingDay(session)) return "the us market is closed that day (weekend or holiday). pick a trading day";
  if (!isRegularSession(deadline)) return `pick a time during regular hours: 9:30am–${isEarlyClose(session) ? "1:00pm (early close)" : "4:00pm"} et`;
  if (deadline.getTime() <= startOpenFor(activation).getTime()) return "the deadline has to be after the market open that starts the duel";
  return null;
}

/** start and deadline for a duel that activates at `activation` */
export function scheduleFor(type: ExpirationType, activation: Date, customDeadline?: Date | string | null): { startAt: Date; deadline: Date } {
  const startAt = startOpenFor(activation);
  if (type === "next_open") return { startAt, deadline: nextOpenAfter(startAt) };
  if (type === "one_week") {
    const deadline = nextOpenAtOrAfter(new Date(activation.getTime() + 7 * 86_400_000));
    return { startAt, deadline: deadline.getTime() > startAt.getTime() ? deadline : nextOpenAfter(startAt) };
  }
  const d = customDeadline ? new Date(customDeadline) : null;
  if (!d) throw new ExpirationError("a custom deadline is required");
  const err = validateCustomDeadline(d, activation);
  if (err) throw new ExpirationError(err);
  return { startAt, deadline: d };
}

/** "tue, dec 2, 9:30 am et" */
export function etLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d).toLowerCase() + " et";
}
/** the same instant in the viewer's own timezone */
export function localLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d).toLowerCase();
}

/**
 * how a duel's deadline reads everywhere (invite, acceptance, review, duel page).
 * once a duel activates, or for custom deadlines, it's the exact time. before activation,
 * next_open / one_week show the rule plus the time it would be if it activated now.
 */
export function deadlineText(d: { deadline: string; expirationType?: ExpirationType; startAt?: string }, now = new Date()): { et: string; local: string; exact: boolean; rule?: string } {
  if (d.startAt || !d.expirationType || d.expirationType === "custom") {
    const at = new Date(d.deadline);
    return { et: etLabel(at), local: localLabel(at), exact: true };
  }
  const at = scheduleFor(d.expirationType, now).deadline;
  return { et: etLabel(at), local: localLabel(at), exact: false, rule: EXPIRATION_COPY[d.expirationType].label };
}

/** one-line version: "tue, dec 2, 9:30 am et" or "next market open (if accepted now: …)" */
export function deadlineLine(d: Parameters<typeof deadlineText>[0], now = new Date()): string {
  const t = deadlineText(d, now);
  return t.exact ? t.et : `${t.rule} (if accepted now: ${t.et})`;
}
