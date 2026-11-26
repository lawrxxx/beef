import { decodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { BEEF_ESCROW_ABI } from "./escrow-abi";
import { type Call } from "./calls";
import { STAKE_MAX_UNITS, STAKE_MIN_UNITS } from "@/lib/stake";

// gas sponsorship policy. the paymaster proxy runs every user operation through this
// before asking cdp to sponsor it. anything not explicitly allowed is refused.

export interface SponsorshipPolicy {
  usdc: Address;
  escrow: Address;
  /** escrow functions users may call with sponsored gas */
  escrowFunctions: readonly ("createDuel" | "join" | "refund" | "settle")[];
  minStakeUnits: bigint;
  maxStakeUnits: bigint;
  perUserDailyLimit: number;
  globalDailyLimit: number;
}

export function defaultPolicy(usdc: Address, escrow: Address): SponsorshipPolicy {
  return {
    usdc: getAddress(usdc),
    escrow: getAddress(escrow),
    escrowFunctions: ["createDuel", "join", "refund", "settle"],
    minStakeUnits: STAKE_MIN_UNITS,
    maxStakeUnits: STAKE_MAX_UNITS,
    perUserDailyLimit: Number(process.env.SPONSOR_PER_USER_DAILY ?? 10),
    globalDailyLimit: Number(process.env.SPONSOR_GLOBAL_DAILY ?? 500),
  };
}

export type PolicyResult = { ok: true } | { ok: false; reason: string };
const no = (reason: string): PolicyResult => ({ ok: false, reason });

/**
 * rules:
 * - no native value, ever
 * - only two contracts: test usdc and the beef escrow
 * - usdc: only `approve(escrow, min stake ≤ amount ≤ max stake)`, and only when the same batch then
 *   calls the escrow (so an approval is consumed immediately, never left dangling)
 * - escrow: only allowlisted functions
 */
export function checkCalls(calls: Call[], policy: SponsorshipPolicy): PolicyResult {
  if (calls.length === 0 || calls.length > 4) return no("unexpected number of calls");
  let approvals = 0;
  let escrowCalls = 0;
  for (const c of calls) {
    if (c.value !== 0n) return no("calls may not send eth");
    const to = getAddress(c.to);
    if (to === policy.usdc) {
      let d;
      try { d = decodeFunctionData({ abi: erc20Abi, data: c.data }); } catch { return no("unknown usdc call"); }
      if (d.functionName !== "approve") return no(`usdc.${d.functionName} is not allowed`);
      const [spender, amount] = d.args as [Address, bigint];
      if (getAddress(spender) !== policy.escrow) return no("usdc approvals may only go to the beef escrow");
      if (amount < policy.minStakeUnits || amount > policy.maxStakeUnits) return no("approval amount is outside the stake limits");
      approvals++;
    } else if (to === policy.escrow) {
      let d;
      try { d = decodeFunctionData({ abi: BEEF_ESCROW_ABI, data: c.data }); } catch { return no("unknown escrow call"); }
      if (!(policy.escrowFunctions as readonly string[]).includes(d.functionName)) return no(`escrow.${d.functionName} is not sponsored`);
      if (d.functionName === "createDuel") {
        const stake = d.args[1] as bigint;
        if (stake < policy.minStakeUnits || stake > policy.maxStakeUnits) return no("stake is outside the limits");
      }
      escrowCalls++;
    } else {
      return no(`contract ${to} is not on the allowlist`);
    }
  }
  if (approvals > 0 && escrowCalls === 0) return no("a usdc approval must be followed by an escrow call in the same operation");
  return { ok: true };
}

export function checkLimits(p: { userCount: number; globalCount: number }, policy: SponsorshipPolicy): PolicyResult {
  if (p.userCount >= policy.perUserDailyLimit) return no(`daily sponsored transaction limit reached (${policy.perUserDailyLimit})`);
  if (p.globalCount >= policy.globalDailyLimit) return no("beef's daily gas sponsorship budget is used up. try again tomorrow.");
  return { ok: true };
}
