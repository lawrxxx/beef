import { beforeAll, describe, expect, it } from "vitest";
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import escrowArtifact from "../../../contracts/out/BeefEscrow.json";
import usdcArtifact from "../../../contracts/out/MockUSDC.json";
import { buildAcceptCalls, buildCreateDuelCalls, duelIdToBytes32, usdcUnits } from "./calls";
import { checkCalls, defaultPolicy } from "./policy";

// real contract tests on an in-process evm. the smart-account batch is simulated by
// sending the same calls (approve exact stake, then escrow call) from the participant.

const KEYS = [1, 2, 3, 4, 5].map((i) => keccak256(toHex(`beef-test-key-${i}`)));
const ACCOUNTS = KEYS.map((k) => privateKeyToAccount(k));
const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 84532 }, wallet: { accounts: KEYS.map((secretKey) => ({ secretKey, balance: "0x56BC75E2D63100000" })) } });
const acct = (a: Address): PrivateKeyAccount => ACCOUNTS.find((x) => x.address === a)!;
const transport = custom(provider as any);
const chain = { id: 84532, name: "local base sepolia", nativeCurrency: { name: "eth", symbol: "eth", decimals: 18 }, rpcUrls: { default: { http: [""] } } } as const;
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport });

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
async function sendCalls(from: Address, calls: { to: Address; data: Hex }[]) { for (const c of calls) await send(from, c.to, c.data); }
const read = (fn: string, args: unknown[], addr = escrow, abi = escrowAbi) => pub.readContract({ address: addr, abi, functionName: fn, args }) as Promise<any>;
const balance = async (a: Address) => Number(await read("balanceOf", [a], usdc, usdcAbi)) / 1e6;

async function expectRevert(p: Promise<unknown>) {
  let failed = false;
  try { await p; } catch { failed = true; }
  expect(failed).toBe(true);
}

async function deploy(bytecode: Hex, abi: any, args: unknown[]) {
  const hash = await wallet.deployContract({ account: acct(alice), abi, bytecode, args, chain });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}

async function signSettlement(duelId: string, winners: Address[], signer: Address) {
  const key = duelIdToBytes32(duelId);
  const [, , , terms] = await read("getDuel", [key]);
  const settlementHash = keccak256(toHex(`settlement:${duelId}`));
  const digest = await read("settlementDigest", [key, terms, winners, settlementHash]);
  const sig = await acct(signer).signMessage({ message: { raw: digest } });
  return { key, settlementHash, sig };
}

const createCalls = (duelId: string, stake: number, participants: Address[]) =>
  buildCreateDuelCalls({ usdc, escrow, duelId, stake, participants, termsHash: keccak256(toHex(`terms:${duelId}`)) });

beforeAll(async () => {
  [alice, bob, oracle, mallory, carol] = ACCOUNTS.map((a) => a.address);
  usdc = await deploy(usdcArtifact.bytecode as Hex, usdcAbi, []);
  escrow = await deploy(escrowArtifact.bytecode as Hex, escrowAbi, [usdc, oracle]);
  for (const who of [alice, bob, mallory, carol]) await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ account: acct(alice), address: usdc, abi: usdcAbi, functionName: "mint", args: [who, usdcUnits(100)], chain }) });
});

describe("BeefEscrow on a local chain (chain id 84532)", () => {
  it("the calls beef builds pass the sponsorship policy for this deployment", () => {
    const p = defaultPolicy(usdc, escrow);
    expect(checkCalls(createCalls("x", 10, [alice, bob]), p).ok).toBe(true);
    expect(checkCalls(buildAcceptCalls({ usdc, escrow, duelId: "x", stake: 10 }), p).ok).toBe(true);
  });

  it("create + accept lock exactly the stakes, leaving no allowance behind", async () => {
    await sendCalls(alice, createCalls("d1", 10, [alice, bob]));
    expect(Number(await read("allowance", [alice, escrow], usdc, usdcAbi))).toBe(0);
    let [, , deposits, , , status] = await read("getDuel", [duelIdToBytes32("d1")]);
    expect([Number(deposits), Number(status)]).toEqual([1, 1]); // funding
    await sendCalls(bob, buildAcceptCalls({ usdc, escrow, duelId: "d1", stake: 10 }));
    [, , deposits, , , status] = await read("getDuel", [duelIdToBytes32("d1")]);
    expect([Number(deposits), Number(status)]).toEqual([2, 2]); // active
    expect(await balance(escrow)).toBe(20);
    expect(await balance(alice)).toBe(90);
  });

  it("rejects bad creates and outsiders", async () => {
    await expectRevert(send(mallory, escrow, createCalls("d2", 10, [alice, bob])[1].data)); // not a participant
    await expectRevert(sendCalls(alice, createCalls("d3", 30, [alice, bob]))); // above max stake
    await expectRevert(sendCalls(alice, createCalls("d4", 10, [alice, alice]))); // duplicate participant
    // a real smart-account batch is atomic, so a reverted createDuel also undoes its approve.
    // sending the calls one by one here isn't, so clear the leftover allowance first.
    const { encodeFunctionData, erc20Abi } = await import("viem");
    await send(alice, usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, 0n] }));
    await expectRevert(send(alice, escrow, createCalls("d5", 10, [alice, bob])[1].data)); // no approval
    await expectRevert(sendCalls(mallory, buildAcceptCalls({ usdc, escrow, duelId: "d1", stake: 10 }))); // outsider deposit
    await expectRevert(sendCalls(alice, createCalls("d1", 10, [alice, bob]))); // duel already exists
  });

  it("only an oracle-signed result pays out, exactly once", async () => {
    const forged = await signSettlement("d1", [bob], bob);
    await expectRevert(wallet.writeContract({ account: acct(bob), address: escrow, abi: escrowAbi, functionName: "settle", args: [forged.key, [bob], forged.settlementHash, forged.sig], chain }).then((h) => pub.waitForTransactionReceipt({ hash: h })).then((r) => { if (r.status !== "success") throw new Error(); }));
    const good = await signSettlement("d1", [alice], oracle);
    await send(mallory, escrow, (await import("viem")).encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [good.key, [alice], good.settlementHash, good.sig] })); // anyone can relay a valid result
    expect(await balance(alice)).toBe(110);
    expect(await balance(escrow)).toBe(0);
    await expectRevert(send(alice, escrow, (await import("viem")).encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [good.key, [alice], good.settlementHash, good.sig] }))); // idempotent
  });

  it("a draw returns every stake; signatures can't be replayed on another duel", async () => {
    await sendCalls(alice, createCalls("d6", 5, [alice, bob]));
    await sendCalls(bob, buildAcceptCalls({ usdc, escrow, duelId: "d6", stake: 5 }));
    await sendCalls(alice, createCalls("d7", 5, [alice, bob]));
    await sendCalls(bob, buildAcceptCalls({ usdc, escrow, duelId: "d7", stake: 5 }));
    const draw6 = await signSettlement("d6", [], oracle);
    const { encodeFunctionData } = await import("viem");
    await expectRevert(send(alice, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [duelIdToBytes32("d7"), [], draw6.settlementHash, draw6.sig] }))); // replay
    const [a0, b0] = [await balance(alice), await balance(bob)];
    await send(alice, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [draw6.key, [], draw6.settlementHash, draw6.sig] }));
    expect([await balance(alice) - a0, await balance(bob) - b0]).toEqual([5, 5]);
  });

  it("group duel: tied winners split the pot", async () => {
    await sendCalls(alice, createCalls("g1", 10, [alice, bob, carol]));
    await sendCalls(bob, buildAcceptCalls({ usdc, escrow, duelId: "g1", stake: 10 }));
    await sendCalls(carol, buildAcceptCalls({ usdc, escrow, duelId: "g1", stake: 10 }));
    const s = await signSettlement("g1", [alice, carol], oracle);
    const [a0, c0] = [await balance(alice), await balance(carol)];
    const { encodeFunctionData } = await import("viem");
    await send(bob, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [s.key, [alice, carol], s.settlementHash, s.sig] }));
    expect([await balance(alice) - a0, await balance(carol) - c0]).toEqual([15, 15]);
  });

  it("the server's oracle digest + signature match the contract (payout via signed result)", async () => {
    const { settlementDigest, signSettlement } = await import("@/lib/server/oracle");
    const { encodeFunctionData } = await import("viem");
    await sendCalls(alice, createCalls("o1", 4, [alice, bob]));
    await sendCalls(bob, buildAcceptCalls({ usdc, escrow, duelId: "o1", stake: 4 }));
    const key = duelIdToBytes32("o1");
    const [, , , terms] = await read("getDuel", [key]);
    const settlementHash = keccak256(toHex("payload"));
    const onchain = await read("settlementDigest", [key, terms, [bob], settlementHash]);
    // the server computes the digest with chain id 84532 and the escrow address
    expect(settlementDigest({ escrow, duelId: "o1", termsHash: terms, winners: [bob], settlementHash })).toBe(onchain);
    const sig = await signSettlement({ escrow, duelId: "o1", termsHash: terms, winners: [bob], settlementHash }, KEYS[2]); // oracle key
    const b0 = await balance(bob);
    await send(bob, escrow, encodeFunctionData({ abi: escrowAbi, functionName: "settle", args: [key, [bob], settlementHash, sig] }));
    expect(await balance(bob) - b0).toBe(8);
  });

  it("unfunded duels refund after the window, not before", async () => {
    const { encodeFunctionData } = await import("viem");
    await sendCalls(alice, createCalls("r1", 7, [alice, bob]));
    const refund = encodeFunctionData({ abi: escrowAbi, functionName: "refund", args: [duelIdToBytes32("r1")] });
    await expectRevert(send(mallory, escrow, refund));
    await provider.request({ method: "evm_increaseTime", params: [2 * 24 * 3600 + 5] });
    await provider.request({ method: "evm_mine", params: [] });
    await expectRevert(sendCalls(bob, buildAcceptCalls({ usdc, escrow, duelId: "r1", stake: 7 }))); // too late to join
    const a0 = await balance(alice);
    await send(mallory, escrow, refund);
    expect(await balance(alice) - a0).toBe(7);
  });
});
