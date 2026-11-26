"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BarChart3, Swords } from "lucide-react";
import { getAsset } from "@/lib/market/assets";
import { useBeef } from "@/lib/store/store";
import { useQuotes } from "@/lib/hooks";
import { EmptyState, QuoteLine, Section, Skeleton, SourceBadge } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";
import { PostCard } from "@/components/social";

export default function StockPage() {
  const { ticker: raw } = useParams<{ ticker: string }>();
  const ticker = raw.toUpperCase();
  const asset = getAsset(ticker);
  const s = useBeef();
  const { quotes, loading } = useQuotes(asset ? [ticker] : []);

  if (!asset) return <EmptyState icon={<BarChart3 size={22} />} title={`${ticker} isn't supported yet`} body="beef supports a curated list of us stocks." action={<Link href="/discover" className="btn-dark btn-sm">browse stocks</Link>} />;

  const q = quotes[ticker];
  const posts = s.posts.filter((p) => p.tickers.includes(ticker)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const duels = s.duels.filter((d) => d.participants.some((p) => p.ticker === ticker) && d.visibility === "public");
  const fans = s.users.filter((u) => u.favoriteStocks.includes(ticker)).length;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] text-muted">{asset.name} · {asset.sector}</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">{ticker}</h1>
        </div>
        <SourceBadge />
      </div>
      <div className="card p-4">
        {q ? <QuoteLine q={q} big /> : loading ? <Skeleton className="h-12 w-40" /> : <p className="text-sm text-loss">price unavailable</p>}
        {q?.reason && q.status !== "live" && <p className="mt-1 text-xs text-muted">{q.reason}</p>}
        <p className="mt-2 text-xs text-muted">
          price: the mid from chainlink data streams' 24/5 {ticker} streams (regular, extended or overnight, chosen by chainlink's market status).
          {q?.streamId && <> stream <span className="font-mono">{q.streamId.slice(0, 10)}…{q.streamId.slice(-6)}</span>.</>}
        </p>
        <div className="mt-4 flex gap-2">
          <Link href={`/duel/new?mine=${ticker}`} className="btn-primary btn-sm flex-1"><Swords size={15} /> back {ticker} in a duel</Link>
        </div>
        <p className="mt-3 text-[13px] text-muted">{fans} people have {ticker} as a favourite · {duels.length} duels</p>
      </div>
      {duels.length > 0 && <Section title="duels" className="mt-6"><div className="grid gap-3 sm:grid-cols-2">{duels.slice(0, 4).map((d) => <DuelCard key={d.id} d={d} compact />)}</div></Section>}
      <Section title="discussion" className="mt-6">
        {posts.length ? <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div> : <p className="text-sm text-muted">no one's talking about {ticker} yet.</p>}
      </Section>
    </div>
  );
}
