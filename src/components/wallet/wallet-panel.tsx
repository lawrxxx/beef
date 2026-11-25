"use client";

import Link from "next/link";
import { useState } from "react";
import {
  useCreateEvmSmartAccount, useLinkEmail, useLinkGoogle, useSignInWithEmail, useSignInWithOAuth, useSignOut, useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";
import { CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, Mail, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { EXPLORER, ESCROW_ADDRESS, shortAddress } from "@/lib/chain/config";
import { cx, timeAgo, usd } from "@/lib/format";
import { useAction } from "@/components/ui";
import { toast } from "@/components/share";
import { friendly, useBeefWallet, type ActivityItem } from "./use-beef-wallet";
import { cdpEnabled, useCdpReady } from "./cdp-provider";

const ACTION_LABEL: Record<ActivityItem["action"], string> = { create: "stake locked (created duel)", accept: "stake locked (accepted duel)", refund: "stake refunded", settle: "duel settled" };
const STATUS_LABEL: Record<ActivityItem["status"], string> = { prepared: "waiting for you", sponsored: "gas covered, sending", submitted: "confirming", confirmed: "done", failed: "failed" };

function GoogleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" /></svg>;
}

/** email one-time code or google. creates (or restores) the user's wallet. */
function WalletSignIn() {
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signInWithOAuth } = useSignInWithOAuth();
  const run = useAction();
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/[.05]"><Wallet size={20} /></span>
        <div>
          <p className="font-semibold">set up your beef wallet</p>
          <p className="text-[13px] text-muted">no app or extension needed. no seed phrase to write down.</p>
        </div>
      </div>
      {!flowId ? (
        <form className="mt-4 space-y-2" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          const r = await run(async () => {
            if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("enter a valid email");
            return friendly(() => signInWithEmail({ email }))();
          });
          setBusy(false);
          if (r) { setFlowId(r.flowId); toast("info", "we emailed you a 6-digit code"); }
        }}>
          <label className="label" htmlFor="wallet-email">email</label>
          <input id="wallet-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <button className="btn-dark w-full" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} continue with email</button>
        </form>
      ) : (
        <form className="mt-4 space-y-2" onSubmit={async (e) => {
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
          <button type="button" className="btn-ghost btn-sm w-full" onClick={() => { setFlowId(null); setOtp(""); }}>use a different email</button>
        </form>
      )}
      <div className="my-3 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <button className="btn-outline w-full" onClick={() => run(friendly(() => signInWithOAuth("google")))}><GoogleIcon /> continue with google</button>
      <p className="mt-3 text-xs text-muted">signing in again with the same email or google account on any device brings back the same wallet.</p>
    </div>
  );
}

function LinkMethods({ methods }: { methods: string[] }) {
  const { linkGoogle } = useLinkGoogle();
  const { linkEmail } = useLinkEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const run = useAction();
  const [email, setEmail] = useState("");
  const [flow, setFlow] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const has = (m: string) => methods.some((x) => x.toLowerCase().includes(m));
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted">add another way to sign in, so you can always get back to your wallet.</p>
      <div className="flex flex-wrap gap-2">
        {["email", "google"].map((m) => <span key={m} className={cx("chip !min-h-0 !py-1 text-xs", has(m) && "chip-active")}>{has(m) ? <CheckCircle2 size={12} /> : null}{m}</span>)}
      </div>
      {!has("google") && <button className="btn-outline btn-sm" onClick={() => run(friendly(() => linkGoogle()), "google linked")}><GoogleIcon /> link google</button>}
      {!has("email") && !flow && (
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(friendly(() => linkEmail(email))); if (r) setFlow(r.flowId); }}>
          <input className="input !py-2" type="email" placeholder="add an email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="email to link" />
          <button className="btn-outline btn-sm">send code</button>
        </form>
      )}
      {flow && (
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const ok = await run(friendly(async () => { await verifyEmailOTP({ flowId: flow, otp }); return true; }), "email linked"); if (ok) setFlow(null); }}>
          <input className="input !py-2 font-mono" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} aria-label="code" />
          <button className="btn-dark btn-sm">verify</button>
        </form>
      )}
    </div>
  );
}

/** existing users without a smart account (or a delayed creation) finish setup here */
function FinishSetup({ eoa, userId }: { eoa: string | null; userId: string }) {
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();
  const { signOut } = useSignOut();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <div className="card p-4">
      <p className="font-semibold">one more step</p>
      <p className="mt-1 text-[13px] text-muted">your sign-in worked. beef needs a smart account for duels. it's free, and gas is covered.</p>
      <button className="btn-dark mt-3 w-full" disabled={busy} onClick={async () => {
        setBusy(true);
        // idempotency key tied to the cdp user: repeated taps can't create a second account
        await run(friendly(() => createEvmSmartAccount({ owner: (eoa ?? undefined) as `0x${string}` | undefined, enableSpendPermissions: false, idempotencyKey: `beef-smart-account-${userId}` })), "wallet ready");
        setBusy(false);
      }}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} finish wallet setup</button>
      <button className="btn-ghost btn-sm mt-2 w-full text-muted" onClick={() => run(friendly(() => signOut()))}>sign out of wallet</button>
    </div>
  );
}

function SignedInWallet() {
  const w = useBeefWallet();
  const { signOut } = useSignOut();
  const run = useAction();
  if (!w.smartAccount) return <FinishSetup eoa={w.eoa} userId={w.user?.userId ?? "unknown"} />;
  const methods = (w.user?.authenticationMethods ? Object.entries(w.user.authenticationMethods).filter(([, v]) => v).map(([k]) => k) : []) as string[];

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-gain" /> wallet connected</span>
          <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-semibold text-ink-soft">base sepolia · test network</span>
        </div>
        <div className="p-4">
          <p className="text-[13px] text-muted">test usdc</p>
          <p className="num font-display text-3xl font-bold">{w.usdc.formatted == null ? (w.usdc.loading ? "…" : "—") : usd(w.usdc.formatted)}</p>
          {w.usdc.error && <p className="text-xs text-loss">{w.usdc.error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-black/[.03] p-2.5"><p className="text-[11px] text-muted">in duels</p><p className="num font-semibold">{usd(w.committedUsdc)}</p></div>
            <div className="rounded-xl bg-black/[.03] p-2.5"><p className="text-[11px] text-muted">gas</p><p className="flex items-center justify-center gap-1 font-semibold"><Sparkles size={13} className="text-gold" /> covered by beef</p></div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
            <span className="font-mono text-[13px]">{shortAddress(w.smartAccount)}</span>
            <span className="flex gap-1">
              <button className="btn-ghost btn-sm !h-8 !px-2" aria-label="copy address" onClick={async () => { if (w.smartAccount) { await navigator.clipboard.writeText(w.smartAccount).catch(() => {}); toast("success", "address copied"); } }}><Copy size={14} /></button>
              {w.smartAccount && <a className="btn-ghost btn-sm !h-8 !px-2" href={`${EXPLORER}/address/${w.smartAccount}`} target="_blank" rel="noreferrer" aria-label="view on explorer"><ExternalLink size={14} /></a>}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            need test usdc? get free base sepolia usdc from the <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">circle faucet</a> and send it to your address. it has no real value.
          </p>
        </div>
        <div className="border-t px-4 py-2.5 text-[13px]">
          {w.link.status === "linking" && <span className="flex items-center gap-1.5 text-muted"><Loader2 size={13} className="animate-spin" /> linking to your beef account…</span>}
          {w.link.status === "linked" && <span className="flex items-center gap-1.5 text-gain"><ShieldCheck size={14} /> verified and linked to your beef account</span>}
          {w.link.status === "error" && <span className="text-loss">{w.link.message}</span>}
        </div>
      </div>

      <div className="card p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} /> sign-in & recovery</p>
        <LinkMethods methods={methods} />
        <p className="mt-3 text-xs text-muted">your wallet's keys are held in coinbase's secure enclave and unlocked only when you sign in. beef never sees them and can't move your funds.</p>
      </div>

      <div className="card">
        <p className="border-b px-4 py-3 text-sm font-semibold">onchain activity</p>
        {w.activity.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">nothing yet. when you lock a stake in a duel, it shows up here.</p>
        ) : (
          <ul className="divide-y">
            {w.activity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/duel/${a.duelId}`} className="block truncate text-[15px] hover:underline">{ACTION_LABEL[a.action]}</Link>
                  <p className="text-xs text-muted">{timeAgo(a.createdAt)} · <span className={cx(a.status === "failed" ? "text-loss" : a.status === "confirmed" ? "text-gain" : "text-gold")}>{STATUS_LABEL[a.status]}</span>{a.error ? ` · ${a.error}` : ""}</p>
                </div>
                <div className="text-right">
                  {a.amountUnits !== "0" && <p className="num font-semibold">−{usd(Number(a.amountUnits) / 1e6)}</p>}
                  {a.txHash && <a className="text-xs text-brand-dark underline" href={`${EXPLORER}/tx/${a.txHash}`} target="_blank" rel="noreferrer">receipt</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className="btn-ghost btn-sm w-full text-muted" onClick={() => run(friendly(() => signOut()), "wallet signed out")}>sign out of wallet</button>
    </div>
  );
}

function WalletInner() {
  const w = useBeefWallet();
  if (!w.isInitialized) return <div className="card p-4"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-10 w-full" /></div>;
  return w.isSignedIn ? <SignedInWallet /> : <WalletSignIn />;
}

export function WalletPanel() {
  if (!cdpEnabled()) {
    return (
      <div className="card p-4 text-sm">
        <p className="font-semibold">beef wallet isn't switched on here yet</p>
        <p className="mt-1 text-muted">this deployment has no coinbase developer platform project configured, so embedded wallets are off. everything else uses practice money.</p>
        {!ESCROW_ADDRESS && <p className="mt-1 text-xs text-faint">escrow contract: not deployed</p>}
      </div>
    );
  }
  return <ReadyGate><WalletInner /></ReadyGate>;
}

function ReadyGate({ children }: { children: React.ReactNode }) {
  const ready = useCdpReady();
  if (!ready) return <div className="card p-4" aria-busy="true"><div className="skeleton h-5 w-40" /><div className="skeleton mt-3 h-10 w-full" /></div>;
  return <>{children}</>;
}
