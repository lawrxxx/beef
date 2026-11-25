import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/market";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 40);
  const p = getMarketProvider();
  const results = (await p.search(q)).map(({ ticker, name, sector }) => ({ ticker, name, sector }));
  return NextResponse.json({ results });
}
