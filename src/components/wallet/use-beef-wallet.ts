"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useCurrentUser, useGetAccessToken, useIsInitialized, useIsSignedIn, useSendUserOperation,
} from "@coinbase/cdp-hooks";
import { createPublicClient, erc20Abi, formatUnits, http, type Address, type Hex } from "viem";
import { CDP_NETWORK, CHAIN, USDC_ADDRESS, USDC_DECIMALS, assertBaseSepolia, CHAIN_ID } from "@/lib/chain/config";
import { deserializeCalls } from "@/lib/wallet/calls";

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

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

/** wraps a wallet action so its error is friendly */
export const friendly = <T,>(fn: () => Promise<T>) => async () => { try { return await fn(); } catch (e) { throw friendlyWalletError(e); } };

async function api<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `request failed (${res.status})`);
  return j as T;
}

/** everything the beef ui needs from the embedded wallet, in one place */
export function useBeefWallet() {
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { currentUser } = useCurrentUser();
  const { getAccessToken } = useGetAccessToken();
  const userOp = useSendUserOperation();

  const smartAccount = (currentUser?.evmSmartAccountObjects?.[0]?.address ?? currentUser?.evmSmartAccounts?.[0] ?? null) as Address | null;
  const eoa = (currentUser?.evmAccountObjects?.[0]?.address ?? currentUser?.evmAccounts?.[0] ?? null) as Address | null;

  const [usdc, setUsdc] = useState<{ value: bigint | null; loading: boolean; error: string | null }>({ value: null, loading: false, error: null });
  const [link, setLink] = useState<LinkState>({ status: "idle" });
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const refreshBalance = useCallback(async () => {
    if (!smartAccount) return;
    setUsdc((u) => ({ ...u, loading: true }));
    try {
      const value = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [smartAccount] });
      setUsdc({ value, loading: false, error: null });
    } catch {
      setUsdc((u) => ({ ...u, loading: false, error: "couldn't load your balance from base sepolia" }));
    }
  }, [smartAccount]);

  const token = useCallback(async () => {
    const t = await getAccessToken();
    if (!t) throw new Error("your wallet session ended. sign in again.");
    return t;
  }, [getAccessToken]);

  const refreshActivity = useCallback(async () => {
    try {
      const r = await api<{ linked: boolean; items: ActivityItem[] }>("/api/wallet/activity", { accessToken: await token() });
      setActivity(r.items);
    } catch { /* shown via link state */ }
  }, [token]);

  // link (or re-confirm) the wallet with the beef account once per session
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!isSignedIn || !smartAccount || linked.current === smartAccount) return;
    linked.current = smartAccount;
    (async () => {
      setLink({ status: "linking" });
      try {
        await api("/api/wallet/link", { accessToken: await token() });
        setLink({ status: "linked" });
        void refreshActivity();
      } catch (e) {
        setLink({ status: "error", message: e instanceof Error ? e.message : "couldn't link your wallet" });
      }
    })();
  }, [isSignedIn, smartAccount, token, refreshActivity]);

  useEffect(() => {
    void refreshBalance();
    if (!smartAccount) return;
    const id = setInterval(refreshBalance, 20_000);
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
      paymasterUrl: `${window.location.origin}/api/paymaster`,
      paymasterContext: { intentId: prepared.intentId },
      idempotencyKey: prepared.intentId, // a double tap can't submit twice
    }))();
    return { intentId: prepared.intentId, userOperationHash, accessToken };
  }, [smartAccount, token, userOp]);

  const confirm = useCallback(async (p: { intentId: string; userOpHash: Hex; txHash: Hex }) => {
    const r = await api<{ status: string }>("/api/wallet/confirm", { accessToken: await token(), ...p });
    void refreshActivity();
    void refreshBalance();
    return r.status;
  }, [token, refreshActivity, refreshBalance]);

  const committedUnits = activity
    .filter((a) => a.status === "confirmed" && (a.action === "create" || a.action === "accept"))
    .reduce((s, a) => s + BigInt(a.amountUnits), 0n);

  return {
    isInitialized, isSignedIn, user: currentUser, smartAccount, eoa, link,
    usdc: { ...usdc, formatted: usdc.value == null ? null : Number(formatUnits(usdc.value, USDC_DECIMALS)) },
    committedUsdc: Number(formatUnits(committedUnits, USDC_DECIMALS)),
    activity, refreshActivity, refreshBalance, runDuelAction, confirm,
    userOp: { status: userOp.status, data: userOp.data, error: userOp.error },
  };
}
