import { describe, expect, it } from "vitest";

import { normalizeImportPayload, toCalculation } from "../lib/contract";
import { buildProjectExport, clientOfferRows } from "../lib/export";
import {
  buildInitialOfferControls,
  buildOfferPresentation,
  buildSimulation,
  buildVatControls,
  provisionalUtilityForRow,
} from "../lib/financial-engine";

function project(quantity: number | null = 6, offerMode = "manual", baseCost: number | null = 100) {
  return toCalculation(normalizeImportPayload({
    calculation: { name: "Utilidad provisional", currency: "COP" },
    items: [{
      item: "1",
      description: "Equipo",
      quantity,
      reference_unit: 250,
      manual_unit_cost: baseCost,
      selected_cost_mode: "manual",
      offer_mode: offerMode,
      manual_offer_unit: offerMode === "manual" ? 200 : null,
      additional_costs: [
        { name: "Accesorio", category: "service", mode: "per_unit", amount: 10 },
        { name: "Flete", category: "logistics", mode: "fixed", amount: 60 },
        { name: "Marcación", category: "service", mode: "fixed", amount: null },
      ],
    }],
    general_costs: [{ name: "Póliza", category: "other", amount: 30 }],
    settings: {},
  }), "provisional", "2026-10-05T00:00:00.000Z");
}

describe("utilidad con servicios pendientes", () => {
  it("mantiene el cálculo visible y avisa que hay asociados sin valorar", () => {
    const source = project();
    const simulation = buildSimulation(source, buildInitialOfferControls(source));
    const row = simulation.rows[0]!;
    const offer = buildOfferPresentation(simulation, buildVatControls(source), source.settings);

    expect(row.knownCostTotal).toBe(720);
    expect(row.offerTotal).toBe(1200);
    expect(provisionalUtilityForRow(row)).toBeNull();
    expect(offer.summary.totalOfferWithVat).toBe(1194);
    expect(offer.summary.totalDeductions).toBe(0);
    expect(offer.summary.generalCostsTotal).toBe(30);
    expect(offer.summary.expectedNetCollection - row.knownCostTotal! - offer.summary.generalCostsTotal).toBe(444);
    expect(offer.summary.isComplete).toBe(true);
    expect(offer.summary.estimatedUtility).toBe(444);
    expect(offer.rows[0]?.utilityValue).toBe(474);
    expect(row.utilityValue).toBe(480);
    expect(row.status).toBe("viable");
    expect(row.isFinanciallyEvaluable).toBe(true);
    expect(simulation.summary.total.isComplete).toBe(true);
    expect(simulation.summary.missingAssociatedCostCount).toBe(1);
    expect(simulation.summary.missingCostCount).toBe(0);
    expect(row.warnings.join(" ")).toContain("costos conocidos");
  });

  it("no anuncia utilidad si falta el costo base", () => {
    const noOffer = project(6, "profit");
    const controls = buildInitialOfferControls(noOffer);
    controls["1-0"]!.manualOfferUnit = null;
    const noOfferRow = buildSimulation(noOffer, controls).rows[0]!;
    expect(noOfferRow.offerTotal).not.toBeNull();
    expect(provisionalUtilityForRow(noOfferRow)).toBeNull();

    const noBase = project(6, "manual", null);
    const noBaseRow = buildSimulation(noBase, buildInitialOfferControls(noBase)).rows[0]!;
    expect(noBaseRow.baseCostUnit).toBeNull();
    expect(provisionalUtilityForRow(noBaseRow)).toBeNull();
    const exported = buildProjectExport(noBase);
    expect(exported.offer.summary.isComplete).toBe(false);
    expect(exported.offer.summary.estimatedUtility).toBeNull();
    expect(exported.offer.summary.estimatedNetUtility).toBeNull();
  });

  it("usa una unidad asumida para calcular con cantidad ausente", () => {
    const source = project(null);
    const simulation = buildSimulation(source, buildInitialOfferControls(source));
    const row = simulation.rows[0]!;

    expect(source.items[0]?.quantity).toBeNull();
    expect(row.quantity).toBe(1);
    expect(row.quantityAssumed).toBe(true);
    expect(row.knownCostTotal).toBe(170);
    expect(row.offerTotal).toBe(200);
    expect(row.utilityValue).toBe(30);
    expect(provisionalUtilityForRow(row)).toBeNull();
    expect(simulation.summary.assumedQuantityCount).toBe(1);
    const exportedRow = clientOfferRows(buildProjectExport(source))[0];
    expect(exportedRow?.Cantidad).toBe(1);
    expect(exportedRow?.["Cantidad asumida"]).toBe("Sí, confirmar con pliego");
    expect(clientOfferRows(buildProjectExport(project()))[0]?.["Cantidad asumida"]).toBe("");
  });

  it("no calcula totales con cantidad cero", () => {
    const source = project(0);
    const simulation = buildSimulation(source, buildInitialOfferControls(source));
    const row = simulation.rows[0]!;

    expect(row.quantity).toBeNull();
    expect(row.quantityAssumed).toBe(false);
    expect(row.offerTotal).toBeNull();
    expect(provisionalUtilityForRow(row)).toBeNull();
    expect(simulation.summary.missingQuantityCount).toBe(1);
    expect(simulation.summary.total.isComplete).toBe(false);
  });

  it("al valorar el servicio pendiente vuelve a utilidad definitiva", () => {
    const source = project();
    source.items[0]!.additionalCosts[2]!.amount = 20;
    const simulation = buildSimulation(source, buildInitialOfferControls(source));
    const row = simulation.rows[0]!;

    expect(provisionalUtilityForRow(row)).toBeNull();
    expect(row.utilityValue).toBe(460);
    expect(row.status).not.toBe("incomplete");
    expect(simulation.summary.total.isComplete).toBe(true);
  });
});
