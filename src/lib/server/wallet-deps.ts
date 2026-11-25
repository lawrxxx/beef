import "server-only";
import { NextResponse } from "next/server";
import { createPublicClient, http, keccak256, toHex, type Hex } from "viem";
import { CHAIN } from "@/lib/chain/config";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { MemoryWalletRepo, SupabaseWalletRepo, type WalletRepo } from "./wallet-repo";
import { verifyWithCdp, type EndUserVerifier, type VerifiedEndUser } from "./cdp";
import { WalletError, type DuelForChain } from "./wallet-service";
import { clientKey, rateLimit } from "./rate-limit";

const g = globalThis as unknown as { __beefWalletRepo?: MemoryWalletRepo };

/** live mode: postgres (service role). demo mode: server memory (resets on redeploy). */
export function getWalletRepo(): WalletRepo {
  const admin = getAdminSupabase();
  if (admin) return new SupabaseWalletRepo(admin);
  return (g.__beefWalletRepo ??= new MemoryWalletRepo());
}

export const verifier: EndUserVerifier = verifyWithCdp;

/** the beef user making the request. live mode: the supabase session. demo mode: none. */
export async function appUserId(): Promise<string | null> {
  const sb = await getServerSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export const liveMode = () => !!getAdminSupabase();

export async function loadDuelForChain(duelId: string): Promise<DuelForChain | null> {
  const db = getAdminSupabase();
  if (!db) throw new WalletError("onchain stakes need live mode (supabase) so every participant has a verified wallet.", 400);
  const { data: d } = await db.from("duels").select("id,created_by,status,stake,deadline,calculation_version,methodology,duel_settlements(status,winner_ids,payload)").eq("id", duelId).maybeSingle();
  if (!d) return null;
  const { data: ps } = await db.from("duel_participants").select("user_id,ticker").eq("duel_id", duelId);
  const parts = (ps ?? []).map((p: any) => ({ userId: p.user_id ?? "", ticker: p.ticker }));
  parts.sort((a, b) => (a.userId === d.created_by ? -1 : b.userId === d.created_by ? 1 : a.ticker.localeCompare(b.ticker)));
  return {
    id: d.id, createdBy: d.created_by, status: d.status, stake: Number(d.stake), deadline: new Date(d.deadline).toISOString(),
    calculationVersion: d.calculation_version, methodology: d.methodology, participants: parts,
    settlement: settlementOf((d as any).duel_settlements),
  };
}

function settlementOf(raw: any): DuelForChain["settlement"] {
  const st = Array.isArray(raw) ? raw[0] : raw;
  if (!st) return undefined;
  return { status: st.status, winners: st.winner_ids ?? [], payloadHash: keccak256(toHex(JSON.stringify(st.payload))) };
}

/** forwards an approved erc-7677 request to the cdp paymaster. the url is a server secret. */
export async function forwardToCdpPaymaster(body: unknown): Promise<unknown> {
  const url = process.env.CDP_PAYMASTER_URL;
  if (!url) throw new Error("CDP_PAYMASTER_URL is not configured");
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`paymaster http ${res.status}`);
  return res.json();
}

const publicClient = createPublicClient({ chain: CHAIN, transport: http(process.env.BASE_SEPOLIA_RPC_URL || undefined) });

export async function getReceipt(txHash: Hex) {
  try { return await publicClient.getTransactionReceipt({ hash: txHash }); } catch { return null; }
}

export function limited(req: Request, route: string, n = 20) {
  const rl = rateLimit(clientKey(req, route), n, 60_000);
  return rl.ok ? null : NextResponse.json({ error: "too many requests, slow down" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
}

export function errorResponse(e: unknown) {
  if (e instanceof WalletError) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : "something went wrong";
  const status = /configured/.test(msg) ? 503 : /verified|session/.test(msg) ? 401 : 500;
  return NextResponse.json({ error: msg }, { status });
}

/** verifies once and reuses the result inside a request */
export function cachedVerifier(): EndUserVerifier & { last?: VerifiedEndUser } {
  let cache: Promise<VerifiedEndUser> | null = null;
  const f = ((t: string) => (cache ??= verifier(t))) as EndUserVerifier & { last?: VerifiedEndUser };
  return f;
}
