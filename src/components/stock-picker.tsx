"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { ASSETS } from "@/lib/market/assets";
import { useQuotes } from "@/lib/hooks";
import { cx, price } from "@/lib/format";
import { Pct } from "@/components/ui";

export function StockPicker({ value, onChange, exclude = [], label }: { value?: string; onChange: (t: string) => void; exclude?: string[]; label?: string }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ASSETS.filter((a) => !s || a.ticker.toLowerCase().includes(s) || a.name.toLowerCase().includes(s) || a.sector.includes(s));
  }, [q]);
  const { quotes, loading } = useQuotes(ASSETS.map((a) => a.ticker), 60_000);
  return (
    <div>
      {label && <p className="label">{label}</p>}
      <div className="relative mb-2">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input !pl-10" placeholder="search ticker or company" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search stocks" />
      </div>
      <ul className="max-h-[46dvh] divide-y overflow-y-auto rounded-xl border bg-surface" role="listbox" aria-label="stocks">
        {list.length === 0 && <li className="p-4 text-sm text-muted">no supported stock matches “{q}”.</li>}
        {list.map((a) => {
          const disabled = exclude.includes(a.ticker);
          const sel = value === a.ticker;
          const qt = quotes[a.ticker];
          return (
            <li key={a.ticker}>
              <button
                role="option"
                aria-selected={sel}
                disabled={disabled}
                onClick={() => onChange(a.ticker)}
                className={cx("flex w-full items-center gap-3 px-3.5 py-3 text-left transition disabled:opacity-40", sel ? "bg-black/[.04]" : "hover:bg-black/[.02]")}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[.05] text-[11px] font-extrabold">{a.ticker.slice(0, 4)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{a.ticker}</span>
                  <span className="block truncate text-[13px] text-muted">{a.name}{disabled ? " · already picked" : ""}</span>
                </span>
                <span className="text-right">
                  {qt ? <><span className="num block text-sm font-semibold">{price(qt.price)}</span><Pct v={qt.changePct} className="text-[12px]" /></> : loading ? <span className="skeleton block h-4 w-14" /> : null}
                </span>
                {sel && <Check size={18} className="text-brand" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
