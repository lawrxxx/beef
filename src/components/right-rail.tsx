"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useBeef } from "@/lib/store/store";
import { trendingTickers } from "@/lib/derive";
import { useQuotes } from "@/lib/hooks";
import { QuoteLine, SourceBadge } from "@/components/ui";
import { cx } from "@/lib/format";
import { DailyBeefCard } from "@/components/daily-beef";
import { UserRow } from "@/components/social";

export function TrendingList({ limit = 6 }: { limit?: number }) {
  const s = useBeef();
  const trending = useMemo(() => trendingTickers(s, limit), [s, limit]);
  const { quotes, loading, error } = useQuotes(trending.map((t) => t.ticker));
  return (
    <div className="divide-y border-y border-line">
      {error && <p className="p-3 text-sm text-loss">prices unavailable right now</p>}
      {trending.map(({ ticker, mentions }, i) => (
        <Link key={ticker} href={`/stock/${ticker}`} className="flex items-center gap-3 py-2.5 hover:bg-ink/[.03]">
          <span className="display-cond num w-5 text-[15px] font-bold text-faint">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="display-cond text-[20px] font-bold leading-tight">{ticker}</p>
            <p className="text-xs text-muted">{mentions} mentions & duels</p>
          </div>
          <div className="text-right">
            {quotes[ticker] ? <QuoteLine q={quotes[ticker]} className="items-end" /> : loading ? <div className="skeleton h-8 w-16" /> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function RightRail() {
  const s = useBeef();
  const me = s.session.userId;
  const suggestions = s.users
    .filter((u) => u.id !== me && !s.follows.some((f) => f.followerId === me && f.followeeId === u.id))
    .sort((a, b) => s.follows.filter((f) => f.followeeId === b.id).length - s.follows.filter((f) => f.followeeId === a.id).length)
    .slice(0, 3);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[320px] shrink-0 space-y-5 overflow-y-auto px-5 py-8 xl:block">
      <DailyBeefCard compact />
      <div>
        <div className="mb-2 flex items-center justify-between gap-3"><h2 className="section-title rule-title flex-1">trending</h2><SourceBadge /></div>
        <TrendingList limit={5} />
      </div>
      {suggestions.length > 0 && (
        <div>
          <h2 className="section-title rule-title mb-1">people to follow</h2>
          <div className="divide-y">{suggestions.map((u) => <UserRow key={u.id} userId={u.id} />)}</div>
        </div>
      )}
      <p className="px-1 text-xs leading-relaxed text-faint">
        beef runs on base sepolia with test usdc, which has no monetary value. stock prices come from chainlink data feeds. nothing here is financial advice.{" "}
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
    <div className="no-scrollbar -mx-4 flex overflow-x-auto border-y border-ink/80 px-4">
      {trending.map(({ ticker }, i) => (
        <Link key={ticker} href={`/stock/${ticker}`} className={cx("shrink-0 py-2.5 pr-4", i > 0 && "border-l border-line pl-4")}>
          <p className="display-cond text-[19px] font-bold leading-tight">{ticker}</p>
          <QuoteLine q={quotes[ticker]} />
        </Link>
      ))}
    </div>
  );
}

/** the red ticker tape: real chainlink feed prices for the most talked-about stocks */
export function TickerTape({ className }: { className?: string }) {
  const s = useBeef();
  const tickers = useMemo(() => {
    const t = trendingTickers(s, 7).map((x) => x.ticker);
    for (const x of ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "GOOGL", "META"]) if (!t.includes(x)) t.push(x);
    return t.slice(0, 7);
  }, [s]);
  const { quotes } = useQuotes(tickers);
  const items = tickers.map((t) => ({ t, p: quotes[t]?.price != null ? Number(quotes[t]!.price) : null }));
  if (!items.some((i) => i.p != null)) return null;
  const run = (k: string) => (
    <span className="flex shrink-0" key={k}>
      {items.map(({ t, p }) => (
        <Link key={t} href={`/stock/${t}`} className="num mr-6 text-[11.5px] font-bold">{t} {p != null ? p.toFixed(2) : "—"}</Link>
      ))}
      <span className="meta mr-6 text-[10px] font-bold opacity-70">chainlink feeds</span>
    </span>
  );
  return (
    <div className={cx("overflow-hidden whitespace-nowrap bg-brand py-1.5 text-[rgb(18_17_16)]", className)} aria-label="stock prices">
      <div className="tape-run">{run("a")}{run("b")}</div>
    </div>
  );
}

/** stocks as type: a grid of big tickers with mono prices */
export function StockGrid({ limit = 6 }: { limit?: number }) {
  const s = useBeef();
  const list = useMemo(() => {
    const t = trendingTickers(s, limit).map((x) => x.ticker);
    for (const x of ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "GOOGL", "META"]) if (t.length < limit && !t.includes(x)) t.push(x);
    return t;
  }, [s, limit]);
  const { quotes } = useQuotes(list);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
      {list.map((t) => (
        <Link key={t} href={`/stock/${t}`} className="group border-t-[3px] border-ink pt-1.5">
          <p className="cond text-[44px] leading-[.85] group-hover:text-brand-dark">{t}</p>
          <QuoteLine q={quotes[t]} className="mt-1" />
        </Link>
      ))}
    </div>
  );
}
