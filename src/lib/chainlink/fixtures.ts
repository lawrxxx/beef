import { encodeAbiParameters, keccak256, pad, parseUnits, toHex, type Hex } from "viem";
import { CHAINLINK_DIRECTORY } from "./directory";
import type { SupportedTicker } from "./config";
import type { RawReport } from "./report";

// TEST FIXTURES ONLY. synthetic rwa advanced (v11) reports, abi-encoded exactly like
// chainlink's, so the official sdk decoder can be exercised in isolated unit tests.
// the numbers are made up and the "signatures" are empty: chainlink's verifier rejects
// these. never shown to users, never used as market data.

export const fixtureStream = (t: SupportedTicker, s: "regular" | "extended" | "overnight" = "regular") => CHAINLINK_DIRECTORY.testnet[t][s].streamId;

export function fixtureReport(o: {
  streamId: Hex;
  observationsTimestamp: number;
  mid: string; // decimal string, e.g. "182.41"
  bid?: string;
  ask?: string;
  marketStatus?: number;
  /** seconds before observationsTimestamp that the mid last updated */
  midAgeS?: number;
  expiresAt?: number;
  digest?: Hex;
}): RawReport {
  const e18 = (v: string) => parseUnits(v, 18);
  const mid = e18(o.mid);
  const bid = o.bid ? e18(o.bid) : mid - parseUnits("0.01", 18);
  const ask = o.ask ? e18(o.ask) : mid + parseUnits("0.01", 18);
  const lastSeenNs = BigInt(o.observationsTimestamp - (o.midAgeS ?? 1)) * 1_000_000_000n;
  const blob = encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint64" }, { type: "uint64" }, { type: "uint192" }, { type: "uint192" }, { type: "uint64" },
      { type: "int192" }, { type: "uint64" }, { type: "int192" }, { type: "int192" }, { type: "int192" }, { type: "int192" }, { type: "int192" }, { type: "uint32" },
    ],
    [o.streamId, BigInt(o.observationsTimestamp), BigInt(o.observationsTimestamp), 0n, 0n, BigInt(o.expiresAt ?? o.observationsTimestamp + 86_400),
      mid, lastSeenNs, bid, 0n, ask, 0n, mid, o.marketStatus ?? 2],
  );
  const fullReport = encodeAbiParameters(
    [{ type: "bytes32[3]" }, { type: "bytes" }, { type: "bytes32[]" }, { type: "bytes32[]" }, { type: "bytes32" }],
    [[o.digest ?? keccak256(toHex("fixture-config")), pad("0x00"), pad("0x00")], blob, [], [], pad("0x00")],
  );
  return { feedID: o.streamId, fullReport, validFromTimestamp: o.observationsTimestamp, observationsTimestamp: o.observationsTimestamp };
}
