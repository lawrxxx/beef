import { NextResponse } from "next/server";
import { z } from "zod";
import { linkWallet } from "@/lib/server/wallet-service";
import { cachedVerifier, errorResponse, getWalletRepo, limited } from "@/lib/server/wallet-deps";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const Body = z.object({ accessToken: z.string().min(10).max(8192) });

/**
 * links the signed-in cdp wallet to the signed-in beef (supabase) account. the server
 * verifies the cdp token, checks the wallet's identity matches the beef account (jwt
 * sub or email), and reads the addresses from cdp. one user ↔ one wallet, enforced in
 * postgres. a returning user gets their existing link back.
 */
export async function POST(req: Request) {
  const rl = limited(req, "wallet-link", 10); if (rl) return rl;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "missing wallet session" }, { status: 400 });
  try {
    const sb = await getServerSupabase();
    const { data } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    if (!data.user) return NextResponse.json({ error: "sign in to beef first" }, { status: 401 });
    const link = await linkWallet({ appUserId: data.user.id, appEmail: data.user.email ?? null, accessToken: body.data.accessToken }, { verify: cachedVerifier(), repo: getWalletRepo() });
    return NextResponse.json({ link: { smartAccount: link.smartAccount, eoa: link.eoa, authMethods: link.authMethods, linkedAt: link.linkedAt } });
  } catch (e) { return errorResponse(e); }
}
