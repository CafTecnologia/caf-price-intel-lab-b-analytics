import { describe, expect, it } from "vitest";

import { mergeCalculationLinkFields, normalizeImportPayload, sampleImportPayload, toProject } from "../lib/contract";
import { buildProjectExport } from "../lib/export";
import {
  buildInitialOfferControls,
  buildOfferPresentation,
  buildSimulation,
  convertOfferControlMode,
  selectedCostUnit,
} from "../lib/financial-engine";

describe("financial offer contract", () => {
  it("normalizes sample import payload into a calculation", () => {
    const payload = normalizeImportPayload(sampleImportPayload());
    const project = toProject(payload, "test-project", "2026-05-01T00:00:00.000Z");

    expect(project.name).toBe("Laboratorio de calculo financiero");
    expect(project.sourceSystem).toBe("demo");
    expect(project.items).toHaveLength(8);
    expect(project.items[0]?.referenceUnit).toBe(350000);
    expect(project.items[1]?.selectedCostMode).toBe("weighted");
    expect(project.items[7]?.vatMode).toBe("exempt");
    expect(project.items[0]?.vatMode).toBe("included");
  });

  it("selects cost source according to selected mode", () => {
    const payload = normalizeImportPayload(sampleImportPayload());
    const project = toProject(payload, "test-project", "2026-05-01T00:00:00.000Z");
    const item = project.items[0]!;

    expect(selectedCostUnit({ ...item, selectedCostMode: "weighted" }, project.settings)).toBe(231000);
    expect(selectedCostUnit({ ...item, selectedCostMode: "moderate" }, project.settings)).toBe(252000);
    expect(selectedCostUnit({ ...item, selectedCostMode: "optimistic" }, project.settings)).toBe(210000);
    expect(selectedCostUnit({ ...item, selectedCostMode: "manual", manualUnitCost: 123456 }, project.settings)).toBe(123456);
  });

  it("normalizes COP and USD price sources into minimum, average and moderate costs", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Fuentes mixtas" },
      items: [
        {
          item: "1",
          description: "Item importado",
          quantity: 1,
          reference_unit: 800000,
          selected_cost_mode: "weighted",
          price_sources: [
            { name: "Local", unit_price: 500000, currency: "COP" },
            { name: "Exterior", unit_price: 100, currency: "USD" },
          ],
        },
      ],
      settings: { usd_to_cop_rate: 4000, usd_import_pct: 30 },
    });
    const project = toProject(payload, "sources", "2026-05-01T00:00:00.000Z");
    const item = project.items[0]!;

    expect(selectedCostUnit({ ...item, selectedCostMode: "optimistic" }, project.settings)).toBe(500000);
    expect(selectedCostUnit({ ...item, selectedCostMode: "moderate" }, project.settings)).toBe(510000);
    expect(selectedCostUnit({ ...item, selectedCostMode: "weighted" }, project.settings)).toBe(505000);
  });

  it("builds financial simulation totals", () => {
    const payload = normalizeImportPayload(sampleImportPayload());
    const project = toProject(payload, "test-project", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.rows).toHaveLength(8);
    expect(simulation.summary.total.isComplete).toBe(false);
    expect(simulation.summary.total.totalReference).toBeNull();
    expect(simulation.summary.referenceKnownTotal).toBe(10710000);
    expect(simulation.summary.referenceKnownCount).toBe(7);
    expect(simulation.summary.missingCostCount).toBe(1);
    expect(simulation.summary.missingReferenceCount).toBe(1);
    expect(simulation.summary.partial.evaluableCount).toBe(6);
    expect(simulation.summary.partial.totalReference).toBe(9210000);
    expect(simulation.summary.partial.totalCost).toBe(42855750);
    expect(simulation.summary.partial.totalOffer).toBe(8706000);
    expect(simulation.summary.partial.totalMargin).toBe(-34149750);
  });

  it("defaults the offer to the ceiling when there is no explicit adjustment", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Oferta base" },
      items: [
        {
          item: "1",
          description: "Costo superior al techo",
          quantity: 100,
          reference_unit: 50000,
          manual_unit_cost: 400000,
          selected_cost_mode: "manual",
        },
      ],
      settings: { default_margin: 0, manual_cost_priority: true },
    });
    const project = toProject(payload, "base-offer", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.rows[0]?.offerUnit).toBe(50000);
    expect(simulation.rows[0]?.offerTotal).toBe(5000000);
    expect(simulation.rows[0]?.costTotal).toBe(40000000);
    expect(simulation.rows[0]?.status).toBe("loss");
  });

  it("keeps the same offer when switching between adjustment modes", () => {
    const current = { mode: "discount" as const, discountPct: 0, profitPct: 0, manualOfferUnit: 50000 };

    const asProfit = convertOfferControlMode(current, "profit", {
      referenceUnit: 50000,
      costUnit: 400000,
      offerUnit: 50000,
    });
    expect(asProfit.mode).toBe("profit");
    expect(asProfit.profitPct).toBeCloseTo(-87.5);
    expect(asProfit.discountPct).toBeCloseTo(0);
    expect(asProfit.manualOfferUnit).toBe(50000);

    const asManual = convertOfferControlMode(current, "manual", {
      referenceUnit: 50000,
      costUnit: 400000,
      offerUnit: 50000,
    });
    expect(asManual.mode).toBe("manual");
    expect(asManual.manualOfferUnit).toBe(50000);
  });

  it("keeps explicit profit mode as an intentional offer from cost", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Utilidad explicita" },
      items: [
        {
          item: "1",
          description: "Utilidad cero explicita",
          quantity: 100,
          reference_unit: 50000,
          manual_unit_cost: 400000,
          selected_cost_mode: "manual",
          offer_mode: "profit",
          profit_pct: 0,
        },
      ],
      settings: { default_margin: 0, manual_cost_priority: true },
    });
    const project = toProject(payload, "explicit-profit", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.rows[0]?.offerUnit).toBe(400000);
    expect(simulation.rows[0]?.discountPctVsReference).toBeCloseTo(-700);
    expect(simulation.rows[0]?.status).toBe("over_ceiling");
  });

  it("builds offer presentation with VAT controls", () => {
    const payload = normalizeImportPayload(sampleImportPayload());
    const project = toProject(payload, "test-project", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const offer = buildOfferPresentation(simulation, {
      "1-0": { mode: "included", ratePct: 19 },
      "2-1": { mode: "exempt", ratePct: 0 },
    });

    expect(offer.rows).toHaveLength(8);
    expect(offer.summary.totalOfferWithVat).toBe(11034000);
    expect(offer.summary.totalVat).toBeGreaterThan(100000);
  });

  it("rejects invalid payloads without items", () => {
    expect(() =>
      normalizeImportPayload({
        project: { name: "Sin items" },
        items: [],
        settings: {},
      }),
    ).toThrow();
  });

  it("maps optional Odoo and IA link fields on import", () => {
    const payload = normalizeImportPayload({
      calculation: {
        name: "Con enlaces",
        source_system: "ia-bridge",
        odoo_project_id: " 12345 ",
        ia_run_id: "run-abc",
        source_analysis_id: "analysis-xyz",
      },
      items: [{ description: "Item", quantity: 1 }],
      settings: {},
    });
    const project = toProject(payload, "id1", "2026-05-01T00:00:00.000Z");
    expect(project.odooProjectId).toBe("12345");
    expect(project.iaRunId).toBe("run-abc");
    expect(project.sourceAnalysisId).toBe("analysis-xyz");
  });

  it("mergeCalculationLinkFields keeps prior link values when omitted on re-import", () => {
    const existing = { odooProjectId: "99", iaRunId: "run-1", sourceAnalysisId: "an-1" };
    const metaOmit = normalizeImportPayload({
      calculation: { name: "X", external_id: "e1", source_system: "sys" },
      items: [{ description: "I", quantity: 1 }],
      settings: {},
    }).calculation;
    expect(mergeCalculationLinkFields(metaOmit, existing)).toEqual(existing);

    const metaUpdate = normalizeImportPayload({
      calculation: {
        name: "X",
        external_id: "e1",
        source_system: "sys",
        odoo_project_id: "new-odoo",
        source_analysis_id: null,
      },
      items: [{ description: "I", quantity: 1 }],
      settings: {},
    }).calculation;
    expect(mergeCalculationLinkFields(metaUpdate, existing)).toEqual({
      odooProjectId: "new-odoo",
      iaRunId: "run-1",
      sourceAnalysisId: null,
    });
  });

  it("accepts extra metadata from external systems without breaking the contract", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Desde otro sistema", source_system: "erp-x", extra_meta: "ignored" },
      items: [{ description: "Item valido", quantity: "COP 1.000", unknown: true }],
      settings: {},
      unknown_root: "ignored",
    });

    expect(payload.calculation.name).toBe("Desde otro sistema");
    expect(payload.calculation.source_system).toBe("erp-x");
    expect(payload.items[0]?.description).toBe("Item valido");
  });

  it("keeps legacy project payloads compatible", () => {
    const payload = normalizeImportPayload({
      project: { name: "Legacy", source_system: "old-app" },
      items: [{ description: "Item legacy", quantity: 1 }],
      settings: {},
    });

    expect(payload.calculation.name).toBe("Legacy");
    expect(payload.calculation.source_system).toBe("old-app");
  });

  it("supports included, excluded and exempt VAT modes", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "IVA" },
      items: [
        { item: "1", description: "Incluido", quantity: 1, reference_unit: 119000, cost_weighted_unit: 100000, vat_mode: "included" },
        { item: "2", description: "Excluido", quantity: 1, reference_unit: 100000, cost_weighted_unit: 80000, vat_mode: "excluded" },
        { item: "3", description: "Exento", quantity: 1, reference_unit: 100000, cost_weighted_unit: 80000, vat_mode: "exempt" },
      ],
      settings: { vat_rate: 19 },
    });
    const project = toProject(payload, "vat", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.rows[0]?.referenceUnit).toBe(119000);
    expect(simulation.rows[1]?.referenceUnit).toBe(119000);
    expect(simulation.rows[2]?.referenceUnit).toBe(100000);
  });

  it("separates complete total from partial evaluable summary", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Parcial" },
      items: [
        { item: "1", description: "Completo", quantity: 1, reference_unit: 100000, cost_weighted_unit: 70000 },
        { item: "2", description: "Sin costo", quantity: 1, reference_unit: 200000 },
      ],
      settings: {},
    });
    const project = toProject(payload, "partial", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.summary.total.isComplete).toBe(false);
    expect(simulation.summary.total.totalCost).toBeNull();
    expect(simulation.summary.total.totalReference).toBeNull();
    expect(simulation.summary.referenceKnownTotal).toBe(300000);
    expect(simulation.summary.referenceIsComplete).toBe(true);
    expect(simulation.summary.partial.evaluableCount).toBe(1);
    expect(simulation.summary.partial.totalCost).toBe(70000);
    expect(simulation.summary.missingCostCount).toBe(1);
  });

  it("can prioritize manual cost when configured", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Manual" },
      items: [{ item: "1", description: "Con manual", quantity: 1, reference_unit: 100000, cost_weighted_unit: 80000, manual_unit_cost: 65000 }],
      settings: { manual_cost_priority: true },
    });
    const project = toProject(payload, "manual", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.rows[0]?.costUnit).toBe(65000);
    expect(simulation.rows[0]?.costModeUsed).toBe("manual_priority");
  });

  it("persists offer controls for simulation and export", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Oferta persistida" },
      items: [
        {
          item: "1",
          description: "Con utilidad",
          quantity: 2,
          reference_unit: 200000,
          cost_weighted_unit: 100000,
          offer_mode: "profit",
          profit_pct: 30,
        },
      ],
      settings: {},
    });
    const project = toProject(payload, "offer", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const exported = buildProjectExport(project);

    expect(simulation.rows[0]?.offerUnit).toBe(130000);
    expect(exported.simulation.rows[0]?.offerUnit).toBe(130000);
  });

  it("rejects unsupported contract versions and currencies", () => {
    expect(() =>
      normalizeImportPayload({
        version: 2,
        calculation: { name: "Version 2", currency: "COP" },
        items: [{ description: "Item" }],
      }),
    ).toThrow();

    expect(() =>
      normalizeImportPayload({
        version: 1,
        calculation: { name: "USD", currency: "USD" },
        items: [{ description: "Item" }],
      }),
    ).toThrow();
  });
});
