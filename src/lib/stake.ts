import { formatUnits, parseUnits } from "viem";
import { USDC_DECIMALS } from "@/lib/chain/config";

// stake amounts in test usdc. everything that touches token amounts goes through
// bigint base units (6 decimals) via viem's parseUnits / formatUnits, never float math.
//
// the limits are configurable (NEXT_PUBLIC_STAKE_MIN_USDC / NEXT_PUBLIC_STAKE_MAX_USDC)
// and must match the deployed escrow's immutable minStake / maxStake and the database's
// duels_stake_check. /api/wallet/status reports whether the app and the contract agree.

export const STAKE_DECIMALS = 2; // stakes are whole cents of test usdc
export const STAKE_PRESETS = ["1", "5", "10", "20", "25"] as const;

const AMOUNT_RE = /^\d+(\.\d+)?$/;

function limit(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  return AMOUNT_RE.test(v) ? v : fallback;
}
export const STAKE_MIN = limit(process.env.NEXT_PUBLIC_STAKE_MIN_USDC, "1");
export const STAKE_MAX = limit(process.env.NEXT_PUBLIC_STAKE_MAX_USDC, "1000");
export const STAKE_MIN_UNITS = parseUnits(STAKE_MIN, USDC_DECIMALS);
export const STAKE_MAX_UNITS = parseUnits(STAKE_MAX, USDC_DECIMALS);

/** base units → "35.50" (always two decimals; more if the amount really has them) */
export function formatUsdc(units: bigint): string {
  const s = formatUnits(units, USDC_DECIMALS);
  const [i, f = ""] = s.split(".");
  return `${i}.${f.padEnd(STAKE_DECIMALS, "0")}`;
}

/** a stake as stored in the database (numeric(10,2), arrives as a js number) → base units */
export function stakeUnits(stake: number | string): bigint {
  // 6 places, not 2: a stray sub-cent value stays visible and fails the whole-cents check
  const s = typeof stake === "number" ? stake.toFixed(USDC_DECIMALS) : stake.trim();
  return parseUnits(s, USDC_DECIMALS);
}

/** "35.50 test usdc" from a stored stake */
export const fmtStake = (stake: number | string) => formatUsdc(stakeUnits(stake));

/** every participant pays the same stake; the pot is the sum of their deposits */
export const prizePoolUnits = (stake: bigint, participants: number) => stake * BigInt(participants);

export type StakeCheck = { ok: true; units: bigint; value: string } | { ok: false; error: string };

/** validates typed or picked stake input against format and the configured limits */
export function parseStakeInput(input: string): StakeCheck {
  const v = input.trim().replace(/^\+/, "");
  if (!v) return { ok: false, error: "enter a stake" };
  if (v.startsWith("-")) return { ok: false, error: "a stake can't be negative" };
  if (!/^\d*\.?\d*$/.test(v) || v === ".") return { ok: false, error: "enter a number, like 35.50" };
  const [, frac = ""] = v.split(".");
  if (frac.length > STAKE_DECIMALS) return { ok: false, error: `use at most ${STAKE_DECIMALS} decimal places` };
  const units = parseUnits(v.startsWith(".") ? `0${v}` : v.endsWith(".") ? v.slice(0, -1) : v, USDC_DECIMALS);
  if (units === 0n) return { ok: false, error: "a stake has to be more than zero" };
  if (units < STAKE_MIN_UNITS) return { ok: false, error: `the minimum stake is ${formatUsdc(STAKE_MIN_UNITS)} test usdc` };
  if (units > STAKE_MAX_UNITS) return { ok: false, error: `the maximum stake is ${formatUsdc(STAKE_MAX_UNITS)} test usdc` };
  return { ok: true, units, value: formatUsdc(units) };
}

/** server-side: is a stored stake inside the configured limits and on whole cents? */
export function stakeWithinLimits(stake: number | string): boolean {
  try {
    const u = stakeUnits(stake);
    return u >= STAKE_MIN_UNITS && u <= STAKE_MAX_UNITS && u % 10_000n === 0n;
  } catch { return false; }
}
