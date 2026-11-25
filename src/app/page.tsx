"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Plus, Swords, Users } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { useMe, useMounted, userById } from "@/lib/hooks";
import { canAccept } from "@/lib/derive";
import { usd } from "@/lib/format";
import { Avatar, CardSkeleton, EmptyState, Section, SimBadge, Tabs } from "@/components/ui";
import { Composer } from "@/components/composer";
import { PostCard, UserRow } from "@/components/social";
import { DuelCard } from "@/components/duel-card";
import { DailyBeefCard } from "@/components/daily-beef";

type Feed = "foryou" | "following" | "duels";

export default function HomePage() {
  const s = useBeef();
  const me = useMe();
  const mounted = useMounted();
  const [tab, setTab] = useState<Feed>("foryou");
  const [limit, setLimit] = useState(10);

  const following = useMemo(() => new Set(s.follows.filter((f) => f.followerId === me?.id).map((f) => f.followeeId)), [s.follows, me?.id]);
  const invites = s.duels.filter((d) => canAccept(d, me?.id ?? null) && !d.open);
  const live = s.duels.filter((d) => d.status === "active").slice(0, 6);
  const featured = s.duels.find((d) => d.featured && d.status === "active");

  const posts = useMemo(() => {
    let list = [...s.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (tab === "following") list = list.filter((p) => following.has(p.authorId) || p.authorId === me?.id);
    if (tab === "duels") list = list.filter((p) => p.duelId);
    return list;
  }, [s.posts, tab, following, me?.id]);

  const suggestions = s.users.filter((u) => u.id !== me?.id && !following.has(u.id)).slice(0, 3);
  const popularCommunities = [...s.communities].sort((a, b) => s.memberships.filter((m) => m.communityId === b.id).length - s.memberships.filter((m) => m.communityId === a.id).length).slice(0, 3);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-bold tracking-tight">{me ? `hey, ${me.displayName.split(" ")[0]}` : "welcome to beef"}</h1>
          <p className="text-[15px] text-muted">{me ? "here's what your friends are arguing about." : "stock duels with friends. browse freely, sign in to play."}</p>
        </div>
        <Link href="/duel/new" className="btn-primary btn-sm shrink-0 lg:hidden"><Plus size={16} /> beef</Link>
      </div>

      {!me && (
        <div className="card mb-5 flex flex-col gap-3 bg-ink p-5 text-white sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-display text-lg font-bold">think your stock beats theirs?</p>
            <p className="text-sm text-white/70">pick two stocks, set a stake, and see who's right by the deadline.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/auth/sign-up" className="btn bg-white text-ink hover:bg-white/90 btn-sm">create account</Link>
            <Link href="/auth/sign-in" className="btn border border-white/30 text-white btn-sm">try the demo</Link>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <div className="mb-5 space-y-2">
          {invites.map((d) => {
            const by = userById(s, d.createdBy);
            return (
              <Link key={d.id} href={`/duel/${d.id}`} className="card flex items-center gap-3 border-brand/30 bg-brand-soft/50 p-3.5">
                <Avatar user={by} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px]"><b>{by?.displayName}</b> challenged you</p>
                  <p className="text-[13px] text-ink-soft">{d.participants.map((p) => p.ticker).join(" vs ")} · {usd(d.stake, 0)} each · {d.deadlineLabel}</p>
                </div>
                <span className="btn-dark btn-sm">view</span>
              </Link>
            );
          })}
        </div>
      )}

      <Tabs<Feed> value={tab} onChange={(v) => { setTab(v); setLimit(10); }} options={[{ value: "foryou", label: "for you" }, { value: "following", label: "following" }, { value: "duels", label: "duels" }]} className="mb-4" />

      {tab === "foryou" && (
        <>
          <div className="mb-5"><Composer /></div>
          {live.length > 0 && (
            <Section title="live now" action={<Link href="/duel?tab=live" className="text-sm font-semibold text-brand-dark">see all</Link>}>
              <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
                {live.map((d) => <div key={d.id} className="w-[300px] shrink-0 snap-start"><DuelCard d={d} compact /></div>)}
              </div>
            </Section>
          )}
          <div className="mb-6 xl:hidden"><DailyBeefCard /></div>
        </>
      )}

      {!mounted ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : posts.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title={tab === "following" ? "your following feed is quiet" : "nothing here yet"} body={tab === "following" ? "follow a few people to fill it up." : "be the first to post a take."} action={<Link href="/discover" className="btn-dark btn-sm">find people</Link>} />
      ) : (
        <div className="space-y-3">
          {posts.slice(0, limit).map((p, i) => (
            <div key={p.id} className="space-y-3">
              <PostCard post={p} />
              {tab === "foryou" && i === 2 && suggestions.length > 0 && (
                <div className="card px-4 py-2">
                  <p className="section-title pt-2">suggested for you</p>
                  {suggestions.map((u) => <UserRow key={u.id} userId={u.id} sub={`@${u.username} · likes ${u.favoriteStocks.slice(0, 2).join(", ")}`} />)}
                </div>
              )}
              {tab === "foryou" && i === 5 && featured && (
                <div>
                  <p className="section-title mb-2 flex items-center gap-1.5"><Swords size={13} /> featured challenge</p>
                  <DuelCard d={featured} />
                </div>
              )}
              {tab === "foryou" && i === 7 && (
                <div className="card p-4">
                  <p className="section-title mb-2">popular communities</p>
                  <div className="space-y-1">
                    {popularCommunities.map((c) => (
                      <Link key={c.id} href={`/communities/${c.slug}`} className="-mx-2 flex items-center gap-3 rounded-xl p-2 hover:bg-black/[.03]">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/[.04] text-xl">{c.emoji}</span>
                        <div className="min-w-0 flex-1"><p className="font-semibold">{c.name}</p><p className="truncate text-[13px] text-muted">{c.description}</p></div>
                        <ArrowRight size={16} className="text-faint" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {posts.length > limit ? (
            <button className="btn-outline w-full" onClick={() => setLimit((l) => l + 10)}>show more</button>
          ) : (
            <p className="py-6 text-center text-sm text-faint">you're all caught up 🥩</p>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-center lg:hidden"><SimBadge label="demo · simulated prices & practice money" /></div>
    </div>
  );
}
