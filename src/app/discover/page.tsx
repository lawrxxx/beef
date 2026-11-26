"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { ASSETS } from "@/lib/market/assets";
import { statsFor, useMounted } from "@/lib/hooks";
import { PageHeader, Section, SourceBadge, Tabs } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";
import { PostCard, UserRow } from "@/components/social";
import { TrendingList } from "@/components/right-rail";
import { DailyBeefCard } from "@/components/daily-beef";
import { CommunityList } from "@/components/community-list";

type Filter = "all" | "people" | "stocks" | "duels" | "communities";

export default function DiscoverPage() {
  const s = useBeef();
  const mounted = useMounted();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const query = q.trim().toLowerCase().replace(/^[$@]/, "");

  const results = useMemo(() => {
    if (!query) return null;
    return {
      people: s.users.filter((u) => u.username.includes(query) || u.displayName.toLowerCase().includes(query)),
      stocks: ASSETS.filter((a) => a.ticker.toLowerCase().includes(query) || a.name.toLowerCase().includes(query)),
      duels: s.duels.filter((d) => d.visibility === "public" && (d.participants.some((p) => p.ticker.toLowerCase().includes(query)) || d.title?.toLowerCase().includes(query))),
      communities: s.communities.filter((c) => c.name.includes(query) || c.description.includes(query) || c.tickers.some((t) => t.toLowerCase().includes(query))),
    };
  }, [query, s.users, s.duels, s.communities]);

  const popular = useMemo(
    () => s.users.filter((u) => u.id !== s.session.userId).map((u) => ({ u, followers: s.follows.filter((f) => f.followeeId === u.id).length, score: statsFor(s, u.id).score })).sort((a, b) => b.score - a.score).slice(0, 5),
    [s],
  );
  const hotPosts = useMemo(() => {
    const score = (id: string) => s.reactions.filter((r) => r.targetId === id).length + 2 * s.comments.filter((c) => c.targetId === id).length;
    return [...s.posts].sort((a, b) => score(b.id) - score(a.id)).slice(0, 3);
  }, [s]);
  const publicDuels = s.duels.filter((d) => d.visibility === "public" && ["active", "pending"].includes(d.status)).slice(0, 4);

  const show = (f: Filter) => filter === "all" || filter === f;

  return (
    <div>
      <PageHeader title="discover" subtitle="find your next beef" />
      <div className="relative mb-3">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input !rounded-full !pl-10 !pr-10" placeholder="search people, $tickers, duels, communities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search" />
        {q && <button className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-black/5" onClick={() => setQ("")} aria-label="clear search"><X size={16} /></button>}
      </div>
      <Tabs<Filter> value={filter} onChange={setFilter} className="mb-5" options={[{ value: "all", label: "all" }, { value: "people", label: "people" }, { value: "stocks", label: "stocks" }, { value: "duels", label: "duels" }, { value: "communities", label: "communities" }]} />

      {results ? (
        <div>
          {show("people") && results.people.length > 0 && <Section title="people"><div className="card px-4 py-1">{results.people.slice(0, 8).map((u) => <UserRow key={u.id} userId={u.id} />)}</div></Section>}
          {show("stocks") && results.stocks.length > 0 && (
            <Section title="stocks">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {results.stocks.map((a) => <Link key={a.ticker} href={`/stock/${a.ticker}`} className="card p-3"><p className="font-bold">{a.ticker}</p><p className="truncate text-[13px] text-muted">{a.name}</p></Link>)}
              </div>
            </Section>
          )}
          {show("duels") && results.duels.length > 0 && <Section title="duels"><div className="grid gap-3 sm:grid-cols-2">{results.duels.slice(0, 6).map((d) => <DuelCard key={d.id} d={d} compact />)}</div></Section>}
          {show("communities") && results.communities.length > 0 && <Section title="communities"><CommunityList ids={results.communities.map((c) => c.id)} /></Section>}
          {Object.values(results).every((r) => r.length === 0) && <p className="py-10 text-center text-muted">nothing matches “{q}”. try a ticker like nvda.</p>}
        </div>
      ) : (
        <div>
          {filter === "all" && <div className="mb-6 xl:hidden"><DailyBeefCard /></div>}
          {show("stocks") && <Section title="trending stocks" action={<SourceBadge />}><TrendingList limit={filter === "stocks" ? 10 : 5} /></Section>}
          {show("duels") && (
            <Section title="public duels" action={<Link href="/duel?tab=open" className="text-sm font-semibold text-brand-dark">see all</Link>}>
              <div className="grid gap-3 sm:grid-cols-2">{publicDuels.map((d) => <DuelCard key={d.id} d={d} compact />)}</div>
            </Section>
          )}
          {show("people") && (
            <Section title="popular on beef">
              <div className="card px-4 py-1">{mounted && popular.map(({ u, score, followers }) => <UserRow key={u.id} userId={u.id} sub={`@${u.username} · ${score} beef score · ${followers} followers`} />)}</div>
            </Section>
          )}
          {show("communities") && (
            <Section title="communities" action={<Link href="/communities/new" className="text-sm font-semibold text-brand-dark">create</Link>}>
              <CommunityList ids={s.communities.map((c) => c.id)} />
            </Section>
          )}
          {filter === "all" && <Section title="trending discussions"><div className="space-y-3">{hotPosts.map((p) => <PostCard key={p.id} post={p} />)}</div></Section>}
        </div>
      )}
    </div>
  );
}
