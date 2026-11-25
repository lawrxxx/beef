import { NextResponse } from "next/server";
import { z } from "zod";
import { linkWallet } from "@/lib/server/wallet-service";
import { appUserId, cachedVerifier, errorResponse, getWalletRepo, limited, liveMode } from "@/lib/server/wallet-deps";

export const dynamic = "force-dynamic";
const Body = z.object({ accessToken: z.string().min(10).max(8192) });

/**
 * links the signed-in cdp wallet to the beef user. the server verifies the cdp token
 * and reads the wallet addresses from cdp, so the browser can't claim someone else's.
 * live mode: one supabase user ↔ one cdp user ↔ one smart account (unique in postgres).
 */
export async function POST(req: Request) {
  const rl = limited(req, "wallet-link", 10); if (rl) return rl;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "missing wallet session" }, { status: 400 });
  try {
    const verify = cachedVerifier();
    let userId: string | null;
    if (liveMode()) {
      userId = await appUserId();
      if (!userId) return NextResponse.json({ error: "sign in to beef first" }, { status: 401 });
    } else {
      userId = `cdp:${(await verify(body.data.accessToken)).cdpUserId}`; // demo: the wallet is its own identity
    }
    const link = await linkWallet({ appUserId: userId, accessToken: body.data.accessToken }, { verify, repo: getWalletRepo() });
    return NextResponse.json({ link: { smartAccount: link.smartAccount, eoa: link.eoa, authMethods: link.authMethods, linkedAt: link.linkedAt } });
  } catch (e) { return errorResponse(e); }
}
