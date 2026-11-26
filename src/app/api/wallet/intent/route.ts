import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareIntent } from "@/lib/server/wallet-service";
import { appUserId, cachedVerifier, errorResponse, getWalletRepo, limited, loadDuelForChain, resolveEscrow } from "@/lib/server/wallet-deps";
import { CDP_NETWORK } from "@/lib/chain/config";
import { oracleConfigured, signJoin, signSettlement } from "@/lib/server/oracle";

export const dynamic = "force-dynamic";
const Body = z.object({ accessToken: z.string().min(10).max(8192), action: z.enum(["create", "accept", "refund", "settle"]), duelId: z.string().uuid() });

/** returns the server-built calls for a duel action (the only calls the paymaster will sponsor) */
export async function POST(req: Request) {
  const rl = limited(req, "wallet-intent", 15); if (rl) return rl;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "invalid request" }, { status: 400 });
  try {
    const userId = await appUserId();
    const { intent, summary } = await prepareIntent(
      { accessToken: body.data.accessToken, action: body.data.action, duelId: body.data.duelId, appUserId: userId ?? undefined },
      { verify: cachedVerifier(), repo: getWalletRepo(), loadDuel: loadDuelForChain, sign: oracleConfigured() ? signSettlement : undefined, signJoin: oracleConfigured() ? signJoin : undefined, resolveEscrow },
    );
    return NextResponse.json({ intentId: intent.id, calls: intent.calls, network: CDP_NETWORK, expiresAt: intent.expiresAt, summary });
  } catch (e) { return errorResponse(e); }
}
