"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Globe, Info, Lock, Search, Share2, Users, X } from "lucide-react";
import dynamic from "next/dynamic";
import type { Duel, User } from "@/lib/types";
import { getAsset } from "@/lib/market/assets";
import { EXPIRATION_COPY, EXPIRATION_TYPES, etLabel, localLabel, scheduleFor, startOpenFor, validateCustomDeadline, type ExpirationType } from "@/lib/expiration";
import { createDuel, inviteLink, useBeef } from "@/lib/store/store";
import { STAKE_MAX_UNITS, STAKE_MIN_UNITS, STAKE_PRESETS, fmtStake, formatUsdc, parseStakeInput, prizePoolUnits } from "@/lib/stake";
import type { StakeWalletStatus } from "@/components/wallet/stake-balance";
import { rivalsOf, useMe, useNow } from "@/lib/hooks";
import { cx, marketTime} from "@/lib/format";
import { Avatar, EmptyState, useAction } from "@/components/ui";
import { StockPicker } from "@/components/stock-picker";
import { absoluteUrl, shareLink, toast } from "@/components/share";

// wallet code (viem + cdp) only loads for the funding step
const FundCard = dynamic(() => import("@/components/wallet/duel-funding").then((m) => m.DuelFunding), { ssr: false });
const StakeBalance = dynamic(() => import("@/components/wallet/stake-balance").then((m) => m.StakeBalance), {
  ssr: false, loading: () => <div className="mt-3 rounded-lg border px-3 py-2.5"><div className="skeleton h-5 w-48" /></div>,
});

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
  const [stakeChoice, setStakeChoice] = useState<string>("10"); // a preset, or "custom"
  const [customStake, setCustomStake] = useState("");
  const [wallet, setWallet] = useState<StakeWalletStatus>({ ready: false, reason: "checking your wallet…" });
  const [expiration, setExpiration] = useState<ExpirationType>("next_open");
  const [customAt, setCustomAt] = useState(""); // datetime-local, in the viewer's own timezone
  const [visibility, setVisibility] = useState<Duel["visibility"]>("public");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [q, setQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);
  const [created, setCreated] = useState<Duel | null>(null);

  // schedules are shown "if accepted now"; next market open / one week are fixed when the duel activates
  const nowTick = useNow(60_000);
  const now = useMemo(() => new Date(nowTick || Date.now()), [nowTick]);
  const startIfNow = startOpenFor(now);
  const customDate = customAt ? new Date(customAt) : null;
  const customError = expiration === "custom" ? (customDate ? validateCustomDeadline(customDate, now) : "pick a date and time") : null;
  const presetDeadline = (t: ExpirationType) => scheduleFor(t, now).deadline;
  const deadline = expiration === "custom"
    ? (customDate && !customError ? { deadline: customDate.toISOString(), label: etLabel(customDate) } : null)
    : { deadline: presetDeadline(expiration).toISOString(), label: EXPIRATION_COPY[expiration].label };

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
  // amounts stay in bigint base units; strings are for display only
  const stakeCheck = parseStakeInput(stakeChoice === "custom" ? customStake : stakeChoice);
  const stakeU = stakeCheck.ok ? stakeCheck.units : null;
  const stakeLabel = stakeCheck.ok ? stakeCheck.value : "—";
  const potLabel = stakeU != null ? formatUsdc(prizePoolUnits(stakeU, participants)) : "—";
  const userById = (id: string) => s.users.find((u) => u.id === id);

  const problems: (string | null)[] = [
    mode === "open" ? null : mode === "group" ? (opponents.length < 2 ? "pick at least two friends for a group beef" : null) : opponents.length !== 1 ? "pick someone to challenge, or make it an open challenge" : null,
    picked.some((t) => !t) ? `pick ${slots} different stocks` : new Set(picked).size !== picked.length ? "each side needs a different stock" : null,
    !mine || !picked.includes(mine) ? "pick the stock you're backing" : mode === "group" && new Set(groupAssign.map((g) => g.ticker)).size !== groupAssign.length ? "each friend needs a different stock" : null,
    !stakeCheck.ok ? stakeCheck.error : !wallet.ready ? wallet.reason : null,
    !deadline ? (customError ?? "pick a deadline") : null,
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
      myTicker: mine!, opponentTicker: theirTicker, opponentId: mode === "open" ? null : opponents[0], stake: Number(stakeLabel), // "35.50" → 35.5, stored as numeric(10,2)
      deadline: deadline!.deadline, deadlineLabel: deadline!.label, expirationType: expiration, visibility, title: title || undefined,
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
          <p className="mt-1 text-[15px] text-muted">{funded ? (created.open ? "anyone can take the other side." : "your opponent can accept now. it goes live at the first market close after everyone's in.") : `your ${fmtStake(created.stake)} test usdc goes into the beef escrow on base sepolia. nobody can accept until it's locked.`}</p>
        </div>
        <FundCard d={live} />
        {funded && (
          <div className="card mt-3 p-4">
            <p className="text-sm font-semibold">share the invite</p>
            <p className="mt-1 truncate font-mono text-[12px] text-muted">{link}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-outline btn-sm" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => {}); toast("success", "link copied"); }}><Copy size={15} /> copy link</button>
              <button className="btn-dark btn-sm" onClick={() => shareLink(link, `${me.displayName} challenged you on beef: ${created.participants.map((p) => p.ticker).join(" vs ")}, ${fmtStake(created.stake)} test usdc each.`)}><Share2 size={15} /> share</button>
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
          <p className="kicker num">step {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}</p>
          <h1 className="font-display text-[24px] font-bold leading-tight tracking-[-0.03em]">{STEPS[step].title}</h1>
        </div>
        <Link href="/duel" className="btn-ghost btn-sm !h-10 !w-10 !px-0" aria-label="cancel"><X size={20} /></Link>
      </div>
      <div className="mb-5 flex gap-[3px]" aria-hidden>{STEPS.map((_, i) => <div key={i} className={cx("h-[3px] flex-1", i === step ? "bg-brand" : i < step ? "bg-ink" : "bg-ink/15")} />)}</div>

      {/* running summary */}
      {step > 0 && step < 5 && (
        <div className="mb-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-y border-line py-2.5 text-sm">
          <span className="text-muted">{mode === "open" ? "open challenge" : opponents.map((id) => `@${userById(id)?.username}`).join(", ")}</span>
          {picked.some(Boolean) && <span className="font-bold">· {picked.map((t) => t ?? "?").join(" vs ")}</span>}
          {step > 2 && mine && <span className="text-muted">· you: <b className="text-ink">{mine}</b></span>}
          {step > 3 && <span className="text-muted">· {stakeLabel} test usdc each</span>}
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
                className={cx("rounded-md border-2 p-3 text-left transition", mode === m ? "border-ink bg-surface" : "border-line hover:border-ink/40")} aria-pressed={mode === m}>
                <span className="flex items-center gap-1.5 text-sm font-semibold">{icon}{label}</span>
                <span className="block text-xs text-muted">{sub}</span>
              </button>
            ))}
          </div>
          {mode === "open" ? (
            <p className="mt-4 border-l-[3px] border-brand pl-3 text-[15px] text-ink-soft">anyone on beef can take the other side. great for settling a debate in a community.</p>
          ) : (
            <>
              <div className="relative mt-3">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-10" placeholder="search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search people" />
              </div>
              <ul className="mt-2 max-h-[48dvh] divide-y overflow-y-auto border-y border-line">
                {friends.length === 0 && <li className="p-4 text-sm text-muted">no one matches “{q}”.</li>}
                {friends.map((u) => {
                  const on = opponents.includes(u.id);
                  return (
                    <li key={u.id}>
                      <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-ink/[.03]" onClick={() => toggleOpponent(u.id)} aria-pressed={on}>
                        <Avatar user={u} size={38} />
                        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{u.displayName}</span><span className="block truncate text-[13px] text-muted">@{u.username}</span></span>
                        <span className={cx("flex h-6 w-6 items-center justify-center rounded-[5px] border-2", on ? "border-ink bg-ink text-inverse" : "border-ink/25")}>{on && <Check size={14} />}</span>
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
                <button key={i} onClick={() => setActiveSlot(i)} className={cx("rounded-md border-2 p-3 text-center transition", activeSlot === i ? "border-ink bg-surface" : "border-line")} aria-label={`stock ${i + 1}${t ? `: ${t}` : ""}`}>
                  <span className={cx("display-cond block text-[32px] font-bold leading-none", !t && "text-faint")}>{t ?? "?"}</span>
                  <span className="block truncate text-xs text-muted">{t ? getAsset(t)?.name : `stock ${i + 1}`}</span>
                </button>
              );
              return slots === 2 && i === 1 ? [<span key="vs" className="font-display text-[15px] italic text-faint">vs</span>, node] : node;
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
                className={cx("rounded-md border-2 p-4 text-center transition", mine === t ? "border-ink bg-ink text-inverse" : "border-line hover:border-ink/40")}>
                <span className="display-cond block text-[44px] font-bold leading-none">{t}</span>
                <span className={cx("block truncate text-xs", mine === t ? "text-inverse/70" : "text-muted")}>{mine === t ? "your pick" : getAsset(t!)?.name}</span>
              </button>
            ))}
          </div>
          {mine && mode !== "group" && <p className="text-center text-[15px] text-ink-soft">you're backing <b>{mine}</b>. {mode === "open" ? "your opponent" : userById(opponents[0])?.displayName} gets <b>{theirStocks[0]}</b>.</p>}
          {mine && mode === "group" && (
            <div className="divide-y border-y border-line">
              {groupAssign.map((g) => (
                <div key={g.userId} className="flex items-center gap-3 py-2.5">
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
          <p className="flex items-start gap-2 text-[13px] text-muted"><Info size={15} className="mt-0.5 shrink-0" />whoever's stock has the higher percentage return wins. a $30 stock can beat a $900 one.</p>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="grid grid-cols-6 gap-1.5">
            {STAKE_PRESETS.map((v) => (
              <button key={v} onClick={() => setStakeChoice(v)} aria-pressed={stakeChoice === v}
                className={cx("display-cond num min-w-0 rounded-md border-2 py-2 text-[22px] font-bold transition", stakeChoice === v ? "border-ink bg-ink text-inverse" : "border-line hover:border-ink/40")}>{v}</button>
            ))}
            <button onClick={() => setStakeChoice("custom")} aria-pressed={stakeChoice === "custom"}
              className={cx("min-w-0 rounded-md border-2 py-2.5 text-[13px] font-bold transition", stakeChoice === "custom" ? "border-ink bg-ink text-inverse" : "border-line hover:border-ink/40")}>custom</button>
          </div>
          {stakeChoice === "custom" && (
            <div className="mt-2.5">
              <div className="relative">
                <input id="custom-stake" aria-label="your stake" className="input num scroll-mb-48 !pr-24 text-lg font-semibold" inputMode="decimal" enterKeyHint="done" autoComplete="off" autoFocus
                  placeholder="35.50" value={customStake} aria-invalid={!!customStake && !stakeCheck.ok} aria-describedby="custom-stake-hint"
                  onChange={(e) => setCustomStake(e.target.value.replace(",", ".").replace(/[^\d.]/g, "").slice(0, 12))}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">test usdc</span>
              </div>
              <p id="custom-stake-hint" className={cx("mt-1 text-xs", customStake && !stakeCheck.ok ? "text-loss" : "text-muted")}>
                {customStake && !stakeCheck.ok ? stakeCheck.error : `${formatUsdc(STAKE_MIN_UNITS)} to ${formatUsdc(STAKE_MAX_UNITS)} test usdc, up to 2 decimals`}
              </p>
            </div>
          )}
          <StakeBalance stakeUnits={stakeU} onStatus={setWallet} />
          <div className="mt-4 grid grid-cols-3 border-y-2 border-ink">
            {[["your stake", stakeLabel, false], [participants > 2 ? `each of ${participants - 1} friends` : "their stake", stakeLabel, false], ["prize pool", potLabel, true]].map(([k, v, pot], i) => (
              <div key={String(k)} className={cx("min-w-0 py-3", i > 0 && "border-l border-line pl-3")}>
                <p className="truncate text-[10.5px] font-semibold uppercase tracking-[.12em] text-muted">{k}</p>
                <p className={cx("num display-cond mt-1 truncate text-[30px] font-bold leading-none", pot && "text-brand-dark")}>{v}</p>
                <p className="mt-0.5 text-[11px] text-muted">test usdc</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-muted">everyone puts in the same stake and the winner takes the pool; a draw returns every stake. stakes are test usdc on base sepolia (no monetary value), held by the beef escrow.</p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2">
          <div role="radiogroup" aria-label="when does it end" className="space-y-2">
            {EXPIRATION_TYPES.map((t) => {
              const on = expiration === t;
              const end = t === "custom" ? (customDate && !customError ? customDate : null) : presetDeadline(t);
              return (
                <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setExpiration(t)}
                  className={cx("flex w-full items-start justify-between gap-3 rounded-md border-2 p-4 text-left transition", on ? "border-ink bg-surface" : "border-line hover:border-ink/40")}>
                  <div className="min-w-0">
                    <p className="font-semibold">{EXPIRATION_COPY[t].label}</p>
                    <p className="text-[13px] text-muted">{EXPIRATION_COPY[t].description}</p>
                    {end ? (
                      <p className="mt-1 text-[13px] font-medium text-ink-soft">
                        {t === "custom" ? "ends" : "ends (if accepted now)"} {etLabel(end)}
                        <span className="block text-[12px] font-normal text-muted">your time: {localLabel(end)}</span>
                      </p>
                    ) : t === "custom" && <p className="mt-1 text-[13px] text-muted">choose below</p>}
                  </div>
                  <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border-2", on ? "border-ink bg-ink text-inverse" : "border-ink/25")}>{on && <Check size={14} />}</span>
                </button>
              );
            })}
          </div>
          {expiration === "custom" && (
            <div className="card p-4">
              <label className="label" htmlFor="custom-deadline">deadline (your local time)</label>
              <input id="custom-deadline" type="datetime-local" className="input" value={customAt} onChange={(e) => setCustomAt(e.target.value)}
                aria-invalid={!!customAt && !!customError} aria-describedby="custom-deadline-hint" />
              <p id="custom-deadline-hint" className={cx("mt-1 text-xs", customAt && customError ? "text-loss" : "text-muted")}>
                {customAt && customError ? customError : customDate && !customError ? `${etLabel(customDate)} · ${localLabel(customDate)}` : "a trading day, during regular hours (9:30am–4:00pm et)"}
              </p>
            </div>
          )}
          <p className="text-[12px] text-muted">if accepted now, starting prices would lock at {etLabel(startIfNow)} ({localLabel(startIfNow)}).</p>
          <p className="flex items-start gap-2 border-l-[3px] border-ink/70 py-1 pl-3 text-[13px] text-ink-soft">
            <Info size={16} className="mt-0.5 shrink-0" />
            starting prices lock at the selected market open after both players accept. at the deadline, beef compares the latest valid chainlink feed prices using the same methodology. invalid or unavailable prices pause settlement.
          </p>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div className="divide-y border-y-2 border-ink">
            {[
              ["against", mode === "open" ? "open challenge · first to accept" : opponents.map((id) => `@${userById(id)?.username}`).join(", ")],
              ["you back", mine!],
              [mode === "group" ? "they back" : "they back", mode === "group" ? groupAssign.map((g) => `${g.ticker} (@${userById(g.userId)?.username})`).join(", ") : theirStocks[0]],
              ["your stake", `${stakeLabel} test usdc`],
              [participants > 2 ? "each friend's stake" : "their stake", `${stakeLabel} test usdc`],
              ["prize pool", `${potLabel} test usdc · winner takes all`],
              ["starts", `the next market open after acceptance (if accepted now: ${etLabel(startIfNow)})`],
              ["deadline", expiration === "custom" && deadline ? `${etLabel(new Date(deadline.deadline))} · your time ${localLabel(new Date(deadline.deadline))}` : `${EXPIRATION_COPY[expiration].label} (if accepted now: ${deadline ? etLabel(new Date(deadline.deadline)) : "—"})`],
              ["prices lock", "first chainlink feed update at or after the start"],
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
            <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="text-sm text-ink-soft">i agree to these terms. once everyone's in they can't be changed. stakes are <b>test usdc on base sepolia</b>, stock prices come from chainlink data streams, and this is entertainment, not investment advice.</span>
          </label>
        </div>
      )}

      {/* footer */}
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-5 border-t border-line bg-bg pb-2 pt-3 lg:bottom-0">
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
