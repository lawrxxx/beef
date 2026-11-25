"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Clock, Crown, FastForward, FileText, Image as ImageIcon,
  Lock, RefreshCw, Repeat, Share2, ShieldCheck, Swords,
} from "lucide-react";
import type { Duel } from "@/lib/types";
import {
  acceptDuel, cancelDuel, declineDuel, encodeInvite, requestLock, requestSettlement, simulateOpponentAccept, useBeef,
} from "@/lib/store/store";
import { livePerformance, useMe, useMounted, useNow, useQuotes, userById } from "@/lib/hooks";
import { canAccept, isParticipant, STATUS_LABEL } from "@/lib/derive";
import { countdown, cx, marketTime, price, sessionLabel, usd } from "@/lib/format";
import { resolveEndSession, sessionCloseUtc, sessionDateOf } from "@/lib/market/calendar";
import { Avatar, CardSkeleton, EmptyState, Pct, SimBadge, UserLink, useAction } from "@/components/ui";
import { StatusPill, VersusBar } from "@/components/duel-card";
import { Comments, ReactionBar } from "@/components/social";
import { drawTrophyCard, shareCanvas, shareLink } from "@/components/share";

export default function DuelPage() {
  const { id } = useParams<{ id: string }>();
  const s = useBeef();
  const mounted = useMounted();
  const d = s.duels.find((x) => x.id === id);
  if (!mounted) return <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>;
  if (!d) return <EmptyState icon={<Swords size={22} />} title="duel not found" body="it may have been removed, or the link is incomplete." action={<Link href="/duel" className="btn-dark btn-sm">all duels</Link>} />;
  return <DuelView d={d} />;
}

function DuelView({ d }: { d: Duel }) {
  const s = useBeef();
  const me = useMe();
  const router = useRouter();
  const run = useAction();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [agree, setAgree] = useState(false);
  const live = d.status === "active";
  const showQuotes = live || d.status === "pending" || d.status === "accepted";
  const { quotes, error: quoteError } = useQuotes(showQuotes ? d.participants.map((p) => p.ticker) : [], 15_000);
  const perf = livePerformance(d, quotes);
  const st = d.settlement;
  const done = d.status === "completed" && st;
  const group = d.participants.length > 2;
  const pot = d.stake * d.participants.length;
  const mine = isParticipant(d, me?.id ?? null);
  const acceptable = canAccept(d, me?.id ?? null);
  const sorted = [...perf].sort((a, b) => (b.ret ?? -1e9) - (a.ret ?? -1e9));
  const leader = live && sorted[0]?.ret != null && sorted[0].ret !== sorted[1]?.ret ? sorted[0] : null;
  const usersMap = Object.fromEntries(d.participants.map((p) => [p.userId, userById(s, p.userId)]));
  const opponent = !group && me ? d.participants.find((p) => p.userId && p.userId !== me.id) : undefined;
  const endSession = d.lockAt ? resolveEndSession(new Date(d.deadline), sessionDateOf(new Date(d.lockAt))) : null;

  const busyRun = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); await run(fn, ok); setBusy(false); };

  return (
    <div className="pb-6">
      <div className="mb-3 flex items-center justify-between">
        <button className="btn-ghost btn-sm -ml-2 !px-2" onClick={() => router.back()} aria-label="back"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-2"><SimBadge /><StatusPill d={d} /></div>
      </div>

      {d.title && <h1 className="mb-1 font-display text-2xl font-bold tracking-tight">{d.title}</h1>}
      <p className="mb-4 text-[15px] text-muted">
        {usd(d.stake, 0)} each · <b className="text-ink">{usd(pot, 0)} pot</b> · {d.deadlineLabel}
        {d.communityId && <> · <Link className="underline" href={`/communities/${s.communities.find((c) => c.id === d.communityId)?.slug}`}>{s.communities.find((c) => c.id === d.communityId)?.name}</Link></>}
      </p>

      {/* hero */}
      <div className="card overflow-hidden">
        {done && (
          <div className={cx("px-4 py-3 text-center text-sm font-semibold", st.status === "draw" ? "bg-black/[.04]" : "bg-gold-soft text-gold")}>
            {st.status === "draw" ? "🤝 a dead heat. stakes returned." : `🏆 ${st.winners.map((w) => usersMap[w]?.displayName ?? "?").join(" & ")} ${st.winners.length > 1 ? "win" : "wins"} ${usd(pot / st.winners.length, 0)}`}
          </div>
        )}
        {live && leader && (
          <div className="bg-gain-soft px-4 py-2.5 text-center text-sm font-semibold text-gain">
            {usersMap[leader.userId]?.displayName ?? "?"} is leading with {leader.ticker} <span className="font-normal text-gain/80">· not final until the deadline close</span>
          </div>
        )}
        <div className={cx("grid gap-3 p-5", group ? "grid-cols-2" : "grid-cols-[1fr_auto_1fr] items-start")}>
          {perf.map((p, i) => {
            const u = usersMap[p.userId];
            const isWinner = done ? st.winners.includes(p.userId) : leader?.userId === p.userId;
            const right = !group && i === 1;
            const node = (
              <div key={p.ticker} className={cx("flex flex-col", right ? "items-end text-right" : "items-start", group && "card p-3")}>
                <div className="relative">
                  <Avatar user={u} size={group ? 44 : 56} />
                  {isWinner && <Crown size={20} className="absolute -right-1 -top-2 rotate-12 fill-gold-soft text-gold" />}
                </div>
                <p className="mt-2 max-w-full truncate text-sm font-semibold">{u ? <UserLink user={u} /> : "open spot"}{u?.id === me?.id && <span className="text-muted"> (you)</span>}</p>
                <p className="font-display text-[28px] font-extrabold leading-none tracking-tight">{p.ticker}</p>
                <div className="mt-2 text-[22px]">{live || done ? <Pct v={p.ret} /> : <span className="text-base text-faint">not started</span>}</div>
                {p.accepted ? null : <span className="mt-1 text-xs text-gold">hasn't accepted</span>}
              </div>
            );
            if (right) return [<div key="vs" className="pt-5 font-display text-sm font-extrabold text-faint">vs</div>, node];
            return node;
          })}
        </div>
        {!group && (live || done) && <div className="px-5 pb-4"><VersusBar a={perf[0]?.ret ?? null} b={perf[1]?.ret ?? null} /></div>}

        <div className="grid grid-cols-3 border-t text-center">
          <div className="border-r p-3">
            <p className="text-xs text-muted">{done ? "ended" : live ? "time left" : d.status === "accepted" ? "prices lock in" : d.status === "awaiting_verification" ? "status" : "length"}</p>
            <p className="num mt-0.5 font-semibold">
              {done ? sessionLabel(st.endSession) : live ? countdown(d.deadline, now) : d.status === "accepted" && d.lockAt ? countdown(d.lockAt, now) : d.status === "awaiting_verification" ? "paused" : d.deadlineLabel}
            </p>
          </div>
          <div className="border-r p-3">
            <p className="text-xs text-muted">stake</p>
            <p className="num mt-0.5 font-semibold">{usd(d.stake, 0)} each</p>
          </div>
          <div className="p-3">
            <p className="text-xs text-muted">prize pool</p>
            <p className="num mt-0.5 font-semibold">{usd(pot, 0)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-[13px]">
          <span className="text-muted">settlement</span>
          <span className="font-medium">{SETTLEMENT_LABEL(d)}</span>
        </div>
      </div>

      {/* state-specific actions */}
      <div className="mt-4 space-y-3">
        {d.status === "pending" && acceptable && (
          <div className="card p-4">
            <p className="font-semibold">{usersMap[d.createdBy]?.displayName} wants to beef</p>
            <p className="mt-1 text-sm text-muted">
              you'd take <b className="text-ink">{d.participants.find((p) => p.userId === me?.id && !p.accepted)?.ticker ?? d.participants.find((p) => p.userId === "")?.ticker}</b>. {usd(d.stake, 0)} from your practice balance is held until it settles. invitation expires {marketTime(d.inviteExpiresAt)}.
            </p>
            <label className="mt-3 flex items-start gap-3 text-sm text-ink-soft">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#1D1D1F]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>i've read the <button className="underline" onClick={() => setShowTerms(true)}>terms</button> and agree to them. simulated prices, practice money.</span>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-outline" onClick={() => run(() => declineDuel(d.id), "declined")}>decline</button>
              <button className="btn-primary" disabled={!agree} onClick={() => run(() => acceptDuel(d.id, agree), "you're in! prices lock at the next close")}>accept · {usd(d.stake, 0)}</button>
            </div>
          </div>
        )}
        {d.status === "pending" && !me && (
          <Link href="/auth/sign-in" className="btn-primary w-full">sign in to accept</Link>
        )}
        {d.status === "pending" && mine && !acceptable && (
          <div className="card p-4">
            <p className="flex items-center gap-2 font-semibold"><Clock size={17} /> waiting for {d.open ? "someone to accept" : d.participants.filter((p) => !p.accepted).map((p) => `@${usersMap[p.userId]?.username}`).join(", ")}</p>
            <p className="mt-1 text-sm text-muted">invitation expires {marketTime(d.inviteExpiresAt)}.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-dark btn-sm" onClick={() => shareLink(`/invite#${encodeInvite(d)}`, `${me?.displayName} challenged you on beef: ${d.participants.map((p) => p.ticker).join(" vs ")}, ${usd(d.stake, 0)} each.`)}><Share2 size={15} /> share invite</button>
              {d.createdBy === me?.id && <button className="btn-outline btn-sm" onClick={() => run(() => cancelDuel(d.id), "duel cancelled")}>cancel</button>}
            </div>
          </div>
        )}
        {d.status === "accepted" && (
          <div className="card p-4">
            <p className="flex items-center gap-2 font-semibold"><Lock size={17} /> everyone's in. terms are locked.</p>
            <p className="mt-1 text-sm text-muted">starting prices lock at the official close: {d.lockAt && marketTime(d.lockAt)}. the duel goes live then.</p>
          </div>
        )}
        {d.status === "awaiting_verification" && st && (
          <div className="card border-gold/40 bg-gold-soft/40 p-4">
            <p className="flex items-center gap-2 font-semibold text-gold"><AlertTriangle size={17} /> settlement paused</p>
            <p className="mt-1 text-sm text-ink-soft">{st.explanation}</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">{st.issues.map((i) => <li key={i}>{i}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">beef never guesses a winner. once verified prices are available, settlement runs again automatically.</p>
            <button className="btn-outline btn-sm mt-3" disabled={busy} onClick={() => busyRun(() => requestSettlement(d.id), "checked again")}><RefreshCw size={15} /> retry verification</button>
          </div>
        )}
        {done && (
          <div className="card p-4">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={17} className="text-gain" /> how the winner was decided</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{st.explanation}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-dark btn-sm" onClick={() => shareCanvas(drawTrophyCard(d, usersMap), `beef-${d.id}.png`, st.explanation, `/duel/${d.id}`)}><ImageIcon size={15} /> share trophy card</button>
              {mine && opponent ? (
                <Link href={`/duel/new?mine=${d.participants.find((p) => p.userId === me!.id)!.ticker}&theirs=${opponent.ticker}&vs=${opponent.userId}`} className="btn-outline btn-sm"><Repeat size={15} /> rematch</Link>
              ) : (
                <button className="btn-outline btn-sm" onClick={() => shareLink(`/duel/${d.id}`, st.explanation)}><Share2 size={15} /> share link</button>
              )}
            </div>
          </div>
        )}
        {live && quoteError && <p className="text-sm text-loss">live prices are unavailable right now. the result isn't affected: it uses official closes.</p>}
      </div>

      {/* price table */}
      {(live || done || d.status === "awaiting_verification" || d.status === "pending" || d.status === "accepted") && (
        <div className="card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-semibold">prices</p>
            <span className="text-xs text-muted">source: {d.startSnapshots[0]?.source === "mock" ? "beef simulated market" : d.startSnapshots[0]?.source}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="px-4 py-2 font-medium">stock</th><th className="px-2 py-2 font-medium">start</th><th className="px-2 py-2 font-medium">{done ? "end" : "now"}</th><th className="px-4 py-2 text-right font-medium">return</th></tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((p) => (
                  <tr key={p.ticker}>
                    <td className="px-4 py-2.5"><span className="font-bold">{p.ticker}</span> <span className="text-muted">@{usersMap[p.userId]?.username}</span></td>
                    <td className="num px-2 py-2.5">
                      {p.startPrice != null ? price(p.startPrice) : <span className="text-[12px] text-muted">locks at close</span>}
                      {p.adjustedStart != null && <span className="block text-[11px] text-gold">split-adj. {price(p.adjustedStart)}</span>}
                    </td>
                    <td className="num px-2 py-2.5">{p.current != null ? price(p.current) : "—"}{live && <span className="block text-[11px] text-muted">{p.quote?.marketOpen ? "live (simulated)" : "last close (simulated)"}</span>}</td>
                    <td className="px-4 py-2.5 text-right"><Pct v={p.ret} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 border-t bg-black/[.015] px-4 py-3 text-xs text-muted">
            {d.startSnapshots[0] && <p>start: official close {sessionLabel(d.startSnapshots[0].session)} · {marketTime(d.startSnapshots[0].timestamp)}</p>}
            {d.endSnapshots[0] ? <p>end: official close {sessionLabel(d.endSnapshots[0].session)} · {marketTime(d.endSnapshots[0].timestamp)}</p> : endSession && <p>end: official close {sessionLabel(endSession)} · {marketTime(sessionCloseUtc(endSession).toISOString())}</p>}
            {st && <p>settlement: {st.status === "needs_verification" ? "pending verification" : st.status} · calculation {st.calculationVersion} · {st.simulated ? "simulated data" : st.source}</p>}
            <p>return = ((end − start) ÷ start) × 100. share price doesn't matter, only the percentage move.</p>
          </div>
        </div>
      )}

      {/* demo time controls */}
      {(d.status === "accepted" || live || (d.status === "pending" && mine && !acceptable)) && (
        <div className="card mt-4 border-dashed p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><FastForward size={16} /> demo time controls <SimBadge label="demo only" /></p>
          <p className="mt-1 text-[13px] text-muted">real duels wait for real market closes. in the demo you can jump ahead: the server computes the outcome from simulated closing prices. you can't pick the prices, only skip the wait.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.status === "pending" && <button className="btn-outline btn-sm" onClick={() => run(() => simulateOpponentAccept(d.id), "accepted")}>simulate acceptance</button>}
            {d.status === "accepted" && d.lockAt && <button className="btn-outline btn-sm" disabled={busy} onClick={() => busyRun(() => requestLock(d.id, d.lockAt), "starting prices locked")}>jump to price lock</button>}
            {live && <button className="btn-outline btn-sm" disabled={busy} onClick={() => busyRun(() => requestSettlement(d.id, new Date(new Date(d.deadline).getTime() + 60_000).toISOString()), "settled by the server")}>jump to deadline & settle</button>}
          </div>
        </div>
      )}

      {/* terms */}
      <div className="card mt-4">
        <button className="flex w-full items-center justify-between px-4 py-3.5" onClick={() => setShowTerms((v) => !v)} aria-expanded={showTerms}>
          <span className="flex items-center gap-2 font-semibold"><FileText size={17} /> challenge terms</span>
          <ChevronDown size={18} className={cx("transition", showTerms && "rotate-180")} />
        </button>
        {showTerms && (
          <dl className="divide-y border-t text-sm">
            {[
              ["stocks", d.participants.map((p) => `${p.ticker} (@${usersMap[p.userId]?.username ?? "open"})`).join(" vs ")],
              ["stake", `${usd(d.stake, 0)} each, practice money`],
              ["comparison", "percentage return, official closing prices"],
              ["price lock", d.terms.priceRule],
              ["deadline", marketTime(d.deadline)],
              ["settlement", d.terms.settlementRule],
              ["data provider", d.terms.provider === "mock" ? "beef simulated market (not live data)" : d.terms.provider],
              ["market timezone", "america/new_york (et). stored in utc."],
              ["calculation", d.terms.calculationVersion],
              ["created", `${marketTime(d.createdAt)} by @${usersMap[d.createdBy]?.username}`],
            ].map(([k, v]) => <div key={k} className="grid grid-cols-[110px_1fr] gap-3 px-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-ink-soft">{v}</dd></div>)}
          </dl>
        )}
      </div>

      {s.audit[d.id]?.length ? (
        <div className="card mt-4 p-4">
          <p className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck size={17} /> settlement audit log</p>
          <ul className="space-y-1.5 font-mono text-[12px] text-ink-soft">
            {s.audit[d.id].map((a) => <li key={a.id}><span className="text-muted">{new Date(a.at).toISOString().slice(0, 19).replace("T", " ")}z</span> {a.action} — {a.detail}</li>)}
          </ul>
        </div>
      ) : null}

      {!group && mine && opponent && (
        <Link href={`/rivalry/${usersMap[opponent.userId]?.username}`} className="card mt-4 flex items-center justify-between p-4">
          <span className="font-semibold">your rivalry with @{usersMap[opponent.userId]?.username}</span>
          <span className="text-sm text-brand-dark">head to head →</span>
        </Link>
      )}

      <div className="card mt-4 p-4">
        <ReactionBar targetType="duel" targetId={d.id} />
        <div id="comments" className="mt-3 border-t pt-2"><Comments targetType="duel" targetId={d.id} /></div>
      </div>

      <p className="mt-4 text-center text-xs text-faint">{STATUS_LABEL[d.status]} · id {d.id}</p>
    </div>
  );
}

function SETTLEMENT_LABEL(d: Duel): string {
  switch (d.status) {
    case "pending": return "starts once everyone accepts";
    case "accepted": return "terms locked · prices lock at the close";
    case "active": return "pending · settles at the deadline close";
    case "awaiting_verification": return "paused · waiting for verified prices";
    case "completed": return d.settlement?.status === "draw" ? "settled · draw, stakes returned" : "settled · winner paid (practice money)";
    case "cancelled": return "cancelled · nothing was staked";
    case "declined": return "declined · nothing was staked";
    case "expired": return "invite expired · nothing was staked";
  }
}
