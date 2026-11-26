import "server-only";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID } from "@/lib/chain/config";
import { duelIdToBytes32 } from "@/lib/wallet/calls";

// signs settlement results for the escrow. the key lives only in server env
// (SETTLEMENT_ORACLE_PRIVATE_KEY); its address is the escrow's immutable `oracle`.
// it can only release funds according to a result, to that duel's participants.

/** must equal BeefEscrow.settlementDigest (bound to chain id + escrow address) */
export function settlementDigest(p: { escrow: Address; duelId: string; termsHash: Hex; winners: Address[]; settlementHash: Hex }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address[]" }, { type: "bytes32" }],
    [BigInt(CHAIN_ID), p.escrow, duelIdToBytes32(p.duelId), p.termsHash, p.winners, p.settlementHash],
  ));
}

/** must equal BeefEscrow.joinDigest: lets exactly `who` take an open slot in this duel */
export function joinDigest(p: { escrow: Address; duelId: string; who: Address }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }],
    ["beef.join", BigInt(CHAIN_ID), p.escrow, duelIdToBytes32(p.duelId), p.who],
  ));
}

/** the oracle key from env, tolerant of pasted whitespace, quotes or a missing 0x */
export function oracleKey(): Hex | undefined {
  const raw = (process.env.SETTLEMENT_ORACLE_PRIVATE_KEY ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const k = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : undefined;
}

/** public info only: whether the key is set, and the address it signs as */
export function oracleStatus(): { state: "missing" | "malformed" | "ok"; address?: Address } {
  if (!(process.env.SETTLEMENT_ORACLE_PRIVATE_KEY ?? "").trim()) return { state: "missing" };
  const k = oracleKey();
  return k ? { state: "ok", address: privateKeyToAccount(k).address } : { state: "malformed" };
}

export async function signJoin(p: Parameters<typeof joinDigest>[0], key = oracleKey()): Promise<Hex> {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("settlement oracle key isn't configured on the server");
  return privateKeyToAccount(key).signMessage({ message: { raw: joinDigest(p) } });
}

export const oracleConfigured = () => !!oracleKey();

export async function signSettlement(p: Parameters<typeof settlementDigest>[0], key = oracleKey()): Promise<Hex> {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("settlement oracle key isn't configured on the server");
  return privateKeyToAccount(key).signMessage({ message: { raw: settlementDigest(p) } });
}
