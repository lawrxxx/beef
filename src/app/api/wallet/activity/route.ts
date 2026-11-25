import { NextResponse } from "next/server";
import { z } from "zod";
import { cachedVerifier, errorResponse, getWalletRepo, limited } from "@/lib/server/wallet-deps";

export const dynamic = "force-dynamic";
const Body = z.object({ accessToken: z.string().min(10).max(8192) });

/** the wallet's onchain activity as recorded by beef (prepared → sponsored → confirmed) */
export async function POST(req: Request) {
  const rl = limited(req, "wallet-activity", 30); if (rl) return rl;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const repo = getWalletRepo();
    const eu = await cachedVerifier()(body.data.accessToken);
    const link = await repo.getLinkByCdpUser(eu.cdpUserId);
    if (!link) return NextResponse.json({ linked: false, items: [] });
    const items = (await repo.listIntents(link.userId)).map(({ calls, callsHash, ...rest }) => rest);
    return NextResponse.json({ linked: true, items });
  } catch (e) { return errorResponse(e); }
}
