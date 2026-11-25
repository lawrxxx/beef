import { MARKET_TZ } from "@/lib/market/calendar";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function usd(n: number, digits = 2) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function price(n: number) {
  return usd(n, 2);
}

export function pct(n: number, digits = 2) {
  const v = Math.abs(n) < 0.5 / 10 ** digits ? 0 : n;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function timeAgo(iso: string, now = Date.now()) {
  if (!now) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function countdown(iso: string, now = Date.now()) {
  if (!now) return "…";
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  if (s === 0) return "ended";
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

/** e.g. "fri, nov 27 · 1:00 pm et" */
export function marketTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { timeZone: MARKET_TZ, weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: MARKET_TZ, hour: "numeric", minute: "2-digit" });
  return `${date} · ${time} et`.toLowerCase();
}

export function sessionLabel(session: string) {
  const [y, m, dd] = session.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).toLowerCase();
}

export function uid(prefix: string) {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${r}`;
}
