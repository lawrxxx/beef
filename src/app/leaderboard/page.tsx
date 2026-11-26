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

  const unit = METRICS.find((m) => m.value === metric)!.unit;
  const record = (r: (typeof ranked)[number]) => `${r.st.wins}–${r.st.losses}${r.st.draws ? `–${r.st.draws}` : ""}`;

  // table rows from #4 down: tight, mono, scannable
  const Row = ({ r, rank, pinned }: { r: (typeof ranked)[number]; rank: number; pinned?: boolean }) => (
    <Link href={`/u/${r.u.username}`} className={cx("grid grid-cols-[34px_28px_1fr_auto_64px] items-center gap-2 py-2.5 hover:bg-ink/[.05]", r.u.id === me && "bg-ink/[.07]", pinned && "border-t-2 border-dashed border-ink/40")}>
      <span className="num text-[15px] font-bold text-muted">{rank}</span>
      <Avatar user={r.u} size={28} />
      <span className="min-w-0 truncate font-bold">{r.u.displayName}{r.u.id === me && <span className="font-normal text-muted"> · you</span>}</span>
      <span className="num text-[12px] text-muted">{record(r)}{r.st.streak > 1 && <span className="text-brand-dark"> 🔥{r.st.streak}</span>}</span>
      <span className="num text-right text-[15px] font-bold">{fmt(r.value)}</span>
    </Link>
  );
  const [first, second, third] = ranked;
  const above = myIdx > 0 ? ranked[myIdx - 1] : null;

  return (
    <div>
      <PageHeader title="ranks" subtitle="who's actually right?" />
      <Tabs<Period> value={period} onChange={setPeriod} options={PERIODS} className="mb-3" />
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="category">
        {METRICS.map((m) => (
          <button key={m.value} role="tab" aria-selected={metric === m.value} onClick={() => setMetric(m.value)}
            className={cx("chip shrink-0", metric === m.value && "chip-active")}>
            {m.label}
          </button>
        ))}
      </div>

      {ranked.length === 0 ? (
        <EmptyState icon={<Trophy size={22} />} title="no results in this period yet" body="rankings fill up as duels settle." action={<Link href="/duel/new" className="btn-primary btn-sm">start a beef</Link>} />
      ) : (
        <>
          {/* the podium: #1 gets the red field, #2 and #3 the ink slabs */}
          <Link href={`/u/${first.u.username}`} className="field -mx-4 grid grid-cols-[auto_1fr_auto] items-end gap-3 px-4 py-4 lg:mx-0">
            <span className="cond pr-4 text-[132px] leading-[.72]">1</span>
            <div className="min-w-0 pb-1">
              <p className="meta font-bold">top of the board{first.u.id === me && " · you"}</p>
              <div className="mt-1.5 flex items-center gap-2"><Avatar user={first.u} size={30} /><p className="cond truncate text-[34px] leading-[.85]">{first.u.displayName}</p></div>
              <p className="num mt-1 text-[12px] font-bold">{record(first)} · {first.st.completed ? `${first.st.winRate.toFixed(0)}%` : "—"}{first.st.streak > 1 && ` · 🔥${first.st.streak}`}</p>
            </div>
            <div className="pb-1 text-right"><p className="num text-[30px] font-bold leading-none">{fmt(first.value)}</p><p className="meta mt-1 font-bold">{unit}</p></div>
          </Link>
          {(second || third) && (
            <div className="slab -mx-4 grid grid-cols-2 lg:mx-0">
              {[second, third].map((r, i) => r ? (
                <Link key={r.u.id} href={`/u/${r.u.username}`} className={cx("min-w-0 px-4 py-3 hover:bg-slab-2", i === 1 && "border-l-2 border-bg")}>
                  <span className="cond text-[64px] leading-[.8]">{i + 2}</span>
                  <div className="mt-2 flex items-center gap-1.5"><Avatar user={r.u} size={20} /><p className="cond truncate text-[22px] leading-[.9]">{r.u.displayName}</p></div>
                  <p className="num mt-1 text-[12px] text-slab-muted">{fmt(r.value)} · {record(r)}{r.u.id === me && " · you"}</p>
                </Link>
              ) : <div key={i} className="border-l-2 border-bg" />)}
            </div>
          )}
          {ranked.length > 3 && (
            <div className="mt-4">
              <div className="meta grid grid-cols-[34px_28px_1fr_auto_64px] gap-2 border-b-2 border-ink pb-1.5 text-muted"><span>#</span><span /><span>player</span><span>w–l</span><span className="text-right">{unit}</span></div>
              <div className="divide-y divide-line">
                {ranked.slice(3, 10).map((r, i) => <Row key={r.u.id} r={r} rank={i + 4} />)}
                {myIdx >= 10 && <Row r={ranked[myIdx]} rank={myIdx + 1} pinned />}
              </div>
            </div>
          )}
          {/* your position, with the real gap to the person above you */}
          {myIdx > 0 && above && (
            <p className="meta sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 -mx-4 mt-4 flex justify-between bg-ink px-4 py-2.5 font-bold text-inverse lg:bottom-4 lg:mx-0">
              <span>you · #{myIdx + 1}</span>
              <span className="num normal-case tracking-normal">{metric === "winrate" ? `${(above.value - ranked[myIdx].value).toFixed(0)} pts` : Math.round(above.value - ranked[myIdx].value)} behind {above.u.displayName.split(" ")[0]}</span>
            </p>
          )}
        </>
      )}
      {me && myIdx < 0 && ranked.length > 0 && <p className="mt-3 text-[13px] text-muted">you're not ranked here yet{metric === "winrate" ? ` (needs ${minForWinRate} settled duels)` : ""}.</p>}

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
