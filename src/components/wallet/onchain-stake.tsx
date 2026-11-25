"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Lock, Sparkles } from "lucide-react";
import type { Duel } from "@/lib/types";
import { CHAIN, ESCROW_ADDRESS, EXPLORER, shortAddress } from "@/lib/chain/config";
import { BEEF_ESCROW_ABI } from "@/lib/wallet/escrow-abi";
import { duelIdToBytes32 } from "@/lib/wallet/calls";
import { usd } from "@/lib/format";
import { Sheet } from "@/components/ui";
import { REMOTE } from "@/lib/store/store";
import { cdpEnabled, useCdpReady } from "./cdp-provider";
import { useBeefWallet } from "./use-beef-wallet";

const client = createPublicClient({ chain: CHAIN, transport: http() });
const ESCROW_STATUS = ["not opened", "waiting for stakes", "stakes locked", "settled", "refunded"] as const;

interface ChainState { status: number; deposits: number; participants: number; fundingDeadline: number; mine: boolean }

function useEscrowState(duelId: string, account: Address | null, refreshKey: number) {
  const [state, setState] = useState<ChainState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ESCROW_ADDRESS) return;
    let alive = true;
    (async () => {
      try {
        const key = duelIdToBytes32(duelId);
        const [stake, participants, deposits, , fundingDeadline, status] = await client.readContract({ address: ESCROW_ADDRESS!, abi: BEEF_ESCROW_ABI, functionName: "getDuel", args: [key] });
        const mine = account ? await client.readContract({ address: ESCROW_ADDRESS!, abi: BEEF_ESCROW_ABI, functionName: "deposited", args: [key, account] }) : false;
        if (alive) setState({ status: Number(status), deposits: Number(deposits), participants: participants.length, fundingDeadline: Number(fundingDeadline), mine: Boolean(mine) });
        void stake;
      } catch { if (alive) setError("couldn't read the escrow on base sepolia"); }
    })();
    return () => { alive = false; };
  }, [duelId, account, refreshKey]);
  return { state, error };
}

function Inner({ d, meId }: { d: Duel; meId: string }) {
  const w = useBeefWallet();
  const [refresh, setRefresh] = useState(0);
  const { state, error } = useEscrowState(d.id, w.smartAccount, refresh);
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "sending" | "confirming" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ intentId: string; userOpHash: Hex } | null>(null);

  // when the user operation lands, verify it on the server
  useEffect(() => {
    const data = w.userOp.data;
    if (!pending || !data || data.userOpHash?.toLowerCase() !== pending.userOpHash.toLowerCase()) return;
    if (data.status === "complete" && data.transactionHash) {
      setPhase("confirming");
      w.confirm({ intentId: pending.intentId, userOpHash: pending.userOpHash, txHash: data.transactionHash as Hex })
        .then((s) => { setPhase(s === "confirmed" ? "done" : "confirming"); setPending(null); setRefresh((x) => x + 1); })
        .catch((e) => { setPhase("error"); setMsg(e instanceof Error ? e.message : "couldn't verify the transaction"); });
    } else if (data.status === "failed" || data.status === "dropped") {
      setPhase("error"); setMsg("the transaction didn't go through. nothing was taken from your wallet."); setPending(null);
    }
  }, [w.userOp.data, pending, w]);

  const isCreator = d.createdBy === meId;
  const status = state?.status ?? 0;
  const expired = state ? state.fundingDeadline > 0 && Date.now() / 1000 > state.fundingDeadline : false;
  const action: "create" | "accept" | "refund" | "settle" | null =
    status === 0 ? (isCreator && d.status === "pending" ? "create" : null)
      : status === 1 && expired ? "refund"
        : status === 1 && !state?.mine ? "accept"
          : status === 2 && d.status === "completed" ? "settle" : null;
  const short = (w.usdc.formatted ?? 0) < d.stake && (action === "create" || action === "accept");
  const moving = action === "create" || action === "accept";

  const go = async () => {
    if (!action) return;
    setMsg(null); setPhase("preparing");
    try {
      setPhase("sending");
      const r = await w.runDuelAction(action, d.id);
      setPending({ intentId: r.intentId, userOpHash: r.userOperationHash });
      setOpen(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : "something went wrong";
      setPhase("error");
      setMsg(/sponsor|paymaster/i.test(m) ? `gas sponsorship was refused, so nothing was sent. ${m}` : m);
    }
  };

  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><Lock size={16} /> onchain stake</p>
        <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-semibold text-ink-soft">base sepolia · test usdc</span>
      </div>
      {error && <p className="mt-2 text-sm text-loss">{error}</p>}
      <p className="mt-1 text-[13px] text-muted">
        escrow: {state ? `${ESCROW_STATUS[status]}${status === 1 ? ` (${state.deposits}/${state.participants})` : ""}` : "checking…"}
        {state?.mine && " · your stake is locked"}
      </p>
      {!w.isSignedIn ? (
        <Link href="/wallet" className="btn-outline btn-sm mt-3"><Link2 size={15} /> set up your wallet to stake test usdc</Link>
      ) : action ? (
        <>
          <button className="btn-primary btn-sm mt-3" disabled={phase === "sending" || phase === "preparing" || !!pending} onClick={() => { setAgree(false); setOpen(true); }}>
            {pending ? <><Loader2 size={15} className="animate-spin" /> confirming onchain…</> : action === "refund" ? "get my stake back" : action === "settle" ? "release the payout" : `lock ${usd(d.stake, 0)} test usdc`}
          </button>
          {short && <p className="mt-2 text-xs text-gold">you have {usd(w.usdc.formatted ?? 0)} test usdc. you need {usd(d.stake, 0)}. gas is free, usdc isn't. <Link href="/wallet" className="underline">top up</Link></p>}
        </>
      ) : status === 0 && !isCreator ? (
        <p className="mt-2 text-xs text-muted">the creator opens the onchain escrow first. then you can lock your stake.</p>
      ) : null}
      {phase === "done" && <p className="mt-2 flex items-center gap-1.5 text-sm text-gain"><CheckCircle2 size={15} /> verified onchain.</p>}
      {phase === "error" && msg && <p className="mt-2 flex items-start gap-1.5 text-sm text-loss"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{msg}</p>}

      <Sheet open={open} onClose={() => setOpen(false)} title={action === "refund" ? "get your stake back" : action === "settle" ? "release the payout" : "lock your stake"}>
        <div className="card divide-y text-[15px]">
          {[
            ...(action === "settle" ? [
              ["what happens", d.settlement?.status === "draw" ? "everyone's stake goes back" : `the pot (${usd(d.stake * d.participants.length, 0)}) goes to the winner`],
              ["based on", "beef's verified result, signed by its settlement service"],
            ] : [
              ["amount", action === "refund" ? "your full stake" : `${usd(d.stake, 0)} test usdc`],
              ["goes to", `beef escrow ${shortAddress(ESCROW_ADDRESS)}`],
              ["released", action === "refund" ? "now, back to your wallet" : "to the winner after the official close, or back to everyone on a draw"],
            ]),
            ["network", "base sepolia (test network)"],
            ["gas", "covered by beef"],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><span className="text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>)}
        </div>
        {moving && (
          <label className="mt-3 flex items-start gap-3 text-sm text-ink-soft">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#1D1D1F]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>i authorise the beef escrow to take exactly {usd(d.stake, 0)} test usdc from my wallet for this duel. it's a one-time approval for this amount only.</span>
          </label>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Sparkles size={12} className="text-gold" /> test usdc has no real value. no real money moves on beef.</p>
        <button className="btn-primary mt-4 w-full" disabled={(moving && (!agree || short)) || phase === "sending"} onClick={go}>
          {phase === "sending" ? <><Loader2 size={16} className="animate-spin" /> sending…</> : "confirm"}
        </button>
      </Sheet>
      {w.userOp.data?.transactionHash && <a className="mt-2 block text-xs text-brand-dark underline" href={`${EXPLORER}/tx/${w.userOp.data.transactionHash}`} target="_blank" rel="noreferrer">view transaction</a>}
    </div>
  );
}

/** shows on duel pages in live mode when wallets are configured */
export function OnchainStake({ d, meId }: { d: Duel; meId: string | null }) {
  const ready = useCdpReady();
  if (!cdpEnabled() || !REMOTE || !meId || !d.participants.some((p) => p.userId === meId)) return null;
  if (!["pending", "accepted", "active", "completed"].includes(d.status)) return null;
  if (!ESCROW_ADDRESS) {
    return (
      <div className="card mt-4 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><Lock size={16} /> onchain stake</p>
        <p className="mt-1 text-muted">staking test usdc onchain switches on once the beef escrow contract is deployed on base sepolia. this duel uses practice money.</p>
      </div>
    );
  }
  if (!ready) return <div className="card mt-4 p-4"><div className="skeleton h-5 w-32" /></div>;
  return <Inner d={d} meId={meId} />;
}
