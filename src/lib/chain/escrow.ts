import type { SimTransaction } from "@/lib/types";
import { uid } from "@/lib/format";
import { REAL_MONEY_ENABLED } from "./config";

/**
 * practice-money ledger used by demo duels. it never fabricates tx hashes or
 * confirmations. test-usdc stakes on base sepolia go through the embedded wallet
 * flow instead (lib/wallet, /api/wallet/*, /api/paymaster), which only reports
 * "confirmed" after verifying the mined receipt.
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
    throw new Error("real-money escrow is disabled");
  }
  return new SimulatedEscrow();
}

// the real escrow abi is generated from contracts/BeefEscrow.sol: see lib/wallet/escrow-abi.ts
