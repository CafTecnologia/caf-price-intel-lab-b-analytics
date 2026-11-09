import { describe, expect, it } from "vitest";
import { coNumberFormat } from "../lib/co-number-format";
describe("shared Colombian number presentation", () => {
  it("keeps pesos, decimals, losses and row millions unchanged", () => {
    expect(coNumberFormat().format(14792600)).toBe("14.792.600");
    expect(coNumberFormat().format(-2173)).toBe("-2.173");
    expect(coNumberFormat(2).format(2462.64)).toBe("2.462,64");
    expect(coNumberFormat(3, true).format(0.0405)).toBe("0,041");
    expect(coNumberFormat(2, true).format(1.2)).toBe("1,20");
    expect(coNumberFormat(2).format(1.2)).toBe("1,2");
    expect(coNumberFormat().format(0)).toBe("0");
  });
  it("reuses format configuration without mixing fixed and optional decimals", () => {
    expect(coNumberFormat(2)).toBe(coNumberFormat(2));
    expect(coNumberFormat(2, true)).toBe(coNumberFormat(2, true));
    expect(coNumberFormat(2, true)).not.toBe(coNumberFormat(2));
  });
});
