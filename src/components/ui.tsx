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
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", ring && "ring-2 ring-white")}
      style={{ width: size, height: size, background: user?.avatarColor ?? "#EEE", fontSize: size * 0.5 }}
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

export function SimBadge({ className, label = "simulated" }: { className?: string; label?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold", className)} title="prices and balances in this demo are simulated, not live market data or real money">
      <FlaskConical size={11} /> {label}
    </span>
  );
}

// ---------- layout ----------

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-6", className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/[.04] text-muted">{icon}</div>
      <p className="font-semibold">{title}</p>
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
    <div role="tablist" className={cx("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1", className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cx("chip shrink-0", value === o.value && "chip-active")}>
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
      <button aria-label="close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="relative max-h-[88dvh] w-full max-w-md animate-fade-up overflow-y-auto rounded-t-3xl bg-surface p-5 pb-safe shadow-pop sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
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
          <div key={t.id} className="pointer-events-auto mt-3 flex max-w-sm animate-fade-up items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-pop">
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
