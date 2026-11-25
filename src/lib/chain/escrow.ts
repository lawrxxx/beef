import type { SimTransaction } from "@/lib/types";
import { uid } from "@/lib/format";
import { REAL_MONEY_ENABLED } from "./config";

/**
 * escrow abstraction. the app talks to this interface only. the simulated
 * implementation records ledger entries locally and never fabricates tx hashes or
 * confirmations. an onchain implementation would call BeefEscrow (see /contracts)
 * via viem and only report "confirmed" after a receipt with sufficient confirmations.
 */
export interface EscrowService {
  readonly kind: "simulated" | "onchain";
  lockStake(p: { userId: string; duelId: string; amount: number }): Promise<SimTransaction>;
  payout(p: { userId: string; duelId: string; amount: number; settlementId: string }): Promise<SimTransaction>;
  refund(p: { userId: string; duelId: string; amount: number }): Promise<SimTransaction>;
}

export class SimulatedEscrow implements EscrowService {
  readonly kind = "simulated" as const;
  private tx(kind: SimTransaction["kind"], userId: string, amount: number, duelId?: string): SimTransaction {
    return { id: uid("sim"), userId, kind, amount, duelId, createdAt: new Date().toISOString(), state: "simulated" };
  }
  async lockStake(p: { userId: string; duelId: string; amount: number }) { return this.tx("stake_lock", p.userId, -p.amount, p.duelId); }
  async payout(p: { userId: string; duelId: string; amount: number }) { return this.tx("payout", p.userId, p.amount, p.duelId); }
  async refund(p: { userId: string; duelId: string; amount: number }) { return this.tx("refund", p.userId, p.amount, p.duelId); }
}

export function getEscrow(): EscrowService {
  if (REAL_MONEY_ENABLED) {
    // intentionally not implemented: requires an audited, deployed contract, an oracle
    // that can attest official closes, and regulatory sign-off.
    throw new Error("onchain escrow is not available in this build");
  }
  return new SimulatedEscrow();
}

/** minimal abi for the reference escrow contract in /contracts/BeefEscrow.sol */
export const BEEF_ESCROW_ABI = [
  { type: "function", name: "createDuel", stateMutability: "nonpayable", inputs: [{ name: "duelId", type: "bytes32" }, { name: "stake", type: "uint256" }, { name: "participants", type: "address[]" }, { name: "termsHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "duelId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "duelId", type: "bytes32" }, { name: "winners", type: "address[]" }, { name: "settlementHash", type: "bytes32" }, { name: "oracleSig", type: "bytes" }], outputs: [] },
  { type: "function", name: "refund", stateMutability: "nonpayable", inputs: [{ name: "duelId", type: "bytes32" }], outputs: [] },
  { type: "event", name: "Settled", inputs: [{ name: "duelId", type: "bytes32", indexed: true }, { name: "settlementHash", type: "bytes32", indexed: false }] },
] as const;
