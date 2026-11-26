import { decodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { BASE_SEPOLIA_VERIFIER_PROXY } from "./config";
import type { V11Price } from "./report";

// report integrity: chainlink's own verifier proxy on base sepolia checks the DON
// signatures. we call `verify(payload, "")` (interface from chainlink's onchain
// verification tutorial) as a read-only eth_call: chainlink's contract runs the real
// signature check and returns the verified report, but no transaction is recorded.
// results are labelled exactly that way. nothing here signs or "verifies" on its own.

export const VERIFIER_PROXY_ABI = parseAbi([
  "function verify(bytes payload, bytes parameterPayload) payable returns (bytes verifierResponse)",
  "function getVerifier(bytes32 configDigest) view returns (address)",
  "function typeAndVersion() view returns (string)",
]);

/** the full report is abi (bytes32[3] reportContext, bytes reportBlob, bytes32[] rs, bytes32[] ss, bytes32 vs) */
const FULL_REPORT = [{ type: "bytes32[3]" }, { type: "bytes" }, { type: "bytes32[]" }, { type: "bytes32[]" }, { type: "bytes32" }] as const;
const V11_BLOB = [
  { type: "bytes32" }, { type: "uint64" }, { type: "uint64" }, { type: "uint192" }, { type: "uint192" }, { type: "uint64" },
  { type: "int192" }, { type: "uint64" }, { type: "int192" }, { type: "int192" }, { type: "int192" }, { type: "int192" }, { type: "int192" }, { type: "uint32" },
] as const;

/** "verified": signatures checked by chainlink's verifier proxy. "onchain": read directly from a chainlink data feed contract (no report to verify). */
export type VerificationStatus = "verified" | "onchain" | "reverted" | "mismatch" | "unsupported_config" | "error";

export interface Verification {
  status: VerificationStatus;
  /** how it was checked: chainlink's verifier proxy (read-only call) or a direct chainlink data feed read */
  method: "chainlink_verifier_proxy_eth_call" | "chainlink_data_feed_read";
  verifier: Address;
  chainId: 84532 | 8453;
  configDigest: Hex | null;
  checkedAt: string;
  detail: string;
}

export function configDigestOf(fullReport: Hex): Hex {
  const [ctx] = decodeAbiParameters(FULL_REPORT, fullReport);
  return ctx[0];
}

/**
 * runs chainlink's signature verification for one report and checks the verified payload
 * matches what we decoded (same stream, same timestamps, same prices, same status).
 */
export async function verifyWithChainlink(client: Pick<PublicClient, "readContract" | "call">, p: V11Price, now = new Date()): Promise<Verification> {
  const base = { method: "chainlink_verifier_proxy_eth_call" as const, verifier: BASE_SEPOLIA_VERIFIER_PROXY, chainId: 84532 as const, checkedAt: now.toISOString() };
  let configDigest: Hex | null = null;
  try {
    configDigest = configDigestOf(p.fullReport);
    // is this DON configuration registered with the base sepolia verifier at all?
    const verifier = await client.readContract({ address: BASE_SEPOLIA_VERIFIER_PROXY, abi: VERIFIER_PROXY_ABI, functionName: "getVerifier", args: [configDigest] });
    if (verifier === zeroAddress) return { ...base, status: "unsupported_config", configDigest, detail: "the report's DON config isn't registered with chainlink's base sepolia verifier" };

    let out: Hex;
    try {
      const res = await client.call({ to: BASE_SEPOLIA_VERIFIER_PROXY, data: encodeFunctionData({ abi: VERIFIER_PROXY_ABI, functionName: "verify", args: [p.fullReport, "0x"] }) });
      if (!res.data) return { ...base, status: "reverted", configDigest, detail: "verifier returned no data" };
      [out] = decodeAbiParameters([{ type: "bytes" }], res.data);
    } catch (e) {
      return { ...base, status: "reverted", configDigest, detail: `chainlink's verifier reverted: ${(e as { shortMessage?: string }).shortMessage ?? "execution reverted"}` };
    }
    const v = decodeAbiParameters(V11_BLOB, out);
    const same = v[0].toLowerCase() === p.streamId.toLowerCase() && Number(v[2]) === p.observationsTimestamp && v[6] === p.mid
      && v[7] === p.lastSeenTimestampNs && v[8] === p.bid && v[10] === p.ask && Number(v[13]) === p.marketStatus;
    if (!same) return { ...base, status: "mismatch", configDigest, detail: "the verified report doesn't match the decoded report" };
    return { ...base, status: "verified", configDigest, detail: "signatures accepted by chainlink's verifier proxy (read-only call, no transaction)" };
  } catch (e) {
    return { ...base, status: "error", configDigest, detail: e instanceof Error ? e.message : "verification failed" };
  }
}
