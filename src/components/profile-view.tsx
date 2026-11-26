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
  const weekRank = useMemo(() => {
    const since = Date.now() - 7 * 864e5;
    const scores = s.users.map((u) => ({ id: u.id, st: statsFor(s, u.id, since) })).filter((x) => x.st.completed > 0)
      .sort((a, b) => b.st.score - a.st.score || b.st.wins - a.st.wins);
    const i = scores.findIndex((x) => x.id === user.id);
    return i >= 0 ? i + 1 : null;
  }, [s, user.id]);
  const badges = useMemo(() => achievementsFor(s, user.id, correctPicks(s, user.id, daily)), [s, user.id, daily]);
  const rivals = useMemo(() => rivalsOf(s, user.id), [s, user.id]);
  const duels = s.duels.filter((d) => d.participants.some((p) => p.userId === user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const posts = s.posts.filter((p) => p.authorId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const followers = s.follows.filter((f) => f.followeeId === user.id).map((f) => f.followerId);
  const following = s.follows.filter((f) => f.followerId === user.id).map((f) => f.followeeId);

  if (!mounted) return <CardSkeleton />;

  return (
    <div>
      {/* the player card */}
      <div className="-mx-4 border-y-[3px] border-ink lg:mx-0 lg:border-[3px]">
        <div className="grid grid-cols-[112px_1fr] border-b-[3px] border-ink">
          <div className="flex items-center justify-center overflow-hidden border-r-[3px] border-ink" style={{ background: user.avatarColor ?? "rgb(var(--sunken))" }}>
            {user.avatar?.startsWith("data:") || user.avatar?.startsWith("http") ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : <span className="text-[60px]">{user.avatar ?? "👤"}</span>}
          </div>
          <div className="min-w-0 px-3 py-3">
            <p className="meta text-muted">@{user.username}{weekRank ? ` · #${weekRank} this week` : ""}</p>
            <h1 className="cond mt-1.5 break-words text-[44px] leading-[.84]">{user.displayName}{user.verified && <span title="early member" className="ml-1 align-top text-[16px] text-brand">●</span>}</h1>
          </div>
        </div>
        <div className="grid grid-cols-[1.25fr_1fr_1fr]">
          <div className="slab px-3 py-3"><p className="meta muted-s">beef score</p><p className="cond mt-1 text-[56px] leading-[.8]">{st.score}</p></div>
          <div className="border-r-2 border-ink px-3 py-3"><p className="meta text-muted">record</p><p className="cond mt-1 text-[44px] leading-[.8]">{st.wins}–{st.losses}{st.draws ? `–${st.draws}` : ""}</p><p className="num mt-1 text-[11px] text-muted">{st.completed ? `${st.winRate.toFixed(0)}% wins` : "no results"}</p></div>
          <div className="px-3 py-3"><p className="meta text-muted">streak</p><p className="cond mt-1 text-[44px] leading-[.8]">{st.streak}</p><p className="num mt-1 text-[11px] text-muted">best {st.bestStreak}</p></div>
        </div>
      </div>

      <div className="mt-4">
        {user.bio && <p className="serif text-[21px] leading-snug">“{user.bio}”</p>}
        {user.favoriteStocks.length > 0 && (
          <div className="mt-3"><p className="meta text-muted">plays</p><p className="mt-1 flex flex-wrap gap-x-3">{user.favoriteStocks.map((t) => <Link key={t} href={`/stock/${t}`} className="cond text-[28px] hover:text-brand-dark">{t}</Link>)}</p></div>
        )}
        <div className="meta mt-3 flex gap-4">
          <button onClick={() => setList("followers")} className="font-bold hover:underline"><span className="num text-[13px]">{followers.length}</span> followers</button>
          <button onClick={() => setList("following")} className="font-bold hover:underline"><span className="num text-[13px]">{following.length}</span> following</button>
          <span className="text-muted"><span className="num text-[13px]">{st.active}</span> live</span>
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
              <Link href={`/duel/new?vs=${user.id}`} className="btn-primary btn-sm flex-1"><Swords size={15} /> challenge</Link>
              <div className="flex-1 [&>button]:w-full"><FollowButton userId={user.id} small /></div>
              <button className="btn-ghost btn-sm !px-3" aria-label="share profile" onClick={() => shareLink(`/u/${user.username}`, `${user.displayName} on beef`)}><Share2 size={16} /></button>
            </>
          )}
        </div>
      </div>

      {rivals.some((r) => r.wins + r.losses + r.draws > 0) && (
        <div className="mt-7">
          <p className="section-title rule-title mb-1">head to head</p>
          {rivals.filter((r) => r.wins + r.losses + r.draws > 0).slice(0, 3).map((r) => {
            const o = s.users.find((u) => u.id === r.opponentId)!;
            return (
              <Link key={r.opponentId} href={`/rivalry/${o.username}${isMe ? "" : `?a=${user.username}`}`} className="flex items-center gap-3 border-b border-line py-2.5 hover:bg-ink/[.05]">
                <Avatar user={o} size={30} />
                <span className="min-w-0 flex-1 truncate font-bold">vs {o.displayName}</span>
                <span className="cond text-[30px]">{r.wins}<span className="text-brand">–</span>{r.losses}</span>
              </Link>
            );
          })}
        </div>
      )}

      <Tabs<Tab> value={tab} onChange={setTab} className="mb-2 mt-7" options={[{ value: "activity", label: "activity" }, { value: "duels", label: "duels" }, { value: "rivalries", label: "rivalries" }, { value: "badges", label: `badges ${badges.filter((b) => b.unlocked).length}/${badges.length}` }]} />

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
            <div key={b.id} className={cx("border-2 p-3 text-center", b.unlocked ? "border-ink" : "border-dashed border-ink/30 opacity-45 grayscale")} title={b.description}>
              <p className="text-3xl">{b.emoji}</p>
              <p className="cond mt-1 text-[18px]">{b.name}</p>
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


