import { NextResponse } from "next/server";
import { cdpServerConfigured } from "@/lib/server/cdp";
import { CHAIN_ID, ESCROW_ADDRESS, PREVIOUS_ESCROWS, USDC_ADDRESS } from "@/lib/chain/config";
import { getAdminSupabase } from "@/lib/supabase/server";
import { oracleConfigured, oracleStatus } from "@/lib/server/oracle";
import { escrowLimits } from "@/lib/server/wallet-deps";
import { STAKE_MAX_UNITS, STAKE_MIN_UNITS, formatUsdc } from "@/lib/stake";

export const dynamic = "force-dynamic";

/** what the wallet layer can do in this deployment (no secrets, just booleans) */
export async function GET() {
  const onchain = await escrowLimits();
  return NextResponse.json({
    chainId: CHAIN_ID, usdc: USDC_ADDRESS, escrow: ESCROW_ADDRESS, previousEscrows: PREVIOUS_ESCROWS.filter((a) => a !== ESCROW_ADDRESS),
    verification: cdpServerConfigured(), sponsorship: process.env.NEXT_PUBLIC_PAYMASTER === "proxy" ? Boolean(process.env.CDP_PAYMASTER_URL) : true, paymaster: process.env.NEXT_PUBLIC_PAYMASTER === "proxy" ? "beef proxy" : "cdp", database: Boolean(getAdminSupabase()), oracle: oracleConfigured(), oracleKey: oracleStatus(),
    stakeLimits: {
      app: { min: formatUsdc(STAKE_MIN_UNITS), max: formatUsdc(STAKE_MAX_UNITS) },
      escrow: onchain ? { min: formatUsdc(onchain.min), max: formatUsdc(onchain.max) } : null,
      match: !!onchain && onchain.min === STAKE_MIN_UNITS && onchain.max === STAKE_MAX_UNITS,
    },
  });
}
