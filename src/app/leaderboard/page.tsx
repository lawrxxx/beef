"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Flame, Info } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { activityCount, statsFor, useMounted } from "@/lib/hooks";
import { outcomeFor } from "@/lib/score";
import { cx } from "@/lib/format";
import { Avatar, CardSkeleton, PageHeader, Tabs } from "@/components/ui";

type Board = "weekly" | "monthly" | "alltime" | "winrate" | "streak" | "active";

const BOARDS: { value: Board; label: string; metric: string }[] = [
  { value: "weekly", label: "weekly", metric: "points" },
  { value: "monthly", label: "monthly", metric: "points" },
  { value: "alltime", label: "all-time", metric: "beef score" },
  { value: "winrate", label: "win rate", metric: "win rate" },
  { value: "streak", label: "streaks", metric: "best streak" },
  { value: "active", label: "most active", metric: "activity" },
];

export default function LeaderboardPage() {
  const s = useBeef();
  const mounted = useMounted();
  const [board, setBoard] = useState<Board>("weekly");
  const me = s.session.userId;

  const rows = useMemo(() => {
    const now = Date.now();
    return s.users.map((u) => {
      const st = statsFor(s, u.id);
      const period = (days: number, seed?: { wins: number; losses: number; draws: number }) => {
        let w = seed && u.id !== "u_me" ? seed.wins : 0, d = seed && u.id !== "u_me" ? seed.draws : 0;
        for (const duel of s.duels) {
          const o = outcomeFor(duel, u.id);
          if (!o || !duel.settlement || now - new Date(duel.settlement.settledAt).getTime() > days * 864e5) continue;
          if (o === "win") w++; if (o === "draw") d++;
        }
        return w * 3 + d;
      };
      const value: Record<Board, number> = {
        weekly: period(7, u.weekly),
        monthly: period(30, u.monthly),
        alltime: st.score,
        winrate: st.completed >= 5 ? st.winRate : -1,
        streak: st.bestStreak,
        active: st.completed + st.active + activityCount(s, u.id),
      };
      return { u, st, value };
    });
  }, [s]);

  const ranked = rows.filter((r) => r.value[board] >= 0).sort((a, b) => b.value[board] - a.value[board] || b.st.score - a.st.score);
  const myIdx = ranked.findIndex((r) => r.u.id === me);
  const fmt = (v: number) => (board === "winrate" ? `${v.toFixed(0)}%` : board === "streak" ? `${v}🔥` : String(Math.round(v)));
  const meta = BOARDS.find((b) => b.value === board)!;

  const Row = ({ r, rank, pinned }: { r: (typeof ranked)[number]; rank: number; pinned?: boolean }) => (
    <Link href={`/u/${r.u.username}`} className={cx("flex items-center gap-3 px-4 py-3 hover:bg-black/[.02]", r.u.id === me && "bg-brand-soft/60", pinned && "border-t-2 border-dashed")}>
      <span className={cx("num w-7 text-center font-display text-lg font-bold", rank <= 3 ? "text-ink" : "text-faint")}>{rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}</span>
      <Avatar user={r.u} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{r.u.displayName}{r.u.id === me && <span className="font-normal text-muted"> (you)</span>}</p>
        <p className="num truncate text-[13px] text-muted">@{r.u.username} · {r.st.winRate.toFixed(0)}% win · {r.st.streak > 0 ? <span className="inline-flex items-center gap-0.5 text-brand-dark"><Flame size={12} />{r.st.streak}</span> : "no streak"}</p>
      </div>
      <div className="text-right">
        <p className="num font-display text-lg font-bold">{fmt(r.value[board])}</p>
        <p className="text-[11px] text-muted">{board === "alltime" ? "score" : `${r.st.score} score`}</p>
      </div>
    </Link>
  );

  return (
    <div>
      <PageHeader title="leaderboard" subtitle="who's actually right?" />
      <Tabs<Board> value={board} onChange={setBoard} options={BOARDS} className="mb-4" />
      {!mounted ? <CardSkeleton /> : (
        <>
          <div className="card divide-y overflow-hidden">
            {ranked.slice(0, 10).map((r, i) => <Row key={r.u.id} r={r} rank={i + 1} />)}
            {myIdx >= 10 && <Row r={ranked[myIdx]} rank={myIdx + 1} pinned />}
          </div>
          {board === "winrate" && <p className="mt-2 text-xs text-muted">minimum five completed duels to qualify.</p>}
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-black/[.03] p-3 text-[13px] text-ink-soft">
            <Info size={16} className="mt-0.5 shrink-0" />
            <p>{board === "weekly" || board === "monthly" ? "points: 3 per win, 1 per draw. " : ""}beef score rewards consistency: win rate (weighted by how many duels you've played), completed duels, streaks and community activity. stake size never counts, so bigger bets don't buy a higher rank.</p>
          </div>
          <p className="mt-2 text-xs text-faint">ranked by {meta.metric}</p>
        </>
      )}
    </div>
  );
}
