"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { markAllRead, markRead, useBeef } from "@/lib/store/store";
import { useMounted, userById } from "@/lib/hooks";
import { cx, timeAgo } from "@/lib/format";
import { Avatar, CardSkeleton, EmptyState, PageHeader, Tabs } from "@/components/ui";

const ICON: Record<string, string> = { duel_invite: "⚔️", duel_accepted: "🤝", duel_declined: "🙅", duel_completed: "🏁", duel_active: "🟢", comment: "💬", reaction: "🔥", follow: "👋", rivalry: "🥊", community: "👥", achievement: "🏅" };

export default function NotificationsPage() {
  const s = useBeef();
  const mounted = useMounted();
  const [tab, setTab] = useState<"all" | "unread">("all");
  if (!mounted) return <CardSkeleton />;
  if (!s.session.userId) return <EmptyState icon={<Bell size={22} />} title="sign in to see notifications" action={<Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>} />;
  const list = s.notifications.filter((n) => n.userId === s.session.userId && (tab === "all" || !n.read)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = s.notifications.filter((n) => n.userId === s.session.userId && !n.read).length;
  return (
    <div>
      <PageHeader title="notifications" subtitle={unread ? `${unread} unread` : "you're all caught up"} action={unread ? <button className="btn-outline btn-sm" onClick={markAllRead}><Check size={15} /> mark all read</button> : undefined} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "all", label: "all" }, { value: "unread", label: "unread" }]} className="mb-4" />
      {list.length === 0 ? <EmptyState icon={<Bell size={22} />} title="nothing new" body="invites, results and replies will show up here." /> : (
        <ul className="card divide-y overflow-hidden">
          {list.map((n) => {
            const actor = n.actorId ? userById(s, n.actorId) : undefined;
            return (
              <li key={n.id}>
                <Link href={n.href} onClick={() => markRead(n.id)} className={cx("flex items-start gap-3 px-4 py-3.5 hover:bg-ink/[.02]", !n.read && "bg-brand-soft/40")}>
                  <div className="relative">
                    {actor ? <Avatar user={actor} size={40} /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/[.05] text-lg">{ICON[n.kind]}</span>}
                    {actor && <span className="absolute -bottom-1 -right-1 text-sm">{ICON[n.kind]}</span>}
                  </div>
                  <p className="min-w-0 flex-1 text-[15px] leading-snug">{actor && <b>{actor.displayName} </b>}{n.text}<span className="block text-[13px] text-muted">{timeAgo(n.createdAt)}</span></p>
                  {!n.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label="unread" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
