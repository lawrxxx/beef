"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { NETWORK_NAME } from "@/lib/chain/config";
import { cdpEnabled, useCdpReady } from "./cdp-provider";
import { useBeefWallet } from "./use-beef-wallet";
import { AddressRow, FundWallet, WalletConnect, usdcLabel } from "./wallet-panel";

function NotReady() {
  return <div className="card p-4" aria-busy="true"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-11 w-full" /></div>;
}

/** screen 4: create (or retrieve) the user's embedded wallet + smart account */
export function WalletStep({ onDone }: { onDone: () => void }) {
  const ready = useCdpReady();
  if (!cdpEnabled()) {
    return (
      <div className="card p-4 text-sm">
        <p className="font-semibold">wallets aren't switched on for this deployment yet</p>
        <p className="mt-1 text-muted">you can set yours up later from the wallet page.</p>
        <button className="btn-dark mt-3 w-full" onClick={onDone}>continue</button>
      </div>
    );
  }
  if (!ready) return <NotReady />;
  return <WalletStepInner onDone={onDone} />;
}

function WalletStepInner({ onDone }: { onDone: () => void }) {
  const w = useBeefWallet();
  const linked = w.link.status === "linked";
  useEffect(() => { if (linked) { const t = setTimeout(onDone, 900); return () => clearTimeout(t); } }, [linked, onDone]);
  if (!w.isSignedIn || !w.smartAccount) return <WalletConnect />;
  return (
    <div className="card p-4">
      {w.link.status === "error" ? (
        <>
          <p className="font-semibold text-loss">couldn't link your wallet</p>
          <p className="mt-1 text-sm text-ink-soft">{w.link.message}</p>
          <button className="btn-outline btn-sm mt-3" onClick={() => void w.relink()}>try again</button>
        </>
      ) : linked ? (
        <p className="flex items-center gap-2 font-semibold text-gain"><CheckCircle2 size={18} /> wallet ready and linked to your account</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> verifying your wallet…</p>
      )}
      <div className="mt-3"><AddressRow address={w.smartAccount} /></div>
      <p className="mt-2 text-xs text-muted">this is your smart account on {NETWORK_NAME}. it holds your test usdc and is what locks your stakes.</p>
    </div>
  );
}

/** screen 5: fund with test usdc from circle's faucet */
export function FundStep({ onDone }: { onDone: () => void }) {
  const ready = useCdpReady();
  if (!cdpEnabled()) return <button className="btn-dark w-full" onClick={onDone}>continue</button>;
  if (!ready) return <NotReady />;
  return <FundStepInner onDone={onDone} />;
}

function FundStepInner({ onDone }: { onDone: () => void }) {
  const w = useBeefWallet();
  if (!w.smartAccount) return <div className="card p-4 text-sm"><p className="text-muted">set up your wallet first. you can also do this later from the wallet page.</p><button className="btn-dark mt-3 w-full" onClick={onDone}>continue</button></div>;
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <p className="text-[13px] text-muted">current balance</p>
        <p className="num font-display text-2xl font-bold">{w.balance.loading && w.balance.available == null ? "…" : usdcLabel(w.balance.available)}</p>
      </div>
      <FundWallet />
      <button className="btn-dark w-full" onClick={onDone}>{(w.balance.available ?? 0) > 0 ? "continue" : "skip for now"}</button>
    </div>
  );
}

/** screen 6: done. shows the real balance and what it allows */
export function DoneStep({ onFinish }: { onFinish: () => void }) {
  const ready = useCdpReady();
  if (!cdpEnabled() || !ready) return <button className="btn-primary w-full" onClick={onFinish}>start exploring</button>;
  return <DoneInner onFinish={onFinish} />;
}

function DoneInner({ onFinish }: { onFinish: () => void }) {
  const w = useBeefWallet();
  const bal = w.balance.available;
  return (
    <div className="space-y-3">
      <div className="card p-4 text-center">
        <p className="text-[13px] text-muted">your wallet balance</p>
        <p className="num font-display text-3xl font-bold">{bal == null ? "—" : usdcLabel(bal)}</p>
        {bal === 0 && <p className="mt-2 text-sm text-ink-soft">you'll need test usdc before you can start or join a funded duel. you can still post, follow people and pick beef of the day right away.</p>}
        {bal != null && bal > 0 && <p className="mt-2 text-sm text-ink-soft">you're ready to start a beef.</p>}
      </div>
      <button className="btn-primary w-full" onClick={onFinish}>start exploring</button>
      {bal === 0 && <Link href="/wallet" onClick={onFinish} className="btn-ghost w-full">get test usdc first</Link>}
    </div>
  );
}
