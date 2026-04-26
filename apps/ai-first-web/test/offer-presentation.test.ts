import { describe, expect, it } from "vitest";

import { buildOfferPresentation } from "../lib/offer-presentation";
import type { OfferSimulation } from "../lib/financial-simulation";

describe("buildOfferPresentation", () => {
  it("calculates utility against the final offer with VAT because costs are treated as VAT-included", () => {
    const simulation: OfferSimulation = {
      rows: [
        {
          rowKey: "item-1",
          item: "1",
          description: "Item demo",
          technicalDescription: "Ficha demo",
          quantity: 1,
          unit: "",
          costUnit: 100,
          referenceUnit: 150,
          referenceTotal: 150,
          costTotal: 100,
          offerUnit: 119,
          offerTotal: 119,
          marginUnit: 19,
          utilityValue: 19,
          marginPctOnCost: 19,
          maxProfitPctBeforeCeiling: 50,
          offerVsReferencePct: 79.33,
          discountPctVsReference: 20.67,
          status: "viable",
          warnings: [],
          sourceNotes: "",
          control: {
            mode: "manual",
            discountPct: 0,
            profitPct: 0,
            manualOfferUnit: 119,
          },
        },
      ],
      summary: {
        totalReference: 150,
        totalCost: 100,
        totalOffer: 119,
        totalMargin: 19,
        marginPctOnCost: 19,
        offerVsReferencePct: 79.33,
        discountPctVsReference: 20.67,
        overCeilingCount: 0,
        lossCount: 0,
        incompleteCount: 0,
      },
    };

    const presentation = buildOfferPresentation(simulation, {
      "item-1": {
        applies: true,
        ratePct: 19,
      },
    });

    expect(presentation.rows[0]?.totalWithoutVat).toBeCloseTo(100, 6);
    expect(presentation.rows[0]?.totalWithVat).toBe(119);
    expect(presentation.rows[0]?.utilityValue).toBe(19);
    expect(presentation.summary.totalOfferWithoutVat).toBeCloseTo(100, 6);
    expect(presentation.summary.totalOfferWithVat).toBe(119);
    expect(presentation.summary.totalProjectCost).toBe(100);
    expect(presentation.summary.estimatedUtility).toBe(19);
  });
});
