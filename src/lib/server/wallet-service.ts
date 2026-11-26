import "server-only";
import { decodeEventLog, getAddress, isAddress, isHex, parseAbi, type Address, type Hex, type TransactionReceipt } from "viem";
import { CHAIN_ID, ENTRYPOINTS, ESCROW_ADDRESS, USDC_ADDRESS, assertBaseSepolia, isKnownEscrow } from "@/lib/chain/config";
import { formatUsdc, stakeUnits, stakeWithinLimits, STAKE_MAX, STAKE_MIN } from "@/lib/stake";
import {
  OPEN_SLOT, buildCreateDuelCalls, buildJoinCalls, buildRefundCalls, buildSettleCalls, callsHash, decodeSmartAccountCallData, deserializeCalls,
  duelIdToBytes32, serializeCalls, termsHash, escrowOfCalls, type Call,
} from "@/lib/wallet/calls";
import { checkCalls, checkLimits, defaultPolicy, type SponsorshipPolicy } from "@/lib/wallet/policy";
import { BEEF_ESCROW_ABI } from "@/lib/wallet/escrow-abi";
import { AttestationError, settlementAttestation } from "@/lib/chainlink/attestation";
import type { Settlement } from "@/lib/types";
import type { EndUserVerifier } from "./cdp";
import { ConflictError, type IntentAction, type WalletIntent, type WalletLink, type WalletRepo } from "./wallet-repo";

export class WalletError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const DAY = 864e5;
const INTENT_TTL_MS = 10 * 60e3;

// ---------- linking ----------

/**
 * links a verified cdp wallet to a beef user. idempotent for the same pair, refuses a
 * second wallet for a user and a second user for a wallet (no duplicates).
 */
export async function linkWallet(p: { appUserId: string; appEmail?: string | null; accessToken: string }, deps: { verify: EndUserVerifier; repo: WalletRepo; now?: Date }): Promise<WalletLink> {
  const eu = await deps.verify(p.accessToken);
  // the wallet must belong to the signed-in beef account: a custom-auth (supabase jwt)
  // login must carry this user's id; an email / google login must carry this user's email
  if (eu.jwtSubs.length > 0) {
    if (!eu.jwtSubs.includes(p.appUserId)) throw new WalletError("this wallet belongs to a different beef account.", 403);
  } else if (p.appEmail !== undefined) {
    if (!p.appEmail || !eu.emails.includes(p.appEmail.toLowerCase())) throw new WalletError("sign in to your wallet with the same email as your beef account.", 403);
  }
  if (!eu.smartAccount) throw new WalletError("your wallet is still being set up. try again in a moment.", 409);
  const mine = await deps.repo.getLinkByUser(p.appUserId);
  if (mine) {
    if (mine.cdpUserId !== eu.cdpUserId) throw new WalletError("this beef account is already linked to a different wallet. sign in to that wallet instead.", 409);
    return mine; // returning user: same wallet, nothing new created
  }
  const taken = await deps.repo.getLinkByCdpUser(eu.cdpUserId);
  if (taken) throw new WalletError("this wallet is already linked to another beef account.", 409);
  const link: WalletLink = {
    userId: p.appUserId, cdpUserId: eu.cdpUserId, eoa: eu.eoa, smartAccount: eu.smartAccount,
    authMethods: eu.authMethods, linkedAt: (deps.now ?? new Date()).toISOString(),
  };
  try { await deps.repo.insertLink(link); } catch (e) {
    if (e instanceof ConflictError) throw new WalletError("this wallet or account is already linked.", 409);
    throw e;
  }
  return link;
}

// ---------- intents (server-built transactions) ----------

export interface DuelForChain {
  id: string;
  createdBy: string;
  status: string;
  stake: number;
  deadline: string;
  calculationVersion: string;
  methodology: string;
  participants: { userId: string; ticker: string }[];
  /** open public challenge: anyone (but the creator) may take the empty slot */
  open?: boolean;
  /** escrow state as recorded from verified onchain events */
  escrowState?: "unfunded" | "funded" | "active" | "settled" | "refunded";
  /** present once beef's settlement service has a final result */
  settlement?: { status: "settled" | "draw" | "needs_verification"; winners: string[]; payload: Settlement | null };
}

export interface PrepareDeps {
  verify: EndUserVerifier;
  repo: WalletRepo;
  loadDuel: (duelId: string) => Promise<DuelForChain | null>;
  escrow?: Address | null;
  usdc?: Address;
  now?: Date;
  newId?: () => string;
  sign?: (p: { escrow: Address; duelId: string; termsHash: Hex; winners: Address[]; settlementHash: Hex }) => Promise<Hex>;
  signJoin?: (p: { escrow: Address; duelId: string; who: Address }) => Promise<Hex>;
  /** which escrow already holds this duel (read from base sepolia). absent → the current escrow */
  resolveEscrow?: (duelId: string) => Promise<Address | null>;
}

/** the escrow an intent's calls go to, if it's one beef knows (or the one a test injected) */
function intentEscrow(intent: WalletIntent, usdc: Address, override: Address | null | undefined): Address | null {
  if (override !== undefined) return override;
  const e = escrowOfCalls(deserializeCalls(intent.calls), usdc);
  return e && isKnownEscrow(e) ? e : null;
}

/**
 * builds the exact calls for a duel action on the server. the client only gets to
 * send these (or nothing): the paymaster refuses any user operation whose calls don't
 * match a prepared intent.
 */
export async function prepareIntent(
  p: { accessToken: string; action: IntentAction; duelId: string; appUserId?: string },
  deps: PrepareDeps,
): Promise<{ intent: WalletIntent; summary: { action: IntentAction; amountUsdc: string; spender: Address; network: string } }> {
  const current = deps.escrow === undefined ? ESCROW_ADDRESS : deps.escrow;
  const usdc = deps.usdc ?? USDC_ADDRESS;
  if (!current) throw new WalletError("onchain stakes aren't available yet: the beef escrow contract isn't deployed on base sepolia.", 503);
  const eu = await deps.verify(p.accessToken);
  const link = await deps.repo.getLinkByCdpUser(eu.cdpUserId);
  if (!link) throw new WalletError("link your wallet to your beef account first.", 409);
  if (p.appUserId && link.userId !== p.appUserId) throw new WalletError("this wallet belongs to a different beef account.", 403);

  const duel = await deps.loadDuel(p.duelId);
  if (!duel) throw new WalletError("duel not found", 404);
  const me = duel.participants.find((x) => x.userId === link.userId);
  const canTakeOpenSlot = p.action === "accept" && !!duel.open && !me && duel.participants.some((x) => !x.userId);
  if (!me && !canTakeOpenSlot) throw new WalletError("you're not in this duel", 403);

  const existing = await deps.repo.findOpenIntent(link.userId, duel.id, p.action);
  if (existing?.status === "confirmed") throw new WalletError("you've already done this for this duel.", 409);
  if (existing) return { intent: existing, summary: summarize(existing, intentEscrow(existing, usdc, deps.escrow) ?? current) }; // duplicate tap → same intent

  // new duels open on the current escrow; everything after that goes to whichever escrow holds the duel
  const escrow = p.action === "create" || !deps.resolveEscrow ? current : (await deps.resolveEscrow(duel.id)) ?? current;
  const stakeOk = stakeWithinLimits(duel.stake);

  let calls: Call[];
  let amount = 0;
  if (p.action === "create") {
    if (duel.createdBy !== link.userId) throw new WalletError("only the creator opens the onchain duel", 403);
    if (duel.status !== "pending") throw new WalletError(`this duel is ${duel.status}`, 409);
    if (duel.escrowState && duel.escrowState !== "unfunded") throw new WalletError("this duel is already funded", 409);
    if (!stakeOk) throw new WalletError(`stakes must be between ${STAKE_MIN} and ${STAKE_MAX} test usdc, in whole cents`, 400);
    // creator's wallet + one open slot per opponent. opponents take their slot with an
    // oracle-signed join, so their wallets don't need to exist yet.
    const wallets: Address[] = duel.participants.map((x) => (x.userId === link.userId ? link.smartAccount : OPEN_SLOT));
    amount = duel.stake;
    calls = buildCreateDuelCalls({
      usdc, escrow, duelId: duel.id, stake: duel.stake, participants: wallets,
      termsHash: termsHash({ duelId: duel.id, stake: duel.stake, tickers: duel.participants.map((x) => x.ticker), deadline: duel.deadline, calculationVersion: duel.calculationVersion, methodology: duel.methodology }),
    });
  } else if (p.action === "accept") {
    if (duel.status !== "pending") throw new WalletError(`this duel is ${duel.status}`, 409);
    if (duel.createdBy === link.userId) throw new WalletError("you created this duel", 409);
    if (duel.escrowState !== "funded") throw new WalletError("the creator hasn't locked their stake yet. you can accept once they have.", 409);
    if (!deps.signJoin) throw new WalletError("joining duels isn't configured on the server yet", 503);
    if (escrow === current && !stakeOk) throw new WalletError(`stakes must be between ${STAKE_MIN} and ${STAKE_MAX} test usdc`, 400);
    amount = duel.stake;
    const joinSig = await deps.signJoin({ escrow, duelId: duel.id, who: link.smartAccount });
    calls = buildJoinCalls({ usdc, escrow, duelId: duel.id, stake: duel.stake, joinSig });
  } else if (p.action === "settle") {
    // payout: the server signs the final result; any participant can submit it
    const st = duel.settlement;
    if (!st || st.status === "needs_verification") throw new WalletError("this duel isn't settled yet. payouts unlock after verified closing prices.", 409);
    if (!deps.sign) throw new WalletError("payouts aren't configured on the server yet", 503);
    const winners: Address[] = [];
    for (const uid of st.status === "draw" ? [] : st.winners) {
      const l = await deps.repo.getLinkByUser(uid);
      if (!l) throw new WalletError("a winner hasn't linked a wallet", 409);
      winners.push(l.smartAccount);
    }
    // the attestation binds the payout to every participant, stream, price, timestamp and report
    const participants: { userId: string; ticker: string; wallet: Address }[] = [];
    for (const x of duel.participants) {
      const l = x.userId ? await deps.repo.getLinkByUser(x.userId) : null;
      if (!l) throw new WalletError("every participant needs a linked wallet before the payout", 409);
      participants.push({ userId: x.userId, ticker: x.ticker, wallet: l.smartAccount });
    }
    if (!st.payload) throw new WalletError("the settlement record is missing", 409);
    let settlementHash: Hex;
    try {
      settlementHash = settlementAttestation({ duelKey: duelIdToBytes32(duel.id), settlement: st.payload, participants, winnerWallets: winners }).hash;
    } catch (e) {
      throw new WalletError(e instanceof AttestationError ? e.message : "couldn't build the settlement attestation", 409);
    }
    const th = termsHash({ duelId: duel.id, stake: duel.stake, tickers: duel.participants.map((x) => x.ticker), deadline: duel.deadline, calculationVersion: duel.calculationVersion, methodology: duel.methodology });
    const oracleSig = await deps.sign({ escrow, duelId: duel.id, termsHash: th, winners, settlementHash });
    calls = buildSettleCalls({ escrow, duelId: duel.id, winners, settlementHash, oracleSig });
  } else {
    calls = buildRefundCalls({ escrow, duelId: duel.id });
  }

  const policy = defaultPolicy(usdc, escrow);
  const ok = checkCalls(calls, policy);
  if (!ok.ok) throw new WalletError(`blocked by policy: ${ok.reason}`, 400); // defence in depth

  const now = deps.now ?? new Date();
  const intent: WalletIntent = {
    id: deps.newId?.() ?? crypto.randomUUID(), userId: link.userId, smartAccount: link.smartAccount, action: p.action, duelId: duel.id,
    amountUnits: (amount ? stakeUnits(amount) : 0n).toString(), callsHash: callsHash(calls), calls: serializeCalls(calls), status: "prepared",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + INTENT_TTL_MS).toISOString(),
  };
  await deps.repo.createIntent(intent);
  return { intent, summary: summarize(intent, escrow) };
}

const summarize = (i: WalletIntent, escrow: Address) => ({ action: i.action, amountUsdc: formatUsdc(BigInt(i.amountUnits)), spender: escrow, network: "base sepolia" });

// ---------- paymaster proxy ----------

export interface PaymasterDeps {
  repo: WalletRepo;
  forward: (body: unknown) => Promise<unknown>;
  escrow?: Address | null;
  usdc?: Address;
  policy?: SponsorshipPolicy;
  now?: Date;
}

const SPONSOR_METHODS = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData"]);
const rpcError = (id: unknown, message: string, code = -32001) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * erc-7677 paymaster proxy. cdp calls this server-to-server while preparing a user
 * operation. we sponsor only operations that (1) are on base sepolia via a known
 * entrypoint, (2) come from a linked beef smart account, (3) match a prepared intent
 * exactly, (4) pass the call policy and (5) fit the per-user and global limits.
 * refusals return a json-rpc error, so the operation fails visibly instead of being
 * sent unsponsored.
 */
export async function handlePaymasterRpc(body: any, deps: PaymasterDeps): Promise<unknown> {
  const id = body?.id;
  const now = deps.now ?? new Date();
  const usdc = deps.usdc ?? USDC_ADDRESS;
  const logRefusal = async (reason: string, sender: string | null = null, intentId: string | null = null) => {
    await deps.repo.log({ at: now.toISOString(), intentId, sender, method: String(body?.method ?? ""), decision: "refused", reason });
    return rpcError(id, `sponsorship refused: ${reason}`);
  };

  if (body?.jsonrpc !== "2.0" || typeof body?.method !== "string") return rpcError(id, "invalid request", -32600);
  if (!SPONSOR_METHODS.has(body.method)) return logRefusal(`method ${body.method} is not supported`);
  if (!(deps.escrow === undefined ? ESCROW_ADDRESS : deps.escrow)) return logRefusal("escrow not deployed");
  const [userOp, entryPoint, chainId, context] = Array.isArray(body.params) ? body.params : [];

  try { assertBaseSepolia(chainId); } catch { return logRefusal(`wrong chain ${String(chainId)} (only base sepolia ${CHAIN_ID})`); }
  if (typeof entryPoint !== "string" || !isAddress(entryPoint) || !ENTRYPOINTS.includes(getAddress(entryPoint) as (typeof ENTRYPOINTS)[number])) return logRefusal("unknown entrypoint");
  const sender = typeof userOp?.sender === "string" && isAddress(userOp.sender) ? getAddress(userOp.sender) : null;
  if (!sender) return logRefusal("missing sender");
  const link = await deps.repo.getLinkBySmartAccount(sender);
  if (!link) return logRefusal("sender isn't a linked beef wallet", sender);

  const intentId = typeof context?.intentId === "string" ? context.intentId : null;
  if (!intentId) return logRefusal("missing intent", sender);
  const intent = await deps.repo.getIntent(intentId);
  if (!intent) return logRefusal("unknown intent", sender, intentId);
  if (getAddress(intent.smartAccount) !== sender) return logRefusal("intent belongs to a different wallet", sender, intentId);
  if (!["prepared", "sponsored"].includes(intent.status)) return logRefusal(`intent is ${intent.status}`, sender, intentId);
  if (Date.parse(intent.expiresAt) < now.getTime()) return logRefusal("intent expired. start again.", sender, intentId);
  const escrow = intentEscrow(intent, usdc, deps.escrow);
  if (!escrow) return logRefusal("intent targets an unknown escrow", sender, intentId);

  let calls: Call[];
  try {
    if (!isHex(userOp.callData)) throw new Error();
    calls = decodeSmartAccountCallData(userOp.callData);
  } catch { return logRefusal("couldn't decode the operation", sender, intentId); }
  if (callsHash(calls) !== intent.callsHash) return logRefusal("operation doesn't match the prepared transaction", sender, intentId);
  const policy = deps.policy ?? defaultPolicy(usdc, escrow);
  const pc = checkCalls(calls, policy);
  if (!pc.ok) return logRefusal(pc.reason, sender, intentId);

  if (intent.status === "prepared") {
    const since = new Date(now.getTime() - DAY);
    const lim = checkLimits({ userCount: await deps.repo.countSponsored(since, sender), globalCount: await deps.repo.countSponsored(since) }, policy);
    if (!lim.ok) return logRefusal(lim.reason, sender, intentId);
  }

  let upstream: unknown;
  try { upstream = await deps.forward(body); }
  catch (e) {
    await deps.repo.log({ at: now.toISOString(), intentId, sender, method: body.method, decision: "error", reason: e instanceof Error ? e.message : "upstream error" });
    return rpcError(id, "sponsorship refused: the gas sponsor is unavailable right now", -32002);
  }
  if ((upstream as any)?.error) {
    await deps.repo.log({ at: now.toISOString(), intentId, sender, method: body.method, decision: "error", reason: JSON.stringify((upstream as any).error).slice(0, 300) });
    return upstream;
  }
  if (body.method === "pm_getPaymasterData") await deps.repo.updateIntent(intentId, { status: "sponsored", sponsoredAt: now.toISOString() }, ["prepared"]);
  await deps.repo.log({ at: now.toISOString(), intentId, sender, method: body.method, decision: "allowed", reason: intent.action });
  return upstream;
}

// ---------- confirmation (receipt verification) ----------

export const USER_OPERATION_EVENT = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);

/**
 * checks a mined receipt really executed this intent: successful tx on base sepolia,
 * emitted by a known entrypoint, for this user operation and sender, sponsored by a
 * paymaster, and the escrow logged the expected event for this duel and wallet.
 */
export function verifyReceipt(receipt: Pick<TransactionReceipt, "status" | "logs">, intent: WalletIntent, userOpHash: Hex, escrow: Address): { ok: true } | { ok: false; reason: string } {
  if (receipt.status !== "success") return { ok: false, reason: "transaction reverted" };
  let opOk = false;
  for (const log of receipt.logs) {
    if (!ENTRYPOINTS.some((e) => e.toLowerCase() === log.address.toLowerCase())) continue;
    try {
      const ev = decodeEventLog({ abi: USER_OPERATION_EVENT, data: log.data, topics: log.topics });
      if (ev.args.userOpHash.toLowerCase() === userOpHash.toLowerCase() && getAddress(ev.args.sender) === getAddress(intent.smartAccount)) {
        if (!ev.args.success) return { ok: false, reason: "user operation failed onchain" };
        if (ev.args.paymaster === "0x0000000000000000000000000000000000000000") return { ok: false, reason: "operation wasn't sponsored" };
        opOk = true;
      }
    } catch { /* not this event */ }
  }
  if (!opOk) return { ok: false, reason: "user operation not found in this transaction" };
  const want = intent.action === "create" ? "Created" : intent.action === "accept" ? "Joined" : intent.action === "refund" ? "Refunded" : "Settled";
  const duelKey = duelIdToBytes32(intent.duelId);
  const sender = getAddress(intent.smartAccount);
  const found = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) return false;
    try {
      const ev = decodeEventLog({ abi: BEEF_ESCROW_ABI, data: log.data, topics: log.topics }) as { eventName: string; args: any };
      if (ev.eventName !== want || ev.args.duelId !== duelKey) return false;
      // the escrow pulls exactly `stake` from each participant, so checking it here proves the deposit amount
      if (want === "Created") return getAddress(ev.args.creator) === sender && BigInt(ev.args.stake) === BigInt(intent.amountUnits);
      if (want === "Joined") return getAddress(ev.args.who) === sender;
      return true;
    } catch { return false; }
  });
  return found ? { ok: true } : { ok: false, reason: `escrow didn't record ${want} for this duel` };
}

export interface ConfirmDeps {
  repo: WalletRepo;
  verify: EndUserVerifier;
  getReceipt: (txHash: Hex) => Promise<Pick<TransactionReceipt, "status" | "logs"> | null>;
  escrow?: Address | null;
  /** applies a verified onchain result to the app database (funded, accepted, settled…) */
  onConfirmed?: (intent: WalletIntent & { txHash: Hex }) => Promise<void>;
}

export async function confirmIntent(p: { accessToken: string; intentId: string; userOpHash: Hex; txHash: Hex }, deps: ConfirmDeps) {
  const eu = await deps.verify(p.accessToken);
  const intent = await deps.repo.getIntent(p.intentId);
  if (!intent) throw new WalletError("unknown transaction", 404);
  const escrow = intentEscrow(intent, USDC_ADDRESS, deps.escrow);
  if (!escrow) throw new WalletError("escrow not deployed", 503);
  const link = await deps.repo.getLinkByCdpUser(eu.cdpUserId);
  if (!link || link.userId !== intent.userId) throw new WalletError("not your transaction", 403);
  if (intent.status === "confirmed") return intent; // idempotent
  if (!isHex(p.txHash) || p.txHash.length !== 66 || !isHex(p.userOpHash) || p.userOpHash.length !== 66) throw new WalletError("bad hashes");
  const receipt = await deps.getReceipt(p.txHash);
  if (!receipt) {
    await deps.repo.updateIntent(intent.id, { status: "submitted", userOpHash: p.userOpHash, txHash: p.txHash }, ["prepared", "sponsored", "submitted"]);
    return { ...intent, status: "submitted" as const };
  }
  const v = verifyReceipt(receipt, intent, p.userOpHash, escrow);
  if (!v.ok) {
    await deps.repo.updateIntent(intent.id, { status: "failed", error: v.reason, userOpHash: p.userOpHash, txHash: p.txHash }, ["prepared", "sponsored", "submitted"]);
    throw new WalletError(`couldn't verify the transaction: ${v.reason}`, 422);
  }
  const moved = await deps.repo.updateIntent(intent.id, { status: "confirmed", userOpHash: p.userOpHash, txHash: p.txHash }, ["prepared", "sponsored", "submitted"]);
  const done = { ...intent, status: "confirmed" as const, userOpHash: p.userOpHash, txHash: p.txHash };
  if (moved && deps.onConfirmed) await deps.onConfirmed(done); // exactly once, after verification
  return done;
}

export { deserializeCalls };
