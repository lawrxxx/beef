"use client";

import { formatUsdc } from "@/lib/stake";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  useCreateEvmSmartAccount, useLinkGoogle, useSignInWithEmail, useSignInWithOAuth, useSignOut, useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { FAUCET_URL, NETWORK_NAME, addressUrl, shortAddress, txUrl } from "@/lib/chain/config";
import { cx, timeAgo } from "@/lib/format";
import { useBeef } from "@/lib/store/store";
import { useAction } from "@/components/ui";
import { toast } from "@/components/share";
import { friendly, useBeefWallet, useFundingWatch, type ActivityItem } from "./use-beef-wallet";
import { cdpEnabled, useCdpReady } from "./cdp-provider";

export const usdcLabel = (units: bigint | null | undefined) => (units == null ? "—" : `${formatUsdc(units)} test usdc`);

function GoogleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" /></svg>;
}

// ---------- connect (create or retrieve the wallet) ----------

/** custom-auth mode: the beef session is the wallet login (same user id → same wallet) */
function ConnectWithBeef() {
  const w = useBeefWallet();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn-dark w-full" disabled={busy} onClick={async () => { setBusy(true); await run(() => w.connectWithBeefAccount(), "wallet ready"); setBusy(false); }}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />} create my wallet
    </button>
  );
}

/** cdp-login mode: email code sent to the beef account's email (or google with that email) */
function ConnectWithEmail() {
  const s = useBeef();
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signInWithOAuth } = useSignInWithOAuth();
  const run = useAction();
  const email = s.session.email ?? "";
  const [flowId, setFlowId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  if (!flowId) {
    return (
      <div className="space-y-2">
        <button className="btn-dark w-full" disabled={busy || !email} onClick={async () => {
          setBusy(true);
          const r = await run(friendly(() => signInWithEmail({ email })));
          setBusy(false);
          if (r) { setFlowId(r.flowId); toast("info", `code sent to ${email}`); }
        }}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />} send a code to {email || "your email"}</button>
        <button className="btn-outline w-full" onClick={() => run(friendly(() => signInWithOAuth("google")))}><GoogleIcon /> use google ({email})</button>
        <p className="text-xs text-muted">use the same email as your beef account. beef checks this before linking the wallet.</p>
      </div>
    );
  }
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await run(async () => {
        if (!/^\d{6}$/.test(otp)) throw new Error("the code is 6 digits");
        await friendly(() => verifyEmailOTP({ flowId, otp }))();
      }, "wallet ready");
      setBusy(false);
    }}>
      <label className="label" htmlFor="wallet-otp">6-digit code sent to {email}</label>
      <input id="wallet-otp" className="input text-center font-mono text-lg tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
      <button className="btn-dark w-full" disabled={busy || otp.length !== 6}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} verify</button>
      <button type="button" className="btn-ghost btn-sm w-full" onClick={() => { setFlowId(null); setOtp(""); }}>send a new code</button>
    </form>
  );
}

/** older cdp users without a smart account finish setup here (idempotent per cdp user) */
function FinishSetup({ eoa, userId }: { eoa: string | null; userId: string }) {
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <div className="card p-4">
      <p className="font-semibold">one more step</p>
      <p className="mt-1 text-[13px] text-muted">beef needs a smart account for duels. it's free, and gas is covered.</p>
      <button className="btn-dark mt-3 w-full" disabled={busy} onClick={async () => {
        setBusy(true);
        await run(friendly(() => createEvmSmartAccount({ owner: (eoa ?? undefined) as `0x${string}` | undefined, enableSpendPermissions: false, idempotencyKey: `beef-smart-account-${userId}` })), "wallet ready");
        setBusy(false);
      }}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} finish wallet setup</button>
    </div>
  );
}

export function WalletConnect() {
  const w = useBeefWallet();
  if (!w.isInitialized) return <div className="card p-4"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-11 w-full" /></div>;
  if (w.isSignedIn && !w.smartAccount) return <FinishSetup eoa={w.eoa} userId={w.user?.userId ?? "unknown"} />;
  if (w.isSignedIn) return null;
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink/[.05]"><Wallet size={20} /></span>
        <div>
          <p className="font-semibold">your beef wallet</p>
          <p className="text-[13px] text-muted">a {NETWORK_NAME} wallet for test usdc. no app, no extension, no seed phrase.</p>
        </div>
      </div>
      {w.authMode === "supabase" ? <ConnectWithBeef /> : <ConnectWithEmail />}
      <p className="mt-3 text-xs text-muted">signing in again on any device brings back the same wallet. its keys stay in coinbase's secure enclave; beef never sees them.</p>
    </div>
  );
}

// ---------- address + funding ----------

export function AddressRow({ address }: { address: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
      <span className="min-w-0 truncate font-mono text-[13px]" title={address}>{shortAddress(address)}</span>
      <span className="flex shrink-0 gap-1">
        <button className="btn-ghost btn-sm !h-8 !px-2" aria-label="copy address" onClick={async () => { await navigator.clipboard.writeText(address).catch(() => {}); toast("success", "address copied"); }}><Copy size={14} /> copy</button>
        <a className="btn-ghost btn-sm !h-8 !px-2" href={addressUrl(address)} target="_blank" rel="noreferrer" aria-label="view on base sepolia explorer"><ExternalLink size={14} /></a>
      </span>
    </div>
  );
}

/** get test usdc: copy the address, open circle's faucet, then watch the chain */
export function FundWallet({ compact }: { compact?: boolean }) {
  const w = useBeefWallet();
  const watch = useFundingWatch(w.refreshBalance, w.balance.units);
  if (!w.smartAccount) return null;
  return (
    <div className={cx(!compact && "card p-4")}>
      {!compact && <p className="font-semibold">get test usdc</p>}
      <ol className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
        <li>1. copy your beef wallet address</li>
        <li>2. on circle's faucet choose <b>usdc</b> and <b>base sepolia</b>, then paste your address</li>
        <li>3. come back here. your balance updates when the tokens land.</li>
      </ol>
      <div className="mt-3"><AddressRow address={w.smartAccount} /></div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a className="btn-primary btn-sm" href={FAUCET_URL} target="_blank" rel="noreferrer" onClick={async () => { await navigator.clipboard.writeText(w.smartAccount!).catch(() => {}); toast("success", "address copied. paste it on the faucet"); watch.start(); }}>
          get test usdc <ExternalLink size={13} />
        </a>
        <button className="btn-outline btn-sm" disabled={w.balance.loading} onClick={() => void w.refreshBalance()}><RefreshCw size={14} className={cx(w.balance.loading && "animate-spin")} /> refresh balance</button>
      </div>
      {watch.state === "waiting" && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-gold"><Loader2 size={13} className="animate-spin" /> waiting for test usdc to arrive on base sepolia… this can take a minute.</p>}
      {watch.state === "arrived" && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-gain"><CheckCircle2 size={14} /> test usdc arrived. balance: {usdcLabel(w.balance.units)}</p>}
      {watch.state === "timeout" && <p className="mt-2 text-[13px] text-muted">nothing has arrived yet. check the faucet used base sepolia and your exact address, then tap refresh.</p>}
      <p className="mt-2 text-xs text-muted">test usdc has no monetary value. the faucet limits how often you can request it.</p>
    </div>
  );
}

// ---------- balances + activity ----------

export function Balances() {
  const w = useBeefWallet();
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-gain" /> wallet connected</span>
        <span className="rounded-full bg-ink/[.05] px-2 py-0.5 text-[11px] font-semibold text-ink-soft">{NETWORK_NAME} · testnet</span>
      </div>
      <div className="grid grid-cols-3 divide-x text-center">
        {[
          ["available", w.balance.units],
          ["in duels", w.balance.units == null ? null : w.balance.lockedUnits],
          ["total", w.balance.totalUnits],
        ].map(([k, v]) => (
          <div key={k as string} className="px-2 py-3">
            <p className="text-[11px] text-muted">{k}</p>
            <p className="num font-display text-lg font-bold">{v == null ? (w.balance.loading ? "…" : "—") : formatUsdc(v as bigint)}</p>
            <p className="text-[10px] text-muted">test usdc</p>
          </div>
        ))}
      </div>
      {w.balance.error && <p className="border-t px-4 py-2 text-xs text-loss">{w.balance.error}</p>}
      <div className="flex items-center justify-between border-t px-4 py-2.5 text-[13px]">
        {w.link.status === "linking" && <span className="flex items-center gap-1.5 text-muted"><Loader2 size={13} className="animate-spin" /> verifying your wallet…</span>}
        {w.link.status === "linked" && <span className="flex items-center gap-1.5 text-gain"><ShieldCheck size={14} /> verified and linked to your beef account</span>}
        {w.link.status === "error" && <span className="text-loss">{w.link.message} <button className="underline" onClick={() => void w.relink()}>retry</button></span>}
        {w.link.status === "idle" && <span />}
        <span className="flex items-center gap-1 text-muted"><Sparkles size={12} className="text-gold" /> gas covered</span>
      </div>
      <p className="border-t px-4 py-2 text-[11px] text-muted">read from base sepolia{w.balance.at ? ` · updated ${timeAgo(new Date(w.balance.at).toISOString())}` : ""}. stakes in duels are held by the beef escrow contract.</p>
    </div>
  );
}

const ACTION_LABEL: Record<ActivityItem["action"], string> = { create: "stake locked · started a duel", accept: "stake locked · joined a duel", refund: "stake refunded", settle: "duel paid out" };
const STATUS: Record<ActivityItem["status"], { label: string; cls: string }> = {
  prepared: { label: "pending", cls: "text-gold" }, sponsored: { label: "pending", cls: "text-gold" }, submitted: { label: "pending", cls: "text-gold" },
  confirmed: { label: "confirmed", cls: "text-gain" }, failed: { label: "failed", cls: "text-loss" },
};

export function Activity() {
  const w = useBeefWallet();
  // only operations that reached the chain (have a transaction hash) are shown
  const items = w.activity.filter((a) => a.txHash);
  return (
    <div className="card">
      <p className="border-b px-4 py-3 text-sm font-semibold">transactions</p>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">no transactions yet. when you lock a stake in a duel, it shows up here with a link to the explorer.</p>
      ) : (
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/duel/${a.duelId}`} className="block truncate text-[15px] hover:underline">{ACTION_LABEL[a.action]}</Link>
                <p className="text-xs text-muted">{timeAgo(a.createdAt)} · <span className={STATUS[a.status].cls}>{STATUS[a.status].label}</span>{a.error ? ` · ${a.error}` : ""}</p>
              </div>
              <div className="text-right">
                {a.amountUnits !== "0" && <p className="num font-semibold">−{(Number(a.amountUnits) / 1e6).toFixed(2)}</p>}
                <a className="text-xs text-brand-dark underline" href={txUrl(a.txHash!)} target="_blank" rel="noreferrer">{a.txHash!.slice(0, 8)}…</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SignInMethods() {
  const w = useBeefWallet();
  const { linkGoogle } = useLinkGoogle();
  const { signOut } = useSignOut();
  const run = useAction();
  if (w.authMode === "supabase") return null; // the beef account is the login
  const has = !!(w.user?.authenticationMethods as Record<string, unknown> | undefined)?.google;
  return (
    <div className="card flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
      <span className="text-muted">wallet sign-in: email{has ? " + google" : ""}</span>
      <span className="flex gap-2">
        {!has && <button className="btn-outline btn-sm" onClick={() => run(friendly(() => linkGoogle()), "google linked")}><GoogleIcon /> link google</button>}
        <button className="btn-ghost btn-sm text-muted" onClick={() => run(friendly(() => signOut()), "wallet signed out")}>sign out of wallet</button>
      </span>
    </div>
  );
}

// ---------- the full panel (wallet page) ----------

function Gate({ children }: { children: ReactNode }) {
  const ready = useCdpReady();
  if (!ready) return <div className="card p-4" aria-busy="true"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-10 w-full" /></div>;
  return <>{children}</>;
}

function PanelInner() {
  const w = useBeefWallet();
  if (!w.isInitialized || !w.isSignedIn || !w.smartAccount) return <WalletConnect />;
  return (
    <div className="space-y-3">
      <Balances />
      <div className="card p-4">
        <p className="mb-2 text-sm font-semibold">your wallet address</p>
        <AddressRow address={w.smartAccount} />
      </div>
      <FundWallet />
      <Activity />
      <SignInMethods />
    </div>
  );
}

export function WalletPanel() {
  if (!cdpEnabled()) {
    return (
      <div className="card p-4 text-sm">
        <p className="font-semibold">wallets aren't switched on yet</p>
        <p className="mt-1 text-muted">this deployment has no coinbase developer platform project configured.</p>
      </div>
    );
  }
  return <Gate><PanelInner /></Gate>;
}

export { Gate as CdpGate };
