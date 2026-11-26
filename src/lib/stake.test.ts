import { describe, expect, it } from "vitest";
import { STAKE_PRESETS, formatUsdc, fmtStake, parseStakeInput, prizePoolUnits, stakeUnits, stakeWithinLimits } from "./stake";

const ok = (s: string) => { const r = parseStakeInput(s); if (!r.ok) throw new Error(r.error); return r; };
const err = (s: string) => { const r = parseStakeInput(s); return r.ok ? null : r.error; };

describe("stake input", () => {
  it("accepts every preset", () => {
    for (const p of STAKE_PRESETS) expect(ok(p).units).toBe(BigInt(p) * 1_000_000n);
  });
  it("accepts custom and decimal amounts above 25", () => {
    expect(ok("35.50")).toEqual({ ok: true, units: 35_500_000n, value: "35.50" });
    expect(ok("35.5").value).toBe("35.50");
    expect(ok("150").units).toBe(150_000_000n);
    expect(ok("1000").value).toBe("1000.00");
    expect(ok("0012.30").value).toBe("12.30");
  });
  it("rejects zero, negative, malformed, too precise and out-of-range amounts", () => {
    expect(err("")).toMatch(/enter a stake/);
    expect(err("0")).toMatch(/more than zero/);
    expect(err("0.00")).toMatch(/more than zero/);
    expect(err("-5")).toMatch(/negative/);
    expect(err("abc")).toMatch(/enter a number/);
    expect(err("1e3")).toMatch(/enter a number/);
    expect(err("1.2.3")).toMatch(/enter a number/);
    expect(err("35.555")).toMatch(/2 decimal/);
    expect(err("0.50")).toMatch(/minimum/);
    expect(err("1000.01")).toMatch(/maximum/);
  });
});

describe("amounts never go through float math", () => {
  it("prize pool is stake × participants in base units", () => {
    expect(formatUsdc(prizePoolUnits(ok("35.50").units, 2))).toBe("71.00");
    expect(formatUsdc(prizePoolUnits(ok("11.10").units, 2))).toBe("22.20");
    expect(formatUsdc(prizePoolUnits(stakeUnits("0.10"), 3))).toBe("0.30"); // 0.1 × 3 in floats is 0.30000000000000004
  });
  it("database values round-trip exactly", () => {
    expect(stakeUnits(35.5)).toBe(35_500_000n);
    expect(stakeUnits(150.25)).toBe(150_250_000n);
    expect(fmtStake(10)).toBe("10.00");
    expect(stakeWithinLimits(35.5)).toBe(true);
    expect(stakeWithinLimits(0.5)).toBe(false);
    expect(stakeWithinLimits(1000.01)).toBe(false);
    expect(stakeWithinLimits(10.005)).toBe(false);
  });
});
