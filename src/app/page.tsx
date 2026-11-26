"use client";

import { deadlineLine } from "@/lib/expiration";
import { fmtStake} from "@/lib/stake";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Swords, Users } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { livePerformance, useMe, useNow, useQuotes, userById } from "@/lib/hooks";
import { countdown, cx } from "@/lib/format";
import type { Duel } from "@/lib/types";
import { canAccept, isParticipant, trendingTickers } from "@/lib/derive";
import { dailyMatchup } from "@/lib/daily";
import { Welcome } from "@/components/welcome";
import { shareLink } from "@/components/share";
import { Avatar, EmptyState, Section, SourceBadge, Tabs } from "@/components/ui";
import { Composer } from "@/components/composer";
import { PostCard, UserRow } from "@/components/social";
import { DuelCard } from "@/components/duel-card";
import { TickerTape, TrendingStrip } from "@/components/right-rail";
import { DailyBeefCard } from "@/components/daily-beef";

type Feed = "foryou" | "following" | "duels";

function StartBeefCard({ signedIn }: { signedIn: boolean }) {
  const s = useBeef();
  // quick matchups: the two most talked-about stocks, plus today's beef of the day
  const ideas = useMemo(() => {
    const t = trendingTickers(s, 4).map((x) => x.ticker);
    const today = new Date().toISOString().slice(0, 10);
    const out: [string, string][] = [];
    if (t[0] && t[1]) out.push([t[0], t[1]]);
    if (t[2] && t[3]) out.push([t[2], t[3]]);
    out.push(dailyMatchup(today));
    return out.filter((p, i, a) => a.findIndex((q) => q.join() === p.join()) === i).slice(0, 3);
  }, [s]);
  return (
    <div className="slab -mx-4 px-4 py-5 lg:mx-0">
      <p className="meta muted-s">start a beef</p>
      <p className="cond mt-2 text-[46px] leading-[.84]">call your<br />shot.</p>
      <div className="mt-4 grid grid-cols-3 border-2 border-slab-text/80">
        {ideas.map(([a, b], i) => (
          <Link key={a + b} href={signedIn ? `/duel/new?mine=${a}&theirs=${b}` : "/auth/sign-in"} className={cx("cond px-2 py-2.5 text-center text-[19px] transition hover:bg-brand hover:text-[rgb(18_17_16)]", i > 0 && "border-l-2 border-slab-text/80")}>
            {a}<span className="mx-0.5 text-brand">/</span>{b}
          </Link>
        ))}
      </div>
      <Link href={signedIn ? "/duel/new" : "/auth/sign-in"} className="btn-primary mt-3 w-full"><Swords size={18} /> pick a fight</Link>
    </div>
  );
}

/** the lead story: a headline written from the biggest live beef, never invented */
function LeadStory({ d, meId }: { d: Duel; meId?: string }) {
  const s = useBeef();
  const now = useNow(60_000);
  const { quotes } = useQuotes(d.status === "active" ? d.participants.map((p) => p.ticker) : []);
  const perf = livePerformance(d, quotes);
  const name = (id: string) => { const u = userById(s, id); return u ? (u.id === meId ? "you" : u.displayName.split(" ")[0]) : "someone"; };
  const sorted = [...perf].sort((a, b) => (b.ret ?? -1e9) - (a.ret ?? -1e9));
  const [lead, next] = sorted;
  let head: string; let dek: string;
  if (d.status === "active" && lead?.ret != null && next?.ret != null) {
    const gap = lead.ret - next.ret;
    if (Math.abs(gap) < 0.005) { head = `dead even: ${name(lead.userId)} and ${name(next.userId)}.`; dek = `${lead.ticker} and ${next.ticker} are level with ${countdown(d.deadline, now)} to go.`; }
    else { head = `${name(lead.userId)} ${name(lead.userId) === "you" ? "are" : "is"} up ${gap.toFixed(2)} on ${name(next.userId)}.`; dek = `${lead.ticker} leads ${next.ticker} with ${countdown(d.deadline, now)} to go.`; }
  } else if (d.status === "accepted") {
    head = `${perf.map((p) => name(p.userId)).join(" vs ")}. locked in.`; dek = `starting prices lock at the next market open.`;
  } else {
    head = `${perf.map((p) => p.ticker).join(" vs ")} is on.`; dek = `${countdown(d.deadline, now)} to go.`;
  }
  return (
    <div>
      <p className="kicker">{d.participants.some((p) => p.userId === meId) ? "your lead story" : "the big one"}</p>
      <h2 className="cond mt-1.5 text-[50px] leading-[.84]">{head}</h2>
      <p className="serif mt-2 text-[18px] leading-snug text-ink-soft">{dek}</p>
      <div className="mt-4"><DuelCard d={d} /></div>
    </div>
  );
}

/** other live beefs as a compact score strip */
function OnTheBoard({ duels }: { duels: Duel[] }) {
  const s = useBeef();
  const { quotes } = useQuotes([...new Set(duels.flatMap((d) => d.participants.map((p) => p.ticker)))]);
  if (!duels.length) return null;
  return (
    <div>
      <p className="section-title rule-title mb-2">on the board</p>
      <div className="no-scrollbar -mx-4 flex overflow-x-auto px-4">
        <div className="flex border-2 border-ink">
          {duels.map((d, i) => {
            const perf = livePerformance(d, quotes);
            const top = Math.max(...perf.map((p) => p.ret ?? -Infinity));
            return (
              <Link key={d.id} href={`/duel/${d.id}`} className={cx("w-[148px] shrink-0 px-3 py-2 hover:bg-ink/[.06]", i > 0 && "border-l-2 border-ink")}>
                {perf.slice(0, 2).map((p) => (
                  <p key={p.ticker} className={cx("flex items-baseline justify-between gap-2", p.ret === top && d.status === "active" ? "text-ink" : "text-muted")}>
                    <span className="cond text-[20px]">{p.ticker}</span>
                    <span className="num text-[12px] font-bold">{p.ret == null ? "—" : `${p.ret > 0 ? "+" : ""}${p.ret.toFixed(2)}`}</span>
                  </p>
                ))}
                <p className="meta mt-1 truncate text-muted">{perf.map((p) => userById(s, p.userId)?.displayName.split(" ")[0] ?? "open").join(" v ")}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const s = useBeef();
  const me = useMe();
  const [tab, setTab] = useState<Feed>("foryou");
  const [limit, setLimit] = useState(10);

  const following = useMemo(() => new Set(s.follows.filter((f) => f.followerId === me?.id).map((f) => f.followeeId)), [s.follows, me?.id]);
  const invites = s.duels.filter((d) => canAccept(d, me?.id ?? null) && !d.open);
  const myLive = s.duels.filter((d) => isParticipant(d, me?.id ?? null) && ["active", "accepted"].includes(d.status));
  const liveBeefs = (myLive.length ? myLive : s.duels.filter((d) => d.status === "active" && d.visibility === "public"))
    .sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 6);

  const posts = useMemo(() => {
    let list = [...s.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (tab === "following") list = list.filter((p) => following.has(p.authorId) || p.authorId === me?.id);
    if (tab === "duels") list = list.filter((p) => p.duelId);
    return list;
  }, [s.posts, tab, following, me?.id]);

  // real people only: ranked by followers and recent posts, excluding who you follow
  const suggestions = useMemo(() => {
    const weekAgo = Date.now() - 7 * 864e5;
    const score = (id: string) => s.follows.filter((f) => f.followeeId === id).length * 2 + s.posts.filter((p) => p.authorId === id && Date.parse(p.createdAt) > weekAgo).length;
    return s.users.filter((u) => u.id !== me?.id && !following.has(u.id)).sort((a, b) => score(b.id) - score(a.id)).slice(0, 3);
  }, [s.users, s.follows, s.posts, me?.id, following]);
  const invite = () => me && shareLink(`/?ref=${me.username}`, `i'm on beef: friendly stock duels with friends. join me and let's settle an argument.`);

  if (!me) return <Welcome />;
  const lead = liveBeefs.find((d) => d.status === "active") ?? liveBeefs[0];
  const board = liveBeefs.filter((d) => d.id !== lead?.id);

  return (
    <div>
      <TickerTape className="-mx-4 -mt-4 mb-5 lg:-mt-8" />
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="meta text-muted" suppressHydrationWarning>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
          <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em]">hey, {me.displayName.split(" ")[0]}.</h1>
        </div>
        <Link href="/duel" className="meta font-bold underline decoration-2 underline-offset-4">all duels</Link>
      </div>

      {/* things that need an answer come first */}
      {invites.map((d) => {
        const by = userById(s, d.createdBy);
        return (
          <Link key={d.id} href={`/duel/${d.id}`} className="field -mx-4 mb-5 flex items-center gap-3 px-4 py-3 lg:mx-0">
            <Avatar user={by} size={40} />
            <div className="min-w-0 flex-1">
              <p className="cond truncate text-[26px] leading-[.9]">{by?.displayName.split(" ")[0]} called you out</p>
              <p className="meta mt-1 truncate">{d.participants.map((p) => p.ticker).join(" vs ")} · {fmtStake(d.stake)} each · {deadlineLine(d)}</p>
            </div>
            <span className="btn-dark btn-sm shrink-0">answer</span>
          </Link>
        );
      })}

      {lead ? <div className="mb-6"><LeadStory d={lead} meId={me.id} /></div> : null}
      {board.length > 0 && <div className="mb-7"><OnTheBoard duels={board} /></div>}
      <div className="mb-7"><StartBeefCard signedIn={!!me} /></div>

      {/* 2. the social feed (3. live beefs sit at its top) */}
      <p className="cond mb-2 text-[34px]">the timeline</p>
      <Tabs<Feed> value={tab} onChange={(v) => { setTab(v); setLimit(10); }} className="mb-1"
        options={[{ value: "foryou", label: "for you" }, { value: "following", label: "following" }, { value: "duels", label: "duels" }]} />

      {tab === "foryou" && <div className="mb-1"><Composer /></div>}

      {posts.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title="your feed is looking quiet."
          body="find friends or invite someone to start your first beef."
          action={<div className="flex gap-2"><Link href="/discover" className="btn-dark btn-sm">find friends</Link><button className="btn-outline btn-sm" onClick={invite}>invite someone</button></div>} />
      ) : (
        <div>
          {posts.slice(0, limit).map((p, i) => (
            <div key={p.id}>
              <PostCard post={p} />
              {/* 4. trending + 5. suggested people, inline on mobile (the desktop rail shows them) */}
              {tab === "foryou" && i === 1 && (
                <div className="py-5 xl:hidden">
                  <div className="mb-2 flex items-center justify-between gap-3"><h2 className="section-title">trending stocks</h2><SourceBadge /></div>
                  <TrendingStrip />
                </div>
              )}
              {tab === "foryou" && i === 2 && following.size < 3 && (
                <div className="flex items-center gap-3 border-b border-line py-4">
                  <div className="min-w-0 flex-1"><p className="font-semibold">beef is better with friends</p><p className="text-[13px] text-muted">send your invite link. it brings them straight to beef.</p></div>
                  <button className="btn-dark btn-sm shrink-0" onClick={invite}>invite</button>
                </div>
              )}
              {tab === "foryou" && i === 4 && suggestions.length > 0 && (
                <div className="border-b border-line py-4 xl:hidden">
                  <p className="section-title rule-title">people to follow</p>
                  {suggestions.map((u) => <UserRow key={u.id} userId={u.id} sub={`@${u.username} · into ${u.favoriteStocks.slice(0, 2).join(", ")}`} />)}
                </div>
              )}
              {tab === "foryou" && i === 7 && <div className="py-4 xl:hidden"><DailyBeefCard /></div>}
            </div>
          ))}
          {posts.length > limit ? (
            <button className="btn-outline mt-4 w-full" onClick={() => setLimit((l) => l + 10)}>show more</button>
          ) : (
            <p className="serif py-8 text-center text-[17px] text-muted">that's everything. go start something.</p>
          )}
        </div>
      )}
      <Link href="/rules" className="mt-4 flex items-center justify-center gap-1 text-xs text-muted">how beef works · chainlink prices, test usdc on base sepolia <ArrowRight size={12} /></Link>
    </div>
  );
}
