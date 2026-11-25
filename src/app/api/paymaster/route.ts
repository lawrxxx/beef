import { NextResponse } from "next/server";
import { handlePaymasterRpc } from "@/lib/server/wallet-service";
import { forwardToCdpPaymaster, getWalletRepo, limited } from "@/lib/server/wallet-deps";

export const dynamic = "force-dynamic";

/**
 * erc-7677 paymaster proxy (the `paymasterUrl` beef passes to cdp). cdp calls this
 * while preparing a user operation; we apply beef's sponsorship policy, then forward
 * approved requests to the real cdp paymaster url, which never leaves the server.
 */
export async function POST(req: Request) {
  const rl = limited(req, "paymaster", 120); if (rl) return rl;
  const body = await req.json().catch(() => null);
  const res = await handlePaymasterRpc(body, { repo: getWalletRepo(), forward: forwardToCdpPaymaster });
  return NextResponse.json(res);
}
