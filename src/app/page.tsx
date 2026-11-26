"use client";

import { deadlineLine } from "@/lib/expiration";
import { fmtStake} from "@/lib/stake";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Swords, Users } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { useMe, userById } from "@/lib/hooks";
import { canAccept, isParticipant, trendingTickers } from "@/lib/derive";
import { dailyMatchup } from "@/lib/daily";
import { Welcome } from "@/components/welcome";
import { shareLink } from "@/components/share";
import { Avatar, EmptyState, Section, SourceBadge, Tabs } from "@/components/ui";
import { Composer } from "@/components/composer";
import { PostCard, UserRow } from "@/components/social";
import { DuelCard } from "@/components/duel-card";
import { TrendingStrip } from "@/components/right-rail";
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
    <div className="border-y border-ink/80 py-5">
      <p className="kicker">start a beef</p>
      <p className="mt-1.5 font-display text-[28px] font-bold leading-[1.02] tracking-[-0.035em]">think your stock<br />beats theirs?</p>
      <p className="mt-2 text-[14px] text-muted">pick two stocks, set a stake, let the market decide.</p>
      <Link href={signedIn ? "/duel/new" : "/auth/sign-in"} className="btn-primary mt-4 w-full"><Swords size={18} /> start a beef</Link>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-muted">quick picks</span>
        {ideas.map(([a, b]) => (
          <Link key={a + b} href={signedIn ? `/duel/new?mine=${a}&theirs=${b}` : "/auth/sign-in"} className="display-cond text-[17px] font-bold hover:text-brand-dark">
            {a}<span className="mx-1 font-normal text-brand">/</span>{b}
          </Link>
        ))}
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

  return (
    <div>
      <div className="mb-5">
        <p className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted" suppressHydrationWarning>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toLowerCase()}</p>
        <h1 className="mt-1 font-display text-[32px] font-bold leading-none tracking-[-0.04em]">{me ? `hey, ${me.displayName.split(" ")[0]}.` : "welcome to beef"}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{me ? "here's what your friends are arguing about." : "stock duels with friends. browse freely, sign in to play."}</p>
      </div>

      {/* 1. the primary action */}
      <div className="mb-7"><StartBeefCard signedIn={!!me} /></div>

      {/* things that need an answer come first */}
      {invites.length > 0 && (
        <Section title={`needs your answer · ${invites.length}`}>
          <div className="space-y-2">
            {invites.map((d) => {
              const by = userById(s, d.createdBy);
              return (
                <Link key={d.id} href={`/duel/${d.id}`} className="relative flex items-center gap-3 border-y border-line bg-brand-soft/50 py-3 pl-4 pr-3">
                  <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" aria-hidden />
                  <Avatar user={by} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]"><b>{by?.displayName}</b> challenged you</p>
                    <p className="truncate text-[13px] text-ink-soft">{d.participants.map((p) => p.ticker).join(" vs ")} · {fmtStake(d.stake)} test usdc each · ends {deadlineLine(d)}</p>
                  </div>
                  <span className="btn-dark btn-sm shrink-0">view</span>
                </Link>
              );
            })}
          </div>
        </Section>
      )}

      {/* 2. the social feed (3. live beefs sit at its top) */}
      <Tabs<Feed> value={tab} onChange={(v) => { setTab(v); setLimit(10); }} className="mb-3"
        options={[{ value: "foryou", label: "for you" }, { value: "following", label: "following" }, { value: "duels", label: "duels" }]} />

      {tab !== "following" && liveBeefs.length > 0 && (
        <Section title={myLive.length ? "your live beefs" : "live now"} action={<Link href="/duel" className="text-sm font-semibold text-brand-dark">all duels</Link>}>
          <div className="space-y-3">
            {liveBeefs.slice(0, 3).map((d) => <DuelCard key={d.id} d={d} compact />)}
          </div>
        </Section>
      )}

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
            <p className="py-8 text-center font-display text-[15px] italic text-faint">that's everything. go start something.</p>
          )}
        </div>
      )}
      <Link href="/rules" className="mt-4 flex items-center justify-center gap-1 text-xs text-muted">how beef works · chainlink prices, test usdc on base sepolia <ArrowRight size={12} /></Link>
    </div>
  );
}
