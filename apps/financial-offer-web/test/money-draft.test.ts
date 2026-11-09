import { describe, expect, it } from "vitest";
import { formatMoneyDraft } from "../lib/money-draft";
import { parseQuickCost } from "../components/quick-cost-editor";

describe("puntuación monetaria mientras se escribe", () => {
  it("agrupa miles, conserva centavos y el valor numérico", () => {
    expect(formatMoneyDraft("50000")).toBe("50.000");
    expect(formatMoneyDraft("50000,5")).toBe("50.000,5");
    expect(formatMoneyDraft("$ 1.234.567,89")).toBe("1.234.567,89");
    expect(formatMoneyDraft("50000.25")).toBe("50.000,25");
    expect(formatMoneyDraft("50.00")).toBe("5.000");
    expect(formatMoneyDraft("1.00")).toBe("100");
    expect(parseQuickCost(formatMoneyDraft("50.00"))).toBe(5000);
    expect(parseQuickCost(formatMoneyDraft("50000"))).toBe(50000);
    expect(parseQuickCost(formatMoneyDraft("50000,25"))).toBe(50000.25);
  });
});
