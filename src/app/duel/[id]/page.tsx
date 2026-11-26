"use client";

import { fmtStake, formatUsdc, prizePoolUnits, stakeUnits } from "@/lib/stake";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Clock, Crown, FileText, Image as ImageIcon,
  Lock, RefreshCw, Repeat, Share2, ShieldCheck, Swords,
} from "lucide-react";
import type { Duel } from "@/lib/types";
import {
  cancelDuel, declineDuel, inviteLink, requestSettlement, useBeef,
} from "@/lib/store/store";
import { livePerformance, useMe, useMounted, useNow, useQuotes, userById } from "@/lib/hooks";
import { canAccept, isParticipant, STATUS_LABEL } from "@/lib/derive";
import { countdown, cx, marketTime, price, sessionLabel} from "@/lib/format";
import { resolveEndSession, sessionCloseUtc, sessionDateOf } from "@/lib/market/calendar";
import { txUrl } from "@/lib/chain/config";
import { deadlineLine, deadlineText, etLabel, localLabel } from "@/lib/expiration";
import { Avatar, CardSkeleton, EmptyState, Pct, QuoteLine, SourceBadge, UserLink, useAction } from "@/components/ui";
import { StatusPill, VersusHero } from "@/components/duel-card";
import { Comments, ReactionBar } from "@/components/social";
import { drawTrophyCard, shareCanvas, shareLink } from "@/components/share";
import dynamic from "next/dynamic";
import { cdpEnabled } from "@/components/wallet/cdp-provider";

// wallet code (viem + cdp) only loads where it can be used: live mode with cdp configured
const DuelFunding = dynamic(() => import("@/components/wallet/duel-funding").then((m) => m.DuelFunding), { ssr: false });

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
  const live = d.status === "active";
  const showQuotes = live || d.status === "pending" || d.status === "accepted";
  const { quotes, error: quoteError } = useQuotes(showQuotes ? d.participants.map((p) => p.ticker) : [], 15_000);
  const perf = livePerformance(d, quotes);
  const st = d.settlement;
  const done = d.status === "completed" && st;
  const group = d.participants.length > 2;
  const potUnits = prizePoolUnits(stakeUnits(d.stake), d.participants.length);
  const pot = formatUsdc(potUnits);
  const mine = isParticipant(d, me?.id ?? null);
  const acceptable = canAccept(d, me?.id ?? null);
  const sorted = [...perf].sort((a, b) => (b.ret ?? -1e9) - (a.ret ?? -1e9));
  const leader = live && sorted[0]?.ret != null && sorted[0].ret !== sorted[1]?.ret ? sorted[0] : null;
  const usersMap = Object.fromEntries(d.participants.map((p) => [p.userId, userById(s, p.userId)]));
  const opponent = !group && me ? d.participants.find((p) => p.userId && p.userId !== me.id) : undefined;
  const dl = deadlineText(d, new Date(now || Date.now()));

  const busyRun = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); await run(fn, ok); setBusy(false); };

  return (
    <div className="pb-6">
      <div className="mb-3 flex items-center justify-between">
        <button className="btn-ghost btn-sm -ml-2 !px-2" onClick={() => router.back()} aria-label="back"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-3"><SourceBadge /><StatusPill d={d} /></div>
      </div>

      {/* masthead: a written headline from the real state of the duel */}
      <p className="meta text-muted">{group ? "group beef" : "beef"} · {d.participants.map((p) => p.ticker).join(" / ")}{d.communityId && <> · <Link className="underline" href={`/communities/${s.communities.find((c) => c.id === d.communityId)?.slug}`}>{s.communities.find((c) => c.id === d.communityId)?.name}</Link></>}</p>
      <h1 className="cond mt-2 text-[44px] leading-[.86]">
        {done
          ? st.status === "draw" ? "dead heat." : `${st.winners.map((w) => usersMap[w]?.displayName.split(" ")[0] ?? "?").join(" & ")} ${st.winners.length > 1 ? "win" : "wins"}.`
          : leader ? `${usersMap[leader.userId]?.displayName.split(" ")[0] ?? "?"} leads.`
            : live ? "all square."
              : d.status === "accepted" ? "locked in."
                : d.status === "pending" ? "the challenge is out."
                  : STATUS_LABEL[d.status] + "."}
      </h1>
      {d.title && d.title !== d.participants.map((p) => p.ticker).join(" vs ") && <p className="serif mt-1 text-[18px]">{d.title}</p>}
      <p className="num mb-5 mt-2 text-[12px] text-muted">
        {done ? <>takes {formatUsdc(potUnits / BigInt(Math.max(1, st.winners.length)))} test usdc{st.status !== "draw" && <> · by {st.marginPct.toFixed(4)} pts</>}</> : <>ends {deadlineLine(d, new Date(now || Date.now()))}</>}
      </p>

      <VersusHero d={d} meId={me?.id} />

      {/* box score */}
      <div className="grid grid-cols-3 border-b-2 border-ink">
        {[
          [done ? "ended" : live ? "time left" : d.status === "accepted" ? "prices lock" : d.status === "awaiting_verification" ? "status" : "length",
            done ? sessionLabel(st.endSession) : live ? countdown(d.deadline, now) : d.status === "accepted" && d.startAt ? countdown(d.startAt, now) : d.status === "awaiting_verification" ? "paused" : (dl.rule ?? dl.et)],
          ["stake", `${fmtStake(d.stake)}`],
          ["pot", pot],
        ].map(([k, v], i) => (
          <div key={k} className={cx("min-w-0 py-3", i > 0 && "border-l-2 border-ink pl-3")}>
            <p className="meta text-muted">{k}</p>
            <p className="num mt-1 text-[16px] font-bold leading-tight">{v}</p>
          </div>
        ))}
      </div>
      <div className="meta flex items-center justify-between border-b border-line py-2.5">
        <span className="text-muted">settlement</span>
        <span className="font-bold normal-case tracking-normal">{SETTLEMENT_LABEL(d)}</span>
      </div>

      {/* state-specific actions */}
      <div className="mt-4 space-y-3">
        {d.status === "pending" && acceptable && (
          <div className="card p-4">
            <p className="font-semibold">{usersMap[d.createdBy]?.displayName} wants to beef</p>
            <p className="mt-1 text-sm text-muted">
              you'd take <b className="text-ink">{d.participants.find((p) => p.userId === me?.id && !p.accepted)?.ticker ?? d.participants.find((p) => p.userId === "")?.ticker}</b> for {fmtStake(d.stake)} test usdc each (prize pool {pot} test usdc). accepting locks your stake in the escrow until it settles. read the <button className="underline" onClick={() => setShowTerms(true)}>terms</button>. invitation expires {marketTime(d.inviteExpiresAt)}.
            </p>
            {!d.open && <button className="btn-outline btn-sm mt-3" onClick={() => run(() => declineDuel(d.id), "declined")}>decline</button>}
          </div>
        )}
        {d.status === "pending" && !me && (
          <Link href="/auth/sign-in" className="btn-primary w-full">sign in to accept</Link>
        )}
        {d.status === "pending" && mine && !acceptable && (
          <div className="card p-4">
            <p className="flex items-center gap-2 font-semibold"><Clock size={17} /> waiting for {d.open ? "someone to accept" : d.participants.filter((p) => !p.accepted).map((p) => `@${usersMap[p.userId]?.username}`).join(", ")}</p>
            <p className="mt-1 text-sm text-muted">{d.escrowState === "unfunded" ? "lock your stake below to send it." : `invitation expires ${marketTime(d.inviteExpiresAt)}.`}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-dark btn-sm" disabled={d.escrowState === "unfunded"} onClick={() => shareLink(inviteLink(d), `${me?.displayName} challenged you on beef: ${d.participants.map((p) => p.ticker).join(" vs ")}, ${fmtStake(d.stake)} test usdc each.`)}><Share2 size={15} /> share invite</button>
              {d.createdBy === me?.id && <button className="btn-outline btn-sm" onClick={() => run(() => cancelDuel(d.id), "duel cancelled")}>cancel</button>}
            </div>
          </div>
        )}
        {d.status === "accepted" && (
          <div className="card p-4">
            <p className="flex items-center gap-2 font-semibold"><Lock size={17} /> everyone's in. terms are locked.</p>
            <p className="mt-1 text-sm text-muted">starting prices lock at the market open: {d.startAt && `${etLabel(new Date(d.startAt))} (${localLabel(new Date(d.startAt))})`}. the duel goes live then and ends {dl.et}.</p>
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
          <div className="pb-2">
            <p className="section-title rule-title">how it was decided</p>
            <p className="mt-2.5 text-[16px] leading-relaxed text-ink">{st.explanation}</p>
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
        {live && quoteError && <p className="text-sm text-loss">live chainlink prices are unavailable right now. the result isn't affected: it uses verified regular-hours reports.</p>}
      </div>

      {cdpEnabled() && <DuelFunding d={d} />}

      {/* price table */}
      {(live || done || d.status === "awaiting_verification" || d.status === "pending" || d.status === "accepted") && (
        <div className="card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-semibold">prices</p>
            <span className="flex items-center gap-1.5 text-xs text-muted">source <SourceBadge /></span>
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
                    <td className="num px-2 py-2.5">{p.endSnap ? price(p.endSnap.price) : live ? <QuoteLine q={p.quote} /> : p.current != null ? price(p.current) : "—"}</td>
                    <td className="px-4 py-2.5 text-right"><Pct v={p.ret} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 border-t bg-ink/[.015] px-4 py-3 text-xs text-muted">
            {(d.startSnapshots[0] || d.startAt) && <p>start: first chainlink feed update at or after {etLabel(new Date(d.startSnapshots[0]?.timestamp ?? d.startAt!))}</p>}
            <p>end: first chainlink feed update at or after {dl.et}{dl.exact ? "" : " (fixed when the duel starts)"} · your time {dl.local}</p>
            {[...d.startSnapshots, ...d.endSnapshots].filter((x) => x.streamId).map((x) => (
              <p key={`${x.ticker}${x.kind}`} className="font-mono text-[11px]">{x.ticker} {x.kind}: {x.streamId!.length === 42 ? "feed" : "stream"} {x.streamId!.slice(0, 10)}…{x.streamId!.slice(-4)}{x.roundId ? ` · round ${x.roundId}` : ""} · updated {x.observationsTimestamp ? new Date(x.observationsTimestamp * 1000).toISOString().slice(0, 19).replace("T", " ") + "z" : "—"} · report {x.reportHash?.slice(0, 10)}… · {x.verification?.status === "verified" ? "verified by chainlink's verifier (base sepolia)" : x.verification?.status === "onchain" ? <a className="underline" href={`https://basescan.org/address/${x.streamId}#readContract`} target="_blank" rel="noreferrer">chainlink feed on base mainnet</a> : `verification: ${x.verification?.status ?? "none"}`}</p>
            ))}
            {st && <p>settlement: {st.status === "needs_verification" ? "paused for verification" : st.status} · {st.methodology} · calculation {st.calculationVersion}{st.marginE4 && st.status === "settled" ? ` · margin ${(Number(st.marginE4) / 1e4).toFixed(4)} pts` : ""}</p>}
            {st?.issues?.length ? <p className="text-gold">why it's paused: {st.issues.join("; ")}</p> : null}
            {d.settleTx && <p>payout transaction: <a className="underline" href={txUrl(d.settleTx)} target="_blank" rel="noreferrer">{d.settleTx.slice(0, 10)}… on the base sepolia explorer</a></p>}
            <p>return = ((end − start) ÷ start) × 100. share price doesn't matter, only the percentage move.</p>
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
              ["stake", `${fmtStake(d.stake)} test usdc each, held by the beef escrow on base sepolia`],
              ["prize pool", `${pot} test usdc`],
              ["comparison", "percentage return from chainlink prices at the lock and end closes"],
              ["price lock", d.terms.priceRule],
              ["starts", d.startAt ? `${etLabel(new Date(d.startAt))} · your time ${localLabel(new Date(d.startAt))}` : "the next market open after everyone accepts"],
              ["deadline", `${deadlineLine(d, new Date(now || Date.now()))} · your time ${dl.local}`],
              ["settlement", d.terms.settlementRule],
              ["price data", d.terms.methodology === "chainlink_regular_hours_mid_v1" ? "chainlink data streams · 24/5 us equities, verified with chainlink's base sepolia verifier" : "chainlink data feeds on base mainnet (coinbase tokenized stocks, total-return), read onchain"],
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
    case "pending": return d.escrowState === "unfunded" ? "waiting for the creator's stake" : "waiting for opponents to lock their stakes";
    case "accepted": return "terms locked · prices lock at the market open";
    case "active": return "pending · settles at the deadline";
    case "awaiting_verification": return "paused · waiting for verified prices";
    case "completed": return d.escrowState === "settled" ? (d.settlement?.status === "draw" ? "settled · draw, stakes returned onchain" : "settled · paid out onchain") : "result final · payout ready to release";
    case "cancelled": return d.escrowState === "funded" ? "cancelled · creator can reclaim the stake after the funding window" : d.escrowState === "refunded" ? "cancelled · stake refunded" : "cancelled · nothing was staked";
    case "declined": return d.escrowState === "funded" ? "declined · creator can reclaim the stake after the funding window" : d.escrowState === "refunded" ? "declined · stake refunded" : "declined · nothing was staked";
    case "expired": return d.escrowState === "funded" ? "expired · creator can reclaim the stake" : d.escrowState === "refunded" ? "expired · stake refunded" : "invite expired · nothing was staked";
  }
}
