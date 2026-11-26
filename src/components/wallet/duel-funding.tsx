"use client";

import { deadlineLine } from "@/lib/expiration";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Sparkles } from "lucide-react";
import type { Duel } from "@/lib/types";
import { ESCROW_ADDRESS, NETWORK_NAME, shortAddress, txUrl } from "@/lib/chain/config";
import { fmtStake, formatUsdc, prizePoolUnits, stakeUnits } from "@/lib/stake";
import { resolveDuelEscrow } from "@/lib/wallet/escrow-resolve";
import { BEEF_ESCROW_ABI } from "@/lib/wallet/escrow-abi";
import { duelIdToBytes32 } from "@/lib/wallet/calls";
import { marketTime } from "@/lib/format";
import { reloadRemote, useBeef } from "@/lib/store/store";
import { Sheet } from "@/components/ui";
import { cdpEnabled, useCdpReady } from "./cdp-provider";
import { publicClient, useBeefWallet } from "./use-beef-wallet";
import { WalletConnect } from "./wallet-panel";

const ESCROW_STATUS = ["not opened yet", "waiting for opponents", "all stakes locked", "paid out", "refunded"] as const;
type Action = "create" | "accept" | "refund" | "settle";
interface Chain { status: number; stake: bigint; deposits: number; participants: number; fundingDeadline: number; mine: boolean }

/** the escrow contract is the source of truth for stakes */
function useEscrow(duelId: string, account: string | null, nonce: number) {
  const [state, setState] = useState<Chain | null>(null);
  const [escrow, setEscrow] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ESCROW_ADDRESS) return;
    let alive = true;
    (async () => {
      try {
        // older duels may live on a previous escrow; new ones open on the current one
        const at = (await resolveDuelEscrow(publicClient, duelId)) ?? ESCROW_ADDRESS!;
        const key = duelIdToBytes32(duelId);
        const [stake, participants, deposits, , fundingDeadline, status] = await publicClient.readContract({ address: at, abi: BEEF_ESCROW_ABI, functionName: "getDuel", args: [key] });
        const mine = account ? await publicClient.readContract({ address: at, abi: BEEF_ESCROW_ABI, functionName: "deposited", args: [key, account as `0x${string}`] }) : false;
        if (alive) { setEscrow(at); setState({ status: Number(status), stake, deposits: Number(deposits), participants: participants.length, fundingDeadline: Number(fundingDeadline), mine: Boolean(mine) }); setError(null); }
      } catch { if (alive) setError("couldn't read the escrow on base sepolia"); }
    })();
    return () => { alive = false; };
  }, [duelId, account, nonce]);
  return { state, escrow, error };
}

function Inner({ d }: { d: Duel }) {
  const s = useBeef();
  const w = useBeefWallet();
  const meId = s.session.userId!;
  const [nonce, setNonce] = useState(0);
  const { state, escrow, error } = useEscrow(d.id, w.smartAccount, nonce);
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [phase, setPhase] = useState<"idle" | "sending" | "confirming" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ intentId: string; userOpHash: Hex } | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  // when the user operation lands, verify it server-side before anything changes in beef
  useEffect(() => {
    const data = w.userOp.data;
    if (!pending || !data || data.userOpHash?.toLowerCase() !== pending.userOpHash.toLowerCase()) return;
    if (data.status === "complete" && data.transactionHash) {
      setPhase("confirming"); setTx(data.transactionHash);
      w.confirm({ intentId: pending.intentId, userOpHash: pending.userOpHash, txHash: data.transactionHash as Hex })
        .then(async (st) => {
          setPending(null);
          if (st === "confirmed") { setPhase("done"); await reloadRemote(); setNonce((x) => x + 1); }
          else setPhase("confirming");
        })
        .catch((e) => { setPhase("error"); setMsg(e instanceof Error ? e.message : "couldn't verify the transaction"); });
    } else if (data.status === "failed" || data.status === "dropped") {
      setPhase("error"); setMsg("the transaction didn't go through. nothing left your wallet."); setPending(null);
    }
  }, [w.userOp.data, pending, w]);

  const isCreator = d.createdBy === meId;
  const myRow = d.participants.find((p) => p.userId === meId);
  const canJoin = !isCreator && (myRow ? !myRow.accepted : d.open && d.participants.some((p) => !p.userId));
  const chain = state?.status ?? 0;
  const windowOver = !!state && state.fundingDeadline > 0 && Date.now() / 1000 > state.fundingDeadline;
  const action: Action | null =
    chain === 0 ? (isCreator && d.status === "pending" && d.escrowState === "unfunded" ? "create" : null)
      : chain === 1 && windowOver ? (state?.mine ? "refund" : null)
        : chain === 1 && canJoin && d.status === "pending" ? "accept"
          : chain === 2 && d.status === "completed" && d.settlement && d.settlement.status !== "needs_verification" && escrow !== ESCROW_ADDRESS ? "settle" : null;
  // escrow v3 pays out through beef's settlement relay, no tap needed
  const relayPays = chain === 2 && d.status === "completed" && escrow === ESCROW_ADDRESS;
  const moves = action === "create" || action === "accept";
  const stakeU = stakeUnits(d.stake);
  const stake = fmtStake(d.stake);
  const balanceU = w.balance.units;
  const short = moves && balanceU != null && balanceU < stakeU;
  const unknownBalance = moves && balanceU == null;
  // the escrow is the source of truth: once the duel is onchain, the amount shown must be the amount it holds
  const mismatch = !!state && state.status !== 0 && state.stake !== stakeU;
  const opponents = d.participants.filter((p) => p.userId !== meId).map((p) => (p.userId ? `@${s.users.find((u) => u.id === p.userId)?.username}` : "open spot"));
  const myTicker = myRow?.ticker ?? d.participants.find((p) => !p.userId)?.ticker;
  const pot = formatUsdc(prizePoolUnits(stakeU, d.participants.length));

  const go = async () => {
    if (!action) return;
    setMsg(null); setPhase("sending");
    try {
      const r = await w.runDuelAction(action, d.id);
      setPending({ intentId: r.intentId, userOpHash: r.userOperationHash });
      setOpen(false);
    } catch (e) {
      console.error("[beef] duel action failed", action, e);
      const m = e instanceof Error ? e.message : "something went wrong";
      setPhase("error");
      setMsg(/sponsor|paymaster/i.test(m) ? `gas sponsorship was refused, so nothing was sent. ${m}` : m);
    }
  };

  const label: Record<Action, string> = {
    create: `lock ${stake} test usdc and send`,
    accept: `accept and lock ${stake} test usdc`,
    refund: "get my stake back",
    settle: "release the payout",
  };

  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><Lock size={16} /> stakes</p>
        <span className="rounded-full bg-ink/[.05] px-2 py-0.5 text-[11px] font-semibold text-ink-soft">{NETWORK_NAME} · test usdc</span>
      </div>
      {error ? <p className="mt-1 text-sm text-loss">{error}</p> : (
        <p className="mt-1 text-[13px] text-muted">
          escrow: {state ? `${ESCROW_STATUS[chain]}${chain === 1 ? ` (${state.deposits}/${state.participants} locked)` : ""}` : "checking base sepolia…"}
          {state?.mine && chain < 3 && " · your stake is locked"}
        </p>
      )}

      {!w.isSignedIn || !w.smartAccount ? (
        action || (!state && (isCreator || canJoin)) ? <div className="mt-3"><WalletConnect /></div> : null
      ) : action ? (
        <>
          {action === "create" && <p className="mt-2 text-sm text-ink-soft">nobody can accept until your stake is locked.</p>}
          <button className="btn-primary btn-sm mt-3" disabled={phase === "sending" || !!pending} onClick={() => { setAgree(false); setMsg(null); if (phase === "error") setPhase("idle"); setOpen(true); }}>
            {pending || phase === "confirming" ? <><Loader2 size={15} className="animate-spin" /> confirming on base sepolia…</> : label[action]}
          </button>
          {short && <p className="mt-2 text-xs text-gold">you have {formatUsdc(balanceU!)} test usdc and need {stake}: {formatUsdc(stakeU - balanceU!)} more. gas is free, usdc isn't. <Link href="/wallet" className="underline">get test usdc</Link></p>}
        </>
      ) : chain === 1 && !canJoin && !state?.mine && !isCreator ? (
        <p className="mt-2 text-xs text-muted">this duel is waiting for its invited players.</p>
      ) : chain === 0 && !isCreator && d.status === "pending" ? (
        <p className="mt-2 text-xs text-muted">waiting for the creator to lock their stake. you can accept once they have.</p>
      ) : null}

      {relayPays && <p className="mt-2 text-xs text-muted">the result is final. beef's settlement relay is sending the payout on base sepolia; it shows here once confirmed.</p>}
      {phase === "done" && <p className="mt-2 flex items-center gap-1.5 text-sm text-gain"><CheckCircle2 size={15} /> confirmed on base sepolia.</p>}
      {phase === "error" && msg && <p className="mt-2 flex items-start gap-1.5 text-sm text-loss"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{msg}</p>}
      {tx && <a className="mt-2 block text-xs text-brand-dark underline" href={txUrl(tx)} target="_blank" rel="noreferrer">view transaction on the base sepolia explorer</a>}

      <Sheet open={open} onClose={() => setOpen(false)} title={action ? label[action] : ""}>
        <div className="card divide-y text-[15px]">
          {(action === "settle" ? [
            ["result", d.settlement?.status === "draw" ? "draw: every stake goes back" : `the pot (${pot} test usdc) goes to the winner`],
            ["based on", "beef's verified result, signed by its settlement service"],
          ] : action === "refund" ? [
            ["amount", `${stake} test usdc back to your wallet`],
            ["why", "the duel didn't fill before the 2-day funding window closed"],
          ] : [
            ["against", opponents.join(", ")],
            ["your stock", myTicker ?? "—"],
            ["your stake", `${stake} test usdc`],
            ["prize pool", `${pot} test usdc`],
            ["deadline", deadlineLine(d)],
            ["network", `${NETWORK_NAME} (testnet)`],
            ["token", "usdc by circle (test)"],
            ["held by", `beef escrow ${shortAddress(escrow ?? ESCROW_ADDRESS)}`],
            ["fees", "none · gas covered by beef"],
          ]).map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><span className="shrink-0 text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>)}
        </div>
        {moves && (
          <label className="mt-3 flex items-start gap-3 text-sm text-ink-soft">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-ink" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>i authorise the beef escrow to take exactly {stake} test usdc from my wallet for this duel. it's a one-time approval for this amount only.</span>
          </label>
        )}
        {short && <p className="mt-2 text-sm text-loss">not enough test usdc: you have {formatUsdc(balanceU!)} and need {formatUsdc(stakeU - balanceU!)} more.</p>}
        {unknownBalance && <p className="mt-2 text-sm text-muted">checking your balance on base sepolia…</p>}
        {mismatch && <p className="mt-2 text-sm text-loss">the escrow holds a different stake ({formatUsdc(state!.stake)}) than this duel shows. nothing will be sent.</p>}
        {phase === "error" && msg && <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-xl bg-loss/10 p-3 text-sm text-loss"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span className="break-words">{msg}</span></p>}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Sparkles size={12} className="text-gold" /> test usdc has no monetary value.</p>
        <button className="btn-primary mt-4 w-full" disabled={(moves && (!agree || short || unknownBalance)) || mismatch || phase === "sending"} onClick={go}>
          {phase === "sending" ? <><Loader2 size={16} className="animate-spin" /> sending…</> : "confirm"}
        </button>
      </Sheet>
    </div>
  );
}

/** stakes card for a duel: lock, accept, refund or release payout, from onchain state */
export function DuelFunding({ d }: { d: Duel }) {
  const s = useBeef();
  const ready = useCdpReady();
  const me = s.session.userId;
  const involved = !!me && (d.participants.some((p) => p.userId === me) || (d.open && d.status === "pending"));
  if (!involved) return null;
  if (!ESCROW_ADDRESS) {
    return (
      <div className="card mt-4 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><Lock size={16} /> stakes</p>
        <p className="mt-1 text-muted">the beef escrow contract isn't deployed on base sepolia yet, so stakes can't be locked. no money is involved until it is.</p>
      </div>
    );
  }
  if (!cdpEnabled()) return <div className="card mt-4 p-4 text-sm text-muted">wallets aren't switched on for this deployment yet.</div>;
  if (!ready) return <div className="card mt-4 p-4"><div className="skeleton h-5 w-32" /></div>;
  return <Inner d={d} />;
}
