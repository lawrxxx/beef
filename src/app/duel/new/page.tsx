"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Globe, Info, Lock, Search, Share2, Users, X } from "lucide-react";
import { ASSETS, getAsset } from "@/lib/market/assets";
import { deadlineOptions, nextCloseAfter, sessionCloseUtc } from "@/lib/market/calendar";
import {
  MAX_STAKE, STAKE_OPTIONS, createDuel, encodeInvite, practiceBalance, simulateOpponentAccept, useBeef,
} from "@/lib/store/store";
import { useMe, useMounted, rivalsOf } from "@/lib/hooks";
import { cx, marketTime, usd } from "@/lib/format";
import { Avatar, EmptyState, SimBadge, useAction } from "@/components/ui";
import { StockPicker } from "@/components/stock-picker";
import { absoluteUrl, shareLink, toast } from "@/components/share";
import type { Duel } from "@/lib/types";

const STEPS = ["your stock", "their stock", "stake", "deadline", "opponent", "review"] as const;

function NewDuelInner() {
  const s = useBeef();
  const me = useMe();
  const router = useRouter();
  const sp = useSearchParams();
  const mounted = useMounted();
  const run = useAction();

  const [step, setStep] = useState(0);
  const [mine, setMine] = useState<string | undefined>(sp.get("mine")?.toUpperCase() && getAsset(sp.get("mine")!) ? sp.get("mine")!.toUpperCase() : undefined);
  const [theirs, setTheirs] = useState<string | undefined>(sp.get("theirs")?.toUpperCase() && getAsset(sp.get("theirs")!) ? sp.get("theirs")!.toUpperCase() : undefined);
  const [stake, setStake] = useState(10);
  const [deadlineId, setDeadlineId] = useState<string>("friday");
  const [opponent, setOpponent] = useState<string | null | undefined>(sp.get("vs") ?? undefined); // null = open challenge
  const [group, setGroup] = useState<{ userId: string; ticker: string }[]>([]);
  const [groupMode, setGroupMode] = useState(false);
  const [visibility, setVisibility] = useState<Duel["visibility"]>("public");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [q, setQ] = useState("");
  const [created, setCreated] = useState<Duel | null>(null);

  useEffect(() => {
    // prefilled from "challenge" buttons: skip ahead
    if (mine && theirs && step === 0) setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo(() => deadlineOptions(new Date()), []);
  const deadline = options.find((o) => o.id === deadlineId) ?? options[0];
  const lockSession = useMemo(() => nextCloseAfter(new Date()), []);
  const balance = me ? practiceBalance(s, me.id) : 0;
  const participantsCount = 2 + group.length;
  const pot = stake * participantsCount;

  const friends = useMemo(() => {
    if (!me) return [];
    const followIds = new Set(s.follows.filter((f) => f.followerId === me.id).map((f) => f.followeeId));
    const rivalIds = new Set(rivalsOf(s, me.id).map((r) => r.opponentId));
    return s.users
      .filter((u) => u.id !== me.id)
      .filter((u) => !q || u.username.includes(q.toLowerCase()) || u.displayName.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => Number(rivalIds.has(b.id)) - Number(rivalIds.has(a.id)) || Number(followIds.has(b.id)) - Number(followIds.has(a.id)));
  }, [s, me, q]);

  if (!mounted) return null;
  if (!me) {
    return <EmptyState icon={<Lock size={22} />} title="sign in to start a beef" body="you can browse everything without an account. duels need one." action={<Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>} />;
  }

  const canNext = [
    !!mine,
    !!theirs && theirs !== mine,
    stake > 0 && stake <= balance,
    !!deadline,
    opponent !== undefined && (!groupMode || group.every((g) => g.ticker)),
    agree,
  ][step];

  const opponentUser = opponent ? s.users.find((u) => u.id === opponent) : null;
  const usedTickers = [mine, theirs, ...group.map((g) => g.ticker)].filter(Boolean) as string[];

  const submit = async () => {
    const d = await run(() => createDuel({
      myTicker: mine!, opponentTicker: theirs!, opponentId: opponent ?? null, stake,
      deadline: deadline.deadline, deadlineLabel: deadline.label, visibility,
      title: title || undefined, extra: groupMode ? group : undefined,
    }), "challenge sent");
    if (d) setCreated(d);
  };

  if (created) {
    const link = absoluteUrl(`/invite#${encodeInvite(created)}`);
    const live = s.duels.find((d) => d.id === created.id) ?? created;
    return (
      <div className="mx-auto max-w-md pt-4 text-center animate-fade-up">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gain-soft text-gain"><Check size={30} /></div>
        <h1 className="font-display text-2xl font-bold">challenge created</h1>
        <p className="mt-1 text-[15px] text-muted">
          {created.open ? "anyone can take the other side." : `send it to ${opponentUser?.displayName ?? "your friend"}. it becomes active once they accept.`}
        </p>
        <div className="card mt-5 p-4 text-left">
          <p className="text-sm text-muted">invitation link</p>
          <p className="mt-1 truncate font-mono text-[13px]">{link}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn-outline btn-sm" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => {}); toast("success", "link copied"); }}><Copy size={15} /> copy</button>
            <button className="btn-dark btn-sm" onClick={() => shareLink(link, `${me.displayName} challenged you on beef: ${mine} vs ${theirs}, ${usd(stake, 0)} each.`)}><Share2 size={15} /> share</button>
          </div>
        </div>
        {live.status === "pending" && (
          <div className="card mt-3 border-dashed p-4 text-left">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><SimBadge label="demo" /> no friends online?</p>
            <p className="mt-1 text-sm text-muted">simulate {opponentUser ? `@${opponentUser.username}` : "someone"} accepting so you can see the full flow.</p>
            <button className="btn-outline btn-sm mt-3" onClick={() => run(() => simulateOpponentAccept(created.id), "accepted! prices lock at the next close")}>simulate acceptance</button>
          </div>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Link href={`/duel/${created.id}`} className="btn-primary">view duel</Link>
          <Link href="/" className="btn-ghost">home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center gap-2">
        <button className="btn-ghost btn-sm !h-10 !w-10 !px-0" onClick={() => (step ? setStep(step - 1) : router.back())} aria-label="back"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <p className="text-xs font-semibold text-muted">step {step + 1} of {STEPS.length}</p>
          <h1 className="font-display text-xl font-bold">{
            ["which stock are you backing?", "what are you up against?", "how much is on it?", "when does it end?", "who are you beefing with?", "review your challenge"][step]
          }</h1>
        </div>
        <Link href="/duel" className="btn-ghost btn-sm !h-10 !w-10 !px-0" aria-label="cancel"><X size={20} /></Link>
      </div>
      <div className="mb-5 flex gap-1" aria-hidden>{STEPS.map((_, i) => <div key={i} className={cx("h-1 flex-1 rounded-full", i <= step ? "bg-ink" : "bg-black/10")} />)}</div>

      {(mine || theirs) && step < 5 && (
        <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl bg-surface p-3 text-center shadow-card">
          <span className={cx("font-display text-xl font-extrabold", !mine && "text-faint")}>{mine ?? "?"}</span>
          <span className="text-xs font-bold text-faint">vs</span>
          <span className={cx("font-display text-xl font-extrabold", !theirs && "text-faint")}>{theirs ?? "?"}</span>
          {step >= 2 && <span className="ml-2 rounded-full bg-black/[.05] px-2 py-0.5 text-xs font-semibold">{usd(stake, 0)} each</span>}
        </div>
      )}

      {step === 0 && <StockPicker value={mine} onChange={(t) => { setMine(t); if (theirs === t) setTheirs(undefined); setStep(1); }} />}
      {step === 1 && <StockPicker value={theirs} onChange={(t) => { setTheirs(t); setStep(2); }} exclude={mine ? [mine] : []} />}

      {step === 2 && (
        <div>
          <div className="grid grid-cols-5 gap-2">
            {STAKE_OPTIONS.map((v) => (
              <button key={v} disabled={v > balance} onClick={() => setStake(v)} className={cx("rounded-xl border-2 py-3 font-display text-lg font-bold transition disabled:opacity-30", stake === v ? "border-ink bg-ink text-white" : "border-line bg-surface")}>${v}</button>
            ))}
          </div>
          <div className="card mt-4 p-4">
            <div className="flex justify-between text-[15px]"><span className="text-muted">you put in</span><span className="num font-semibold">{usd(stake, 0)}</span></div>
            <div className="mt-1 flex justify-between text-[15px]"><span className="text-muted">they put in</span><span className="num font-semibold">{usd(stake, 0)}</span></div>
            <div className="mt-3 flex justify-between border-t pt-3"><span className="font-semibold">winner takes</span><span className="num font-display text-2xl font-bold">{usd(stake * 2, 0)}</span></div>
            <p className="mt-2 text-xs text-muted">a draw returns everyone's stake. practice balance: {usd(balance)} · max {usd(MAX_STAKE, 0)} per duel.</p>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted"><SimBadge label="practice money" /> stakes use a simulated balance. no real money moves in this version of beef.</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          {options.map((o) => (
            <button key={o.id} onClick={() => setDeadlineId(o.id)} className={cx("card flex w-full items-center justify-between p-4 text-left transition", deadlineId === o.id && "border-ink ring-1 ring-ink")}>
              <div>
                <p className="font-semibold">{o.label}</p>
                <p className="text-[13px] text-muted">{marketTime(o.deadline)}{o.note ? ` · ${o.note}` : ""}</p>
              </div>
              {deadlineId === o.id && <Check size={20} />}
            </button>
          ))}
          <div className="flex items-start gap-2 rounded-xl bg-black/[.03] p-3 text-[13px] text-ink-soft">
            <Info size={16} className="mt-0.5 shrink-0" />
            <p>starting prices lock at the first market close after your opponent accepts (next: {marketTime(sessionCloseUtc(lockSession).toISOString())}). the winner is decided by the official close on the deadline.</p>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <button className={cx("card flex items-center gap-2 p-3 text-left", opponent === null && !groupMode && "border-ink ring-1 ring-ink")} onClick={() => { setOpponent(null); setGroupMode(false); setGroup([]); }}>
              <Globe size={18} /> <span><span className="block text-sm font-semibold">open challenge</span><span className="block text-xs text-muted">anyone can accept</span></span>
            </button>
            <button className={cx("card flex items-center gap-2 p-3 text-left", groupMode && "border-ink ring-1 ring-ink")} onClick={() => { setGroupMode((g) => !g); if (opponent === null) setOpponent(undefined); }}>
              <Users size={18} /> <span><span className="block text-sm font-semibold">group beef</span><span className="block text-xs text-muted">up to 6 friends</span></span>
            </button>
          </div>
          <div className="relative mt-3">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-10" placeholder="search friends" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search friends" />
          </div>
          {groupMode && <p className="mt-3 text-[13px] text-muted">first pick plays {theirs}. everyone else picks their own stock below.</p>}
          <ul className="card mt-3 max-h-[44dvh] divide-y overflow-y-auto">
            {friends.map((u) => {
              const isOpp = opponent === u.id;
              const g = group.find((x) => x.userId === u.id);
              return (
                <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => {
                      if (!groupMode) { setOpponent(u.id); return; }
                      if (!opponent || opponent === null) { setOpponent(u.id); return; }
                      if (isOpp) { setOpponent(group[0]?.userId); setGroup(group.slice(1)); return; }
                      if (g) setGroup(group.filter((x) => x.userId !== u.id));
                      else if (group.length < 4) setGroup([...group, { userId: u.id, ticker: "" }]);
                    }}
                  >
                    <Avatar user={u} size={38} />
                    <span className="min-w-0"><span className="block truncate font-semibold">{u.displayName}</span><span className="block truncate text-[13px] text-muted">@{u.username}</span></span>
                  </button>
                  {isOpp && <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">{theirs}</span>}
                  {g && (
                    <select className="input !w-24 !py-1.5 text-sm" value={g.ticker} onChange={(e) => setGroup(group.map((x) => (x.userId === u.id ? { ...x, ticker: e.target.value } : x)))} aria-label={`stock for ${u.username}`}>
                      <option value="">pick</option>
                      {ASSETS.filter((a) => a.ticker === g.ticker || !usedTickers.includes(a.ticker)).map((a) => <option key={a.ticker}>{a.ticker}</option>)}
                    </select>
                  )}
                  {!isOpp && !g && <span className="h-5 w-5 rounded-full border-2" />}
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <p className="label">who can see it</p>
            <div className="flex gap-2">
              {(["public", "friends", "private"] as const).map((v) => <button key={v} onClick={() => setVisibility(v)} className={cx("chip", visibility === v && "chip-active")}>{v}</button>)}
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div className="card p-4">
            <label className="label" htmlFor="title">name your beef (optional)</label>
            <input id="title" className="input" value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. chips vs phones" />
          </div>
          <div className="card divide-y">
            {[
              ["matchup", `${mine} (you) vs ${theirs}${groupMode ? ` + ${group.map((g) => g.ticker).join(", ")}` : ""}`],
              ["against", opponent === null ? "open challenge · first to accept" : [opponentUser, ...group.map((g) => s.users.find((u) => u.id === g.userId))].map((u) => `@${u?.username}`).join(", ")],
              ["stake", `${usd(stake, 0)} each · winner takes ${usd(pot, 0)}`],
              ["deadline", `${deadline.label} · ${marketTime(deadline.deadline)}`],
              ["prices lock", "at the first official close after everyone accepts"],
              ["winner", "highest percentage return. identical returns are a draw."],
              ["visibility", visibility],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-3 text-[15px]"><span className="shrink-0 text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>
            ))}
          </div>
          <label className="card flex cursor-pointer items-start gap-3 p-4">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#1D1D1F]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="text-sm text-ink-soft">i agree to these terms. once accepted they can't be changed. i understand this uses <b>simulated prices and practice money</b>, and that comparing stock returns is entertainment, not investment advice.</span>
          </label>
        </div>
      )}

      {step >= 2 && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-5 lg:bottom-4">
          {step < 5 ? (
            <button className="btn-dark w-full" disabled={!canNext} onClick={() => setStep(step + 1)}>continue</button>
          ) : (
            <button className="btn-primary w-full" disabled={!canNext} onClick={submit}>send challenge · {usd(stake, 0)}</button>
          )}
        </div>
      )}
      {step < 2 && (mine || theirs) && (
        <button className="btn-ghost mt-3 w-full" disabled={!canNext} onClick={() => setStep(step + 1)}>continue with {step === 0 ? mine : theirs}</button>
      )}
    </div>
  );
}

export default function NewDuelPage() {
  return <Suspense><NewDuelInner /></Suspense>;
}
