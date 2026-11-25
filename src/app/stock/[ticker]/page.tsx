"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Swords } from "lucide-react";
import { getAsset } from "@/lib/market/assets";
import { useBeef } from "@/lib/store/store";
import { useQuotes } from "@/lib/hooks";
import { marketTime, price } from "@/lib/format";
import { EmptyState, Pct, Section, SimBadge, Skeleton } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";
import { PostCard } from "@/components/social";

function Sparkline({ rows }: { rows: { session: string; close: number }[] }) {
  if (rows.length < 2) return null;
  const w = 600, h = 140, pad = 6;
  const vals = rows.map((r) => r.close);
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i: number) => pad + (i / (rows.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const up = vals.at(-1)! >= vals[0];
  const d = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.close).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label={`30 session closing prices, ${up ? "up" : "down"} overall`}>
      <path d={d} fill="none" stroke={up ? "#11915A" : "#D33F49"} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export default function StockPage() {
  const { ticker: raw } = useParams<{ ticker: string }>();
  const ticker = raw.toUpperCase();
  const asset = getAsset(ticker);
  const s = useBeef();
  const { quotes, loading } = useQuotes(asset ? [ticker] : []);
  const [hist, setHist] = useState<{ session: string; close: number }[] | null>(null);
  useEffect(() => {
    if (!asset) return;
    fetch(`/api/market/history?ticker=${ticker}`).then((r) => r.json()).then((j) => setHist(j.rows ?? [])).catch(() => setHist([]));
  }, [asset, ticker]);

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
        <SimBadge />
      </div>
      <div className="card p-4">
        {q ? (
          <>
            <p className="num font-display text-3xl font-bold">{price(q.price)}</p>
            <p className="mt-0.5 text-sm"><Pct v={q.changePct} /> <span className="text-muted">{q.marketOpen ? "today · simulated, updating" : `at close · ${marketTime(q.asOf)}`}</span></p>
          </>
        ) : loading ? <Skeleton className="h-12 w-40" /> : <p className="text-sm text-loss">price unavailable</p>}
        <div className="mt-3">{hist ? <Sparkline rows={hist} /> : <Skeleton className="h-36 w-full" />}</div>
        <p className="mt-1 text-xs text-muted">last 30 days of simulated closing prices. not live market data.</p>
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
