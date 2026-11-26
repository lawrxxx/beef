"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAuthenticateWithJWT, useCurrentUser, useGetAccessToken, useIsInitialized, useIsSignedIn, useSendUserOperation,
} from "@coinbase/cdp-hooks";
import { createPublicClient, erc20Abi, formatUnits, http, type Address, type Hex } from "viem";
import { CDP_NETWORK, CHAIN, CHAIN_ID, KNOWN_ESCROWS, RPC_URL, USDC_ADDRESS, USDC_DECIMALS, assertBaseSepolia } from "@/lib/chain/config";
import { deserializeCalls, duelIdToBytes32 } from "@/lib/wallet/calls";
import { BEEF_ESCROW_ABI } from "@/lib/wallet/escrow-abi";
import { useBeef } from "@/lib/store/store";
import { CDP_AUTH } from "./cdp-provider";

// one place for everything the ui needs from the wallet. every balance here is read
// from base sepolia: the usdc contract for the wallet, the escrow contract for stakes.

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

export type LinkState = { status: "idle" | "linking" | "linked" | "error"; message?: string };
export interface ActivityItem {
  id: string; action: "create" | "accept" | "refund" | "settle"; duelId: string; amountUnits: string;
  status: "prepared" | "sponsored" | "submitted" | "confirmed" | "failed"; createdAt: string; txHash?: string; error?: string;
}

/** turns raw sdk / network errors into something a person can act on */
export function friendlyWalletError(e: unknown): Error {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/network error|failed to fetch|load failed|networkerror/i.test(m)) return new Error("couldn't reach coinbase. check your connection and try again.");
  if (/unauthori[sz]ed|401|expired|not signed in/i.test(m)) return new Error("your wallet session expired. sign in again.");
  if (/rate|429|too many/i.test(m)) return new Error("too many attempts. wait a minute and try again.");
  if (/invalid.*(otp|code)|otp/i.test(m)) return new Error("that code didn't work. check it or request a new one.");
  if (/user (rejected|cancel)/i.test(m)) return new Error("cancelled. nothing was sent.");
  return e instanceof Error ? e : new Error(m || "something went wrong");
}
export const friendly = <T,>(fn: () => Promise<T>) => async () => { try { return await fn(); } catch (e) { throw friendlyWalletError(e); } };

async function api<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `request failed (${res.status})`);
  return j as T;
}

export const PAYMASTER_MODE: "cdp" | "proxy" = process.env.NEXT_PUBLIC_PAYMASTER === "proxy" ? "proxy" : "cdp";

export const fmtUsdc = (units: bigint | null | undefined) => (units == null ? null : Number(formatUnits(units, USDC_DECIMALS)));

export function useBeefWallet() {
  const s = useBeef();
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { currentUser } = useCurrentUser();
  const { getAccessToken } = useGetAccessToken();
  const { authenticateWithJWT } = useAuthenticateWithJWT();
  const userOp = useSendUserOperation();

  const smartAccount = (currentUser?.evmSmartAccountObjects?.[0]?.address ?? currentUser?.evmSmartAccounts?.[0] ?? null) as Address | null;
  const eoa = (currentUser?.evmAccountObjects?.[0]?.address ?? currentUser?.evmAccounts?.[0] ?? null) as Address | null;

  const [wallet, setWallet] = useState<{ units: bigint | null; loading: boolean; error: string | null; at: number | null }>({ units: null, loading: false, error: null, at: null });
  const [locked, setLocked] = useState<bigint | null>(null);
  const [link, setLink] = useState<LinkState>({ status: "idle" });
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  // duels the signed-in person is in, whose stakes might sit in escrow
  const myEscrowDuels = useMemo(() => s.duels.filter((d) => d.participants.some((p) => p.userId === s.session.userId)
    && ["funded", "active"].includes(d.escrowState ?? "")), [s.duels, s.session.userId]);

  /** usdc in the smart account + stakes the escrow holds for it, both read onchain */
  const refreshBalance = useCallback(async () => {
    if (!smartAccount) return null;
    setWallet((w) => ({ ...w, loading: true }));
    try {
      const units = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [smartAccount] });
      setWallet({ units, loading: false, error: null, at: Date.now() });
      if (KNOWN_ESCROWS.length && myEscrowDuels.length) {
        // stakes can sit in the current escrow or an older one; count what the chain says is ours
        const pairs = KNOWN_ESCROWS.flatMap((escrow) => myEscrowDuels.map((d) => ({ escrow, key: duelIdToBytes32(d.id) })));
        const [res, states] = await Promise.all([
          publicClient.multicall({ contracts: pairs.map((p) => ({ address: p.escrow, abi: BEEF_ESCROW_ABI, functionName: "deposited" as const, args: [p.key, smartAccount] as const })), allowFailure: true }),
          publicClient.multicall({ contracts: pairs.map((p) => ({ address: p.escrow, abi: BEEF_ESCROW_ABI, functionName: "getDuel" as const, args: [p.key] as const })), allowFailure: true }),
        ]);
        let sum = 0n;
        pairs.forEach((_, i) => {
          const dep = res[i]?.status === "success" && res[i].result === true;
          const duel = states[i]?.status === "success" ? (states[i].result as readonly unknown[]) : null;
          const st = duel ? Number(duel[5]) : 0;
          if (dep && duel && (st === 1 || st === 2)) sum += duel[0] as bigint; // the stake the escrow actually holds
        });
        setLocked(sum);
      } else setLocked(0n);
      return units;
    } catch {
      setWallet((w) => ({ ...w, loading: false, error: "couldn't read your balance from base sepolia. try refresh." }));
      return null;
    }
  }, [smartAccount, myEscrowDuels]);

  const token = useCallback(async () => {
    const t = await getAccessToken();
    if (!t) throw new Error("your wallet session ended. connect it again.");
    return t;
  }, [getAccessToken]);

  const refreshActivity = useCallback(async () => {
    try {
      const r = await api<{ linked: boolean; items: ActivityItem[] }>("/api/wallet/activity", { accessToken: await token() });
      setActivity(r.items);
    } catch { /* link state shows problems */ }
  }, [token]);

  /** supabase custom-auth mode: one tap, the beef session is the wallet login */
  const connectWithBeefAccount = useCallback(async () => {
    await friendly(() => authenticateWithJWT())();
  }, [authenticateWithJWT]);

  // verify + link the wallet to the beef account once per session (idempotent server side)
  const linked = useRef<string | null>(null);
  const relink = useCallback(async () => {
    if (!smartAccount) return;
    setLink({ status: "linking" });
    try {
      await api("/api/wallet/link", { accessToken: await token() });
      setLink({ status: "linked" });
      void refreshActivity();
    } catch (e) {
      setLink({ status: "error", message: e instanceof Error ? e.message : "couldn't link your wallet" });
    }
  }, [smartAccount, token, refreshActivity]);
  useEffect(() => {
    if (!isSignedIn || !smartAccount || !s.session.userId || linked.current === smartAccount) return;
    linked.current = smartAccount;
    void relink();
  }, [isSignedIn, smartAccount, s.session.userId, relink]);

  useEffect(() => {
    void refreshBalance();
    if (!smartAccount) return;
    const id = setInterval(refreshBalance, 30_000);
    return () => clearInterval(id);
  }, [smartAccount, refreshBalance]);

  /**
   * prepares a duel action on the server, then sends exactly those calls as one
   * sponsored user operation on base sepolia. the paymaster url is always set, so an
   * unsponsored operation is never sent: if sponsorship is refused, this throws.
   */
  const runDuelAction = useCallback(async (action: "create" | "accept" | "refund" | "settle", duelId: string) => {
    if (!smartAccount) throw new Error("your wallet isn't ready yet");
    const accessToken = await token();
    const prepared = await api<{ intentId: string; calls: { to: string; value: string; data: string }[]; network: string }>(
      "/api/wallet/intent", { accessToken, action, duelId },
    );
    if (prepared.network !== CDP_NETWORK) throw new Error("refusing to send outside base sepolia");
    assertBaseSepolia(CHAIN_ID);
    const { userOperationHash } = await friendly(() => userOp.sendUserOperation({
      evmSmartAccount: smartAccount,
      network: CDP_NETWORK,
      calls: deserializeCalls(prepared.calls),
      // gas: coinbase's paymaster on base sepolia, limited in the cdp portal to usdc.approve and the
      // escrow's createDuel/join/refund/settle. NEXT_PUBLIC_PAYMASTER=proxy routes through beef's own
      // /api/paymaster instead (needs a publicly reachable url that cdp accepts).
      ...(PAYMASTER_MODE === "proxy"
        ? { paymasterUrl: `${window.location.origin}/api/paymaster`, paymasterContext: { intentId: prepared.intentId } }
        : { useCdpPaymaster: true }),
      idempotencyKey: prepared.intentId, // a double tap can't submit twice
    }))();
    return { intentId: prepared.intentId, userOperationHash };
  }, [smartAccount, token, userOp]);

  const confirm = useCallback(async (p: { intentId: string; userOpHash: Hex; txHash: Hex }) => {
    const r = await api<{ status: string }>("/api/wallet/confirm", { accessToken: await token(), ...p });
    void refreshActivity();
    void refreshBalance();
    return r.status;
  }, [token, refreshActivity, refreshBalance]);

  const available = fmtUsdc(wallet.units);
  const lockedUsdc = fmtUsdc(locked) ?? 0;

  return {
    authMode: CDP_AUTH, isInitialized, isSignedIn, user: currentUser, smartAccount, eoa, link, relink,
    connectWithBeefAccount,
    balance: {
      available, locked: lockedUsdc, total: available == null ? null : available + lockedUsdc, loading: wallet.loading, error: wallet.error, at: wallet.at,
      units: wallet.units, lockedUnits: locked, totalUnits: wallet.units == null ? null : wallet.units + (locked ?? 0n),
    },
    activity, refreshActivity, refreshBalance, runDuelAction, confirm,
    userOp: { status: userOp.status, data: userOp.data, error: userOp.error },
  };
}

/**
 * after someone opens the faucet: poll the onchain balance until it goes up (or give
 * up after a few minutes). never claims tokens arrived until the chain says so.
 */
export function useFundingWatch(refresh: () => Promise<bigint | null>, current: bigint | null) {
  const [state, setState] = useState<"idle" | "waiting" | "arrived" | "timeout">("idle");
  const base = useRef<bigint | null>(null);
  const start = useCallback(() => { base.current = current ?? 0n; setState("waiting"); }, [current]);
  useEffect(() => {
    if (state !== "waiting") return;
    let n = 0;
    const tick = async () => {
      n++;
      const v = await refresh();
      if (v != null && base.current != null && v > base.current) setState("arrived");
      else if (n >= 36) setState("timeout"); // ~3 minutes
    };
    const id = setInterval(tick, 5000);
    const onFocus = () => void tick(); // coming back from the faucet tab
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [state, refresh]);
  return { state, start, reset: () => setState("idle") };
}
