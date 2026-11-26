"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Swords, Users } from "lucide-react";
import { toggleMembership, useBeef } from "@/lib/store/store";
import { statsFor, useMounted } from "@/lib/hooks";
import { Avatar, CardSkeleton, EmptyState, Tabs, TickerTag, useAction } from "@/components/ui";
import { Composer } from "@/components/composer";
import { PostCard, UserRow } from "@/components/social";
import { DuelCard } from "@/components/duel-card";

type Tab = "feed" | "challenges" | "leaderboard" | "members";

export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const s = useBeef();
  const mounted = useMounted();
  const router = useRouter();
  const run = useAction();
  const [tab, setTab] = useState<Tab>("feed");
  const c = s.communities.find((x) => x.slug === slug);
  const members = useMemo(() => (c ? s.memberships.filter((m) => m.communityId === c.id).map((m) => m.userId) : []), [s.memberships, c]);
  const board = useMemo(() => members.map((id) => ({ id, st: statsFor(s, id) })).sort((a, b) => b.st.score - a.st.score), [members, s]);
  if (!mounted) return <CardSkeleton />;
  if (!c) return <EmptyState icon={<Users size={22} />} title="community not found" action={<Link href="/communities" className="btn-dark btn-sm">browse communities</Link>} />;

  const joined = members.includes(s.session.userId ?? "");
  const posts = s.posts.filter((p) => p.communityId === c.id || (p.tickers.some((t) => c.tickers.includes(t)) && members.includes(p.authorId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const duels = s.duels.filter((d) => d.communityId === c.id || (d.visibility === "public" && d.participants.every((p) => c.tickers.includes(p.ticker))));

  return (
    <div>
      <Link href="/communities" className="btn-ghost btn-sm -ml-2 mb-2 !px-2"><ArrowLeft size={18} /> communities</Link>
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-ink/[.04] text-4xl">{c.emoji}</span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold">{c.name}</h1>
            <p className="text-sm text-muted">{members.length} members</p>
          </div>
        </div>
        <p className="mt-3 text-[15px] text-ink-soft">{c.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{c.tickers.map((t) => <TickerTag key={t} t={t} />)}</div>
        <div className="mt-4 flex gap-2">
          <button className={joined ? "btn-outline btn-sm flex-1" : "btn-dark btn-sm flex-1"} onClick={() => { if (!s.session.userId) return router.push("/auth/sign-in"); run(() => toggleMembership(c.id), joined ? "left community" : `welcome to ${c.name}`); }}>{joined ? "joined ✓" : "join"}</button>
          <Link href={`/duel/new?mine=${c.tickers[0]}&theirs=${c.tickers[1] ?? ""}`} className="btn-primary btn-sm flex-1"><Swords size={15} /> challenge</Link>
        </div>
        <div className="mt-4 flex -space-x-2">{members.slice(0, 8).map((id) => <Avatar key={id} user={s.users.find((u) => u.id === id)} size={30} ring />)}</div>
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} className="mb-4 mt-5" options={[{ value: "feed", label: "discussion" }, { value: "challenges", label: "challenges" }, { value: "leaderboard", label: "leaderboard" }, { value: "members", label: "members" }]} />
      {tab === "feed" && (
        <div className="space-y-3">
          {joined && <Composer communityId={c.id} />}
          {posts.length ? posts.map((p) => <PostCard key={p.id} post={p} />) : <p className="py-6 text-center text-sm text-muted">no posts yet. start the conversation.</p>}
        </div>
      )}
      {tab === "challenges" && (duels.length ? <div className="grid gap-3 sm:grid-cols-2">{duels.map((d) => <DuelCard key={d.id} d={d} compact />)}</div> : <p className="py-6 text-center text-sm text-muted">no challenges yet.</p>)}
      {tab === "leaderboard" && (
        <div className="card divide-y">
          {board.map(({ id, st }, i) => {
            const u = s.users.find((x) => x.id === id)!;
            return (
              <Link key={id} href={`/u/${u.username}`} className="flex items-center gap-3 px-4 py-3">
                <span className="num w-6 text-center font-bold text-faint">{i + 1}</span>
                <Avatar user={u} size={36} />
                <p className="flex-1 truncate font-semibold">{u.displayName}</p>
                <p className="num font-display font-bold">{st.score}</p>
              </Link>
            );
          })}
        </div>
      )}
      {tab === "members" && <div className="card px-4 py-1">{members.map((id) => <UserRow key={id} userId={id} />)}</div>}
    </div>
  );
}
