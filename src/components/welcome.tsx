import Link from "next/link";
import { ThemeToggle } from "@/components/theme-controls";
import { Logo } from "@/components/shell";

/** screen 1: what beef is, in ten seconds */
export function Welcome() {
  return (
    <div className="flex min-h-[80dvh] flex-col py-6">
      <div className="flex items-center justify-between"><Logo /><ThemeToggle /></div>
      <div className="mt-12 animate-fade-up">
        <p className="kicker">stock duels with friends</p>
        <h1 className="mt-2 font-display text-[44px] font-extrabold leading-[.95] tracking-[-0.05em]">put your money where your mouth is.</h1>
        <p className="mt-4 text-[17px] leading-snug text-ink-soft">challenge friends to predict which stock does better. whoever's stock wins takes the pot.</p>
        <ol className="mt-8 border-t-2 border-ink">
          {[
            "pick two stocks and a friend. you each lock the same stake.",
            "at the deadline, the higher percentage return wins. prices come from chainlink data feeds, worked out by beef's server.",
            "build a record, rivalries and a beef score.",
            "runs on base sepolia with test usdc. it has no monetary value, so it's all for fun.",
          ].map((text, i) => (
            <li key={i} className="flex items-baseline gap-4 border-b border-line py-3 text-[15px]">
              <span className="display-cond num w-6 shrink-0 text-[22px] font-bold text-brand-dark">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-ink-soft">{text}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-auto space-y-2 pt-10">
        <Link href="/auth/sign-up" className="btn-primary w-full">get started</Link>
        <Link href="/auth/sign-in" className="btn-ghost w-full">i already have an account</Link>
        <Link href="/discover" className="block text-center text-sm text-muted underline">look around first</Link>
      </div>
    </div>
  );
}
