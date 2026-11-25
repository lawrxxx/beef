import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Address, Hex } from "viem";

// persistence for wallet links, transaction intents and sponsorship decisions.
// only the server writes these (service role in live mode); browsers can read their own.

export interface WalletLink {
  userId: string;          // beef user id (supabase auth uid)
  cdpUserId: string;       // cdp end-user id
  eoa: Address | null;     // embedded signer (owner of the smart account)
  smartAccount: Address;   // the account that holds usdc and talks to the escrow
  authMethods: string[];
  linkedAt: string;
}

export type IntentAction = "create" | "accept" | "refund" | "settle";
export type IntentStatus = "prepared" | "sponsored" | "submitted" | "confirmed" | "failed";

export interface WalletIntent {
  id: string;
  userId: string;
  smartAccount: Address;
  action: IntentAction;
  duelId: string;
  amountUnits: string;     // usdc base units this intent moves out of the wallet ("0" if none)
  callsHash: Hex;
  calls: { to: string; value: string; data: string }[];
  status: IntentStatus;
  createdAt: string;
  expiresAt: string;
  sponsoredAt?: string;
  userOpHash?: Hex;
  txHash?: Hex;
  error?: string;
}

export interface SponsorshipLog {
  at: string; intentId: string | null; sender: string | null; method: string; decision: "allowed" | "refused" | "error"; reason: string;
}

export class ConflictError extends Error {}

export interface WalletRepo {
  getLinkByUser(userId: string): Promise<WalletLink | null>;
  getLinkByCdpUser(cdpUserId: string): Promise<WalletLink | null>;
  getLinkBySmartAccount(addr: Address): Promise<WalletLink | null>;
  /** must fail with ConflictError if the user, cdp user or address is already linked */
  insertLink(link: WalletLink): Promise<void>;
  createIntent(i: WalletIntent): Promise<void>;
  getIntent(id: string): Promise<WalletIntent | null>;
  findOpenIntent(userId: string, duelId: string, action: IntentAction): Promise<WalletIntent | null>;
  /** conditional update: only applies if the current status is one of `from` */
  updateIntent(id: string, patch: Partial<WalletIntent>, from: IntentStatus[]): Promise<boolean>;
  countSponsored(since: Date, smartAccount?: Address): Promise<number>;
  listIntents(userId: string): Promise<WalletIntent[]>;
  log(l: SponsorshipLog): Promise<void>;
}

const lower = (a: string) => a.toLowerCase();

export class MemoryWalletRepo implements WalletRepo {
  links: WalletLink[] = [];
  intents = new Map<string, WalletIntent>();
  logs: SponsorshipLog[] = [];
  async getLinkByUser(u: string) { return this.links.find((l) => l.userId === u) ?? null; }
  async getLinkByCdpUser(c: string) { return this.links.find((l) => l.cdpUserId === c) ?? null; }
  async getLinkBySmartAccount(a: Address) { return this.links.find((l) => lower(l.smartAccount) === lower(a)) ?? null; }
  async insertLink(l: WalletLink) {
    if (this.links.some((x) => x.userId === l.userId || x.cdpUserId === l.cdpUserId || lower(x.smartAccount) === lower(l.smartAccount))) throw new ConflictError("already linked");
    this.links.push(l);
  }
  async createIntent(i: WalletIntent) { this.intents.set(i.id, { ...i }); }
  async getIntent(id: string) { const i = this.intents.get(id); return i ? { ...i } : null; }
  async findOpenIntent(userId: string, duelId: string, action: IntentAction) {
    const now = Date.now();
    return [...this.intents.values()].find((i) => i.userId === userId && i.duelId === duelId && i.action === action
      && (i.status === "confirmed" || ((i.status === "prepared" || i.status === "sponsored" || i.status === "submitted") && Date.parse(i.expiresAt) > now))) ?? null;
  }
  async updateIntent(id: string, patch: Partial<WalletIntent>, from: IntentStatus[]) {
    const i = this.intents.get(id);
    if (!i || !from.includes(i.status)) return false;
    this.intents.set(id, { ...i, ...patch });
    return true;
  }
  async countSponsored(since: Date, smartAccount?: Address) {
    return [...this.intents.values()].filter((i) => i.sponsoredAt && Date.parse(i.sponsoredAt) >= since.getTime() && (!smartAccount || lower(i.smartAccount) === lower(smartAccount))).length;
  }
  async listIntents(userId: string) { return [...this.intents.values()].filter((i) => i.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async log(l: SponsorshipLog) { this.logs.push(l); }
}

// ---------- supabase (live mode) ----------

const toLink = (r: any): WalletLink => ({
  userId: r.user_id, cdpUserId: r.cdp_user_id, eoa: r.eoa_address, smartAccount: r.smart_account_address,
  authMethods: r.auth_methods ?? [], linkedAt: r.linked_at,
});
const toIntent = (r: any): WalletIntent => ({
  id: r.id, userId: r.user_id, smartAccount: r.smart_account_address, action: r.action, duelId: r.duel_id,
  amountUnits: String(r.amount_units), callsHash: r.calls_hash, calls: r.calls, status: r.status,
  createdAt: r.created_at, expiresAt: r.expires_at, sponsoredAt: r.sponsored_at ?? undefined,
  userOpHash: r.user_op_hash ?? undefined, txHash: r.tx_hash ?? undefined, error: r.error ?? undefined,
});
const intentRow = (i: Partial<WalletIntent>) => {
  const r: Record<string, unknown> = {};
  if (i.id !== undefined) r.id = i.id;
  if (i.userId !== undefined) r.user_id = i.userId;
  if (i.smartAccount !== undefined) r.smart_account_address = i.smartAccount.toLowerCase();
  if (i.action !== undefined) r.action = i.action;
  if (i.duelId !== undefined) r.duel_id = i.duelId;
  if (i.amountUnits !== undefined) r.amount_units = i.amountUnits;
  if (i.callsHash !== undefined) r.calls_hash = i.callsHash;
  if (i.calls !== undefined) r.calls = i.calls;
  if (i.status !== undefined) r.status = i.status;
  if (i.createdAt !== undefined) r.created_at = i.createdAt;
  if (i.expiresAt !== undefined) r.expires_at = i.expiresAt;
  if (i.sponsoredAt !== undefined) r.sponsored_at = i.sponsoredAt;
  if (i.userOpHash !== undefined) r.user_op_hash = i.userOpHash;
  if (i.txHash !== undefined) r.tx_hash = i.txHash;
  if (i.error !== undefined) r.error = i.error;
  return r;
};

export class SupabaseWalletRepo implements WalletRepo {
  constructor(private db: SupabaseClient) {}
  private async one(q: PromiseLike<{ data: any; error: any }>) { const { data, error } = await q; if (error) throw new Error(error.message); return data; }
  async getLinkByUser(u: string) { const d = await this.one(this.db.from("wallet_links").select("*").eq("user_id", u).maybeSingle()); return d ? toLink(d) : null; }
  async getLinkByCdpUser(c: string) { const d = await this.one(this.db.from("wallet_links").select("*").eq("cdp_user_id", c).maybeSingle()); return d ? toLink(d) : null; }
  async getLinkBySmartAccount(a: Address) { const d = await this.one(this.db.from("wallet_links").select("*").eq("smart_account_address", a.toLowerCase()).maybeSingle()); return d ? toLink(d) : null; }
  async insertLink(l: WalletLink) {
    const { error } = await this.db.from("wallet_links").insert({
      user_id: l.userId, cdp_user_id: l.cdpUserId, eoa_address: l.eoa?.toLowerCase() ?? null,
      smart_account_address: l.smartAccount.toLowerCase(), auth_methods: l.authMethods, linked_at: l.linkedAt,
    });
    if (error?.code === "23505") throw new ConflictError("already linked");
    if (error) throw new Error(error.message);
  }
  async createIntent(i: WalletIntent) { const { error } = await this.db.from("wallet_intents").insert(intentRow(i)); if (error) throw new Error(error.message); }
  async getIntent(id: string) { const d = await this.one(this.db.from("wallet_intents").select("*").eq("id", id).maybeSingle()); return d ? toIntent(d) : null; }
  async findOpenIntent(userId: string, duelId: string, action: IntentAction) {
    const d = await this.one(this.db.from("wallet_intents").select("*").eq("user_id", userId).eq("duel_id", duelId).eq("action", action)
      .or(`status.eq.confirmed,and(status.in.(prepared,sponsored,submitted),expires_at.gt.${new Date().toISOString()})`).limit(1));
    return d?.[0] ? toIntent(d[0]) : null;
  }
  async updateIntent(id: string, patch: Partial<WalletIntent>, from: IntentStatus[]) {
    const { data, error } = await this.db.from("wallet_intents").update(intentRow(patch)).eq("id", id).in("status", from).select("id");
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }
  async countSponsored(since: Date, smartAccount?: Address) {
    let q = this.db.from("wallet_intents").select("id", { count: "exact", head: true }).gte("sponsored_at", since.toISOString());
    if (smartAccount) q = q.eq("smart_account_address", smartAccount.toLowerCase());
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async listIntents(userId: string) { const d = await this.one(this.db.from("wallet_intents").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)); return (d ?? []).map(toIntent); }
  async log(l: SponsorshipLog) { await this.db.from("sponsorship_logs").insert({ at: l.at, intent_id: l.intentId, sender: l.sender, method: l.method, decision: l.decision, reason: l.reason }); }
}
