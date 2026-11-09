import { describe, expect, it } from "vitest";
import { parseQuickCost } from "../components/quick-cost-editor";

describe("precio rápido en COP", () => {
  it("interpreta valores colombianos sin multiplicar decimales", () => {
    expect(parseQuickCost("$ 450.000")).toBe(450000);
    expect(parseQuickCost("450.000,50")).toBe(450000.5);
    expect(parseQuickCost("13900")).toBe(13900);
    expect(parseQuickCost("0")).toBe(0);
  });

  it("rechaza importes incompletos o negativos antes de guardar", () => {
    expect(parseQuickCost("")).toBeNull();
    expect(parseQuickCost("-100")).toBeNull();
    expect(parseQuickCost("abc")).toBeNull();
  });
});
