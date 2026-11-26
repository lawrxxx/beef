"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { CHAIN_ID, FAUCET_URL, NETWORK_NAME, shortAddress } from "@/lib/chain/config";
import { formatUsdc } from "@/lib/stake";
import { timeAgo } from "@/lib/format";
import { toast } from "@/components/share";
import { cdpEnabled, useCdpReady } from "./cdp-provider";
import { publicClient, useBeefWallet, useFundingWatch } from "./use-beef-wallet";
import { WalletConnect } from "./wallet-panel";

/** whether the stake step can continue, and why not */
export type StakeWalletStatus = { ready: true } | { ready: false; reason: string };

/**
 * the creator's real base sepolia test usdc balance (smart account, read from circle's
 * usdc contract), shown under the stake options. nothing here is cached or made up:
 * no wallet → no number.
 */
function Inner({ stakeUnits, onStatus }: { stakeUnits: bigint | null; onStatus: (s: StakeWalletStatus) => void }) {
  const w = useBeefWallet();
  const watch = useFundingWatch(w.refreshBalance, w.balance.units);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // the rpc we read balances from must really be base sepolia
  useEffect(() => {
    let alive = true;
    publicClient.getChainId().then((id) => alive && setChainOk(id === CHAIN_ID)).catch(() => alive && setChainOk(null));
    return () => { alive = false; };
  }, []);

  // coming back from the faucet tab: read the chain again
  const { refreshBalance } = w;
  useEffect(() => {
    const onFocus = () => void refreshBalance();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshBalance]);

  const units = w.balance.units;
  const connected = w.isSignedIn && !!w.smartAccount;
  const need = units != null && stakeUnits != null && stakeUnits > units ? stakeUnits - units : null;

  const status: StakeWalletStatus =
    !connected ? { ready: false, reason: "connect your beef wallet to stake" }
      : chainOk === false ? { ready: false, reason: `wrong network: beef only uses ${NETWORK_NAME}` }
        : w.balance.error && units == null ? { ready: false, reason: "couldn't read your balance. tap refresh." }
          : units == null ? { ready: false, reason: "checking your balance on base sepolia…" }
            : need != null ? { ready: false, reason: `you need ${formatUsdc(need)} more test usdc` }
              : { ready: true };
  const key = status.ready ? "ok" : status.reason;
  const last = useRef<string | null>(null);
  useEffect(() => { if (last.current !== key) { last.current = key; onStatus(status); } });

  if (!connected) return <div className="mt-3"><WalletConnect /></div>;

  const refresh = async () => { setRefreshing(true); await w.refreshBalance(); setRefreshing(false); };
  const copy = async () => { await navigator.clipboard.writeText(w.smartAccount!).catch(() => {}); toast("success", "wallet address copied"); };

  return (
    <div className={`mt-2.5 rounded-2xl border px-3 py-2 ${need != null ? "border-gold/40 bg-gold-soft/50" : "bg-surface"}`} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="text-muted">available balance: </span>
          {units != null
            ? <b className="num">{formatUsdc(units)} test usdc</b>
            : w.balance.error ? <span className="text-loss">unavailable</span>
              : <span className="inline-flex items-center gap-1 text-muted"><Loader2 size={13} className="animate-spin" /> loading…</span>}
        </p>
        <button type="button" className="btn-ghost btn-sm !h-8 shrink-0 !px-2" onClick={refresh} disabled={refreshing} aria-label="refresh balance">
          <RefreshCw size={14} className={refreshing || w.balance.loading ? "animate-spin" : ""} /> refresh
        </button>
      </div>
      {w.balance.error && <p className="mt-1 flex items-center gap-1 text-xs text-loss"><AlertTriangle size={12} /> {w.balance.error}</p>}
      {chainOk === false && <p className="mt-1 text-xs text-loss">the balance source isn't {NETWORK_NAME} (chain {CHAIN_ID}). staking is blocked.</p>}
      {need != null && (
        <>
          <p className="mt-1 text-sm font-semibold text-gold">you need {formatUsdc(need)} more test usdc.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a className="btn-dark btn-sm" href={FAUCET_URL} target="_blank" rel="noreferrer" onClick={() => watch.start()}>get test usdc <ExternalLink size={13} /></a>
            <button type="button" className="btn-outline btn-sm" onClick={copy}><Copy size={13} /> copy {shortAddress(w.smartAccount)}</button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            on the faucet pick <b>base sepolia</b> and paste your wallet address.{" "}
            {watch.state === "waiting" ? "waiting for it to arrive onchain…" : watch.state === "timeout" ? "nothing yet. tap refresh once the faucet says it's sent." : "then come back and refresh."}
          </p>
        </>
      )}
      {need == null && units != null && <p className="mt-0.5 text-[11px] text-muted">read from {NETWORK_NAME}{w.balance.at ? ` · updated ${timeAgo(new Date(w.balance.at).toISOString())}` : ""}. you can copy your address <button type="button" className="underline" onClick={copy}>here</button>.</p>}
    </div>
  );
}

export function StakeBalance(props: { stakeUnits: bigint | null; onStatus: (s: StakeWalletStatus) => void }) {
  const ready = useCdpReady();
  const enabled = cdpEnabled();
  useEffect(() => { if (!enabled) props.onStatus({ ready: false, reason: "wallets aren't switched on for this deployment" }); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return <p className="mt-2.5 rounded-2xl border px-3 py-2 text-[13px] text-muted">wallets aren't switched on for this deployment, so stakes can't be locked.</p>;
  if (!ready) return <div className="mt-3 rounded-2xl border px-3 py-2.5"><div className="skeleton h-5 w-48" /></div>;
  return <Inner {...props} />;
}
