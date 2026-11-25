"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Globe, Info, Lock, Search, Share2, Users, X } from "lucide-react";
import dynamic from "next/dynamic";
import type { Duel, User } from "@/lib/types";
import { getAsset } from "@/lib/market/assets";
import { deadlineOptions, nextCloseAfter, sessionCloseUtc } from "@/lib/market/calendar";
import {
  MAX_STAKE, STAKE_OPTIONS, createDuel, inviteLink, useBeef,
} from "@/lib/store/store";
import { rivalsOf, useMe } from "@/lib/hooks";
import { cx, marketTime, usd } from "@/lib/format";
import { Avatar, EmptyState, SimBadge, useAction } from "@/components/ui";
import { StockPicker } from "@/components/stock-picker";
import { absoluteUrl, shareLink, toast } from "@/components/share";

// wallet code (viem + cdp) only loads for the funding step
const FundCard = dynamic(() => import("@/components/wallet/duel-funding").then((m) => m.DuelFunding), { ssr: false });

const STEPS = [
  { key: "who", title: "who are you beefing with?" },
  { key: "stocks", title: "pick the matchup" },
  { key: "side", title: "which side are you on?" },
  { key: "stake", title: "what's on the line?" },
  { key: "deadline", title: "when does it end?" },
  { key: "review", title: "review the terms" },
] as const;

const MAX_GROUP = 5; // you + up to 5 friends
const validTicker = (t: string | null) => (t && getAsset(t) ? t.toUpperCase() : null);

function NewDuelInner() {
  const s = useBeef();
  const me = useMe();
  const router = useRouter();
  const sp = useSearchParams();
  const run = useAction();

  // prefill from "challenge" buttons: ?vs=<userId>&mine=<ticker>&theirs=<ticker>
  const preVs = sp.get("vs") && s.users.some((u) => u.id === sp.get("vs") && u.id !== me?.id) ? sp.get("vs") : null;
  const preMine = validTicker(sp.get("mine"));
  const preTheirs = validTicker(sp.get("theirs"));

  // a full prefill (rematch / challenge a prediction) jumps straight to the stake
  const [step, setStep] = useState(preVs && preMine && preTheirs && preMine !== preTheirs ? 3 : 0);
  const [mode, setMode] = useState<"friend" | "open" | "group">("friend");
  const [opponents, setOpponents] = useState<string[]>(preVs ? [preVs] : []);
  const [stocks, setStocks] = useState<(string | null)[]>([preMine ?? null, preTheirs && preTheirs !== preMine ? preTheirs : null]);
  const [activeSlot, setActiveSlot] = useState(preMine ? (preTheirs ? 0 : 1) : 0);
  const [mine, setMine] = useState<string | null>(preMine);
  const [assign, setAssign] = useState<Record<string, string>>({}); // group: friend -> ticker
  const [stake, setStake] = useState(10);
  const [deadlineId, setDeadlineId] = useState("week");
  const [visibility, setVisibility] = useState<Duel["visibility"]>("public");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [q, setQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);
  const [created, setCreated] = useState<Duel | null>(null);

  const options = useMemo(() => deadlineOptions(new Date()), []);
  const deadline = options.find((o) => o.id === deadlineId) ?? options[0];
  const lockSession = useMemo(() => nextCloseAfter(new Date()), []);

  const friends = useMemo(() => {
    if (!me) return [] as User[];
    const followIds = new Set(s.follows.filter((f) => f.followerId === me.id).map((f) => f.followeeId));
    const rivalIds = new Set(rivalsOf(s, me.id).map((r) => r.opponentId));
    const ql = q.trim().toLowerCase().replace(/^@/, "");
    return s.users
      .filter((u) => u.id !== me.id)
      .filter((u) => !ql || u.username.includes(ql) || u.displayName.toLowerCase().includes(ql))
      .sort((a, b) => Number(rivalIds.has(b.id)) - Number(rivalIds.has(a.id)) || Number(followIds.has(b.id)) - Number(followIds.has(a.id)) || a.displayName.localeCompare(b.displayName));
  }, [s, me, q]);

  if (!me) {
    return <EmptyState icon={<Lock size={22} />} title="sign in to start a beef" body="you can browse everything without an account. duels need one." action={<Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>} />;
  }

  // ---------- derived ----------
  const slots = mode === "group" ? opponents.length + 1 : 2;
  const picked = stocks.slice(0, slots);
  const theirStocks = picked.filter((t): t is string => !!t && t !== mine);
  const groupAssign = mode === "group"
    ? opponents.map((id, i) => ({ userId: id, ticker: assign[id] && theirStocks.includes(assign[id]) ? assign[id] : theirStocks[i] }))
    : [];
  const participants = mode === "open" ? 2 : opponents.length + 1;
  const pot = stake * participants;
  const userById = (id: string) => s.users.find((u) => u.id === id);

  const problems: (string | null)[] = [
    mode === "open" ? null : mode === "group" ? (opponents.length < 2 ? "pick at least two friends for a group beef" : null) : opponents.length !== 1 ? "pick someone to challenge, or make it an open challenge" : null,
    picked.some((t) => !t) ? `pick ${slots} different stocks` : new Set(picked).size !== picked.length ? "each side needs a different stock" : null,
    !mine || !picked.includes(mine) ? "pick the stock you're backing" : mode === "group" && new Set(groupAssign.map((g) => g.ticker)).size !== groupAssign.length ? "each friend needs a different stock" : null,
    !STAKE_OPTIONS.includes(stake) ? "pick a stake" : null,
    !deadline ? "pick a deadline" : null,
    !agree ? "agree to the terms to send it" : null,
  ];
  const blocked = problems[step];

  const pickStock = (t: string) => {
    const next = [...stocks];
    while (next.length < slots) next.push(null);
    next[activeSlot] = t;
    setStocks(next);
    if (mine && !next.includes(mine)) setMine(null);
    const empty = next.slice(0, slots).findIndex((x) => !x);
    if (empty >= 0) setActiveSlot(empty);
  };

  const toggleOpponent = (id: string) => {
    if (mode !== "group") { setOpponents([id]); return; }
    setOpponents((o) => (o.includes(id) ? o.filter((x) => x !== id) : o.length < MAX_GROUP ? [...o, id] : o));
  };

  const submit = async () => {
    if (submitted.current || submitting || problems.some(Boolean)) return; // prevents double taps
    submitted.current = true;
    setSubmitting(true);
    const theirTicker = mode === "group" ? groupAssign[0].ticker : theirStocks[0];
    const d = await run(() => createDuel({
      myTicker: mine!, opponentTicker: theirTicker, opponentId: mode === "open" ? null : opponents[0], stake,
      deadline: deadline.deadline, deadlineLabel: deadline.label, visibility, title: title || undefined,
      extra: mode === "group" ? groupAssign.slice(1) : undefined,
    }), "challenge saved");
    setSubmitting(false);
    if (d) setCreated(d);
    else submitted.current = false;
  };

  // ---------- success ----------
  if (created) {
    const live = s.duels.find((d) => d.id === created.id) ?? created;
    const link = absoluteUrl(inviteLink(created));
    const funded = live.escrowState !== "unfunded";
    return (
      <div className="mx-auto max-w-md animate-fade-up pt-4">
        <div className="text-center">
          <div className={cx("mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full", funded ? "bg-gain-soft text-gain" : "bg-gold-soft text-gold")}>{funded ? <Check size={28} /> : <Lock size={26} />}</div>
          <h1 className="font-display text-2xl font-bold">{funded ? "challenge sent" : "one more step: lock your stake"}</h1>
          <p className="mt-1 text-[15px] text-muted">{funded ? (created.open ? "anyone can take the other side." : "your opponent can accept now. it goes live at the first market close after everyone's in.") : `your ${stake} test usdc goes into the beef escrow on base sepolia. nobody can accept until it's locked.`}</p>
        </div>
        <FundCard d={live} />
        {funded && (
          <div className="card mt-3 p-4">
            <p className="text-sm font-semibold">share the invite</p>
            <p className="mt-1 truncate font-mono text-[12px] text-muted">{link}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-outline btn-sm" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => {}); toast("success", "link copied"); }}><Copy size={15} /> copy link</button>
              <button className="btn-dark btn-sm" onClick={() => shareLink(link, `${me.displayName} challenged you on beef: ${created.participants.map((p) => p.ticker).join(" vs ")}, ${stake} test usdc each.`)}><Share2 size={15} /> share</button>
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Link href={`/duel/${created.id}`} className="btn-outline">view duel</Link>
          <Link href="/" className="btn-ghost">home</Link>
        </div>
      </div>
    );
  }

  // ---------- wizard ----------
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-3 flex items-center gap-2">
        <button className="btn-ghost btn-sm !h-10 !w-10 !px-0" onClick={() => (step ? setStep(step - 1) : router.back())} aria-label="back"><ArrowLeft size={20} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted">step {step + 1} of {STEPS.length}</p>
          <h1 className="font-display text-xl font-bold leading-tight">{STEPS[step].title}</h1>
        </div>
        <Link href="/duel" className="btn-ghost btn-sm !h-10 !w-10 !px-0" aria-label="cancel"><X size={20} /></Link>
      </div>
      <div className="mb-4 flex gap-1" aria-hidden>{STEPS.map((_, i) => <div key={i} className={cx("h-1 flex-1 rounded-full", i <= step ? "bg-ink" : "bg-black/10")} />)}</div>

      {/* running summary */}
      {step > 0 && step < 5 && (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl bg-surface px-3 py-2.5 text-sm shadow-card">
          <span className="text-muted">{mode === "open" ? "open challenge" : opponents.map((id) => `@${userById(id)?.username}`).join(", ")}</span>
          {picked.some(Boolean) && <span className="font-bold">· {picked.map((t) => t ?? "?").join(" vs ")}</span>}
          {step > 2 && mine && <span className="text-muted">· you: <b className="text-ink">{mine}</b></span>}
          {step > 3 && <span className="text-muted">· {stake} test usdc each</span>}
        </div>
      )}

      {step === 0 && (
        <div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["friend", "a friend", "1 vs 1", null],
              ["open", "open", "anyone accepts", <Globe key="g" size={16} />],
              ["group", "group", "up to 6 people", <Users key="u" size={16} />],
            ] as const).map(([m, label, sub, icon]) => (
              <button key={m} onClick={() => { setMode(m); if (m === "open") setOpponents([]); if (m === "friend") setOpponents((o) => o.slice(0, 1)); }}
                className={cx("card p-3 text-left transition", mode === m && "border-ink ring-1 ring-ink")} aria-pressed={mode === m}>
                <span className="flex items-center gap-1.5 text-sm font-semibold">{icon}{label}</span>
                <span className="block text-xs text-muted">{sub}</span>
              </button>
            ))}
          </div>
          {mode === "open" ? (
            <div className="card mt-3 p-4 text-sm text-ink-soft">anyone on beef can take the other side. great for settling a debate in a community.</div>
          ) : (
            <>
              <div className="relative mt-3">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-10" placeholder="search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search people" />
              </div>
              <ul className="card mt-2 max-h-[48dvh] divide-y overflow-y-auto">
                {friends.length === 0 && <li className="p-4 text-sm text-muted">no one matches “{q}”.</li>}
                {friends.map((u) => {
                  const on = opponents.includes(u.id);
                  return (
                    <li key={u.id}>
                      <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-black/[.02]" onClick={() => toggleOpponent(u.id)} aria-pressed={on}>
                        <Avatar user={u} size={38} />
                        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{u.displayName}</span><span className="block truncate text-[13px] text-muted">@{u.username}</span></span>
                        <span className={cx("flex h-6 w-6 items-center justify-center rounded-full border-2", on ? "border-ink bg-ink text-white" : "border-line")}>{on && <Check size={14} />}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <div className={cx("mb-3 grid gap-2", slots === 2 ? "grid-cols-[1fr_auto_1fr] items-center" : "grid-cols-3")}>
            {Array.from({ length: slots }).map((_, i) => {
              const t = stocks[i] ?? null;
              const node = (
                <button key={i} onClick={() => setActiveSlot(i)} className={cx("rounded-2xl border-2 bg-surface p-3 text-center transition", activeSlot === i ? "border-ink" : "border-line")} aria-label={`stock ${i + 1}${t ? `: ${t}` : ""}`}>
                  <span className="block font-display text-xl font-extrabold">{t ?? "?"}</span>
                  <span className="block truncate text-xs text-muted">{t ? getAsset(t)?.name : `stock ${i + 1}`}</span>
                </button>
              );
              return slots === 2 && i === 1 ? [<span key="vs" className="text-xs font-bold text-faint">vs</span>, node] : node;
            })}
          </div>
          <StockPicker value={stocks[activeSlot] ?? undefined} onChange={pickStock} exclude={picked.filter((t, i) => t && i !== activeSlot) as string[]} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className={cx("grid gap-2", slots === 2 ? "grid-cols-2" : "grid-cols-3")}>
            {picked.map((t) => (
              <button key={t} onClick={() => setMine(t)} aria-pressed={mine === t}
                className={cx("rounded-2xl border-2 p-4 text-center transition", mine === t ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink/30")}>
                <span className="block font-display text-2xl font-extrabold">{t}</span>
                <span className={cx("block truncate text-xs", mine === t ? "text-white/70" : "text-muted")}>{mine === t ? "your pick" : getAsset(t!)?.name}</span>
              </button>
            ))}
          </div>
          {mine && mode !== "group" && <p className="text-center text-[15px] text-ink-soft">you're backing <b>{mine}</b>. {mode === "open" ? "your opponent" : userById(opponents[0])?.displayName} gets <b>{theirStocks[0]}</b>.</p>}
          {mine && mode === "group" && (
            <div className="card divide-y">
              {groupAssign.map((g) => (
                <div key={g.userId} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar user={userById(g.userId)} size={32} />
                  <span className="flex-1 truncate text-sm font-semibold">{userById(g.userId)?.displayName}</span>
                  <select className="input !w-28 !py-1.5 text-sm" value={g.ticker} aria-label={`stock for ${userById(g.userId)?.username}`}
                    onChange={(e) => {
                      const t = e.target.value;
                      const other = groupAssign.find((x) => x.ticker === t);
                      setAssign({ ...Object.fromEntries(groupAssign.map((x) => [x.userId, x.ticker])), [g.userId]: t, ...(other ? { [other.userId]: g.ticker } : {}) });
                    }}>
                    {theirStocks.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <p className="flex items-start gap-2 rounded-xl bg-black/[.03] p-3 text-[13px] text-ink-soft"><Info size={16} className="mt-0.5 shrink-0" />whoever's stock has the higher percentage return wins. a $30 stock can beat a $900 one.</p>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="grid grid-cols-5 gap-2">
            {STAKE_OPTIONS.map((v) => (
              <button key={v} onClick={() => setStake(v)} aria-pressed={stake === v}
                className={cx("rounded-xl border-2 py-3 font-display text-lg font-bold transition disabled:opacity-30", stake === v ? "border-ink bg-ink text-white" : "border-line bg-surface")}>{v}</button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="card p-3"><p className="text-xs text-muted">your stake</p><p className="num mt-0.5 font-display text-lg font-bold">{stake}</p><p className="text-[10px] text-muted">test usdc</p></div>
            <div className="card p-3"><p className="text-xs text-muted">{participants > 2 ? `each of ${participants - 1} friends` : "their stake"}</p><p className="num mt-0.5 font-display text-lg font-bold">{stake}</p><p className="text-[10px] text-muted">test usdc</p></div>
            <div className="card border-ink/20 bg-ink p-3 text-white"><p className="text-xs text-white/70">prize pool</p><p className="num mt-0.5 font-display text-lg font-bold">{pot}</p><p className="text-[10px] text-white/70">test usdc</p></div>
          </div>
          <p className="mt-3 text-[13px] text-muted">winner takes the pool; a draw returns everyone's stake. stakes are test usdc on base sepolia (no monetary value), up to {MAX_STAKE} per duel. you'll need this much in your wallet when you lock it.</p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2">
          {options.map((o) => (
            <button key={o.id} onClick={() => setDeadlineId(o.id)} aria-pressed={deadlineId === o.id} className={cx("card flex w-full items-center justify-between p-4 text-left transition", deadlineId === o.id && "border-ink ring-1 ring-ink")}>
              <div>
                <p className="font-semibold">{o.label}</p>
                <p className="text-[13px] text-muted">ends {marketTime(o.deadline)}{o.note ? ` · ${o.note}` : ""}</p>
              </div>
              {deadlineId === o.id && <Check size={20} />}
            </button>
          ))}
          <p className="flex items-start gap-2 rounded-xl bg-black/[.03] p-3 text-[13px] text-ink-soft">
            <Info size={16} className="mt-0.5 shrink-0" />
            starting prices lock at the first market close after everyone accepts (next: {marketTime(sessionCloseUtc(lockSession).toISOString())}). the result uses the official close on the deadline.
          </p>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div className="card divide-y">
            {[
              ["against", mode === "open" ? "open challenge · first to accept" : opponents.map((id) => `@${userById(id)?.username}`).join(", ")],
              ["you back", mine!],
              [mode === "group" ? "they back" : "they back", mode === "group" ? groupAssign.map((g) => `${g.ticker} (@${userById(g.userId)?.username})`).join(", ") : theirStocks[0]],
              ["your stake", `${stake} test usdc`],
              ["prize pool", `${pot} test usdc · winner takes all`],
              ["deadline", `${deadline.label} · ${marketTime(deadline.deadline)}`],
              ["prices lock", "first official close after everyone's in"],
              ["network", "base sepolia (testnet)"],
              ["token", "usdc by circle (test, no monetary value)"],
              ["fees", "none · gas covered by beef"],
              ["winner", "higher percentage return. identical returns are a draw."],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-[15px]"><span className="shrink-0 text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>
            ))}
          </div>
          <div className="card p-4">
            <label className="label" htmlFor="title">name it <span className="font-normal text-muted">(optional)</span></label>
            <input id="title" className="input" value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. chips vs phones" />
            <p className="label mt-3">who can see it</p>
            <div className="flex gap-2">{(["public", "friends", "private"] as const).map((v) => <button key={v} onClick={() => setVisibility(v)} aria-pressed={visibility === v} className={cx("chip", visibility === v && "chip-active")}>{v}</button>)}</div>
          </div>
          <label className="card flex cursor-pointer items-start gap-3 p-4">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#1D1D1F]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="text-sm text-ink-soft">i agree to these terms. once everyone's in they can't be changed. stakes are <b>test usdc on base sepolia</b>, stock prices are simulated, and this is entertainment, not investment advice.</span>
          </label>
        </div>
      )}

      {/* footer */}
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-5 bg-bg/90 pb-2 pt-2 backdrop-blur lg:bottom-0">
        {blocked && (step !== 1 || picked.some(Boolean)) && <p className="mb-2 text-center text-[13px] text-muted" role="status">{blocked}</p>}
        {step < 5 ? (
          <button className="btn-dark w-full" disabled={!!blocked} onClick={() => setStep(step + 1)}>continue</button>
        ) : (
          <button className="btn-primary w-full" disabled={!!blocked || submitting} onClick={submit}>{submitting ? "saving…" : "continue to lock your stake"}</button>
        )}
      </div>
    </div>
  );
}

export default function NewDuelPage() {
  return <Suspense><NewDuelInner /></Suspense>;
}
