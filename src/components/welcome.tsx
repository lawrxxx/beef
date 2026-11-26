import Link from "next/link";
import { ThemeToggle } from "@/components/theme-controls";
import { Swords, TrendingUp, Trophy, Users } from "lucide-react";
import { Logo } from "@/components/shell";

/** screen 1: what beef is, in ten seconds */
export function Welcome() {
  return (
    <div className="flex min-h-[80dvh] flex-col py-6">
      <div className="flex items-center justify-between"><Logo /><ThemeToggle /></div>
      <div className="mt-10 animate-fade-up">
        <h1 className="font-display text-[32px] font-extrabold leading-[1.1] tracking-tight">put your money where your mouth is.</h1>
        <p className="mt-3 text-[17px] text-ink-soft">challenge friends to predict which stock does better. whoever's stock wins takes the pot.</p>
        <ul className="mt-6 space-y-3 text-[15px]">
          {([
            [Swords, "pick two stocks and a friend. you each lock the same stake."],
            [TrendingUp, "at the deadline, the higher percentage return wins. official closing prices, worked out by beef's server."],
            [Trophy, "build a record, rivalries and a beef score."],
            [Users, "runs on base sepolia with test usdc. it has no monetary value, so it's all for fun."],
          ] as const).map(([Icon, text], i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink/[.05]"><Icon size={18} /></span>
              <span className="pt-1.5 text-ink-soft">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto space-y-2 pt-10">
        <Link href="/auth/sign-up" className="btn-primary w-full">get started</Link>
        <Link href="/auth/sign-in" className="btn-ghost w-full">i already have an account</Link>
        <Link href="/discover" className="block text-center text-sm text-muted underline">look around first</Link>
      </div>
    </div>
  );
}
