import { describe, expect, it } from "vitest";
import { flattenCellValueForExport } from "@/lib/stage-results-export-xlsx";

describe("stage-results-export-xlsx", () => {
  it("aplana objetos y arrays para Excel", () => {
    expect(flattenCellValueForExport("x")).toBe("x");
    expect(flattenCellValueForExport(["a", "b"])).toBe("a · b");
    expect(flattenCellValueForExport({ foo: 1, bar: "z" })).toBe("foo: 1 | bar: z");
  });
});
