"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useBeef } from "@/lib/store/store";
import { trendingTickers } from "@/lib/derive";
import { useQuotes } from "@/lib/hooks";
import { price } from "@/lib/format";
import { Pct, SimBadge } from "@/components/ui";
import { DailyBeefCard } from "@/components/daily-beef";
import { UserRow } from "@/components/social";

export function TrendingList({ limit = 6 }: { limit?: number }) {
  const s = useBeef();
  const trending = useMemo(() => trendingTickers(s, limit), [s, limit]);
  const { quotes, loading, error } = useQuotes(trending.map((t) => t.ticker));
  return (
    <div className="card divide-y">
      {error && <p className="p-3 text-sm text-loss">prices unavailable right now</p>}
      {trending.map(({ ticker, mentions }, i) => (
        <Link key={ticker} href={`/stock/${ticker}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[.02]">
          <span className="num w-4 text-sm text-faint">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">{ticker}</p>
            <p className="text-xs text-muted">{mentions} mentions & duels</p>
          </div>
          <div className="text-right">
            {quotes[ticker] ? <><p className="num text-sm font-semibold">{price(quotes[ticker].price)}</p><Pct v={quotes[ticker].changePct} className="text-xs" /></> : loading ? <div className="skeleton h-8 w-16" /> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function RightRail() {
  const s = useBeef();
  const me = s.session.userId;
  const suggestions = s.users.filter((u) => u.id !== me && !s.follows.some((f) => f.followerId === me && f.followeeId === u.id)).slice(0, 3);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[320px] shrink-0 space-y-5 overflow-y-auto px-5 py-8 xl:block">
      <DailyBeefCard compact />
      <div>
        <div className="mb-2 flex items-center justify-between"><h2 className="section-title">trending</h2><SimBadge /></div>
        <TrendingList limit={5} />
      </div>
      {suggestions.length > 0 && (
        <div>
          <h2 className="section-title mb-2">people to follow</h2>
          <div className="card px-4 py-1">{suggestions.map((u) => <UserRow key={u.id} userId={u.id} />)}</div>
        </div>
      )}
      <p className="px-1 text-xs leading-relaxed text-faint">
        beef is a demo. prices are simulated and stakes use practice balances. nothing here is financial advice.{" "}
        <Link href="/rules" className="underline">how beef works</Link>
      </p>
    </aside>
  );
}

/** compact horizontal trending row for mobile feeds */
export function TrendingStrip() {
  const s = useBeef();
  const trending = useMemo(() => trendingTickers(s, 8), [s]);
  const { quotes } = useQuotes(trending.map((t) => t.ticker));
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {trending.map(({ ticker }) => (
        <Link key={ticker} href={`/stock/${ticker}`} className="card shrink-0 px-3.5 py-2.5">
          <p className="text-sm font-bold">{ticker}</p>
          {quotes[ticker] ? <Pct v={quotes[ticker].changePct} className="text-[12px]" /> : <span className="skeleton mt-1 block h-3 w-12" />}
        </Link>
      ))}
    </div>
  );
}
