import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import type { Settlement } from "@/lib/types";

// the settlement attestation: one hash over everything a payout depends on. beef's
// settlement signer signs it (with chain id, escrow, duel, terms hash and winners) and
// BeefEscrow.settle checks that signature before paying, so the payout is bound to:
// duel id · participant wallets · tickers · chainlink stream ids · starting and ending
// prices · observation timestamps · signed report hashes · comparison window ·
// winners or draw · calculation version and methodology.
//
// anyone can recompute it from the stored settlement and re-check each report with
// chainlink's verifier. this signature is beef's, not chainlink's, and is labelled so.

export const ATTESTATION_VERSION = "beef.settlement.v1";

export class AttestationError extends Error {}

export function settlementAttestation(p: {
  duelKey: Hex;
  settlement: Settlement;
  /** participant order as stored for the duel, with each participant's linked smart account */
  participants: { userId: string; ticker: string; wallet: Address }[];
  winnerWallets: Address[];
}): { hash: Hex; encoded: Hex } {
  const s = p.settlement;
  if (s.status === "needs_verification") throw new AttestationError("this duel isn't settled yet");
  if (!s.window || !s.evidence?.length) throw new AttestationError("this settlement has no chainlink evidence, so it can't be paid out");
  const ev = (ticker: string, kind: "start" | "end") => {
    const e = s.evidence!.find((x) => x.ticker === ticker && x.kind === kind);
    if (!e || e.verification !== "verified") throw new AttestationError(`${ticker}: no verified ${kind} report`);
    return e;
  };
  const entry = (ticker: string) => {
    const e = s.entries.find((x) => x.ticker === ticker);
    if (!e?.startE18 || !e.endE18) throw new AttestationError(`${ticker}: missing exact prices`);
    return e;
  };
  const rows = p.participants.map((x) => ({ ...x, start: ev(x.ticker, "start"), end: ev(x.ticker, "end"), entry: entry(x.ticker) }));
  const encoded = encodeAbiParameters(
    [
      { type: "string" }, { type: "bytes32" }, { type: "address[]" }, { type: "string[]" }, { type: "bytes32[]" },
      { type: "uint256[]" }, { type: "uint256[]" }, { type: "uint64[]" }, { type: "uint64[]" }, { type: "bytes32[]" }, { type: "bytes32[]" },
      { type: "uint64" }, { type: "uint64" }, { type: "address[]" }, { type: "bool" }, { type: "string" }, { type: "string" },
    ],
    [
      ATTESTATION_VERSION, p.duelKey, rows.map((r) => r.wallet), rows.map((r) => r.ticker), rows.map((r) => r.start.streamId as Hex),
      rows.map((r) => BigInt(r.entry.startE18!)), rows.map((r) => BigInt(r.entry.endE18!)),
      rows.map((r) => BigInt(r.start.observationsTimestamp)), rows.map((r) => BigInt(r.end.observationsTimestamp)),
      rows.map((r) => r.start.reportHash as Hex), rows.map((r) => r.end.reportHash as Hex),
      BigInt(s.window.startTimestamp), BigInt(s.window.endTimestamp), p.winnerWallets, s.status === "draw", s.calculationVersion, s.methodology,
    ],
  );
  return { hash: keccak256(encoded), encoded };
}
