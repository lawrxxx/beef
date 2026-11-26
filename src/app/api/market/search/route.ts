import { NextResponse } from "next/server";
import { ASSETS } from "@/lib/market/assets";

/** stocks with chainlink data streams configured */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 40).toLowerCase();
  const results = ASSETS.filter((a) => !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)).map(({ ticker, name, sector }) => ({ ticker, name, sector }));
  return NextResponse.json({ results });
}
