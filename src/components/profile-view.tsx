"use client";

import { ThemeSelector } from "@/components/theme-controls";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LogOut, Pencil, Settings, Share2, Swords, Download } from "lucide-react";
import type { User } from "@/lib/types";
import { signOut, useBeef } from "@/lib/store/store";
import { achievementsFor, correctPicks, rivalsOf, statsFor, useMounted } from "@/lib/hooks";
import { cx } from "@/lib/format";
import { Avatar, CardSkeleton, SimBadge, Tabs, TickerTag, useAction, Sheet } from "@/components/ui";
import { DuelCard } from "@/components/duel-card";
import { FollowButton, PostCard, UserRow } from "@/components/social";
import { shareLink } from "@/components/share";
import { useDailyResults } from "@/components/daily-beef";
import { IOSGuide, useInstall } from "@/components/install-prompt";
import { useRouter } from "next/navigation";

type Tab = "activity" | "duels" | "rivalries" | "badges";

export function ProfileView({ user }: { user: User }) {
  const s = useBeef();
  const mounted = useMounted();
  const router = useRouter();
  const run = useAction();
  const isMe = s.session.userId === user.id;
  const [tab, setTab] = useState<Tab>("activity");
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [settings, setSettings] = useState(false);
  const [iosGuide, setIosGuide] = useState(false);
  const install = useInstall();
  const daily = useDailyResults();

  const st = useMemo(() => statsFor(s, user.id), [s, user.id]);
  const badges = useMemo(() => achievementsFor(s, user.id, correctPicks(s, user.id, daily)), [s, user.id, daily]);
  const rivals = useMemo(() => rivalsOf(s, user.id), [s, user.id]);
  const duels = s.duels.filter((d) => d.participants.some((p) => p.userId === user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const posts = s.posts.filter((p) => p.authorId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const followers = s.follows.filter((f) => f.followeeId === user.id).map((f) => f.followerId);
  const following = s.follows.filter((f) => f.followerId === user.id).map((f) => f.followeeId);

  if (!mounted) return <CardSkeleton />;

  return (
    <div>
      {/* masthead: a person, not an account summary */}
      <div className="border-b-2 border-ink pb-5">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">@{user.username}</p>
            <h1 className="mt-1 font-display text-[38px] font-bold leading-[.95] tracking-[-0.045em]">{user.displayName}{user.verified && <span title="early member" className="ml-1 align-top text-[18px] text-brand">●</span>}</h1>
          </div>
          <Avatar user={user} size={72} />
        </div>
        {user.bio && <p className="mt-3 font-display text-[19px] font-medium leading-snug tracking-[-0.015em] text-ink-soft">“{user.bio}”</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <button onClick={() => setList("followers")} className="hover:underline"><b className="num">{followers.length}</b> <span className="text-muted">followers</span></button>
          <button onClick={() => setList("following")} className="hover:underline"><b className="num">{following.length}</b> <span className="text-muted">following</span></button>
          {user.favoriteStocks.length > 0 && (
            <span className="flex items-center gap-2"><span className="text-muted">rides with</span>{user.favoriteStocks.map((t) => <Link key={t} href={`/stock/${t}`} className="display-cond text-[16px] font-bold hover:text-brand-dark">{t}</Link>)}</span>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {isMe ? (
            <>
              <Link href="/profile/edit" className="btn-outline btn-sm flex-1"><Pencil size={15} /> edit profile</Link>
              <button className="btn-ghost btn-sm !px-3" aria-label="share profile" onClick={() => shareLink(`/u/${user.username}?ref=${user.username}`, `follow me on beef. let's settle some arguments.`)}><Share2 size={16} /></button>
              <button className="btn-ghost btn-sm !px-3" aria-label="settings" onClick={() => setSettings(true)}><Settings size={16} /></button>
            </>
          ) : (
            <>
              <div className="flex-1 [&>button]:w-full"><FollowButton userId={user.id} small /></div>
              <Link href={`/duel/new?vs=${user.id}`} className="btn-primary btn-sm flex-1"><Swords size={15} /> challenge</Link>
              <button className="btn-ghost btn-sm !px-3" aria-label="share profile" onClick={() => shareLink(`/u/${user.username}`, `${user.displayName} on beef`)}><Share2 size={16} /></button>
            </>
          )}
        </div>
      </div>

      {/* the record, printed like a box score */}
      <div className="grid grid-cols-4 border-b border-line">
        {[
          ["beef score", String(st.score), "reputation"],
          ["record", `${st.wins}–${st.losses}${st.draws ? `–${st.draws}` : ""}`, st.completed ? `${st.winRate.toFixed(0)}% wins` : "no results"],
          ["played", String(st.completed), `${st.active} live`],
          ["streak", String(st.bestStreak), st.streak > 0 ? `${st.streak} now` : "best"],
        ].map(([k, v, sub], i) => (
          <div key={k} className={cx("min-w-0 py-3.5", i > 0 && "border-l border-line pl-3")}>
            <p className="truncate text-[10.5px] font-semibold uppercase tracking-[.12em] text-muted">{k}</p>
            <p className="num display-cond mt-1 truncate text-[30px] font-bold leading-none">{v}</p>
            <p className="num mt-1 truncate text-[11px] text-muted">{sub}</p>
          </div>
        ))}
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} className="mb-4 mt-6" options={[{ value: "activity", label: "activity" }, { value: "duels", label: "duels" }, { value: "rivalries", label: "rivalries" }, { value: "badges", label: `badges ${badges.filter((b) => b.unlocked).length}/${badges.length}` }]} />

      {tab === "activity" && (posts.length ? <div className="-mt-2">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div> : <p className="py-8 text-center text-sm text-muted">no posts yet.</p>)}
      {tab === "duels" && (duels.length ? <div className="grid gap-3 sm:grid-cols-2">{duels.map((d) => <DuelCard key={d.id} d={d} compact />)}</div> : <p className="py-8 text-center text-sm text-muted">no duels yet.</p>)}
      {tab === "rivalries" && (
        rivals.length ? (
          <div className="divide-y border-y border-line">
            {rivals.map((r) => {
              const o = s.users.find((u) => u.id === r.opponentId)!;
              return (
                <Link key={r.opponentId} href={`/rivalry/${o.username}${isMe ? "" : `?a=${user.username}`}`} className="flex items-center gap-3 py-3 hover:bg-ink/[.03]">
                  <Avatar user={o} size={40} />
                  <div className="min-w-0 flex-1"><p className="font-semibold">vs {o.displayName}</p><p className="text-[13px] text-muted">{r.duels.length} duels{r.streak.count > 1 ? ` · ${r.streak.who === "me" ? user.displayName.split(" ")[0] : o.displayName.split(" ")[0]} won ${r.streak.count} straight` : ""}</p></div>
                  <p className="num display-cond text-[28px] font-bold leading-none">{r.wins}<span className="mx-0.5 text-faint">–</span>{r.losses}{r.draws ? `–${r.draws}` : ""}</p>
                </Link>
              );
            })}
          </div>
        ) : <p className="py-8 text-center text-sm text-muted">no rivalries yet. challenge someone twice and it's official.</p>
      )}
      {tab === "badges" && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
          {badges.map((b) => (
            <div key={b.id} className={cx("rounded-md border border-dashed border-ink/25 p-3 text-center", b.unlocked ? "border-solid border-ink/70" : "opacity-45 grayscale")} title={b.description}>
              <p className="text-3xl">{b.emoji}</p>
              <p className="mt-1 text-sm font-semibold">{b.name}</p>
              <p className="text-[11px] leading-tight text-muted">{b.description}</p>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!list} onClose={() => setList(null)} title={list ?? ""}>
        {(list === "followers" ? followers : following).map((id) => <UserRow key={id} userId={id} />)}
        {(list === "followers" ? followers : following).length === 0 && <p className="text-sm text-muted">nobody yet.</p>}
      </Sheet>

      <Sheet open={settings} onClose={() => setSettings(false)} title="settings">
        <div className="space-y-2">
          <p className="text-sm text-muted">signed in as {s.session.email}</p>
          <div className="pb-2">
            <p className="label">appearance</p>
            <ThemeSelector />
            <p className="mt-1 text-xs text-muted">system follows your device. your choice is saved to your account.</p>
          </div>
          <button className="btn-ghost w-full justify-start border-b border-line !rounded-none" onClick={() => shareLink(`/?ref=${user.username}`, "i'm on beef: friendly stock duels with friends. join me and let's settle an argument.")}><Share2 size={17} /> invite friends</button>
          {!install.installed && (
            <button className="btn-ghost w-full justify-start border-b border-line !rounded-none" onClick={async () => { if (install.canPrompt) await install.prompt(); else setIosGuide(true); }}>
              <Download size={17} /> install beef on this device
            </button>
          )}
          <Link href="/wallet" className="btn-ghost w-full justify-start border-b border-line !rounded-none">wallet & test usdc</Link>
          <Link href="/rules" className="btn-ghost w-full justify-start border-b border-line !rounded-none">how beef works & risk disclosure</Link>
          <button className="btn-ghost w-full justify-start border-b border-line !rounded-none text-loss" onClick={() => run(async () => { await signOut(); setSettings(false); router.push("/"); }, "signed out")}><LogOut size={17} /> sign out</button>
          <div className="pt-2"><SimBadge label="base sepolia testnet · test usdc" /></div>
        </div>
      </Sheet>
      <Sheet open={iosGuide} onClose={() => setIosGuide(false)} title="add beef to your home screen"><IOSGuide /></Sheet>
    </div>
  );
}


