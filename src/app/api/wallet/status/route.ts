import { NextResponse } from "next/server";
import { cdpServerConfigured } from "@/lib/server/cdp";
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS } from "@/lib/chain/config";
import { liveMode } from "@/lib/server/wallet-deps";

export const dynamic = "force-dynamic";

/** what the wallet layer can do in this deployment (no secrets, just booleans) */
export async function GET() {
  return NextResponse.json({
    chainId: CHAIN_ID, usdc: USDC_ADDRESS, escrow: ESCROW_ADDRESS,
    verification: cdpServerConfigured(), sponsorship: Boolean(process.env.CDP_PAYMASTER_URL), liveMode: liveMode(),
  });
}
