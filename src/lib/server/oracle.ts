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

export const oracleConfigured = () => /^0x[0-9a-fA-F]{64}$/.test(process.env.SETTLEMENT_ORACLE_PRIVATE_KEY ?? "");

export async function signSettlement(p: Parameters<typeof settlementDigest>[0], key = process.env.SETTLEMENT_ORACLE_PRIVATE_KEY as Hex | undefined): Promise<Hex> {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("settlement oracle key isn't configured on the server");
  return privateKeyToAccount(key).signMessage({ message: { raw: settlementDigest(p) } });
}
