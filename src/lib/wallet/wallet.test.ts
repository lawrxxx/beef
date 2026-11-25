import { describe, expect, it, beforeEach } from "vitest";
import {
  encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, getAddress, keccak256, toHex, type Address, type Hex,
} from "viem";
import { CHAIN_ID, ENTRYPOINTS, USDC_ADDRESS, assertBaseSepolia } from "@/lib/chain/config";
import {
  SMART_WALLET_ABI, buildAcceptCalls, buildCreateDuelCalls, callsHash, decodeSmartAccountCallData, duelIdToBytes32, usdcUnits, type Call,
} from "./calls";
import { checkCalls, checkLimits, defaultPolicy } from "./policy";
import { BEEF_ESCROW_ABI } from "./escrow-abi";
import { MemoryWalletRepo } from "@/lib/server/wallet-repo";
import { mapEndUser, type VerifiedEndUser } from "@/lib/server/cdp";
import {
  USER_OPERATION_EVENT, WalletError, confirmIntent, handlePaymasterRpc, linkWallet, prepareIntent, verifyReceipt, type DuelForChain,
} from "@/lib/server/wallet-service";

const ESCROW = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const ALICE_SA = getAddress("0xa11ce00000000000000000000000000000000001");
const BOB_SA = getAddress("0xb0b0000000000000000000000000000000000002");
const DUEL = "5f0c1d6e-2a7b-4c8d-9e0f-112233445566";
const policy = defaultPolicy(USDC_ADDRESS, ESCROW);

const executeBatch = (calls: Call[]) => encodeFunctionData({ abi: SMART_WALLET_ABI, functionName: "executeBatch", args: [calls.map((c) => ({ target: c.to, value: c.value, data: c.data }))] });

describe("network", () => {
  it("only base sepolia passes", () => {
    expect(() => assertBaseSepolia(84532)).not.toThrow();
    expect(() => assertBaseSepolia("0x14a34")).not.toThrow();
    expect(() => assertBaseSepolia(8453)).toThrow(/base sepolia/); // base mainnet
    expect(() => assertBaseSepolia("0x1")).toThrow(); // ethereum mainnet
    expect(CHAIN_ID).toBe(84532);
  });
});

describe("calls + decoding", () => {
  const create = buildCreateDuelCalls({ usdc: USDC_ADDRESS, escrow: ESCROW, duelId: DUEL, stake: 10, participants: [ALICE_SA, BOB_SA], termsHash: keccak256(toHex("t")) });

  it("approves exactly the stake, then creates the duel", () => {
    expect(create).toHaveLength(2);
    expect(create[0].to).toBe(USDC_ADDRESS);
    expect(create[0].data).toBe(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ESCROW, 10_000_000n] }));
    expect(create[1].to).toBe(ESCROW);
    expect(create.every((c) => c.value === 0n)).toBe(true);
  });

  it("round-trips through the smart account's executeBatch / execute", () => {
    expect(callsHash(decodeSmartAccountCallData(executeBatch(create)))).toBe(callsHash(create));
    const single = encodeFunctionData({ abi: SMART_WALLET_ABI, functionName: "execute", args: [ESCROW, 0n, create[1].data] });
    expect(decodeSmartAccountCallData(single)).toEqual([create[1]]);
  });

  it("duel ids map to stable bytes32 keys", () => {
    expect(duelIdToBytes32(DUEL)).toBe(duelIdToBytes32(DUEL));
    expect(duelIdToBytes32(DUEL)).not.toBe(duelIdToBytes32(DUEL + "x"));
  });
});

describe("sponsorship policy", () => {
  const accept = buildAcceptCalls({ usdc: USDC_ADDRESS, escrow: ESCROW, duelId: DUEL, stake: 10 });
  const approve = (spender: Address, amount: bigint): Call => ({ to: USDC_ADDRESS, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });

  it("allows the beef flows", () => {
    expect(checkCalls(accept, policy).ok).toBe(true);
    expect(checkCalls(buildCreateDuelCalls({ usdc: USDC_ADDRESS, escrow: ESCROW, duelId: DUEL, stake: 25, participants: [ALICE_SA, BOB_SA], termsHash: keccak256("0x01") }), policy).ok).toBe(true);
  });

  it.each([
    ["unknown contract", [{ to: OTHER, value: 0n, data: "0x" as Hex }]],
    ["usdc transfer", [{ to: USDC_ADDRESS, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [OTHER, 1n] }) }, accept[1]]],
    ["approval to another spender", [approve(OTHER, 10_000_000n), accept[1]]],
    ["approval above the max stake", [approve(ESCROW, usdcUnits(26)), accept[1]]],
    ["unlimited approval", [approve(ESCROW, 2n ** 256n - 1n), accept[1]]],
    ["approval with no escrow call (dangling allowance)", [approve(ESCROW, 10_000_000n)]],
    ["sending eth", [{ ...accept[1], value: 1n }]],
    ["non-allowlisted escrow function", [{ to: ESCROW, value: 0n, data: encodeFunctionData({ abi: BEEF_ESCROW_ABI, functionName: "getDuel", args: [duelIdToBytes32(DUEL)] }) }]],
  ])("refuses %s", (_name, calls) => {
    const r = checkCalls(calls as Call[], policy);
    expect(r.ok).toBe(false);
  });

  it("enforces per-user and global daily limits", () => {
    expect(checkLimits({ userCount: policy.perUserDailyLimit, globalCount: 0 }, policy).ok).toBe(false);
    expect(checkLimits({ userCount: 0, globalCount: policy.globalDailyLimit }, policy).ok).toBe(false);
    expect(checkLimits({ userCount: 0, globalCount: 0 }, policy).ok).toBe(true);
  });
});

// ---------- server flows ----------

const users: Record<string, VerifiedEndUser> = {
  "tok-alice": { cdpUserId: "cdp-alice", eoa: getAddress("0xa11ce000000000000000000000000000000000e0"), smartAccount: ALICE_SA, authMethods: ["email"] },
  "tok-bob": { cdpUserId: "cdp-bob", eoa: null, smartAccount: BOB_SA, authMethods: ["oauth2"] },
  "tok-new": { cdpUserId: "cdp-new", eoa: null, smartAccount: null, authMethods: ["email"] },
};
const verify = async (t: string) => { const u = users[t]; if (!u) throw new Error("your wallet session couldn't be verified"); return u; };
const duel: DuelForChain = {
  id: DUEL, createdBy: "alice", status: "pending", stake: 10, deadline: "2026-12-04T21:00:00.000Z",
  calculationVersion: "pct-return-v1", methodology: "percent_return_official_close",
  participants: [{ userId: "alice", ticker: "NVDA" }, { userId: "bob", ticker: "AMD" }],
};

let repo: MemoryWalletRepo;
beforeEach(() => { repo = new MemoryWalletRepo(); });

const linkBoth = async () => {
  await linkWallet({ appUserId: "alice", accessToken: "tok-alice" }, { verify, repo });
  await linkWallet({ appUserId: "bob", accessToken: "tok-bob" }, { verify, repo });
};
const prep = (accessToken: string, action: "create" | "accept" | "refund" = "create", over: Partial<Parameters<typeof prepareIntent>[1]> = {}) =>
  prepareIntent({ accessToken, action, duelId: DUEL }, { verify, repo, loadDuel: async () => duel, escrow: ESCROW, ...over });

describe("wallet linking", () => {
  it("links from verified cdp data, and a returning user gets the same link", async () => {
    const a = await linkWallet({ appUserId: "alice", accessToken: "tok-alice" }, { verify, repo });
    expect(a.smartAccount).toBe(ALICE_SA);
    const again = await linkWallet({ appUserId: "alice", accessToken: "tok-alice" }, { verify, repo });
    expect(again).toEqual(a);
    expect(repo.links).toHaveLength(1); // no duplicate
  });
  it("refuses a second wallet for the same user", async () => {
    await linkWallet({ appUserId: "alice", accessToken: "tok-alice" }, { verify, repo });
    await expect(linkWallet({ appUserId: "alice", accessToken: "tok-bob" }, { verify, repo })).rejects.toThrow(/different wallet/);
  });
  it("refuses one wallet for two users", async () => {
    await linkWallet({ appUserId: "alice", accessToken: "tok-alice" }, { verify, repo });
    await expect(linkWallet({ appUserId: "mallory", accessToken: "tok-alice" }, { verify, repo })).rejects.toThrow(/another beef account/);
  });
  it("waits for the smart account and rejects unverifiable tokens", async () => {
    await expect(linkWallet({ appUserId: "n", accessToken: "tok-new" }, { verify, repo })).rejects.toThrow(/being set up/);
    await expect(linkWallet({ appUserId: "x", accessToken: "forged" }, { verify, repo })).rejects.toThrow(/couldn't be verified/);
  });
  it("maps cdp's end-user object without trusting anything else", () => {
    const m = mapEndUser({ userId: "u1", authenticationMethods: [{ type: "email" }, { type: "oauth2" }], evmAccountObjects: [{ address: "0xa11ce000000000000000000000000000000000e0" }], evmSmartAccountObjects: [{ address: ALICE_SA.toLowerCase() }] });
    expect(m).toEqual({ cdpUserId: "u1", eoa: getAddress("0xa11ce000000000000000000000000000000000e0"), smartAccount: ALICE_SA, authMethods: ["email", "oauth2"] });
  });
});

describe("intents", () => {
  it("needs a deployed escrow", async () => {
    await linkBoth();
    await expect(prep("tok-alice", "create", { escrow: null })).rejects.toMatchObject({ status: 503 });
  });
  it("builds the creator's calls on the server and dedupes repeat requests", async () => {
    await linkBoth();
    const a = await prep("tok-alice");
    expect(a.intent.calls).toHaveLength(2);
    expect(a.summary.amountUsdc).toBe(10);
    const b = await prep("tok-alice");
    expect(b.intent.id).toBe(a.intent.id); // double tap -> same intent
  });
  it("refuses non-creators, outsiders and unlinked opponents", async () => {
    await linkWallet({ appUserId: "alice", accessToken: "tok-alice" }, { verify, repo });
    await expect(prep("tok-alice")).rejects.toThrow(/everyone in the duel needs a beef wallet/);
    await linkWallet({ appUserId: "bob", accessToken: "tok-bob" }, { verify, repo });
    await expect(prep("tok-bob", "create")).rejects.toMatchObject({ status: 403 });
    await expect(prep("tok-alice", "create", { loadDuel: async () => ({ ...duel, participants: [{ userId: "x", ticker: "A" }, { userId: "y", ticker: "B" }] }) })).rejects.toThrow(/not in this duel/);
    await expect(prepareIntent({ accessToken: "tok-alice", action: "settle", duelId: DUEL }, { verify, repo, loadDuel: async () => duel, escrow: ESCROW })).rejects.toBeInstanceOf(WalletError);
  });
});

describe("payout intents", () => {
  it("signs the final result on the server and builds a sponsorable settle call", async () => {
    await linkBoth();
    const { signSettlement } = await import("@/lib/server/oracle");
    const settled = { ...duel, status: "completed", settlement: { status: "settled" as const, winners: ["alice"], payloadHash: keccak256(toHex("p")) as Hex } };
    const key = keccak256(toHex("oracle-test-key"));
    const r = await prepareIntent({ accessToken: "tok-bob", action: "settle", duelId: DUEL }, { verify, repo, loadDuel: async () => settled, escrow: ESCROW, sign: (p) => signSettlement(p, key) });
    expect(r.intent.calls).toHaveLength(1);
    expect(r.intent.amountUnits).toBe("0");
    expect(checkCalls(r.intent.calls.map((c) => ({ to: getAddress(c.to), value: BigInt(c.value), data: c.data as Hex })), policy).ok).toBe(true);
  });
  it("refuses payouts before a verified result or without the oracle key", async () => {
    await linkBoth();
    const paused = { ...duel, status: "awaiting_verification", settlement: { status: "needs_verification" as const, winners: [], payloadHash: "0x00" as Hex } };
    await expect(prepareIntent({ accessToken: "tok-alice", action: "settle", duelId: DUEL }, { verify, repo, loadDuel: async () => paused, escrow: ESCROW, sign: async () => "0x" })).rejects.toThrow(/isn't settled yet/);
    const done = { ...duel, status: "completed", settlement: { status: "draw" as const, winners: [], payloadHash: keccak256("0x01") } };
    await expect(prepareIntent({ accessToken: "tok-alice", action: "settle", duelId: DUEL }, { verify, repo, loadDuel: async () => done, escrow: ESCROW })).rejects.toMatchObject({ status: 503 });
  });
});

describe("paymaster proxy", () => {
  let forwarded: unknown[];
  const forward = async (b: unknown) => { forwarded.push(b); return { jsonrpc: "2.0", id: 1, result: { paymasterAndData: "0xabc" } }; };
  beforeEach(() => { forwarded = []; });

  const rpc = (over: { method?: string; chainId?: string; entryPoint?: string; sender?: string; callData?: Hex; intentId?: string | null }) => ({
    jsonrpc: "2.0", id: 1, method: over.method ?? "pm_getPaymasterData",
    params: [{ sender: over.sender ?? ALICE_SA, callData: over.callData ?? "0x" }, over.entryPoint ?? ENTRYPOINTS[0], over.chainId ?? "0x14a34", over.intentId === null ? {} : { intentId: over.intentId }],
  });
  const setup = async () => {
    await linkBoth();
    const { intent } = await prep("tok-alice");
    const callData = executeBatch(decode(intent.calls));
    return { intent, callData };
  };
  const decode = (c: { to: string; value: string; data: string }[]): Call[] => c.map((x) => ({ to: getAddress(x.to), value: BigInt(x.value), data: x.data as Hex }));

  it("sponsors a matching beef operation and records it", async () => {
    const { intent, callData } = await setup();
    const r: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id }), { repo, forward, escrow: ESCROW });
    expect(r.result).toBeDefined();
    expect(forwarded).toHaveLength(1);
    expect((await repo.getIntent(intent.id))!.status).toBe("sponsored");
    expect(repo.logs.at(-1)!.decision).toBe("allowed");
  });

  it.each([
    ["base mainnet", { chainId: "0x2105" }, /wrong chain/],
    ["unknown entrypoint", { entryPoint: "0x3333333333333333333333333333333333333333" }, /entrypoint/],
    ["unlinked sender", { sender: "0x4444444444444444444444444444444444444444" }, /linked beef wallet/],
    ["no intent", { intentId: null }, /missing intent/],
    ["unknown intent", { intentId: "nope" }, /unknown intent/],
    ["unsupported method", { method: "eth_sendRawTransaction" }, /not supported/],
  ])("refuses %s without forwarding", async (_n, over, re) => {
    const { intent, callData } = await setup();
    const r: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id, ...over }), { repo, forward, escrow: ESCROW });
    expect(r.error.message).toMatch(re);
    expect(forwarded).toHaveLength(0);
    expect(repo.logs.at(-1)!.decision).toBe("refused");
  });

  it("refuses a tampered operation (calls don't match the intent)", async () => {
    const { intent } = await setup();
    const evil = executeBatch([{ to: USDC_ADDRESS, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ESCROW, 25_000_000n] }) }, decode(intent.calls)[1]]);
    const r: any = await handlePaymasterRpc(rpc({ callData: evil, intentId: intent.id }), { repo, forward, escrow: ESCROW });
    expect(r.error.message).toMatch(/doesn't match/);
    expect(forwarded).toHaveLength(0);
  });

  it("refuses an intent used by a different wallet, and expired intents", async () => {
    const { intent, callData } = await setup();
    const r: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id, sender: BOB_SA }), { repo, forward, escrow: ESCROW });
    expect(r.error.message).toMatch(/different wallet/);
    const later = new Date(Date.parse(intent.expiresAt) + 1000);
    const r2: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id }), { repo, forward, escrow: ESCROW, now: later });
    expect(r2.error.message).toMatch(/expired/);
  });

  it("enforces the per-user daily limit", async () => {
    const { intent, callData } = await setup();
    const tight = { ...policy, perUserDailyLimit: 0 };
    const r: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id }), { repo, forward, escrow: ESCROW, policy: tight });
    expect(r.error.message).toMatch(/daily sponsored transaction limit/);
  });

  it("enforces the global budget", async () => {
    const { intent, callData } = await setup();
    const r: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id }), { repo, forward, escrow: ESCROW, policy: { ...policy, globalDailyLimit: 0 } });
    expect(r.error.message).toMatch(/budget/);
  });

  it("reports a sponsor outage as a clear error (never falls back to unsponsored)", async () => {
    const { intent, callData } = await setup();
    const r: any = await handlePaymasterRpc(rpc({ callData, intentId: intent.id }), { repo, forward: async () => { throw new Error("503"); }, escrow: ESCROW });
    expect(r.error.message).toMatch(/gas sponsor is unavailable/);
    expect((await repo.getIntent(intent.id))!.status).toBe("prepared");
  });
});

describe("receipt verification", () => {
  const userOpHash = keccak256(toHex("op")) as Hex;
  const uoLog = (o: { sender?: Address; paymaster?: Address; success?: boolean }) => ({
    address: ENTRYPOINTS[0],
    topics: encodeEventTopics({ abi: USER_OPERATION_EVENT, eventName: "UserOperationEvent", args: { userOpHash, sender: o.sender ?? ALICE_SA, paymaster: o.paymaster ?? OTHER } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, o.success ?? true, 1n, 1n]),
  });
  const escrowLog = (eventName: "Created" | "Deposited", duelId = DUEL) => ({
    address: ESCROW,
    topics: eventName === "Created"
      ? encodeEventTopics({ abi: BEEF_ESCROW_ABI, eventName, args: { duelId: duelIdToBytes32(duelId), creator: ALICE_SA } }) as [Hex, ...Hex[]]
      : encodeEventTopics({ abi: BEEF_ESCROW_ABI, eventName, args: { duelId: duelIdToBytes32(duelId), who: ALICE_SA } }) as [Hex, ...Hex[]],
    data: eventName === "Created" ? encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [10_000_000n, keccak256("0x01")]) : "0x" as Hex,
  });
  const intent = { id: "i1", userId: "alice", smartAccount: ALICE_SA, action: "create" as const, duelId: DUEL, amountUnits: "10000000", callsHash: "0x" as Hex, calls: [], status: "sponsored" as const, createdAt: "", expiresAt: "" };

  it("accepts a sponsored, successful op with the escrow event", () => {
    expect(verifyReceipt({ status: "success", logs: [uoLog({}), escrowLog("Created")] as any }, intent, userOpHash, ESCROW)).toEqual({ ok: true });
  });
  it.each([
    ["reverted tx", { status: "reverted", logs: [uoLog({}), escrowLog("Created")] }, /reverted/],
    ["failed op", { status: "success", logs: [uoLog({ success: false }), escrowLog("Created")] }, /failed onchain/],
    ["unsponsored op", { status: "success", logs: [uoLog({ paymaster: "0x0000000000000000000000000000000000000000" }), escrowLog("Created")] }, /wasn't sponsored/],
    ["someone else's op", { status: "success", logs: [uoLog({ sender: BOB_SA }), escrowLog("Created")] }, /not found/],
    ["missing escrow event", { status: "success", logs: [uoLog({})] }, /escrow didn't record/],
    ["event for another duel", { status: "success", logs: [uoLog({}), escrowLog("Created", "other")] }, /escrow didn't record/],
  ])("rejects %s", (_n, receipt, re) => {
    const r = verifyReceipt(receipt as any, intent, userOpHash, ESCROW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  });

  it("confirmation is idempotent and owner-only", async () => {
    await linkBoth();
    const { intent: i } = await prep("tok-alice");
    const receipt = { status: "success" as const, logs: [uoLog({}), escrowLog("Created")] as any };
    const txHash = keccak256(toHex("tx")) as Hex;
    const deps = { repo, verify, getReceipt: async () => receipt, escrow: ESCROW };
    await expect(confirmIntent({ accessToken: "tok-bob", intentId: i.id, userOpHash, txHash }, deps)).rejects.toMatchObject({ status: 403 });
    const c1 = await confirmIntent({ accessToken: "tok-alice", intentId: i.id, userOpHash, txHash }, deps);
    expect(c1.status).toBe("confirmed");
    const c2 = await confirmIntent({ accessToken: "tok-alice", intentId: i.id, userOpHash, txHash }, deps);
    expect(c2.status).toBe("confirmed");
    await expect(prep("tok-alice")).rejects.toThrow(/already done/); // no second stake for the same duel
  });
});
