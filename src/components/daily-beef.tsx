"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Flame, Lock } from "lucide-react";
import { ensureDaily, pickDaily, useBeef } from "@/lib/store/store";
import { dailyFor, dailySessions } from "@/lib/derive";
import { useAction, Pct } from "@/components/ui";
import { cx, sessionLabel } from "@/lib/format";
import { useMounted } from "@/lib/hooks";

export function useDailyResults() {
  const s = useBeef();
  const [results, setResults] = useState<Record<string, Record<string, number>>>({});
  const key = s.daily.map((d) => `${d.session},${d.a},${d.b}`).join(";");
  useEffect(() => {
    if (!key) return;
    fetch(`/api/daily?m=${encodeURIComponent(key)}`).then((r) => r.json()).then((j) => setResults(j.results ?? {})).catch(() => {});
  }, [key]);
  return results;
}

export function DailyBeefCard({ compact }: { compact?: boolean }) {
  const s = useBeef();
  const mounted = useMounted();
  const run = useAction();
  const { pickSession } = useMemo(() => dailySessions(new Date()), []);
  const d = dailyFor(s, pickSession);
  useEffect(() => { ensureDaily(d); }, [d]);
  const me = s.session.userId;
  const mine = me ? d.picks[me] : undefined;
  const total = Object.keys(d.picks).length;
  const aCount = Object.values(d.picks).filter((x) => x === d.a).length;
  const aShare = total ? Math.round((aCount / total) * 100) : 50;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b bg-brand-soft/60 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-bold text-brand-ink"><Flame size={16} /> beef of the day</p>
        <p className="text-xs font-medium text-brand-ink/80">{mounted ? sessionLabel(d.session) : ""}</p>
      </div>
      <div className="p-4">
        <p className="mb-3 text-[15px] text-ink-soft">which does better{compact ? "" : " from yesterday's close to the next close"}?</p>
        <div className="grid grid-cols-2 gap-2">
          {[d.a, d.b].map((t) => (
            <button
              key={t}
              disabled={!!mine}
              onClick={() => run(() => pickDaily(d.session, t), `you picked ${t}`)}
              className={cx("rounded-xl border-2 p-3 text-center transition", mine === t ? "border-ink bg-ink text-white" : mine ? "border-line opacity-60" : "border-line hover:border-ink/30")}
            >
              <span className="block font-display text-xl font-extrabold">{t}</span>
              {mine && <span className="num text-xs">{t === d.a ? aShare : 100 - aShare}% picked</span>}
            </button>
          ))}
        </div>
        {!me && <p className="mt-2 text-xs text-muted"><Link href="/auth/sign-in" className="underline">sign in</Link> to pick a side.</p>}
        {mine && <p className="mt-2 flex items-center gap-1 text-xs text-muted"><Lock size={12} /> pick locked · result after the close · {total} picks</p>}
        {!compact && <Link href="/beef-of-the-day" className="mt-3 inline-block text-sm font-semibold text-brand-dark hover:underline">see past results →</Link>}
      </div>
    </div>
  );
}

export function DailyHistory() {
  const s = useBeef();
  const results = useDailyResults();
  const me = s.session.userId;
  const past = s.daily.filter((d) => results[d.session]).sort((a, b) => b.session.localeCompare(a.session));
  if (!past.length) return <p className="text-sm text-muted">results appear after each market close.</p>;
  return (
    <ul className="space-y-2">
      {past.map((d) => {
        const r = results[d.session];
        const winner = r[d.a] === r[d.b] ? null : r[d.a] > r[d.b] ? d.a : d.b;
        const mine = me ? d.picks[me] : undefined;
        const total = Object.keys(d.picks).length;
        const right = Object.values(d.picks).filter((p) => p === winner).length;
        return (
          <li key={d.session} className="card flex items-center gap-3 p-3">
            <div className="w-20 shrink-0 text-xs text-muted">{sessionLabel(d.session)}</div>
            <div className="flex flex-1 items-center gap-3 text-sm">
              <span className={cx("font-bold", winner === d.a ? "text-ink" : "text-faint")}>{d.a} <Pct v={r[d.a]} className="text-xs" /></span>
              <span className="text-faint">vs</span>
              <span className={cx("font-bold", winner === d.b ? "text-ink" : "text-faint")}>{d.b} <Pct v={r[d.b]} className="text-xs" /></span>
            </div>
            <div className="text-right text-xs">
              {mine ? <span className={cx("font-semibold", mine === winner ? "text-gain" : "text-loss")}>{mine === winner ? "you called it" : "missed"}</span> : <span className="text-muted">no pick</span>}
              <span className="block text-muted">{total ? Math.round((right / total) * 100) : 0}% right</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
