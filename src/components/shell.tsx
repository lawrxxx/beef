"use client";

import { ThemeToggle } from "@/components/theme-controls";
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

/** the beef wordmark: three speed stripes and a slanted team-style BEEF */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Link href="/" className={cx("flex items-center gap-[0.18em]", className)} style={{ fontSize: size }} aria-label="beef home">
      <span className="flex h-[0.8em] items-stretch gap-[0.07em] -skew-x-[20deg]" aria-hidden>
        <i className="block w-[0.11em] bg-brand" /><i className="block w-[0.11em] bg-brand" /><i className="block w-[0.11em] bg-brand" />
      </span>
      <span className="cond text-[1.12em] leading-none">beef</span>
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
    <Link href="/notifications" className={cx("relative inline-flex h-11 w-11 items-center justify-center hover:bg-white/10", className)} aria-label={`notifications${unread ? `, ${unread} unread` : ""}`}>
      <Bell size={22} />
      {unread > 0 && <span className="num absolute right-0.5 top-1.5 flex h-[17px] min-w-[17px] items-center justify-center bg-brand px-1 text-[10px] font-bold text-brand-ink">{unread}</span>}
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
        <nav className="mt-10 flex flex-col" aria-label="primary">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} className={cx("cond flex items-center gap-3 border-l-[5px] py-1.5 pl-3 text-[30px] transition hover:text-ink", isActive(path, href) ? "border-brand text-ink" : "border-transparent text-faint")} aria-current={isActive(path, href) ? "page" : undefined}>
              {label}
            </Link>
          ))}
          <Link href="/notifications" className={cx("meta mt-5 flex items-center gap-2 border-l-[5px] py-1.5 pl-3 font-bold hover:text-ink", isActive(path, "/notifications") ? "border-brand text-ink" : "border-transparent text-muted")}>
            <Bell size={15} /> notifications <UnreadPill />
          </Link>
          <Link href="/wallet" className={cx("meta flex items-center gap-2 border-l-[5px] py-1.5 pl-3 font-bold hover:text-ink", isActive(path, "/wallet") ? "border-brand text-ink" : "border-transparent text-muted")}>
            <Wallet size={15} /> wallet
          </Link>
        </nav>
        <Link href="/duel/new" className="btn-primary mt-6 w-full"><Plus size={18} /> start a beef</Link>
        <div className="mt-auto">
          {me ? (
            <Link href="/profile" className="flex items-center gap-3 border-t-2 border-ink py-3 hover:bg-ink/[.05]">
              <Avatar user={me} size={36} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{me.displayName}</p><p className="truncate text-xs text-muted">@{me.username}</p></div>
            </Link>
          ) : (
            <Link href="/auth/sign-in" className="btn-outline w-full">sign in</Link>
          )}
          <div className="mt-3 flex items-center justify-between px-2"><SimBadge label="testnet" /><ThemeToggle className="!h-9 !w-9" /></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 justify-center">
        <div className="w-full min-w-0 max-w-[640px]">
          {/* mobile top bar */}
          <header className="slab sticky top-0 z-30 flex items-center justify-between border-b-[4px] border-brand px-4 pt-safe lg:hidden">
            <div className="flex h-14 items-center"><Logo size={27} /></div>
            <div className="flex items-center">
              <ThemeToggle />
              <Link href="/wallet" className="inline-flex h-11 w-11 items-center justify-center hover:bg-white/10" aria-label="wallet"><Wallet size={21} /></Link>
              <BellLink />
            </div>
          </header>
          <main className="px-4 pb-28 pt-4 lg:pb-12 lg:pt-8">{ready ? children : <PageSkeleton />}</main>
        </div>
        {ready && <RightRail />}
      </div>

      {/* mobile bottom nav */}
      <nav className="slab fixed inset-x-0 bottom-0 z-40 border-t-[4px] border-brand pb-safe lg:hidden" aria-label="primary">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(path, href);
            if (href === "/duel") {
              return (
                <Link key={href} href="/duel" className={cx("meta flex flex-col items-center justify-center gap-0.5 bg-brand font-bold text-brand-ink", active && "underline decoration-2 underline-offset-4")} aria-current={active ? "page" : undefined} aria-label="duel">
                  <Swords size={21} strokeWidth={2.4} /> beef
                </Link>
              );
            }
            return (
              <Link key={href} href={href} className={cx("meta relative flex flex-col items-center justify-center gap-0.5 !text-[10px] font-bold", active ? "text-white" : "text-slab-muted")} aria-current={active ? "page" : undefined}>
                {active && <span className="absolute inset-x-3 top-0 h-[3px] bg-white" aria-hidden />}
                <Icon size={22} strokeWidth={active ? 2.3 : 1.8} />
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
  return n ? <span className="num ml-auto bg-brand px-1.5 py-0.5 text-[11px] font-bold text-brand-ink">{n}</span> : null;
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
