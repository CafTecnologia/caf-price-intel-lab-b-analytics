import { describe, expect, it } from "vitest";
import { offerBarLayout } from "../lib/offer-bar-layout";

describe("offer bar layout", () => {
  it("treats a zero global ceiling as a limit", () => {
    const layout = offerBarLayout({ offer: 100, ceiling: 0, cost: 60, netUtility: 40, deductions: 0 });
    expect(layout.excess).toBe(100);
    expect(layout.ceilingMarkerPct).toBe(0);
  });

  it("keeps the discount outside the 100 percent offer composition", () => {
    const layout = offerBarLayout({ offer: 900, ceiling: 1000, cost: 600, netUtility: 210, deductions: 90 });
    expect(layout.offerWidthPct).toBe(90);
    expect(layout.discountWidthPct).toBe(10);
    expect(layout.costPct).toBeCloseTo(66.6667, 3);
    expect(layout.utilityPct).toBeCloseTo(23.3333, 3);
    expect(layout.deductionsPct).toBe(10);
    expect(layout.costPct + layout.utilityPct + layout.deductionsPct).toBeCloseTo(100);
    expect(layout.discount).toBe(100);
  });

  it("marks the ceiling inside an offer that exceeds it without adding a second segment", () => {
    const layout = offerBarLayout({ offer: 1100, ceiling: 1000, cost: 700, netUtility: 300, deductions: 100 });
    expect(layout.offerWidthPct).toBe(100);
    expect(layout.discountWidthPct).toBe(0);
    expect(layout.ceilingMarkerPct).toBeCloseTo(90.909, 2);
    expect(layout.excessWidthPct).toBeCloseTo(9.091, 2);
    expect(layout.excess).toBe(100);
  });

  it("keeps losses explicit rather than treating positive widths as the offer composition", () => {
    const layout = offerBarLayout({ offer: 900, ceiling: 1000, cost: 950, netUtility: -140, deductions: 90 });
    expect(layout.isLoss).toBe(true);
    expect(layout.loss).toBe(140);
    expect(layout.costPct).toBeGreaterThan(100);
    expect(layout.utilityPct).toBe(0);
  });
});
