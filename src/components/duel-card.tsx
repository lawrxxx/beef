"use client";

import { deadlineLine } from "@/lib/expiration";
import { fmtStake, formatUsdc, prizePoolUnits, stakeUnits } from "@/lib/stake";
import Link from "next/link";
import { Users } from "lucide-react";
import type { Duel } from "@/lib/types";
import { useBeef } from "@/lib/store/store";
import { livePerformance, useNow, useQuotes, userById } from "@/lib/hooks";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/derive";
import { countdown, cx, pct } from "@/lib/format";
import { Avatar } from "@/components/ui";

// home and away: beef's one recognisable shape. every duel, anywhere, is the home side
// (whoever threw down the challenge) in the cobalt kit against the away side in white.
// the leader is called out in words and on the gap bar, never by swapping kits.

export function StatusPill({ d }: { d: Duel }) {
  return (
    <span className={cx("meta inline-flex items-center gap-1.5 font-bold", STATUS_STYLE[d.status])}>
      {d.status === "active" && <span className="h-1.5 w-1.5 animate-pulse bg-current" />}
      {STATUS_LABEL[d.status]}
    </span>
  );
}

/** "06d 04:12:33" style clock to an instant */
export function clock(iso: string, now: number) {
  if (!now) return "…";
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d ? `${p(d)}d ` : ""}${p(h)}:${p(m)}:${p(s)}`;
}

/** tug of war between two returns: red for the first side, ink for the second. purely visual. */
export function VersusBar({ a, b, className }: { a: number | null; b: number | null; className?: string }) {
  if (a == null || b == null) return <div className={cx("h-[6px] bg-ink/15", className)} />;
  const diff = Math.max(-10, Math.min(10, a - b));
  const left = 50 + diff * 4.5;
  return (
    <div className={cx("relative flex h-[6px]", className)} aria-hidden>
      <div className="h-full bg-brand transition-all duration-700" style={{ width: `${left}%` }} />
      <div className="h-full flex-1 bg-silver" />
      <div className="absolute -top-1 left-1/2 h-[14px] w-[2px] -translate-x-1/2 bg-bg" />
    </div>
  );
}

/** the inked result stamp */
export function ResultStamp({ kind, className }: { kind: "won" | "lost" | "draw" | "final"; className?: string }) {
  return (
    <span className={cx("stamp", kind === "won" ? "border-ink bg-ink text-inverse" : kind === "lost" ? "border-silver text-silver" : "border-current", className)}>
      {kind === "won" ? "W" : kind === "lost" ? "L" : kind}
    </span>
  );
}

const fmtRet = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : pct(v).replace("-", "−"));

type Side = ReturnType<typeof livePerformance>[number];

function useDuelState(d: Duel, refresh = 1000) {
  const s = useBeef();
  const now = useNow(refresh);
  const live = d.status === "active";
  const { quotes } = useQuotes(live ? d.participants.map((p) => p.ticker) : []);
  const perf = livePerformance(d, quotes);
  const done = d.status === "completed" && !!d.settlement;
  const draw = done && d.settlement!.status === "draw";
  const top = Math.max(...perf.map((p) => p.ret ?? -Infinity));
  const leaders = live ? perf.filter((p) => p.ret != null && p.ret === top) : [];
  const isLead = (p: Side) => (done ? !draw && d.settlement!.winners.includes(p.userId) : leaders.length === 1 && leaders[0].userId === p.userId);
  const pot = formatUsdc(prizePoolUnits(stakeUnits(d.stake), d.participants.length));
  return { s, now, live, perf, done, draw, isLead, pot, showRet: live || done };
}

/** compact slab for feeds and lists */
export function DuelCard({ d, compact }: { d: Duel; compact?: boolean }) {
  const { s, now, live, perf, done, draw, isLead, pot, showRet } = useDuelState(d, compact ? 30_000 : 1000);
  const group = perf.length > 2;
  return (
    <Link href={`/duel/${d.id}`} className="group block min-w-0 border-2 border-ink bg-surface transition hover:shadow-pop active:translate-x-px active:translate-y-px">
      <div className="meta flex items-center justify-between gap-2 border-b-2 border-ink px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          {done ? <span className="font-bold text-ink">final</span> : <StatusPill d={d} />}
          {group && <span className="inline-flex items-center gap-1 text-muted"><Users size={11} /> group</span>}
          <span className="min-w-0 truncate text-muted">{live || d.status === "accepted" ? clock(d.deadline, now) : done ? (draw ? "dead heat" : `by ${d.settlement!.marginPct.toFixed(2)} pts`) : d.status === "pending" ? `ends ${deadlineLine(d)}` : ""}</span>
        </span>
        <span className="shrink-0 font-bold">pot {pot}</span>
      </div>
      <div className={cx("slab grid", group ? "grid-cols-1" : "grid-cols-2")}>
        {perf.map((p, i) => {
          const u = userById(s, p.userId);
          const lead = isLead(p);
          const lost = done && !draw && !lead;
          return (
            <div key={p.ticker} className={cx("min-w-0", group ? "flex items-center gap-3 px-3 py-2" : "px-3 pb-3 pt-2", i === 0 ? "home-kit" : !group && "away-kit", !group && i === 1 && "border-l-2 border-ink", group && i > 0 && "border-t border-slab-text/15", lost && "opacity-50")}>
              <div className={cx("flex min-w-0 items-center gap-1.5", group && "w-28 shrink-0")}>
                <Avatar user={u} size={18} />
                <span className="meta truncate font-bold">{u ? u.displayName.split(" ")[0] : "open spot"}{lead && !done && " · leads"}</span>
                {lead && done && <span className="meta ml-auto bg-ink px-1 font-bold text-inverse">W</span>}
              </div>
              <p className={cx("cond mt-2 leading-none", group ? "mt-0 w-20 text-[24px]" : compact ? "text-[26px]" : "text-[30px]", lost && "line-through decoration-[3px]")}>{p.ticker}</p>
              <p className={cx("cond leading-[.85] tracking-[-0.02em]", group ? "ml-auto text-[28px]" : compact ? "mt-1 text-[38px]" : "mt-1 text-[48px]", !showRet && "opacity-40")}>{showRet ? fmtRet(p.ret) : "—"}</p>
            </div>
          );
        })}
      </div>
      {!group && (live || done) && <VersusBar a={perf[0]?.ret ?? null} b={perf[1]?.ret ?? null} />}
      {!compact && <div className="meta flex justify-between px-3 py-1.5 text-muted"><span>{fmtStake(d.stake)} test usdc each</span><span>{STATUS_LABEL[d.status]}</span></div>}
    </Link>
  );
}

/** the full-size fight card used at the top of a duel page */
export function VersusHero({ d, meId }: { d: Duel; meId?: string | null }) {
  const { s, now, live, perf, done, draw, isLead, showRet } = useDuelState(d, 1000);
  const group = perf.length > 2;
  const sorted = [...perf].sort((a, b) => (b.ret ?? -1e9) - (a.ret ?? -1e9));
  const gap = live && sorted[0]?.ret != null && sorted[1]?.ret != null ? sorted[0].ret - sorted[1].ret : null;
  return (
    <div className="slab -mx-4 border-y-[3px] border-ink lg:mx-0 lg:border-[3px]">
      {perf.map((p, i) => {
        const u = userById(s, p.userId);
        const lead = isLead(p);
        const lost = done && !draw && !lead;
        return (
          <div key={p.ticker} className={cx("relative overflow-hidden px-4", group ? "py-3" : "py-5", i === 0 ? "home-kit" : !group && "away-kit", i > 0 && "border-t-[4px] border-ink", lost && "opacity-55")}>
            {/* the ticker as image, bleeding off the edge */}
            <span aria-hidden className={cx("cond pointer-events-none absolute -bottom-6 -right-2 select-none leading-none opacity-[.13]", group ? "text-[110px]" : "text-[190px]")}>{i + 1}</span>
            <div className="relative flex items-center gap-2">
              <Avatar user={u} size={group ? 22 : 26} />
              <Link href={u ? `/u/${u.username}` : "#"} className="meta truncate font-bold hover:underline">{u ? u.displayName : "open spot"}{u?.id === meId && " (you)"}</Link>
              <span className="meta ml-auto shrink-0 font-bold">
                {i === 0 ? "home" : "away"}{lead && live && gap != null ? ` · leads by ${gap.toFixed(2)}` : lead && done ? " · winner" : lost ? " · loses" : !p.accepted ? " · hasn't accepted" : ""}
              </span>
            </div>
            <div className={cx("relative flex items-end gap-4", group ? "mt-1" : "mt-3")}>
              <p className={cx("cond leading-none", group ? "text-[30px]" : "text-[40px]", lost && "line-through decoration-[4px]")}>{p.ticker}</p>
              {done && lead && <ResultStamp kind="won" className="mb-1" />}
            </div>
            <p className={cx("cond relative leading-[.82] tracking-[-0.03em]", group ? "text-[48px]" : "text-[84px]", !showRet && "opacity-40")}>{showRet ? fmtRet(p.ret) : "—"}</p>
            {p.startPrice != null && <p className="num relative mt-2 text-[12px] opacity-80">${p.startPrice.toFixed(2)} → {p.current != null ? `$${p.current.toFixed(2)}` : "…"}</p>}
          </div>
        );
      })}
      {!group && (live || done) && <VersusBar a={perf[0]?.ret ?? null} b={perf[1]?.ret ?? null} className="!h-[8px]" />}
      {live && <p className="meta flex items-center justify-between bg-bg px-4 py-2 text-ink"><span className="flex items-center gap-1.5 font-bold"><span className="h-1.5 w-1.5 animate-pulse bg-brand" /> live</span><span className="num text-[15px] font-bold">{clock(d.deadline, now)}</span></p>}
      {d.status === "accepted" && d.startAt && <p className="meta flex justify-between bg-bg px-4 py-2 text-ink"><span className="font-bold">prices lock in</span><span className="num text-[15px] font-bold">{countdown(d.startAt, now)}</span></p>}
    </div>
  );
}
