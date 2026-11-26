"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Flame, Swords } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { rivalry, useMounted } from "@/lib/hooks";
import { Avatar, CardSkeleton, EmptyState } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";

function RivalryInner() {
  const { username } = useParams<{ username: string }>();
  const sp = useSearchParams();
  const s = useBeef();
  const mounted = useMounted();
  if (!mounted) return <CardSkeleton />;
  const them = s.users.find((u) => u.username === username);
  const a = sp.get("a") ? s.users.find((u) => u.username === sp.get("a")) : s.users.find((u) => u.id === s.session.userId);
  if (!them || !a) return <EmptyState icon={<Swords size={22} />} title="rivalry not found" action={<Link href="/" className="btn-dark btn-sm">home</Link>} />;
  const r = rivalry(s, a.id, them.id);
  const isMe = a.id === s.session.userId;
  const my = r.duels[0]?.participants.find((p) => p.userId === a.id)?.ticker;
  const their = r.duels[0]?.participants.find((p) => p.userId === them.id)?.ticker;

  return (
    <div>
      <Link href={`/u/${them.username}`} className="btn-ghost btn-sm -ml-2 mb-2 !px-2"><ArrowLeft size={18} /> @{them.username}</Link>
      <div className="card p-6 text-center">
        <p className="section-title">rivalry</p>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center"><Avatar user={a} size={64} /><p className="mt-2 font-semibold">{isMe ? "you" : a.displayName}</p></div>
          <p className="num display-cond text-[64px] font-bold leading-none">{r.wins}<span className="mx-1 text-brand">–</span>{r.losses}</p>
          <div className="flex flex-col items-center"><Avatar user={them} size={64} /><p className="mt-2 font-semibold">{them.displayName}</p></div>
        </div>
        <p className="mt-3 text-sm text-muted">{r.duels.length} total duels · {r.draws} draws</p>
        {r.streak.count > 0 && (
          <p className="mt-2 inline-flex items-center gap-1 border-y border-brand px-1 py-0.5 text-sm font-semibold text-brand-dark">
            <Flame size={14} /> {r.streak.who === "me" ? (isMe ? "you've" : `${a.displayName} has`) : `${them.displayName} has`} won {r.streak.count} in a row
          </p>
        )}
        {isMe && (
          <Link href={`/duel/new?vs=${them.id}${my && their ? `&mine=${my}&theirs=${their}` : ""}`} className="btn-primary mt-5 w-full"><Swords size={17} /> {r.duels.length ? "rematch" : "start the rivalry"}</Link>
        )}
      </div>
      <h2 className="section-title mb-2 mt-6">recent results</h2>
      {r.duels.length ? <div className="grid gap-3 sm:grid-cols-2">{r.duels.map((d) => <DuelCard key={d.id} d={d} compact />)}</div> : <p className="text-sm text-muted">no duels yet.</p>}
    </div>
  );
}

export default function RivalryPage() {
  return <Suspense><RivalryInner /></Suspense>;
}
