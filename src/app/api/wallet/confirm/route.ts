import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmIntent } from "@/lib/server/wallet-service";
import { cachedVerifier, errorResponse, getReceipt, getWalletRepo, limited } from "@/lib/server/wallet-deps";

export const dynamic = "force-dynamic";
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Body = z.object({ accessToken: z.string().min(10).max(8192), intentId: z.string().uuid(), userOpHash: hash, txHash: hash });

/** verifies the mined receipt on base sepolia before beef records the stake as locked */
export async function POST(req: Request) {
  const rl = limited(req, "wallet-confirm", 30); if (rl) return rl;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const intent = await confirmIntent(body.data as any, { repo: getWalletRepo(), verify: cachedVerifier(), getReceipt });
    return NextResponse.json({ status: intent.status, txHash: intent.txHash ?? null });
  } catch (e) { return errorResponse(e); }
}
