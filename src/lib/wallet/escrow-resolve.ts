import type { Address, PublicClient } from "viem";
import { ESCROW_ADDRESS, KNOWN_ESCROWS } from "@/lib/chain/config";
import { BEEF_ESCROW_ABI } from "./escrow-abi";
import { duelIdToBytes32 } from "./calls";

/**
 * which escrow holds a duel, read from base sepolia: the first known escrow where the
 * duel exists. a duel that isn't onchain yet opens on the current escrow.
 */
export async function resolveDuelEscrow(client: Pick<PublicClient, "readContract">, duelId: string): Promise<Address | null> {
  const key = duelIdToBytes32(duelId);
  for (const escrow of KNOWN_ESCROWS) {
    const d = await client.readContract({ address: escrow, abi: BEEF_ESCROW_ABI, functionName: "getDuel", args: [key] });
    if (Number(d[5]) !== 0) return escrow;
  }
  return ESCROW_ADDRESS;
}
