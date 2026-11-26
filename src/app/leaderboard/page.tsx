"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Flame, Info, Trophy } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { statsFor } from "@/lib/hooks";
import { cx } from "@/lib/format";
import { Avatar, EmptyState, PageHeader, Tabs } from "@/components/ui";

type Period = "week" | "month" | "all";
type Metric = "score" | "winrate" | "streak" | "active";

const PERIODS: { value: Period; label: string; days: number }[] = [
  { value: "week", label: "this week", days: 7 },
  { value: "month", label: "this month", days: 30 },
  { value: "all", label: "all-time", days: 0 },
];

const METRICS: { value: Metric; label: string; unit: string }[] = [
  { value: "score", label: "beef score", unit: "score" },
  { value: "winrate", label: "win rate", unit: "win rate" },
  { value: "streak", label: "longest streak", unit: "streak" },
  { value: "active", label: "most active", unit: "activity" },
];

export default function LeaderboardPage() {
  const s = useBeef();
  const [period, setPeriod] = useState<Period>("week");
  const [metric, setMetric] = useState<Metric>("score");
  const me = s.session.userId;
  const minForWinRate = period === "all" ? 5 : 3;

  const ranked = useMemo(() => {
    const days = PERIODS.find((p) => p.value === period)!.days;
    const since = days ? Date.now() - days * 864e5 : 0;
    return s.users
      .map((u) => {
        const st = statsFor(s, u.id, since);
        const value =
          metric === "score" ? (st.completed ? st.score : -1)
          : metric === "winrate" ? (st.completed >= minForWinRate ? st.winRate : -1)
          : metric === "streak" ? (st.bestStreak || -1)
          : st.completed + st.activity || -1;
        return { u, st, value };
      })
      .filter((r) => r.value >= 0)
      .sort((a, b) => b.value - a.value || b.st.wins - a.st.wins || a.u.username.localeCompare(b.u.username));
  }, [s, period, metric, minForWinRate]);

  const myIdx = ranked.findIndex((r) => r.u.id === me);
  const fmt = (v: number) => (metric === "winrate" ? `${v.toFixed(0)}%` : String(Math.round(v)));

  const Row = ({ r, rank, pinned }: { r: (typeof ranked)[number]; rank: number; pinned?: boolean }) => (
    <Link href={`/u/${r.u.username}`} className={cx("relative flex items-center gap-3 hover:bg-ink/[.03]", rank === 1 ? "py-5" : "py-3", pinned && "border-t-2 border-dashed border-ink/40")}>
      {r.u.id === me && <span className="absolute inset-y-2 -left-4 w-[3px] bg-ink" aria-hidden />}
      <span className={cx("display-cond num w-11 shrink-0 text-right font-bold leading-none tracking-[-0.03em]", rank === 1 ? "text-[64px] text-brand" : rank <= 3 ? "text-[44px] text-ink" : "text-[30px] text-faint")}>{rank}</span>
      <Avatar user={r.u} size={rank === 1 ? 48 : 38} />
      <div className="min-w-0 flex-1">
        <p className={cx("truncate font-semibold", rank === 1 && "font-display text-[20px] font-bold tracking-[-0.02em]")}>{r.u.displayName}{r.u.id === me && <span className="font-normal text-muted"> (you)</span>}</p>
        <p className="num flex items-center gap-1 truncate text-[13px] text-muted">
          {r.st.wins}–{r.st.losses}{r.st.draws ? `–${r.st.draws}` : ""} · {r.st.completed ? `${r.st.winRate.toFixed(0)}% win` : "no results"}
          {r.st.streak > 1 && <span className="inline-flex items-center gap-0.5 text-brand-dark">· <Flame size={12} />{r.st.streak}</span>}
        </p>
      </div>
      <div className="text-right">
        <p className={cx("num display-cond font-bold leading-none", rank === 1 ? "text-[34px]" : "text-[24px]")}>{fmt(r.value)}</p>
        <p className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[.1em] text-muted">{METRICS.find((m) => m.value === metric)!.unit}</p>
      </div>
    </Link>
  );

  return (
    <div>
      <PageHeader title="leaderboard" subtitle="who's actually right?" />
      <Tabs<Period> value={period} onChange={setPeriod} options={PERIODS} className="mb-3" />
      <div className="no-scrollbar -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="category">
        {METRICS.map((m) => (
          <button key={m.value} role="tab" aria-selected={metric === m.value} onClick={() => setMetric(m.value)}
            className={cx("chip shrink-0 !min-h-8 !py-1 text-[13px]", metric === m.value && "chip-active")}>
            {m.label}
          </button>
        ))}
      </div>

      {ranked.length === 0 ? (
        <EmptyState icon={<Trophy size={22} />} title="no results in this period yet" body="rankings fill up as duels settle." action={<Link href="/duel/new" className="btn-primary btn-sm">start a beef</Link>} />
      ) : (
        <div className="divide-y border-y-2 border-ink">
          {ranked.slice(0, 10).map((r, i) => <Row key={r.u.id} r={r} rank={i + 1} />)}
          {myIdx >= 10 && <Row r={ranked[myIdx]} rank={myIdx + 1} pinned />}
        </div>
      )}
      {me && myIdx < 0 && ranked.length > 0 && <p className="mt-2 text-center text-[13px] text-muted">you're not ranked here yet{metric === "winrate" ? ` (needs ${minForWinRate} settled duels)` : ""}.</p>}

      <div className="mt-5 flex items-start gap-2 text-[13px] leading-relaxed text-muted">
        <Info size={15} className="mt-0.5 shrink-0" />
        <p>
          rankings use settled duels {period === "all" ? "since the start" : `from the last ${period === "week" ? "7" : "30"} days`}.
          beef score rewards consistency: win rate (weighted by how many duels you've played), completed duels, streaks and community activity.
          stake size never counts, so bigger bets don't buy a higher rank.{metric === "winrate" ? ` win rate needs at least ${minForWinRate} settled duels.` : ""}
        </p>
      </div>
    </div>
  );
}
