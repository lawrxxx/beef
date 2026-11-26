"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, FlaskConical, Info, X, XCircle } from "lucide-react";
import type { User } from "@/lib/types";
import { cx, pct, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { getAsset } from "@/lib/market/assets";

// ---------- avatar ----------

export function Avatar({ user, size = 40, ring }: { user?: User | null; size?: number; ring?: boolean }) {
  const isImg = user?.avatar?.startsWith("data:") || user?.avatar?.startsWith("http");
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", ring && "ring-2 ring-bg")}
      style={{ width: size, height: size, background: user?.avatarColor ?? "rgb(var(--line))", fontSize: size * 0.5 }}
      aria-hidden
    >
      {isImg ? <img src={user!.avatar} alt="" className="h-full w-full object-cover" /> : user?.avatar ?? "👤"}
    </span>
  );
}

export function UserLink({ user, className }: { user?: User | null; className?: string }) {
  if (!user) return <span className={className}>someone</span>;
  return (
    <Link href={`/u/${user.username}`} className={cx("font-semibold hover:underline", className)}>
      {user.displayName}
    </Link>
  );
}

// ---------- market bits ----------

export function TickerTag({ t, href = true }: { t: string; href?: boolean }) {
  const el = <span className="ticker">{t}</span>;
  return href ? <Link href={`/stock/${t}`} title={getAsset(t)?.name}>{el}</Link> : el;
}

export function Pct({ v, className, digits = 2 }: { v: number | null | undefined; className?: string; digits?: number }) {
  if (v == null || Number.isNaN(v)) return <span className={cx("num text-faint", className)}>—</span>;
  const zero = Math.abs(v) < 0.5 / 10 ** digits;
  return (
    <span className={cx("num font-semibold", zero ? "text-muted" : v > 0 ? "text-gain" : "text-loss", className)}>
      {pct(v, digits)}
    </span>
  );
}

export function SimBadge({ className, label = "testnet" }: { className?: string; label?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[.08em] text-gold", className)} title="base sepolia testnet: test usdc has no monetary value">
      <FlaskConical size={11} /> {label}
    </span>
  );
}

/** stock prices come only from chainlink data feeds */
export function SourceBadge({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-chainlink", className)} title="prices: chainlink data feeds on base mainnet">
      <span className="h-1.5 w-1.5 rotate-45 bg-chainlink" aria-hidden /> chainlink
    </span>
  );
}

/** price + market session + freshness for a chainlink quote. never says "live" for a stale or closed report. */
export function QuoteLine({ q, className, big }: { q?: import("@/lib/types").Quote; className?: string; big?: boolean }) {
  if (!q) return <span className={cx("skeleton inline-block h-4 w-16", className)} />;
  if (q.price == null || q.status === "unavailable" || q.status === "unknown") {
    return <span className={cx("text-[12px] text-muted", className)} title={q.reason}>{q.status === "unknown" ? "market status unknown" : "price unavailable"}</span>;
  }
  const updated = q.lastSeenAt ? new Date(q.lastSeenAt) : null;
  const tag = q.status === "live" ? q.sessionLabel : q.status === "closed" ? "market closed" : `stale · ${q.sessionLabel}`;
  return (
    <span className={cx("inline-flex flex-col", className)}>
      <span className={cx("num font-semibold", big ? "display-cond text-[40px] font-bold leading-none" : "text-sm")}>${Number(q.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <span className={cx("text-[11px]", q.status === "live" ? "text-muted" : "text-gold")}>
        {q.status === "live" && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-gain align-middle" />}
        {tag}{updated ? ` · ${updated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
      </span>
    </span>
  );
}

// ---------- layout ----------

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3 border-b border-ink/80 pb-3">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-8", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="section-title rule-title flex-1">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center border-y border-dashed border-ink/25 px-6 py-10 text-center">
      <div className="mb-3 text-muted">{icon}</div>
      <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function CardSkeleton() {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/5" /></div>
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("no-scrollbar -mx-4 flex gap-5 overflow-x-auto border-b px-4", className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx("-mb-px shrink-0 border-b-2 pb-2.5 pt-1 text-[15px] font-semibold transition", value === o.value ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- sheet / modal ----------

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={title}>
      <button aria-label="close" className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="relative max-h-[88dvh] w-full max-w-md animate-fade-up overflow-y-auto rounded-t-2xl border-t border-ink/80 bg-surface p-5 pb-safe shadow-pop sm:rounded-xl sm:border">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} className="btn-ghost btn-sm -mr-2 !px-2" aria-label="close"><X size={20} /></button>
        </div>
        {children}
        <div className="h-3" />
      </div>
    </div>
  );
}

// ---------- toasts ----------

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; push(d.kind, d.text); };
    window.addEventListener("beef:toast", on);
    return () => window.removeEventListener("beef:toast", on);
  }, [push]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-safe" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto mt-3 flex max-w-sm animate-fade-up items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-inverse shadow-pop">
            {t.kind === "success" ? <CheckCircle2 size={16} className="text-gain" /> : t.kind === "error" ? <XCircle size={16} className="text-loss" /> : <Info size={16} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** wraps an action: shows its error message as a toast */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => T | Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast("success", success);
        return r;
      } catch (e) {
        toast("error", e instanceof Error ? e.message : "something went wrong");
        return undefined;
      }
    },
    [toast],
  );
}

/** relative time, rendered only on the client to avoid hydration mismatches */
export function Ago({ iso }: { iso: string }) {
  const now = useNow(60_000);
  return <>{timeAgo(iso, now)}</>;
}
