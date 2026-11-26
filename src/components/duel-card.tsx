"use client";

import { fmtStake, formatUsdc, prizePoolUnits, stakeUnits } from "@/lib/stake";
import Link from "next/link";
import { Clock, Crown, Users } from "lucide-react";
import type { Duel } from "@/lib/types";
import { useBeef } from "@/lib/store/store";
import { livePerformance, useNow, useQuotes, userById } from "@/lib/hooks";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/derive";
import { countdown, cx, usd } from "@/lib/format";
import { Avatar, Pct, QuoteLine } from "@/components/ui";

export function StatusPill({ d }: { d: Duel }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[d.status])}>
      {d.status === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gain" />}
      {STATUS_LABEL[d.status]}
    </span>
  );
}

/** horizontal bar comparing two returns. purely visual. */
export function VersusBar({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return <div className="h-2 rounded-full bg-black/[.05]" />;
  const diff = Math.max(-10, Math.min(10, a - b));
  const left = 50 + diff * 4.5;
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-black/[.06]" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-ink transition-all duration-700" style={{ width: `${left}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white" />
    </div>
  );
}

export function DuelCard({ d, compact }: { d: Duel; compact?: boolean }) {
  const s = useBeef();
  const now = useNow(compact ? 30_000 : 1000);
  const live = d.status === "active";
  const { quotes } = useQuotes(live ? d.participants.map((p) => p.ticker) : []);
  const perf = livePerformance(d, quotes);
  const done = d.status === "completed" && d.settlement;
  const leaderRet = Math.max(...perf.map((p) => p.ret ?? -Infinity));
  const group = d.participants.length > 2;
  const potUnits = prizePoolUnits(stakeUnits(d.stake), d.participants.length);
  const pot = formatUsdc(potUnits);

  return (
    <Link href={`/duel/${d.id}`} className="card block p-4 transition hover:shadow-pop">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill d={d} />
          {group && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><Users size={12} /> group</span>}
          {d.title && <span className="truncate text-[13px] text-muted">{d.title}</span>}
        </div>
        <span className="num shrink-0 text-[13px] font-semibold">{pot} test usdc pot</span>
      </div>

      <div className={cx("grid gap-2", group ? "grid-cols-2" : "grid-cols-[1fr_auto_1fr] items-center")}>
        {perf.map((p, i) => {
          const u = userById(s, p.userId);
          const winner = done ? d.settlement!.winners.includes(p.userId) : live && p.ret != null && p.ret === leaderRet;
          const side = (
            <div key={p.ticker} className={cx("min-w-0", !group && i === 1 && "text-right")}>
              <div className={cx("flex items-center gap-2", !group && i === 1 && "flex-row-reverse")}>
                <Avatar user={u} size={compact ? 30 : 36} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold">
                    {!group && i === 1 && winner && <Crown size={13} className="shrink-0 text-gold" />}
                    <span className="truncate">{u ? u.displayName : "open spot"}</span>
                    {(group || i === 0) && winner && <Crown size={13} className="shrink-0 text-gold" />}
                  </p>
                  <p className="text-[13px] font-bold tracking-wide text-ink-soft">{p.ticker}</p>
                </div>
              </div>
              <div className={cx("mt-1.5 text-[17px]", !group && i === 1 && "text-right")}>
                {d.status === "active" || done ? <Pct v={p.ret} /> : <span className="text-sm text-faint">—</span>}
              </div>
              {live && !compact && <QuoteLine q={p.quote} className={cx("mt-0.5", !group && i === 1 && "items-end")} />}
            </div>
          );
          if (!group && i === 1) return [<span key="vs" className="px-1 text-xs font-bold text-faint">vs</span>, side];
          return side;
        })}
      </div>

      {!group && (live || done) && <div className="mt-3"><VersusBar a={perf[0]?.ret ?? null} b={perf[1]?.ret ?? null} /></div>}

      <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
        <span>{fmtStake(d.stake)} test usdc each</span>
        {live || d.status === "accepted" ? (
          <span className="num inline-flex items-center gap-1"><Clock size={13} /> {countdown(d.deadline, now)} left</span>
        ) : done ? (
          <span>{d.settlement!.status === "draw" ? "draw · stakes returned" : `won by ${d.settlement!.marginPct.toFixed(2)} pts`}</span>
        ) : d.status === "pending" ? (
          <span>{d.deadlineLabel}</span>
        ) : (
          <span>{STATUS_LABEL[d.status]}</span>
        )}
      </div>
    </Link>
  );
}
