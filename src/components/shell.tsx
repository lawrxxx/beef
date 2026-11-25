"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Bell, Compass, Home, Plus, Swords, Trophy, User, Wallet } from "lucide-react";
import { cx } from "@/lib/format";
import { CONFIGURED, useBeef, useStoreReady } from "@/lib/store/store";
import { useMe } from "@/lib/hooks";
import { Avatar, CardSkeleton, SimBadge, Skeleton } from "@/components/ui";
import { InstallPrompt } from "@/components/install-prompt";
import { RightRail } from "@/components/right-rail";

const NAV = [
  { href: "/", label: "home", icon: Home },
  { href: "/discover", label: "discover", icon: Compass },
  { href: "/duel", label: "duel", icon: Swords },
  { href: "/leaderboard", label: "leaderboard", icon: Trophy },
  { href: "/profile", label: "profile", icon: User },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="beef home">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="18" fill="#E5552C" />
        <path d="M12 19a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6h-8l-7 6v-6h-1a6 6 0 0 1-6-6z" fill="#fff" />
        <path d="M52 33a5 5 0 0 0-5-5H33a5 5 0 0 0-5 5v8a5 5 0 0 0 5 5h7l6 5v-5h1a5 5 0 0 0 5-5z" fill="#1D1D1F" />
      </svg>
      <span className="font-display text-[22px] font-extrabold tracking-tight">beef</span>
    </Link>
  );
}

function useUnread() {
  const s = useBeef();
  return s.notifications.filter((n) => n.userId === s.session.userId && !n.read).length;
}

function BellLink({ className }: { className?: string }) {
  const unread = useUnread();
  return (
    <Link href="/notifications" className={cx("relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5", className)} aria-label={`notifications${unread ? `, ${unread} unread` : ""}`}>
      <Bell size={22} />
      {unread > 0 && <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">{unread}</span>}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const me = useMe();
  const router = useRouter();
  const s = useBeef();
  const ready = useStoreReady();
  const bare = path.startsWith("/auth") || path === "/onboarding" || path === "/offline" || path === "/welcome";
  const needsOnboarding = !!s.session.userId && (!s.session.hasProfile || !s.session.onboarded);
  useEffect(() => {
    if (ready && needsOnboarding && !bare) router.replace("/onboarding");
  }, [ready, needsOnboarding, bare, router]);
  if (!CONFIGURED) return <SetupRequired />;
  if (bare) return <main className="mx-auto min-h-dvh w-full max-w-md px-4 pt-safe">{ready ? children : <PageSkeleton />}</main>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1200px]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r px-4 py-6 lg:flex">
        <Logo />
        <nav className="mt-8 flex flex-col gap-1" aria-label="primary">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition hover:bg-black/5", isActive(path, href) ? "bg-black/[.05] font-semibold text-ink" : "text-ink-soft")} aria-current={isActive(path, href) ? "page" : undefined}>
              <Icon size={20} /> {label}
            </Link>
          ))}
          <Link href="/notifications" className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium hover:bg-black/5", isActive(path, "/notifications") ? "bg-black/[.05] font-semibold" : "text-ink-soft")}>
            <Bell size={20} /> notifications <UnreadPill />
          </Link>
          <Link href="/wallet" className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium hover:bg-black/5", isActive(path, "/wallet") ? "bg-black/[.05] font-semibold" : "text-ink-soft")}>
            <Wallet size={20} /> wallet
          </Link>
        </nav>
        <Link href="/duel/new" className="btn-primary mt-6 w-full"><Plus size={18} /> start a beef</Link>
        <div className="mt-auto">
          {me ? (
            <Link href="/profile" className="flex items-center gap-3 rounded-xl p-2 hover:bg-black/5">
              <Avatar user={me} size={36} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{me.displayName}</p><p className="truncate text-xs text-muted">@{me.username}</p></div>
            </Link>
          ) : (
            <Link href="/auth/sign-in" className="btn-outline w-full">sign in</Link>
          )}
          <div className="mt-3 px-2"><SimBadge label="base sepolia · testnet" /></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 justify-center">
        <div className="w-full min-w-0 max-w-[640px]">
          {/* mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-bg/90 px-4 pt-safe backdrop-blur lg:hidden">
            <div className="flex h-14 items-center"><Logo size={26} /></div>
            <div className="flex items-center">
              <Link href="/wallet" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5" aria-label="wallet"><Wallet size={21} /></Link>
              <BellLink />
            </div>
          </header>
          <main className="px-4 pb-28 pt-4 lg:pb-12 lg:pt-8">{ready ? children : <PageSkeleton />}</main>
        </div>
        {ready && <RightRail />}
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 pb-safe backdrop-blur lg:hidden" aria-label="primary">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(path, href);
            if (href === "/duel") {
              return (
                <Link key={href} href="/duel" className="flex flex-col items-center justify-center" aria-current={active ? "page" : undefined} aria-label="duel">
                  <span className={cx("flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-card transition", active ? "bg-brand-dark" : "bg-brand")}><Swords size={22} /></span>
                </Link>
              );
            }
            return (
              <Link key={href} href={href} className={cx("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-ink" : "text-faint")} aria-current={active ? "page" : undefined}>
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                {label === "leaderboard" ? "ranks" : label}
              </Link>
            );
          })}
        </div>
      </nav>
      <InstallPrompt />
    </div>
  );
}

function UnreadPill() {
  const n = useUnread();
  return n ? <span className="ml-auto rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">{n}</span> : null;
}

function PageSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="loading">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-56" />
      <div className="pt-2" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

/** the deployment has no database configured: say so, show nothing fake */
function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <div className="text-4xl">🥩</div>
      <h1 className="mt-4 font-display text-2xl font-bold">beef isn't connected yet</h1>
      <p className="mt-2 text-[15px] text-muted">this deployment has no database configured, so there's nothing to show. beef never fills in fake people or balances.</p>
      <p className="mt-4 text-xs text-faint">admins: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see the readme).</p>
    </main>
  );
}
