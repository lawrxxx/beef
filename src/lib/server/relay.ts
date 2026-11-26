import "server-only";
import { createPublicClient, createWalletClient, decodeEventLog, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, ESCROW_ADDRESS } from "@/lib/chain/config";
import { BEEF_ESCROW_ABI } from "@/lib/wallet/escrow-abi";
import { LEGACY_SETTLE_ABI, duelIdToBytes32, type EscrowResult } from "@/lib/wallet/calls";
import { resolveDuelEscrow } from "@/lib/wallet/escrow-resolve";
import { settlementAttestation } from "@/lib/chainlink/attestation";
import { RESOLUTION_MAX_DELAY_S } from "@/lib/chainlink/feeds";
import { oracleKey, resultDigest, signResult, signSettlement } from "./oracle";
import { getAdminSupabase } from "@/lib/supabase/server";
import { getWalletRepo } from "./wallet-deps";
import type { Settlement } from "@/lib/types";

// the settlement relay: a trusted bridge between two networks.
//
// chainlink feeds live on base mainnet (8453); the beef escrow lives on base sepolia (84532).
// base sepolia can't read base mainnet, so beef's server reads the feeds, works out the
// result (lib/settlement/service.ts), signs it with the settlement oracle key and submits it
// to the escrow, then checks the receipt. the escrow checks the signer, the duel, its
// participants, every price and timestamp and the agreed window, works out the winner itself
// and pays once. base sepolia does NOT independently verify the mainnet feed: anyone can
// re-check the stored round ids against the feed contracts on base mainnet.

const sepolia = createPublicClient({ chain: CHAIN, transport: http(process.env.BASE_SEPOLIA_RPC_URL || undefined) });

export type RelayResult =
  | { status: "confirmed"; txHash: Hex; escrow: Address }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; txHash?: Hex };

/** builds the escrow v3 result in the escrow's own participant order */
export function escrowResultFor(s: Settlement, order: { wallet: Address; ticker: string }[], evidenceHash: Hex): EscrowResult {
  if (!s.window) throw new Error("settlement has no window");
  const entry = (t: string) => { const e = s.entries.find((x) => x.ticker === t); if (!e?.startE18 || !e.endE18) throw new Error(`${t}: missing prices`); return e; };
  const ts = (t: string, kind: "start" | "end") => { const e = s.evidence?.find((x) => x.ticker === t && x.kind === kind); if (!e) throw new Error(`${t}: missing ${kind} observation`); return BigInt(e.observationsTimestamp); };
  return {
    startPrices: order.map((o) => BigInt(entry(o.ticker).startE18!)),
    endPrices: order.map((o) => BigInt(entry(o.ticker).endE18!)),
    startTimes: order.map((o) => ts(o.ticker, "start")),
    endTimes: order.map((o) => ts(o.ticker, "end")),
    startAt: BigInt(s.window.startTimestamp), endAt: BigInt(s.window.endTimestamp), maxDelay: BigInt(RESOLUTION_MAX_DELAY_S),
    evidenceHash,
  };
}

export async function relaySettlement(duelId: string): Promise<RelayResult> {
  const db = getAdminSupabase();
  if (!db) return { status: "failed", reason: "no database" };
  const key = oracleKey();
  if (!key) return { status: "failed", reason: "settlement oracle key isn't configured" };
  const { data: d } = await db.from("duels").select("id,escrow_state,settle_tx,duel_settlements(payload)").eq("id", duelId).maybeSingle();
  if (!d) return { status: "skipped", reason: "duel not found" };
  if (d.settle_tx || d.escrow_state === "settled" || d.escrow_state === "refunded") return { status: "skipped", reason: "already paid out" };
  const raw = (d as { duel_settlements?: { payload: Settlement } | { payload: Settlement }[] }).duel_settlements;
  const s = (Array.isArray(raw) ? raw[0] : raw)?.payload;
  if (!s || (s.status !== "settled" && s.status !== "draw")) return { status: "skipped", reason: "no final result" };

  const escrow = await resolveDuelEscrow(sepolia, duelId);
  if (!escrow) return { status: "failed", reason: "escrow not deployed" };
  const key32 = duelIdToBytes32(duelId);
  const [, chainParts, , termsHash, , chainStatus] = await sepolia.readContract({ address: escrow, abi: BEEF_ESCROW_ABI, functionName: "getDuel", args: [key32] });
  if (Number(chainStatus) !== 2) return { status: "skipped", reason: `escrow status ${chainStatus}, not active` };

  // map the escrow's participant wallets to tickers via verified wallet links
  const { data: ps } = await db.from("duel_participants").select("user_id,ticker").eq("duel_id", duelId);
  const repo = getWalletRepo();
  const byWallet = new Map<string, { userId: string; ticker: string; wallet: Address }>();
  for (const p of ps ?? []) {
    const link = p.user_id ? await repo.getLinkByUser(p.user_id) : null;
    if (link) byWallet.set(getAddress(link.smartAccount), { userId: p.user_id, ticker: p.ticker, wallet: getAddress(link.smartAccount) });
  }
  const order = chainParts.map((a) => byWallet.get(getAddress(a)));
  if (order.some((o) => !o)) return { status: "failed", reason: "a participant's wallet isn't linked to the duel" };
  const participants = order as { userId: string; ticker: string; wallet: Address }[];
  const winnerWallets = s.status === "draw" ? [] : s.winners.map((u) => participants.find((p) => p.userId === u)?.wallet).filter((x): x is Address => !!x);
  const evidenceHash = settlementAttestation({ duelKey: key32, settlement: s, participants, winnerWallets }).hash;

  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ chain: CHAIN, transport: http(process.env.BASE_SEPOLIA_RPC_URL || undefined), account });
  let txHash: Hex;
  try {
    if (escrow === ESCROW_ADDRESS) {
      const result = escrowResultFor(s, participants, evidenceHash);
      const sig = await signResult({ escrow, duelId, termsHash, participants: chainParts as Address[], result });
      if (resultDigest({ escrow, duelId, termsHash, participants: chainParts as Address[], result }) !== await sepolia.readContract({ address: escrow, abi: BEEF_ESCROW_ABI, functionName: "resultDigest", args: [key32, result] })) {
        return { status: "failed", reason: "result digest doesn't match the escrow's" };
      }
      txHash = await wallet.writeContract({ address: escrow, abi: BEEF_ESCROW_ABI, functionName: "settleWithPrices", args: [key32, result, sig] });
    } else {
      // pre-v3 escrow: winners are chosen offchain and bound by the signed attestation hash
      const sig = await signSettlement({ escrow, duelId, termsHash, winners: winnerWallets, settlementHash: evidenceHash });
      txHash = await wallet.writeContract({ address: escrow, abi: LEGACY_SETTLE_ABI, functionName: "settle", args: [key32, winnerWallets, evidenceHash, sig] });
    }
  } catch (e) {
    return { status: "failed", reason: `couldn't submit the payout: ${(e as { shortMessage?: string }).shortMessage ?? (e instanceof Error ? e.message.split("\n")[0] : "error")}` };
  }

  const receipt = await sepolia.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 }).catch(() => null);
  if (!receipt) return { status: "failed", reason: "payout submitted but not confirmed yet", txHash };
  if (receipt.status !== "success") return { status: "failed", reason: "payout transaction reverted", txHash };
  const settled = receipt.logs.some((l) => {
    if (l.address.toLowerCase() !== escrow.toLowerCase()) return false;
    try { const ev = decodeEventLog({ abi: BEEF_ESCROW_ABI, data: l.data, topics: l.topics }); return ev.eventName === "Settled" && (ev.args as { duelId: Hex }).duelId === key32; } catch { return false; }
  });
  if (!settled) return { status: "failed", reason: "receipt has no Settled event for this duel", txHash };
  await db.rpc("set_escrow_state", { p_duel: duelId, p_state: "settled", p_tx: txHash });
  await db.from("settlement_audit_logs").insert({ duel_id: duelId, at: new Date().toISOString(), action: "relay.settled", detail: `escrow ${escrow} tx ${txHash}` });
  return { status: "confirmed", txHash, escrow };
}
