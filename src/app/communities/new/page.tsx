"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createCommunity } from "@/lib/store/store";
import { ASSETS } from "@/lib/market/assets";
import { useMe, useMounted } from "@/lib/hooks";
import { cx } from "@/lib/format";
import { CardSkeleton, EmptyState, useAction } from "@/components/ui";

const EMOJIS = ["💬", "📈", "🤖", "🔬", "🐢", "🐸", "💻", "🏦", "⚡", "🛒", "🎮", "🌍"];

export default function NewCommunityPage() {
  const me = useMe();
  const mounted = useMounted();
  const router = useRouter();
  const run = useAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("💬");
  const [tickers, setTickers] = useState<string[]>([]);
  if (!mounted) return <CardSkeleton />;
  if (!me) return <EmptyState icon="🔒" title="sign in to create a community" action={<Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>} />;
  return (
    <div className="mx-auto max-w-lg">
      <Link href="/communities" className="btn-ghost btn-sm -ml-2 mb-2 !px-2"><ArrowLeft size={18} /> communities</Link>
      <h1 className="mb-4 font-display text-2xl font-bold">create a community</h1>
      <form className="card space-y-5 p-5" onSubmit={async (e) => {
        e.preventDefault();
        const c = await run(() => createCommunity({ name, description, emoji, tickers }), "community created");
        if (c) router.push(`/communities/${c.slug}`);
      }}>
        <div><label className="label" htmlFor="cn">name</label><input id="cn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. ev stocks" required /></div>
        <div><label className="label" htmlFor="cd">what's it about?</label><textarea id="cd" className="input min-h-[84px] resize-none" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></div>
        <div><p className="label">icon</p><div className="flex flex-wrap gap-1.5">{EMOJIS.map((x) => <button type="button" key={x} onClick={() => setEmoji(x)} className={cx("flex h-10 w-10 items-center justify-center rounded-md text-xl", emoji === x ? "ring-2 ring-ink" : "bg-ink/[.04]")}>{x}</button>)}</div></div>
        <div><p className="label">focus stocks</p><div className="flex flex-wrap gap-1.5">{ASSETS.map((a) => { const on = tickers.includes(a.ticker); return <button type="button" key={a.ticker} className={cx("chip", on && "chip-active")} onClick={() => setTickers(on ? tickers.filter((t) => t !== a.ticker) : [...tickers, a.ticker].slice(0, 8))}>{a.ticker}</button>; })}</div></div>
        <button className="btn-primary w-full" disabled={name.trim().length < 3}>create</button>
      </form>
    </div>
  );
}
