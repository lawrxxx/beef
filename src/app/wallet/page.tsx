"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Info, Wallet } from "lucide-react";
import { useBeef } from "@/lib/store/store";
import { CHAIN_ID, ESCROW_ADDRESS, NETWORK_NAME, USDC_ADDRESS, addressUrl, shortAddress } from "@/lib/chain/config";
import { EmptyState, PageHeader, Section } from "@/components/ui";

// wallet code (viem + cdp) loads only on this page
const WalletPanel = dynamic(() => import("@/components/wallet/wallet-panel").then((m) => m.WalletPanel), {
  ssr: false,
  loading: () => <div className="card p-4"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-10 w-full" /></div>,
});

export default function WalletPage() {
  const s = useBeef();
  const [cfg, setCfg] = useState<{ verification: boolean; sponsorship: boolean; oracle: boolean } | null>(null);
  useEffect(() => { fetch("/api/wallet/status").then((r) => r.json()).then(setCfg).catch(() => {}); }, []);

  if (!s.session.userId) {
    return <EmptyState icon={<Wallet size={22} />} title="sign in to see your wallet" body="your beef wallet holds test usdc on base sepolia." action={<Link href="/auth/sign-in" className="btn-dark btn-sm">sign in</Link>} />;
  }

  return (
    <div>
      <PageHeader title="wallet" subtitle={`test usdc on ${NETWORK_NAME}`} />
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft/60 p-3 text-[13px] text-ink-soft">
        <Info size={16} className="mt-0.5 shrink-0 text-gold" />
        <p>beef runs on <b>{NETWORK_NAME}</b>, a test network. test usdc has <b>no monetary value</b>, and no real money moves on beef.</p>
      </div>
      <WalletPanel />
      <Section title="how it works" className="mt-6">
        <div className="card divide-y text-sm">
          {[
            ["network", `${NETWORK_NAME} (chain ${CHAIN_ID}) only`],
            ["token", "usdc by circle (test)"],
            ["usdc contract", USDC_ADDRESS],
            ["stakes held by", ESCROW_ADDRESS ?? "escrow not deployed yet"],
            ["gas", cfg ? (cfg.sponsorship ? "covered by beef (sponsored)" : "sponsorship not configured yet") : "…"],
            ["beef fee", "none"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
              <span className="text-muted">{k}</span>
              {/^0x[0-9a-fA-F]{40}$/.test(v) ? <a className="font-mono text-[12px] underline" href={addressUrl(v)} target="_blank" rel="noreferrer">{shortAddress(v)}</a> : <span className="text-right text-[13px]">{v}</span>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
