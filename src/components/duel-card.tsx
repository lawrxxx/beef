"use client";

import { deadlineLine } from "@/lib/expiration";
import { fmtStake, formatUsdc, prizePoolUnits, stakeUnits } from "@/lib/stake";
import Link from "next/link";
import { Clock, Crown, Users } from "lucide-react";
import type { Duel } from "@/lib/types";
import { useBeef } from "@/lib/store/store";
import { livePerformance, useNow, useQuotes, userById } from "@/lib/hooks";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/derive";
import { countdown, cx} from "@/lib/format";
import { Avatar, Pct, QuoteLine } from "@/components/ui";

export function StatusPill({ d }: { d: Duel }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.1em]", STATUS_STYLE[d.status])}>
      {d.status === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gain" />}
      {STATUS_LABEL[d.status]}
    </span>
  );
}

/** tug of war between two returns: a hairline with the leader's side inked. purely visual. */
export function VersusBar({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return <div className="h-[3px] bg-ink/10" />;
  const diff = Math.max(-10, Math.min(10, a - b));
  const left = 50 + diff * 4.5;
  return (
    <div className="relative h-[3px] bg-ink/10" aria-hidden>
      <div className="absolute inset-y-0 left-0 bg-ink transition-all duration-700" style={{ width: `${left}%` }} />
      <div className="absolute -top-1 left-1/2 h-[11px] w-px -translate-x-1/2 bg-ink/50" />
    </div>
  );
}

/** the inked result stamp used on finished duels */
export function ResultStamp({ kind, className }: { kind: "won" | "lost" | "draw"; className?: string }) {
  return (
    <span className={cx("stamp text-[13px]", kind === "won" ? "border-brand text-brand-dark" : kind === "draw" ? "border-ink/70 text-ink" : "border-ink/30 text-muted", className)}>
      {kind === "won" ? "won" : kind === "draw" ? "draw" : "lost"}
    </span>
  );
}

export function DuelCard({ d, compact }: { d: Duel; compact?: boolean }) {
  const s = useBeef();
  const now = useNow(compact ? 30_000 : 1000);
  const live = d.status === "active";
  const { quotes } = useQuotes(live ? d.participants.map((p) => p.ticker) : []);
  const perf = livePerformance(d, quotes);
  const done = d.status === "completed" && d.settlement;
  const draw = done && d.settlement!.status === "draw";
  const leaderRet = Math.max(...perf.map((p) => p.ret ?? -Infinity));
  const group = d.participants.length > 2;
  const potUnits = prizePoolUnits(stakeUnits(d.stake), d.participants.length);
  const pot = formatUsdc(potUnits);
  const showRet = d.status === "active" || !!done;

  return (
    <Link href={`/duel/${d.id}`} className="card group block overflow-hidden transition hover:border-ink/40">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill d={d} />
          {group && <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[.1em] text-muted"><Users size={12} /> group</span>}
          {d.title && <span className="truncate text-[13px] text-muted">· {d.title}</span>}
        </div>
        <span className="num shrink-0 text-[13px] font-semibold">{pot} <span className="font-normal text-muted">pot</span></span>
      </div>

      <div className="border-y border-line">
        {perf.map((p, i) => {
          const u = userById(s, p.userId);
          const winner = done ? d.settlement!.winners.includes(p.userId) : live && p.ret != null && p.ret === leaderRet;
          return (
            <div key={p.ticker} className={cx("relative flex items-center gap-3 px-4", compact ? "py-2" : "py-2.5", i > 0 && "border-t border-line")}>
              {winner && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" aria-hidden />}
              <Avatar user={u} size={compact ? 28 : 32} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-[14px] font-semibold leading-tight">
                  <span className="truncate">{u ? u.displayName : "open spot"}</span>
                  {winner && !done && <Crown size={13} className="shrink-0 text-gold" />}
                </p>
                {live && !compact ? <QuoteLine q={p.quote} className="mt-0.5" /> : <p className="text-[12px] text-muted">{u ? `@${u.username}` : "anyone can join"}</p>}
              </div>
              <span className="display-cond w-[64px] shrink-0 text-[19px] font-bold uppercase tracking-[.02em]">{p.ticker}</span>
              <span className="w-[86px] shrink-0 text-right">
                {done && winner && !draw ? <ResultStamp kind="won" className="!text-[12px]" /> : showRet ? <Pct v={p.ret} className="display-cond text-[22px] font-bold" /> : <span className="text-sm text-faint">—</span>}
              </span>
            </div>
          );
        })}
      </div>

      {!group && (live || done) && <VersusBar a={perf[0]?.ret ?? null} b={perf[1]?.ret ?? null} />}

      <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-muted">
        <span className="num">{fmtStake(d.stake)} test usdc each</span>
        {live || d.status === "accepted" ? (
          <span className="num inline-flex items-center gap-1 font-semibold text-ink"><Clock size={13} /> {countdown(d.deadline, now)} left</span>
        ) : done ? (
          <span className="num">{draw ? "draw · stakes returned" : `won by ${d.settlement!.marginPct.toFixed(2)} pts`}</span>
        ) : d.status === "pending" ? (
          <span className="truncate pl-2">ends {deadlineLine(d)}</span>
        ) : (
          <span>{STATUS_LABEL[d.status]}</span>
        )}
      </div>
    </Link>
  );
}
