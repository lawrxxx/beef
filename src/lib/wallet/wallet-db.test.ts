import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getAddress, keccak256, toHex } from "viem";
import { ConflictError, SupabaseWalletRepo, type WalletIntent } from "@/lib/server/wallet-repo";

// runs against a real supabase (e.g. `npx supabase start`) when these are set:
// WALLET_DB_TEST_URL, WALLET_DB_TEST_SERVICE_KEY, WALLET_DB_TEST_ANON_KEY
const url = process.env.WALLET_DB_TEST_URL, service = process.env.WALLET_DB_TEST_SERVICE_KEY, anon = process.env.WALLET_DB_TEST_ANON_KEY;
const run = url && service && anon ? describe : describe.skip;

run("wallet tables in postgres", () => {
  let admin: ReturnType<typeof createClient>;
  let repo: SupabaseWalletRepo;
  const tag = Date.now().toString(16);
  const sa = (n: number) => getAddress(`0x${tag.padStart(12, "0")}${n.toString(16).padStart(28, "0")}`);
  let u1: string, u2: string, duelId: string;

  beforeAll(async () => {
    admin = createClient(url!, service!, { auth: { persistSession: false } });
    repo = new SupabaseWalletRepo(admin);
    const { data: ps } = await admin.from("profiles").select("id").limit(50);
    const { data: links } = await admin.from("wallet_links").select("user_id");
    const free = (ps as any[]).map((p) => p.id).filter((id) => !(links as any[]).some((l) => l.user_id === id));
    [u1, u2] = free;
    const { data: d } = await admin.from("duels").select("id").limit(1).single();
    duelId = (d as any).id;
  });

  it("one user ↔ one cdp user ↔ one smart account", async () => {
    await repo.insertLink({ userId: u1, cdpUserId: `cdp-${tag}-1`, eoa: null, smartAccount: sa(1), authMethods: ["email"], linkedAt: new Date().toISOString() });
    await expect(repo.insertLink({ userId: u1, cdpUserId: `cdp-${tag}-x`, eoa: null, smartAccount: sa(9), authMethods: [], linkedAt: new Date().toISOString() })).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.insertLink({ userId: u2, cdpUserId: `cdp-${tag}-1`, eoa: null, smartAccount: sa(2), authMethods: [], linkedAt: new Date().toISOString() })).rejects.toBeInstanceOf(ConflictError);
    await expect(repo.insertLink({ userId: u2, cdpUserId: `cdp-${tag}-2`, eoa: null, smartAccount: sa(1), authMethods: [], linkedAt: new Date().toISOString() })).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getLinkBySmartAccount(sa(1)))?.userId).toBe(u1);
  });

  it("intent lifecycle, conditional updates and sponsorship counters", async () => {
    const now = new Date();
    const i: WalletIntent = {
      id: crypto.randomUUID(), userId: u1, smartAccount: sa(1), action: "accept", duelId, amountUnits: "10000000",
      callsHash: keccak256(toHex(tag)), calls: [], status: "prepared", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600e3).toISOString(),
    };
    await repo.createIntent(i);
    expect((await repo.findOpenIntent(u1, duelId, "accept"))?.id).toBe(i.id);
    const before = await repo.countSponsored(new Date(now.getTime() - 1000), sa(1));
    expect(await repo.updateIntent(i.id, { status: "sponsored", sponsoredAt: now.toISOString() }, ["prepared"])).toBe(true);
    expect(await repo.updateIntent(i.id, { status: "sponsored" }, ["prepared"])).toBe(false); // conditional: already moved on
    expect(await repo.countSponsored(new Date(now.getTime() - 1000), sa(1))).toBe(before + 1);
    await repo.log({ at: now.toISOString(), intentId: i.id, sender: sa(1), method: "pm_getPaymasterData", decision: "allowed", reason: "test" });
  });

  it("browsers can't read or write wallet rows without being the owner", async () => {
    const pub = createClient(url!, anon!, { auth: { persistSession: false } });
    const { data: links } = await pub.from("wallet_links").select("*");
    expect(links ?? []).toHaveLength(0);
    const { error } = await (pub as any).from("wallet_links").insert({ user_id: u2, cdp_user_id: "evil", smart_account_address: sa(7).toLowerCase() });
    expect(error).not.toBeNull();
    const { data: logs } = await pub.from("sponsorship_logs").select("*");
    expect(logs ?? []).toHaveLength(0);
    const { error: mainnet } = await (admin as any).from("wallet_links").insert({ user_id: u2, cdp_user_id: `cdp-${tag}-m`, smart_account_address: sa(8).toLowerCase(), chain_id: 8453 });
    expect(mainnet).not.toBeNull(); // base sepolia only, enforced by the schema
  });
});
