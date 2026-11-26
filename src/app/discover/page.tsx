"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { ASSETS } from "@/lib/market/assets";
import { statsFor, useMounted } from "@/lib/hooks";
import { Avatar, Section, SourceBadge, Tabs } from "@/components/ui";
import { cx } from "@/lib/format";
import { DuelCard } from "@/components/duel-card";
import { PostCard, UserRow } from "@/components/social";
import { StockGrid } from "@/components/right-rail";
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
  const rivalries = useMemo(() => {
    const m = new Map<string, { key: string; a: string; b: string; wa: number; wb: number; total: number; last: string }>();
    for (const d of s.duels) {
      if (d.status !== "completed" || !d.settlement || d.participants.length !== 2) continue;
      const [x, y] = d.participants.map((p) => p.userId).sort();
      if (!x || !y) continue;
      const k = `${x}:${y}`;
      const r = m.get(k) ?? { key: k, a: x, b: y, wa: 0, wb: 0, total: 0, last: "" };
      r.total++;
      if (d.settlement.status !== "draw") { if (d.settlement.winners.includes(x)) r.wa++; else if (d.settlement.winners.includes(y)) r.wb++; }
      if (d.settlement.settledAt > r.last) r.last = d.settlement.settledAt;
      m.set(k, r);
    }
    return [...m.values()].sort((p, q) => q.total - p.total || q.last.localeCompare(p.last)).slice(0, 4)
      .map((r) => ({ ...r, a: s.users.find((u) => u.id === r.a)!, b: s.users.find((u) => u.id === r.b)! })).filter((r) => r.a && r.b);
  }, [s.duels, s.users]);
  const hotPosts = useMemo(() => {
    const score = (id: string) => s.reactions.filter((r) => r.targetId === id).length + 2 * s.comments.filter((c) => c.targetId === id).length;
    return [...s.posts].sort((a, b) => score(b.id) - score(a.id)).slice(0, 3);
  }, [s]);
  const publicDuels = s.duels.filter((d) => d.visibility === "public" && ["active", "pending"].includes(d.status)).slice(0, 4);

  const show = (f: Filter) => filter === "all" || filter === f;

  return (
    <div>
      <h1 className="cond text-[56px] leading-[.82]">find your<br />next beef.</h1>
      <div className="relative mb-4 mt-4">
        <Search size={20} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink" />
        <input className="input !border-b-[3px] !pl-8 !pr-10 !text-[19px] font-semibold" placeholder="people, $tickers, duels, communities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search" />
        {q && <button className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center hover:bg-ink/[.07]" onClick={() => setQ("")} aria-label="clear search"><X size={18} /></button>}
      </div>
      <Tabs<Filter> value={filter} onChange={setFilter} className="mb-5" options={[{ value: "all", label: "all" }, { value: "people", label: "people" }, { value: "stocks", label: "stocks" }, { value: "duels", label: "duels" }, { value: "communities", label: "communities" }]} />

      {results ? (
        <div>
          {show("people") && results.people.length > 0 && <Section title="people"><div className="divide-y">{results.people.slice(0, 8).map((u) => <UserRow key={u.id} userId={u.id} />)}</div></Section>}
          {show("stocks") && results.stocks.length > 0 && (
            <Section title="stocks">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {results.stocks.map((a) => <Link key={a.ticker} href={`/stock/${a.ticker}`} className="border-t-2 border-ink pt-2"><p className="display-cond text-[24px] font-bold leading-none">{a.ticker}</p><p className="truncate text-[13px] text-muted">{a.name}</p></Link>)}
              </div>
            </Section>
          )}
          {show("duels") && results.duels.length > 0 && <Section title="duels"><div className="grid gap-3 sm:grid-cols-2">{results.duels.slice(0, 6).map((d) => <DuelCard key={d.id} d={d} compact />)}</div></Section>}
          {show("communities") && results.communities.length > 0 && <Section title="communities"><CommunityList ids={results.communities.map((c) => c.id)} /></Section>}
          {Object.values(results).every((r) => r.length === 0) && <p className="py-10 text-center text-muted">nothing matches “{q}”. try a ticker like nvda.</p>}
        </div>
      ) : (
        <div>
          {show("people") && rivalries.length > 0 && (
            <Section title="rivalries heating up">
              <div className="divide-y divide-line border-b border-line">
                {rivalries.map((r) => (
                  <Link key={r.key} href={`/rivalry/${r.b.username}?a=${r.a.username}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 hover:bg-ink/[.05]">
                    <span className="flex"><Avatar user={r.a} size={30} /><span className="-ml-1.5 ring-2 ring-bg"><Avatar user={r.b} size={30} /></span></span>
                    <span className="min-w-0 truncate"><b>{r.a.displayName.split(" ")[0]}</b> <span className="serif text-muted">vs</span> <b>{r.b.displayName.split(" ")[0]}</b> <span className="meta text-muted">· {r.total} {r.total === 1 ? "duel" : "duels"}</span></span>
                    <span className="cond text-[30px]">{r.wa}<span className="text-brand">–</span>{r.wb}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}
          {show("people") && (
            <Section title="people to challenge">
              <div className="no-scrollbar -mx-4 flex overflow-x-auto px-4">
                <div className="flex border-2 border-ink">
                  {mounted && popular.map(({ u, score }, i) => (
                    <div key={u.id} className={cx("w-[132px] shrink-0 p-3", i > 0 && "border-l-2 border-ink")}>
                      <Link href={`/u/${u.username}`} className="block">
                        <Avatar user={u} size={44} />
                        <p className="cond mt-2 truncate text-[22px] leading-[.9]">{u.displayName}</p>
                        <p className="num mt-1 text-[11px] text-muted">{score} score</p>
                      </Link>
                      {u.id !== s.session.userId && <Link href={`/duel/new?vs=${u.id}`} className="meta mt-2 inline-block bg-brand px-1.5 py-0.5 font-bold text-[rgb(18_17_16)]">challenge</Link>}
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}
          {show("stocks") && (
            <Section title="stocks" action={<SourceBadge />}>
              <StockGrid limit={filter === "stocks" ? 7 : 6} />
            </Section>
          )}
          {show("duels") && (
            <Section title="open to watch" action={<Link href="/duel?tab=open" className="meta font-bold underline decoration-2 underline-offset-4">see all</Link>}>
              <div className="grid gap-3 sm:grid-cols-2">{publicDuels.map((d) => <DuelCard key={d.id} d={d} compact />)}</div>
            </Section>
          )}
          {filter === "all" && <div className="mb-9 xl:hidden"><DailyBeefCard /></div>}
          {show("communities") && (
            <Section title="communities" action={<Link href="/communities/new" className="meta font-bold underline decoration-2 underline-offset-4">create</Link>}>
              <CommunityList ids={s.communities.map((c) => c.id)} />
            </Section>
          )}
          {filter === "all" && <Section title="trending discussions"><div className="-mt-3">{hotPosts.map((p) => <PostCard key={p.id} post={p} />)}</div></Section>}
        </div>
      )}
    </div>
  );
}
