"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MessageCircle, Send, Share2, Swords, Trash2 } from "lucide-react";
import type { Post, ReactionKind } from "@/lib/types";
import { addComment, deleteComment, toggleFollow, toggleReaction, useBeef } from "@/lib/store/store";
import { useMe, userById } from "@/lib/hooks";
import { cx } from "@/lib/format";
import { Ago, Avatar, TickerTag, UserLink, useAction } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";
import { shareLink } from "@/components/share";

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "fire", emoji: "🔥", label: "fire" },
  { kind: "bull", emoji: "🐂", label: "bullish" },
  { kind: "bear", emoji: "🐻", label: "bearish" },
  { kind: "laugh", emoji: "😂", label: "funny" },
  { kind: "clap", emoji: "👏", label: "respect" },
];

export function ReactionBar({ targetType, targetId }: { targetType: "post" | "duel"; targetId: string }) {
  const s = useBeef();
  const run = useAction();
  const router = useRouter();
  const list = s.reactions.filter((r) => r.targetType === targetType && r.targetId === targetId);
  const mine = list.find((r) => r.userId === s.session.userId)?.kind;
  return (
    <div className="-ml-1.5 flex flex-wrap gap-0.5">
      {REACTIONS.map((r) => {
        const n = list.filter((x) => x.kind === r.kind).length;
        return (
          <button
            key={r.kind}
            aria-label={`${r.label}${n ? `, ${n}` : ""}`}
            aria-pressed={mine === r.kind}
            onClick={(e) => {
              e.preventDefault();
              if (!s.session.userId) return router.push("/auth/sign-in");
              run(() => toggleReaction(targetType, targetId, r.kind));
            }}
            className={cx(
              "inline-flex h-8 min-w-8 items-center justify-center gap-1 px-1.5 text-[13px] transition active:scale-95",
              mine === r.kind ? "bg-ink/[.08] font-semibold" : "opacity-80 grayscale-[.35] hover:bg-ink/[.05] hover:opacity-100 hover:grayscale-0",
            )}
          >
            <span aria-hidden>{r.emoji}</span>
            {n > 0 && <span className="num text-[12px] font-bold text-ink-soft">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Comments({ targetType, targetId, autoFocus }: { targetType: "post" | "duel"; targetId: string; autoFocus?: boolean }) {
  const s = useBeef();
  const me = useMe();
  const run = useAction();
  const [text, setText] = useState("");
  const list = s.comments.filter((c) => c.targetType === targetType && c.targetId === targetId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <div>
      {list.length === 0 && <p className="py-3 text-sm text-muted">no comments yet. start the trash talk (nicely).</p>}
      <ul className="divide-y">
        {list.map((c) => {
          const u = userById(s, c.authorId);
          return (
            <li key={c.id} className="flex gap-3 py-3">
              <Avatar user={u} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><UserLink user={u} /> <span className="text-muted">· <Ago iso={c.createdAt} /></span></p>
                <p className="break-words text-[15px] text-ink-soft">{c.body}</p>
              </div>
              {c.authorId === me?.id && (
                <button aria-label="delete comment" className="btn-ghost btn-sm !px-2 text-muted" onClick={() => run(() => deleteComment(c.id), "comment deleted")}><Trash2 size={15} /></button>
              )}
            </li>
          );
        })}
      </ul>
      {me ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => { addComment(targetType, targetId, text); return true; }); if (ok) setText(""); }}
        >
          <Avatar user={me} size={32} />
          <input className="input !py-2.5" value={text} onChange={(e) => setText(e.target.value)} placeholder="add a comment" maxLength={300} autoFocus={autoFocus} aria-label="comment" />
          <button className="btn-dark btn-sm !h-11 !w-11 !px-0" disabled={!text.trim()} aria-label="send"><Send size={16} /></button>
        </form>
      ) : (
        <Link href="/auth/sign-in" className="btn-outline btn-sm mt-2">sign in to comment</Link>
      )}
    </div>
  );
}

export function FollowButton({ userId, small }: { userId: string; small?: boolean }) {
  const s = useBeef();
  const run = useAction();
  const router = useRouter();
  const me = s.session.userId;
  if (me === userId) return null;
  const following = s.follows.some((f) => f.followerId === me && f.followeeId === userId);
  return (
    <button
      onClick={(e) => { e.preventDefault(); if (!me) return router.push("/auth/sign-in"); run(() => toggleFollow(userId)); }}
      className={cx(small ? (following ? "btn-ghost text-muted" : "btn-outline") : following ? "btn-outline" : "btn-dark", small && "btn-sm")}
      aria-pressed={following}
    >
      {following ? "following" : "follow"}
    </button>
  );
}

export function PostCard({ post }: { post: Post }) {
  const s = useBeef();
  const router = useRouter();
  const author = userById(s, post.authorId);
  const duel = post.duelId ? s.duels.find((d) => d.id === post.duelId) : undefined;
  const community = post.communityId ? s.communities.find((c) => c.id === post.communityId) : undefined;
  const comments = useMemo(() => s.comments.filter((c) => c.targetType === "post" && c.targetId === post.id).length, [s.comments, post.id]);
  const isMine = post.authorId === s.session.userId;

  const body = post.body.split(/(@[a-z0-9._]+)/g).map((part, i) => {
    if (part.startsWith("@")) {
      const u = s.users.find((x) => x.username === part.slice(1));
      return u ? <Link key={i} href={`/u/${u.username}`} className="font-semibold text-brand-dark hover:underline">{part}</Link> : part;
    }
    return part;
  });

  return (
    <article className="grid animate-fade-up grid-cols-[46px_1fr] gap-x-2 border-b border-line py-4">
      {/* the timeline gutter: when, in mono */}
      <div className="flex flex-col items-start gap-2 pt-0.5">
        <Link href={author ? `/u/${author.username}` : "#"}><Avatar user={author} size={34} /></Link>
        <span className="meta text-muted"><Ago iso={post.createdAt} /></span>
      </div>
      <div className="min-w-0">
        <header className="flex items-baseline gap-2">
          <p className="min-w-0 truncate text-[15px]"><UserLink user={author} className="font-bold" /> <span className="text-muted">@{author?.username}</span></p>
          {post.kind === "result" && <span className="meta ml-auto shrink-0 bg-ink px-1.5 font-bold text-inverse">final</span>}
          {post.kind === "opinion" && <span className="meta ml-auto shrink-0 bg-brand px-1.5 font-bold text-brand-ink">call</span>}
        </header>
        {community && <Link href={`/communities/${community.slug}`} className="meta text-muted hover:underline">{community.emoji} {community.name}</Link>}

        <Link href={`/post/${post.id}`} className="mt-1.5 block whitespace-pre-wrap break-words text-[16px] leading-[1.45] text-ink">{body}</Link>

        {post.prediction && (
          <div className="mt-3 border-y-2 border-ink py-2">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <Link href={`/stock/${post.prediction.pick}`} className="cond text-[40px] leading-[.8]">{post.prediction.pick}</Link>
              <span className="cond text-[30px] leading-[.8] text-brand">&gt;</span>
              <Link href={`/stock/${post.prediction.versus}`} className="cond text-[40px] leading-[.8] text-muted">{post.prediction.versus}</Link>
              <span className="meta mb-0.5 text-muted">{post.prediction.horizon}</span>
            </div>
            {!isMine && (
              <button
                className="btn-primary btn-sm mt-2.5"
                onClick={() => router.push(`/duel/new?mine=${post.prediction!.versus}&theirs=${post.prediction!.pick}&vs=${post.authorId}`)}
              >
                <Swords size={15} /> take the other side
              </button>
            )}
          </div>
        )}

        {duel && <div className="mt-3"><DuelCard d={duel} compact /></div>}

        {post.tickers.length > 0 && !post.prediction && (
          <div className="mt-2 flex flex-wrap gap-3">{post.tickers.slice(0, 4).map((t) => <TickerTag key={t} t={t} />)}</div>
        )}

        <footer className="mt-2 flex items-center justify-between gap-2">
          <ReactionBar targetType="post" targetId={post.id} />
          <div className="flex shrink-0 items-center">
            <Link href={`/post/${post.id}#comments`} className="btn-ghost btn-sm !min-h-8 !px-2 text-muted" aria-label={`${comments} comments`}>
              <MessageCircle size={16} /> <span className="num text-[12px]">{comments || ""}</span>
            </Link>
            <button className="btn-ghost btn-sm !min-h-8 !px-2 text-muted" aria-label="share" onClick={() => shareLink(`/post/${post.id}`, `${author?.displayName ?? "someone"} on beef: “${post.body.slice(0, 80)}”`)}>
              <Share2 size={16} />
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

export function UserRow({ userId, sub }: { userId: string; sub?: string }) {
  const s = useBeef();
  const u = userById(s, userId);
  if (!u) return null;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar user={u} size={38} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold">{u.displayName}</p>
          <p className="meta truncate text-muted">{sub ?? `@${u.username}`}</p>
        </div>
      </Link>
      <FollowButton userId={u.id} small />
    </div>
  );
}

