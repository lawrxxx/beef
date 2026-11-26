import {
  decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi,
  parseUnits, toBytes, type Address, type Hex,
} from "viem";
import { BEEF_ESCROW_ABI } from "./escrow-abi";
import { USDC_DECIMALS } from "@/lib/chain/config";

// transaction building shared by the server (which builds and signs off on calls) and
// the paymaster policy (which re-decodes what a user operation actually does).

export interface Call { to: Address; value: bigint; data: Hex }

/** coinbase smart wallet (cdp smart accounts) entry points for user operations */
export const SMART_WALLET_ABI = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

export const usdcUnits = (amount: number) => parseUnits(amount.toFixed(USDC_DECIMALS), USDC_DECIMALS);

/** onchain duel id: a stable hash of the app's duel id */
export const duelIdToBytes32 = (duelId: string): Hex => keccak256(toBytes(`beef:duel:${duelId}`));

/** hash of the agreed terms. the escrow stores it; the oracle signs over it. */
export function termsHash(t: { duelId: string; stake: number; tickers: string[]; deadline: string; calculationVersion: string; methodology: string }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "string[]" }, { type: "string" }, { type: "string" }, { type: "string" }],
    [t.duelId, usdcUnits(t.stake), t.tickers, new Date(t.deadline).toISOString(), t.calculationVersion, t.methodology],
  ));
}

const approve = (usdc: Address, escrow: Address, amount: bigint): Call => ({
  to: usdc, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, amount] }),
});

/**
 * creator: approve exactly the stake to the escrow, then create the duel (which pulls
 * the stake). batched in one user operation, so no allowance is left behind.
 */
export function buildCreateDuelCalls(p: { usdc: Address; escrow: Address; duelId: string; stake: number; participants: Address[]; termsHash: Hex }): Call[] {
  const amount = usdcUnits(p.stake);
  return [
    approve(p.usdc, p.escrow, amount),
    { to: p.escrow, value: 0n, data: encodeFunctionData({ abi: BEEF_ESCROW_ABI, functionName: "createDuel", args: [duelIdToBytes32(p.duelId), amount, p.participants, p.termsHash] }) },
  ];
}

/** opponent: approve exactly the stake, then take their slot with the oracle's authorisation */
export function buildJoinCalls(p: { usdc: Address; escrow: Address; duelId: string; stake: number; joinSig: Hex }): Call[] {
  return [
    approve(p.usdc, p.escrow, usdcUnits(p.stake)),
    { to: p.escrow, value: 0n, data: encodeFunctionData({ abi: BEEF_ESCROW_ABI, functionName: "join", args: [duelIdToBytes32(p.duelId), p.joinSig] }) },
  ];
}

/** zero address marks an open slot (filled later with `join`) */
export const OPEN_SLOT = "0x0000000000000000000000000000000000000000" as Address;

export function buildRefundCalls(p: { escrow: Address; duelId: string }): Call[] {
  return [{ to: p.escrow, value: 0n, data: encodeFunctionData({ abi: BEEF_ESCROW_ABI, functionName: "refund", args: [duelIdToBytes32(p.duelId)] }) }];
}

/** settle() on escrows deployed before v3 (0xAe3a…, 0x760c…): winners chosen offchain, bound by a signed hash */
export const LEGACY_SETTLE_ABI = parseAbi(["function settle(bytes32 duelId, address[] winners, bytes32 settlementHash, bytes oracleSig)"]);

export function buildSettleCalls(p: { escrow: Address; duelId: string; winners: Address[]; settlementHash: Hex; oracleSig: Hex }): Call[] {
  return [{ to: p.escrow, value: 0n, data: encodeFunctionData({ abi: LEGACY_SETTLE_ABI, functionName: "settle", args: [duelIdToBytes32(p.duelId), p.winners, p.settlementHash, p.oracleSig] }) }];
}

/** escrow v3 price result (arrays in the escrow's participant order) */
export interface EscrowResult {
  startPrices: bigint[];
  endPrices: bigint[];
  startTimes: bigint[];
  endTimes: bigint[];
  startAt: bigint;
  endAt: bigint;
  maxDelay: bigint;
  evidenceHash: Hex;
}
export const RESULT_ABI_TYPE = {
  type: "tuple", components: [
    { name: "startPrices", type: "uint256[]" }, { name: "endPrices", type: "uint256[]" },
    { name: "startTimes", type: "uint64[]" }, { name: "endTimes", type: "uint64[]" },
    { name: "startAt", type: "uint64" }, { name: "endAt", type: "uint64" }, { name: "maxDelay", type: "uint64" }, { name: "evidenceHash", type: "bytes32" },
  ],
} as const;

export function buildSettleWithPricesCalls(p: { escrow: Address; duelId: string; result: EscrowResult; oracleSig: Hex }): Call[] {
  return [{ to: p.escrow, value: 0n, data: encodeFunctionData({ abi: BEEF_ESCROW_ABI, functionName: "settleWithPrices", args: [duelIdToBytes32(p.duelId), p.result, p.oracleSig] }) }];
}

/** decodes a smart account's user operation callData into the calls it will make */
export function decodeSmartAccountCallData(callData: Hex): Call[] {
  const d = decodeFunctionData({ abi: SMART_WALLET_ABI, data: callData });
  if (d.functionName === "execute") {
    const [to, value, data] = d.args;
    return [{ to: getAddress(to), value, data }];
  }
  return d.args[0].map((c) => ({ to: getAddress(c.target), value: c.value, data: c.data }));
}

/** canonical fingerprint of a list of calls (used to bind user operations to intents) */
export function callsHash(calls: Call[]): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }],
    [calls.map((c) => ({ to: getAddress(c.to), value: c.value, data: c.data }))],
  ));
}

/** json-safe form for api responses (bigint -> string) */
export const serializeCalls = (calls: Call[]) => calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data }));
export const deserializeCalls = (calls: { to: string; value: string; data: string }[]): Call[] =>
  calls.map((c) => ({ to: getAddress(c.to), value: BigInt(c.value), data: c.data as Hex }));

/** the escrow an intent talks to: the target of its non-usdc call */
export function escrowOfCalls(calls: { to: string }[], usdc: string): Address | null {
  const c = calls.find((x) => getAddress(x.to) !== getAddress(usdc));
  return c ? getAddress(c.to) : null;
}
