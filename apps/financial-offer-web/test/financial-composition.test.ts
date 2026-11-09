import { describe, expect, it } from "vitest";

import { globalOfferCeilingComparison, offerCompositionPercent, settlementCompositionPercent } from "../lib/financial-composition";

describe("financial composition", () => {
  it("uses the final offer as the 100 percent composition and keeps discount outside", () => {
    const result = settlementCompositionPercent({
      offer: 900,
      cost: 600,
      deductions: 90,
      netUtility: 210,
      ceiling: 1000,
    });

    expect(result.costPct).toBeCloseTo(66.6667, 3);
    expect(result.deductionsPct).toBeCloseTo(10, 3);
    expect(result.netUtilityPct).toBeCloseTo(23.3333, 3);
    expect(result.costWidthPct + result.deductionsWidthPct + result.netUtilityWidthPct).toBeCloseTo(100, 8);
    expect(result.discountPct).toBeCloseTo(10, 8);
  });

  it("reports an excess instead of hiding an offer above the ceiling", () => {
    const result = offerCompositionPercent({ offer: 1100, cost: 800, utility: 300, ceiling: 1000 });
    expect(result.discountPct).toBe(0);
    expect(result.excessPct).toBeCloseTo(10, 8);
  });

  it("keeps a loss explicit while the visible positive segments remain bounded", () => {
    const result = settlementCompositionPercent({
      offer: 700,
      cost: 800,
      deductions: 70,
      netUtility: -170,
      ceiling: 1000,
    });

    expect(result.lossPct).toBeCloseTo(24.2857, 3);
    expect(result.netUtilityPct).toBe(0);
    expect(result.costWidthPct + result.deductionsWidthPct).toBeCloseTo(100, 8);
  });

  it("returns empty widths for an empty offer", () => {
    const result = offerCompositionPercent({ offer: 0, cost: 0, utility: 0, ceiling: null });
    expect(result.costWidthPct + result.utilityWidthPct).toBe(0);
    expect(result.discountPct).toBe(0);
  });
});

describe("global offer ceiling", () => {
  it("compares gross registered offer even when some offers are missing", () => {
    expect(globalOfferCeilingComparison({ ceiling: 1000, grossOffer: 1100, offeredItemCount: 2, itemCount: 3 }))
      .toEqual({ status: "exceeded", difference: -100, partial: true });
    expect(globalOfferCeilingComparison({ ceiling: 1000, grossOffer: 900, offeredItemCount: 2, itemCount: 3 }))
      .toEqual({ status: "within", difference: 100, partial: true });
  });

  it("distinguishes an exact limit from missing offer or missing ceiling", () => {
    expect(globalOfferCeilingComparison({ ceiling: 1000, grossOffer: 1000, offeredItemCount: 3, itemCount: 3 }).status).toBe("at_limit");
    expect(globalOfferCeilingComparison({ ceiling: 0, grossOffer: 0, offeredItemCount: 0, itemCount: 3 }).status).toBe("no_offer");
    expect(globalOfferCeilingComparison({ ceiling: null, grossOffer: 1200, offeredItemCount: 3, itemCount: 3 }).status).toBe("no_ceiling");
  });
});
