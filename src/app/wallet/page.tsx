"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { AlertTriangle, ExternalLink, Link2, ShieldOff, Wallet } from "lucide-react";
import { practiceBalance, useBeef } from "@/lib/store/store";
import { useMounted } from "@/lib/hooks";
import { CHAIN, ESCROW_ADDRESS, REAL_MONEY_ENABLED, USDC } from "@/lib/chain/config";
import { TOKENIZED_PROVIDERS } from "@/lib/chain/tokenized";
import { getEscrow } from "@/lib/chain/escrow";
import { cx, timeAgo, usd } from "@/lib/format";
import { CardSkeleton, EmptyState, PageHeader, Section, SimBadge } from "@/components/ui";

export default function WalletPage() {
  const s = useBeef();
  const mounted = useMounted();
  const me = s.session.userId;
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

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
  const wrongChain = isConnected && chainId !== CHAIN.id;

  return (
    <div>
      <PageHeader title="wallet" subtitle="practice balance and wallet connection" />

      <div className="card bg-ink p-5 text-white">
        <div className="flex items-center justify-between"><p className="text-sm text-white/70">practice balance</p><SimBadge label="not real money" /></div>
        <p className="num mt-1 font-display text-4xl font-bold">{usd(balance)}</p>
        <p className="mt-1 text-sm text-white/60">{usd(held, 0)} held in live duels · escrow: {getEscrow().kind}</p>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/60 p3 p-3 text-[13px] text-ink-soft">
        <ShieldOff size={16} className="mt-0.5 shrink-0 text-gold" />
        <p>real-money staking is <b>{REAL_MONEY_ENABLED ? "configured" : "off"}</b>. beef won't move real usdc until the market data source, oracle method, custody model and legal requirements are verified. every transaction below is simulated and has no onchain hash.</p>
      </div>

      <Section title="base wallet" className="mt-6">
        <div className="card p-4">
          {isConnected && address ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-muted">connected with {connector?.name}</p>
                  <p className="truncate font-mono text-sm">{address}</p>
                </div>
                <button className="btn-outline btn-sm" onClick={() => disconnect()}>disconnect</button>
              </div>
              <p className="mt-2 text-sm">network: <b>{chainId === 8453 ? "base" : chainId === 84532 ? "base sepolia" : `chain ${chainId}`}</b></p>
              {wrongChain && <button className="btn-dark btn-sm mt-2" onClick={() => switchChain({ chainId: CHAIN.id })}>switch to {CHAIN.name}</button>}
              <a href={`${CHAIN.blockExplorers?.default.url}/address/${address}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-brand-dark hover:underline">view on explorer <ExternalLink size={13} /></a>
              <p className="mt-3 text-xs text-muted">connecting is read-only. beef never asks you to sign a transaction in this version.</p>
            </>
          ) : (
            <>
              <p className="text-[15px] text-ink-soft">link a wallet on base to get ready for onchain duels. optional, and nothing gets signed.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {connectors.map((c) => (
                  <button key={c.uid} className="btn-outline btn-sm" disabled={isPending} onClick={() => connect({ connector: c, chainId: CHAIN.id })}><Link2 size={15} /> {c.name === "Injected" ? "browser wallet" : c.name}</button>
                ))}
              </div>
              {error && <p className="mt-2 text-sm text-loss">{error.message.split("\n")[0]}</p>}
            </>
          )}
        </div>
      </Section>

      <Section title="activity">
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

      <Section title="onchain setup (for developers)">
        <div className="card divide-y text-sm">
          {[
            ["network", CHAIN.name],
            ["usdc", USDC[CHAIN.id]],
            ["escrow contract", ESCROW_ADDRESS || "not deployed"],
            ["oracle", "not configured (official-close attestation required)"],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 px-4 py-2.5"><span className="text-muted">{k}</span><span className="truncate font-mono text-[12px]">{v}</span></div>)}
        </div>
        {TOKENIZED_PROVIDERS.map((p) => (
          <div key={p.id} className="card mt-2 p-4 text-sm">
            <p className="font-semibold">{p.name}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[13px]">
              {Object.entries(p.capabilities).map(([k, v]) => <p key={k}><span className="text-muted">{k}:</span> <span className={v === "verified" ? "text-gain" : "text-gold"}>{v}</span></p>)}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0" />tokenized stocks may be non-transferable, permissioned or illiquid. none are assumed to be supported until verified.</p>
          </div>
        ))}
      </Section>
    </div>
  );
}
