import { beforeAll, describe, expect, it } from "vitest";
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import escrowArtifact from "../../../contracts/out/BeefEscrow.json";
import usdcArtifact from "../../../contracts/out/MockUSDC.json";
import { OPEN_SLOT, buildCreateDuelCalls, buildJoinCalls, duelIdToBytes32, usdcUnits } from "./calls";
import { checkCalls, defaultPolicy } from "./policy";
import { joinDigest, settlementDigest, signJoin, signSettlement } from "@/lib/server/oracle";

// real contract tests on an in-process evm with chain id 84532. a smart account's
// batch is atomic; here the same calls are sent one by one from each participant.

const KEYS = [1, 2, 3, 4, 5].map((i) => keccak256(toHex(`beef-test-key-${i}`)));
const ACCOUNTS = KEYS.map((k) => privateKeyToAccount(k));
const ORACLE_KEY = KEYS[2];
const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 84532 }, wallet: { accounts: KEYS.map((secretKey) => ({ secretKey, balance: "0x56BC75E2D63100000" })) } });
const transport = custom(provider as any);
const chain = { id: 84532, name: "local base sepolia", nativeCurrency: { name: "eth", symbol: "eth", decimals: 18 }, rpcUrls: { default: { http: [""] } } } as const;
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport });
const acct = (a: Address): PrivateKeyAccount => ACCOUNTS.find((x) => x.address === a)!;

let alice: Address, bob: Address, oracle: Address, mallory: Address, carol: Address;
let usdc: Address, escrow: Address;
const escrowAbi = escrowArtifact.abi as any;
const usdcAbi = usdcArtifact.abi as any;

async function send(from: Address, to: Address, data: Hex) {
  const hash = await wallet.sendTransaction({ account: acct(from), to, data, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("reverted");
  return r;
}
const sendCalls = async (from: Address, calls: { to: Address; data: Hex }[]) => { for (const c of calls) await send(from, c.to, c.data); };
const read = (fn: string, args: unknown[], addr = escrow, abi = escrowAbi) => pub.readContract({ address: addr, abi, functionName: fn, args }) as Promise<any>;
const balance = async (a: Address) => Number(await read("balanceOf", [a], usdc, usdcAbi)) / 1e6;
const clearAllowance = (who: Address) => send(who, usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, 0n] }));
async function expectRevert(p: Promise<unknown>) { let failed = false; try { await p; } catch { failed = true; } expect(failed).toBe(true); }
async function deploy(bytecode: Hex, abi: any, args: unknown[]) {
  const hash = await wallet.deployContract({ account: acct(alice), abi, bytecode, args, chain });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}

/** creator opens a duel with open slots for everyone else (how beef creates duels) */
const create = (duelId: string, stake: number, slots: number) =>
  buildCreateDuelCalls({ usdc, escrow, duelId, stake, participants: [alice, ...Array(slots - 1).fill(OPEN_SLOT)], termsHash: keccak256(toHex(`terms:${duelId}`)) });
const join = async (duelId: string, stake: number, who: Address) =>
  buildJoinCalls({ usdc, escrow, duelId, stake, joinSig: await signJoin({ escrow, duelId, who }, ORACLE_KEY) });
async function settleSigned(duelId: string, winners: Address[], from: Address, key: Hex = ORACLE_KEY) {
  const keyId = duelIdToBytes32(duelId);
  const [, , , terms] = await read("getDuel", [keyId]);
  const settlementHash = keccak256(toHex(`settlement:${duelId}`));
  const sig = await signSettlement({ escrow, duelId, termsHash: terms, winners, settlementHash }, key);
  return send(from, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [keyId, winners, settlementHash, sig] }));
}

beforeAll(async () => {
  [alice, bob, oracle, mallory, carol] = ACCOUNTS.map((a) => a.address);
  usdc = await deploy(usdcArtifact.bytecode as Hex, usdcAbi, []);
  escrow = await deploy(escrowArtifact.bytecode as Hex, escrowAbi, [usdc, oracle]);
  for (const who of [alice, bob, mallory, carol]) await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ account: acct(alice), address: usdc, abi: usdcAbi, functionName: "mint", args: [who, usdcUnits(100)], chain }) });
});

describe("BeefEscrow (local evm, chain id 84532)", () => {
  it("server-side digests match the contract exactly", async () => {
    await sendCalls(alice, create("dg", 1, 2));
    const k = duelIdToBytes32("dg");
    expect(joinDigest({ escrow, duelId: "dg", who: bob })).toBe(await read("joinDigest", [k, bob]));
    const [, , , terms] = await read("getDuel", [k]);
    const sh = keccak256(toHex("x"));
    expect(settlementDigest({ escrow, duelId: "dg", termsHash: terms, winners: [bob], settlementHash: sh })).toBe(await read("settlementDigest", [k, terms, [bob], sh]));
  });

  it("the calls beef builds pass the sponsorship policy", async () => {
    const p = defaultPolicy(usdc, escrow);
    expect(checkCalls(create("x", 10, 2), p).ok).toBe(true);
    expect(checkCalls(await join("x", 10, bob), p).ok).toBe(true);
  });

  it("create locks the creator's exact stake with an open slot; an authorised opponent joins", async () => {
    await sendCalls(alice, create("d1", 10, 2));
    expect(Number(await read("allowance", [alice, escrow], usdc, usdcAbi))).toBe(0); // exact approval consumed
    let [, parts, deposits, , , status] = await read("getDuel", [duelIdToBytes32("d1")]);
    expect([parts[1], Number(deposits), Number(status)]).toEqual([OPEN_SLOT, 1, 1]);
    await sendCalls(bob, await join("d1", 10, bob));
    [, parts, deposits, , , status] = await read("getDuel", [duelIdToBytes32("d1")]);
    expect([parts[1], Number(deposits), Number(status)]).toEqual([bob, 2, 2]); // active
    expect(await balance(escrow)).toBe(20 + 1); // + the 1 from "dg"
  });

  it("strangers can't take a seat", async () => {
    await sendCalls(alice, create("d2", 5, 2));
    const k = duelIdToBytes32("d2");
    const bobSig = await signJoin({ escrow, duelId: "d2", who: bob }, ORACLE_KEY);
    await send(mallory, usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, usdcUnits(5)] }));
    await expectRevert(send(mallory, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "join", args: [k, bobSig] }))); // bob's authorisation
    const selfSigned = await signJoin({ escrow, duelId: "d2", who: mallory }, KEYS[3]); // not the oracle
    await expectRevert(send(mallory, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "join", args: [k, selfSigned] })));
    await clearAllowance(mallory);
    const aliceSig = await signJoin({ escrow, duelId: "d2", who: alice }, ORACLE_KEY);
    await expectRevert(send(alice, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "join", args: [k, aliceSig] }))); // creator can't take the other seat
    await sendCalls(bob, await join("d2", 5, bob));
    await expectRevert(sendCalls(carol, await join("d2", 5, carol))); // no open slot left
    await clearAllowance(carol);
  });

  it("rejects bad creates", async () => {
    await expectRevert(sendCalls(alice, create("d3", 30, 2))); // above max stake
    await clearAllowance(alice);
    await expectRevert(sendCalls(alice, buildCreateDuelCalls({ usdc, escrow, duelId: "d4", stake: 5, participants: [bob, OPEN_SLOT], termsHash: keccak256("0x01") }))); // creator not in it
    await clearAllowance(alice);
    await expectRevert(send(alice, escrow, create("d5", 10, 2)[1].data)); // no approval
    await expectRevert(sendCalls(alice, create("d1", 10, 2))); // id taken
    await clearAllowance(alice);
  });

  it("only an oracle-signed result pays out, exactly once", async () => {
    await expectRevert(settleSigned("d1", [bob], bob, KEYS[1])); // signed by bob, not the oracle
    const a0 = await balance(alice);
    await settleSigned("d1", [alice], mallory); // anyone can relay a valid result
    expect(await balance(alice) - a0).toBe(20);
    await expectRevert(settleSigned("d1", [alice], alice)); // settled once
  });

  it("a draw returns every stake", async () => {
    await sendCalls(alice, create("d6", 5, 2));
    await sendCalls(bob, await join("d6", 5, bob));
    const [a0, b0] = [await balance(alice), await balance(bob)];
    await settleSigned("d6", [], bob);
    expect([await balance(alice) - a0, await balance(bob) - b0]).toEqual([5, 5]);
  });

  it("group duel with two open slots; tied winners split the pot", async () => {
    await sendCalls(alice, create("g1", 10, 3));
    await sendCalls(bob, await join("g1", 10, bob));
    await sendCalls(carol, await join("g1", 10, carol));
    const [a0, c0] = [await balance(alice), await balance(carol)];
    await settleSigned("g1", [alice, carol], bob);
    expect([await balance(alice) - a0, await balance(carol) - c0]).toEqual([15, 15]);
  });

  it("unfilled duels refund after the funding window, not before; late joins fail", async () => {
    await sendCalls(alice, create("r1", 7, 2));
    const refund = encodeFunctionData({ abi: escrowAbi, functionName: "refund", args: [duelIdToBytes32("r1")] });
    await expectRevert(send(mallory, escrow, refund));
    await provider.request({ method: "evm_increaseTime", params: [2 * 24 * 3600 + 5] });
    await provider.request({ method: "evm_mine", params: [] });
    await expectRevert(sendCalls(bob, await join("r1", 7, bob)));
    await clearAllowance(bob);
    const a0 = await balance(alice);
    await send(mallory, escrow, refund);
    expect(await balance(alice) - a0).toBe(7);
  });
});
