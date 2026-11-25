"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ShieldOff, Wallet } from "lucide-react";
import { practiceBalance, useBeef } from "@/lib/store/store";
import { useMounted } from "@/lib/hooks";
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS, shortAddress } from "@/lib/chain/config";
import { getEscrow } from "@/lib/chain/escrow";
import dynamic from "next/dynamic";

const WalletPanel = dynamic(() => import("@/components/wallet/wallet-panel").then((m) => m.WalletPanel), {
  ssr: false,
  loading: () => <div className="card p-4"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-10 w-full" /></div>,
});
import { cx, timeAgo, usd } from "@/lib/format";
import { CardSkeleton, EmptyState, PageHeader, Section, SimBadge } from "@/components/ui";

export default function WalletPage() {
  const s = useBeef();
  const mounted = useMounted();
  const me = s.session.userId;
  const [cfg, setCfg] = useState<{ verification: boolean; sponsorship: boolean; liveMode: boolean } | null>(null);
  useEffect(() => { fetch("/api/wallet/status").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  const ledger = useMemo(() => {
    if (!me) return [];
    const rows: { id: string; label: string; amount: number; at: string; href?: string; state: "simulated" }[] = s.transactions
      .filter((t) => t.userId === me).map((t) => ({ id: t.id, label: t.kind === "faucet" ? "practice balance added" : t.kind, amount: t.amount, at: t.createdAt, state: "simulated" as const }));
    for (const d of s.duels) {
      const p = d.participants.find((x) => x.userId === me);
      if (!p?.accepted) continue;
      const vs = d.participants.map((x) => x.ticker).join(" vs ");
      if (["pending", "accepted", "active", "awaiting_verification", "completed"].includes(d.status)) rows.push({ id: `${d.id}-lock`, label: `stake held · ${vs}`, amount: -d.stake, at: p.acceptedAt ?? d.createdAt, href: `/duel/${d.id}`, state: "simulated" });
      if (d.status === "completed" && d.settlement) {
        const st = d.settlement;
        if (st.status === "draw") rows.push({ id: `${d.id}-ref`, label: `stake returned (draw) · ${vs}`, amount: d.stake, at: st.settledAt, href: `/duel/${d.id}`, state: "simulated" });
        else if (st.winners.includes(me)) rows.push({ id: `${d.id}-pay`, label: `winnings · ${vs}`, amount: (d.stake * d.participants.length) / st.winners.length, at: st.settledAt, href: `/duel/${d.id}`, state: "simulated" });
      }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [s, me]);

  if (!mounted) return <CardSkeleton />;
  if (!me) return <EmptyState icon={<Wallet size={22} />} title="sign in to see your wallet" action={<Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>} />;
  const balance = practiceBalance(s, me);
  const held = s.duels.filter((d) => d.participants.some((p) => p.userId === me && p.accepted) && ["pending", "accepted", "active", "awaiting_verification"].includes(d.status)).reduce((a, d) => a + d.stake, 0);

  return (
    <div>
      <PageHeader title="wallet" subtitle="practice balance and wallet connection" />

      <div className="card bg-ink p-5 text-white">
        <div className="flex items-center justify-between"><p className="text-sm text-white/70">practice balance</p><SimBadge label="not real money" /></div>
        <p className="num mt-1 font-display text-4xl font-bold">{usd(balance)}</p>
        <p className="mt-1 text-sm text-white/60">{usd(held, 0)} held in live duels · escrow: {getEscrow().kind}</p>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/60 p-3 text-[13px] text-ink-soft">
        <ShieldOff size={16} className="mt-0.5 shrink-0 text-gold" />
        <p>beef never moves real money. duels use practice money, and the optional wallet below only holds <b>test usdc on base sepolia</b>, which has no value.</p>
      </div>

      <Section title="your beef wallet" className="mt-6">
        <WalletPanel />
      </Section>

      <Section title="practice money activity">
        <ul className="card divide-y">
          {ledger.map((r) => (
            <li key={r.id}>
              <Link href={r.href ?? "#"} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-[15px]">{r.label}</p><p className="text-xs text-muted">{timeAgo(r.at)} · simulated</p></div>
                <p className={cx("num font-semibold", r.amount > 0 ? "text-gain" : "text-ink")}>{r.amount > 0 ? "+" : "−"}{usd(Math.abs(r.amount))}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="onchain setup">
        <div className="card divide-y text-sm">
          {[
            ["network", `base sepolia (${CHAIN_ID}) only`],
            ["test usdc", shortAddress(USDC_ADDRESS)],
            ["escrow contract", ESCROW_ADDRESS ? shortAddress(ESCROW_ADDRESS) : "not deployed yet"],
            ["wallet verification", cfg ? (cfg.verification ? "on" : "not configured") : "…"],
            ["gas sponsorship", cfg ? (cfg.sponsorship ? "on (beef policy + cdp paymaster)" : "not configured") : "…"],
            ["mode", cfg ? (cfg.liveMode ? "live (supabase)" : "demo") : "…"],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted">{k}</span><span className="truncate font-mono text-[12px]">{v}</span></div>)}
        </div>
      </Section>
    </div>
  );
}
