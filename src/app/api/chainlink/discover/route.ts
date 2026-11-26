import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/server/chainlink";

export const dynamic = "force-dynamic";

/**
 * stream discovery (admin): lists the streams this data streams account can read, keeps
 * the regular / extended / overnight streams that match chainlink's directory, and
 * stores them in price_streams. requires `authorization: bearer $CRON_SECRET`.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.SETTLEMENT_CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runDiscovery());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "discovery failed" }, { status: 502 });
  }
}
