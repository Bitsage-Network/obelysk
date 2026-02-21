import { describe, it, expect } from "vitest";
import { parseAmountToRaw, formatRawAmount, formatUsdValue } from "../avnuSwap";

// ============================================================================
// parseAmountToRaw — BigInt-safe decimal → raw conversion
// ============================================================================

describe("parseAmountToRaw", () => {
  it("converts whole numbers correctly", () => {
    expect(parseAmountToRaw("1", 18)).toBe("1000000000000000000");
    expect(parseAmountToRaw("100", 18)).toBe("100000000000000000000");
    expect(parseAmountToRaw("0", 18)).toBe("0");
  });

  it("converts fractional amounts without floating-point loss", () => {
    expect(parseAmountToRaw("1.5", 18)).toBe("1500000000000000000");
    expect(parseAmountToRaw("0.1", 18)).toBe("100000000000000000");
    expect(parseAmountToRaw("0.000001", 18)).toBe("1000000000000");
  });

  it("handles USDC (6 decimals) correctly", () => {
    expect(parseAmountToRaw("1", 6)).toBe("1000000");
    expect(parseAmountToRaw("100.50", 6)).toBe("100500000");
    expect(parseAmountToRaw("0.000001", 6)).toBe("1");
  });

  it("handles wBTC (8 decimals) correctly", () => {
    expect(parseAmountToRaw("1", 8)).toBe("100000000");
    expect(parseAmountToRaw("0.00000001", 8)).toBe("1");
  });

  it("truncates excess decimals to token precision", () => {
    // USDC has 6 decimals, so 7th digit should be truncated
    expect(parseAmountToRaw("1.1234567", 6)).toBe("1123456");
    expect(parseAmountToRaw("0.0000001", 6)).toBe("0");
  });

  it("handles edge cases", () => {
    expect(parseAmountToRaw("", 18)).toBe("0");
    expect(parseAmountToRaw(".", 18)).toBe("0");
    expect(parseAmountToRaw("0.0", 18)).toBe("0");
    expect(parseAmountToRaw("  1  ", 18)).toBe("1000000000000000000");
  });

  it("handles large amounts without precision loss", () => {
    // 1 billion ETH (stress test)
    expect(parseAmountToRaw("1000000000", 18)).toBe("1000000000000000000000000000");
  });

  it("throws on invalid input", () => {
    expect(() => parseAmountToRaw("1.2.3", 18)).toThrow("multiple decimal points");
  });

  it("throws on amounts exceeding u256", () => {
    const tooLarge = "1" + "0".repeat(80); // way larger than u256
    expect(() => parseAmountToRaw(tooLarge, 0)).toThrow("maximum u256");
  });

  // Key test: the floating-point bug this fixes
  it("avoids the floating-point precision bug", () => {
    // With parseFloat: parseFloat("0.1") * 1e18 = 99999999999999990 (WRONG)
    // With BigInt math: "0.1" * 10^18 = 100000000000000000 (CORRECT)
    expect(parseAmountToRaw("0.1", 18)).toBe("100000000000000000");

    // Another classic: parseFloat("0.3") * 1e18 ≠ 3e17
    expect(parseAmountToRaw("0.3", 18)).toBe("300000000000000000");

    // And: parseFloat("1.005") * 1e6 = 1004999.9999... (WRONG for USDC)
    expect(parseAmountToRaw("1.005", 6)).toBe("1005000");
  });
});

// ============================================================================
// formatRawAmount — BigInt-safe raw → display conversion
// ============================================================================

describe("formatRawAmount", () => {
  it("formats whole token amounts", () => {
    expect(formatRawAmount("1000000000000000000", 18)).toBe("1.0");
    expect(formatRawAmount("1000000", 6)).toBe("1.0");
  });

  it("formats fractional amounts", () => {
    expect(formatRawAmount("1500000000000000000", 18, 6)).toBe("1.5");
    expect(formatRawAmount("100000000000000000", 18, 6)).toBe("0.1");
  });

  it("formats zero correctly", () => {
    expect(formatRawAmount("0", 18)).toBe("0.0");
  });

  it("respects displayDecimals parameter", () => {
    expect(formatRawAmount("1234567890000000000", 18, 4)).toBe("1.2345");
    expect(formatRawAmount("1234567890000000000", 18, 2)).toBe("1.23");
  });

  it("handles large amounts without Number overflow", () => {
    // 10 billion ETH (exceeds Number.MAX_SAFE_INTEGER when raw)
    const raw = (BigInt("10000000000") * BigInt(10) ** BigInt(18)).toString();
    expect(formatRawAmount(raw, 18, 2)).toBe("10000000000.0");
  });

  it("trims trailing zeros but keeps at least one decimal", () => {
    expect(formatRawAmount("1000000000000000000", 18, 6)).toBe("1.0");
    expect(formatRawAmount("1100000000000000000", 18, 6)).toBe("1.1");
    expect(formatRawAmount("1120000000000000000", 18, 6)).toBe("1.12");
  });
});

// ============================================================================
// formatUsdValue — guards against edge cases
// ============================================================================

describe("formatUsdValue", () => {
  it("formats normal values", () => {
    expect(formatUsdValue(1.5)).toBe("$1.50");
    expect(formatUsdValue(1000)).toBe("$1,000.00");
    expect(formatUsdValue(0.05)).toBe("$0.05");
  });

  it("handles zero", () => {
    expect(formatUsdValue(0)).toBe("$0.00");
  });

  it("handles sub-penny amounts", () => {
    expect(formatUsdValue(0.001)).toBe("<$0.01");
    expect(formatUsdValue(0.009)).toBe("<$0.01");
  });

  it("guards against Infinity and NaN", () => {
    expect(formatUsdValue(Infinity)).toBe("$0.00");
    expect(formatUsdValue(-Infinity)).toBe("$0.00");
    expect(formatUsdValue(NaN)).toBe("$0.00");
  });

  it("caps absurdly large values", () => {
    expect(formatUsdValue(1e13)).toBe(">$1T");
    expect(formatUsdValue(1e15)).toBe(">$1T");
  });

  it("handles negative values", () => {
    expect(formatUsdValue(-0.5)).toBe("$0.00");
    expect(formatUsdValue(-100)).toBe("$0.00");
  });
});

// ============================================================================
// parseAmountToRaw — decimals=0 edge case
// ============================================================================

describe("parseAmountToRaw — zero decimals", () => {
  it("converts whole numbers with 0 decimals", () => {
    expect(parseAmountToRaw("42", 0)).toBe("42");
    expect(parseAmountToRaw("1", 0)).toBe("1");
    expect(parseAmountToRaw("0", 0)).toBe("0");
  });

  it("truncates fractional part when decimals=0", () => {
    expect(parseAmountToRaw("1.999", 0)).toBe("1");
    expect(parseAmountToRaw("0.5", 0)).toBe("0");
  });
});

// ============================================================================
// formatRawAmount — decimals=0 edge case
// ============================================================================

describe("formatRawAmount — zero decimals", () => {
  it("formats with 0 decimals", () => {
    expect(formatRawAmount("42", 0)).toBe("42.0");
    expect(formatRawAmount("0", 0)).toBe("0.0");
  });
});
