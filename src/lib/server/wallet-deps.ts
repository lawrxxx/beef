import "server-only";
import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { resolveDuelEscrow } from "@/lib/wallet/escrow-resolve";
import { etLabel, scheduleFor, startOpenFor, type ExpirationType } from "@/lib/expiration";
import { BEEF_ESCROW_ABI } from "@/lib/wallet/escrow-abi";
import { CHAIN, ESCROW_ADDRESS } from "@/lib/chain/config";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { SupabaseWalletRepo, type WalletRepo } from "./wallet-repo";
import { verifyWithCdp, type EndUserVerifier, type VerifiedEndUser } from "./cdp";
import { WalletError, type DuelForChain } from "./wallet-service";
import type { Settlement } from "@/lib/types";
import { clientKey, rateLimit } from "./rate-limit";

/** wallet records live in postgres (written with the service role only) */
export function getWalletRepo(): WalletRepo {
  const admin = getAdminSupabase();
  if (!admin) throw new WalletError("beef isn't connected to its database", 503);
  return new SupabaseWalletRepo(admin);
}

export const verifier: EndUserVerifier = verifyWithCdp;

/** the beef user making the request. from the supabase session. */
export async function appUserId(): Promise<string | null> {
  const sb = await getServerSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}


export async function loadDuelForChain(duelId: string): Promise<DuelForChain | null> {
  const db = getAdminSupabase();
  if (!db) throw new WalletError("beef isn't connected to its database", 503);
  const { data: d } = await db.from("duels").select("id,created_by,status,stake,deadline,calculation_version,methodology,is_open,escrow_state,expiration_type,duel_settlements(status,winner_ids,payload)").eq("id", duelId).maybeSingle();
  if (!d) return null;
  const { data: ps } = await db.from("duel_participants").select("user_id,ticker").eq("duel_id", duelId);
  const parts = (ps ?? []).map((p: any) => ({ userId: p.user_id ?? "", ticker: p.ticker }));
  parts.sort((a, b) => (a.userId === d.created_by ? -1 : b.userId === d.created_by ? 1 : a.ticker.localeCompare(b.ticker)));
  return {
    id: d.id, createdBy: d.created_by, status: d.status, stake: Number(d.stake), deadline: new Date(d.deadline).toISOString(),
    calculationVersion: d.calculation_version, methodology: d.methodology, participants: parts,
    open: !!(d as any).is_open,
    escrowState: (d as any).escrow_state,
    expirationType: (d as any).expiration_type ?? undefined,
    settlement: settlementOf((d as any).duel_settlements),
  };
}

function settlementOf(raw: any): DuelForChain["settlement"] {
  const st = Array.isArray(raw) ? raw[0] : raw;
  if (!st) return undefined;
  return { status: st.status, winners: st.winner_ids ?? [], payload: (st.payload as Settlement) ?? null };
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

/** the escrow that already holds a duel on base sepolia (or the current one for new duels) */
export const resolveEscrow = (duelId: string) => resolveDuelEscrow(publicClient, duelId);

/** the deployed escrow's stake limits, read from base sepolia */
export async function escrowLimits() {
  if (!ESCROW_ADDRESS) return null;
  try {
    const [min, max] = await Promise.all([
      publicClient.readContract({ address: ESCROW_ADDRESS, abi: BEEF_ESCROW_ABI, functionName: "minStake" }),
      publicClient.readContract({ address: ESCROW_ADDRESS, abi: BEEF_ESCROW_ABI, functionName: "maxStake" }),
    ]);
    return { min: min as bigint, max: max as bigint };
  } catch { return null; } // an escrow without configurable limits (the old fixed-25 contract)
}

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

/**
 * applies a verified onchain result to the database (service role). called exactly once
 * per confirmed intent, after the receipt and escrow event were checked.
 */
/**
 * activation: once everyone has joined (status 'accepted'), fix the schedule exactly once.
 * start = the first market open after activation; next_open / one_week deadlines are computed
 * from it, custom deadlines stay as agreed (they were checked before the join was allowed).
 */
export async function activateIfReady(duelId: string, now: Date) {
  const db = getAdminSupabase();
  if (!db) return;
  const { data: d } = await db.from("duels").select("id,status,start_at,expiration_type,deadline").eq("id", duelId).maybeSingle();
  if (!d || d.status !== "accepted" || d.start_at) return;
  const type = (d.expiration_type ?? "custom") as ExpirationType;
  let sched: { startAt: Date; deadline: Date };
  try { sched = scheduleFor(type, now, d.deadline); }
  catch { sched = { startAt: startOpenFor(now), deadline: new Date(d.deadline) }; } // custom that turned invalid: settlement will reject, never guess
  const patch: Record<string, string> = { start_at: sched.startAt.toISOString(), activated_at: now.toISOString() };
  if (type !== "custom") { patch.deadline = sched.deadline.toISOString(); patch.deadline_label = etLabel(sched.deadline); }
  const { error } = await db.from("duels").update(patch).eq("id", duelId).eq("status", "accepted").is("start_at", null);
  if (error) throw new Error(`activation: ${error.message}`);
}

export async function applyConfirmed(i: { action: string; duelId: string; userId: string; txHash: string }) {
  const db = getAdminSupabase();
  if (!db) return;
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
  };
  if (i.action === "create") await call("set_escrow_state", { p_duel: i.duelId, p_state: "funded", p_tx: i.txHash });
  else if (i.action === "accept") {
    await call("accept_duel_for", { p_duel: i.duelId, p_user: i.userId, p_tx: i.txHash });
    await activateIfReady(i.duelId, new Date());
  }
  else if (i.action === "settle") await call("set_escrow_state", { p_duel: i.duelId, p_state: "settled", p_tx: i.txHash });
  else if (i.action === "refund") await call("set_escrow_state", { p_duel: i.duelId, p_state: "refunded", p_tx: i.txHash });
}
