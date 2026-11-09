import { describe, expect, it } from "vitest";
import {
  normalizeImportPayload,
  preserveAdditionalCostsOnReimport,
  sampleImportPayload,
  toCalculation,
} from "../lib/contract";
import { buildInitialOfferControls, buildSimulation, selectedCostSource } from "../lib/financial-engine";

function payloadFor(type: "product" | "service", sourceSystem = "odoo_caf") {
  const payload: any = structuredClone(sampleImportPayload());
  payload.calculation.ia_run_id = "ia-run-service-cost";
  payload.calculation.source_system = sourceSystem;
  const item = payload.items[0]!;
  item.deliverable_type = type;
  item.reference_unit = 500_000;
  item.quantity = 2;
  item.selected_cost_mode = "weighted";
  item.manual_unit_cost = 333_000;
  item.price_sources = [
    { name: "Proveedor A", unit_price: 210_000, currency: "COP" },
    { name: "Proveedor B", unit_price: 260_000, currency: "COP" },
  ];
  return payload;
}

describe("AI service import cost guard", () => {
  it("keeps service evidence and ceiling while leaving imported cost unselected", () => {
    const raw = payloadFor("service");
    raw.items[0]!.additional_costs = [
      { name: "Instalación", category: "service", mode: "fixed", amount: 42_000, notes: "Confirmar alcance", review_status: "included" },
    ];
    const calculation = toCalculation(normalizeImportPayload(raw), "service-1", "2026-10-06T00:00:00Z");
    const item = calculation.items[0]!;

    expect(item.deliverableType).toBe("service");
    expect(item.quantity).toBe(2);
    expect(item.referenceUnit).toBe(500_000);
    expect(item.priceSources).toHaveLength(2);
    expect(item.manualUnitCost).toBeNull();
    expect(item.selectedCostMode).toBe("manual");
    expect(item.costBasisStatus).toBe("pending");
    expect(item.additionalCosts).toMatchObject([{ name: "Instalación", amount: 42_000, notes: "Confirmar alcance", reviewStatus: "suggested" }]);
    expect(selectedCostSource(item).costUnit).toBeNull();

    const simulation = buildSimulation(calculation, buildInitialOfferControls(calculation));
    expect(simulation.rows[0]?.costTotal).toBeNull();
    expect(simulation.rows[0]?.knownCostTotal).toBeNull();
    expect(simulation.rows[0]?.utilityValue).toBeNull();

    item.manualUnitCost = 100_000;
    item.selectedCostMode = "manual";
    item.additionalCosts[0]!.reviewStatus = "included";
    const humanReviewedSimulation = buildSimulation(calculation, buildInitialOfferControls(calculation));
    expect(humanReviewedSimulation.rows[0]?.costTotal).toBeGreaterThan(0);
    expect(humanReviewedSimulation.rows[0]?.knownCostTotal).toBeGreaterThan(0);
    expect(humanReviewedSimulation.rows[0]?.utilityValue).not.toBeNull();
  });

  it("keeps an explicit human service cost when an import has no IA metadata", () => {
    const raw = {
      calculation: { name: "Servicio cotizado", currency: "COP" },
      items: [{
        item: "1",
        description: "Servicio técnico",
        deliverable_type: "service",
        quantity: 1,
        unit: "UN",
        manual_unit_cost: 100,
        selected_cost_mode: "manual",
        manual_offer_unit: 200,
        offer_mode: "manual",
        price_sources: [],
      }],
      settings: {},
    };
    const item = toCalculation(normalizeImportPayload(raw), "trusted-service-cost", "2026-10-06T00:00:00Z").items[0]!;

    expect(item.manualUnitCost).toBe(100);
    expect(item.selectedCostMode).toBe("manual");
    expect(item.costBasisStatus).toBeNull();
    expect(selectedCostSource(item).costUnit).toBe(100);
  });

  it("keeps a manual amount pending when an unmarked import selects weighted mode", () => {
    const raw = {
      calculation: { name: "Servicio por revisar", currency: "COP" },
      items: [{
        item: "1",
        description: "Servicio técnico",
        deliverable_type: "service",
        quantity: 1,
        unit: "UN",
        manual_unit_cost: 100,
        selected_cost_mode: "weighted",
        price_sources: [{ name: "Referencia IA", unit_price: 120, currency: "COP" }],
      }],
      settings: {},
    };
    const item = toCalculation(normalizeImportPayload(raw), "weighted-with-manual-amount", "2026-10-06T00:00:00Z").items[0]!;

    expect(item.costBasisStatus).toBe("pending");
    expect(item.manualUnitCost).toBeNull();
    expect(item.selectedCostMode).toBe("manual");
    expect(item.priceSources).toHaveLength(1);
    expect(selectedCostSource(item).costUnit).toBeNull();
  });

  it("blocks positive service sources without manual value even when metadata is absent", () => {
    const raw = payloadFor("service");
    delete raw.calculation.ia_run_id;
    delete raw.calculation.source_system;
    raw.items[0]!.manual_unit_cost = null;
    const item = toCalculation(normalizeImportPayload(raw), "service-no-origin", "2026-10-06T00:00:00Z").items[0]!;

    expect(item.costBasisStatus).toBe("pending");
    expect(item.manualUnitCost).toBeNull();
    expect(item.selectedCostMode).toBe("manual");
    expect(selectedCostSource(item).costUnit).toBeNull();
  });

  it("guards a new service import without a run id or recognized source label", () => {
    const raw = payloadFor("service", "qa_ai_simulation");
    delete raw.calculation.ia_run_id;
    const item = toCalculation(normalizeImportPayload(raw), "service-unknown-origin", "2026-10-06T00:00:00Z").items[0]!;

    expect(item.deliverableType).toBe("service");
    expect(item.manualUnitCost).toBeNull();
    expect(item.selectedCostMode).toBe("manual");
    expect(item.costBasisStatus).toBe("pending");
    expect(selectedCostSource(item).costUnit).toBeNull();
  });

  it("leaves product automatic pricing unchanged for the same AI sources", () => {
    const calculation = toCalculation(normalizeImportPayload(payloadFor("product")), "product-1", "2026-10-06T00:00:00Z");
    const item = calculation.items[0]!;

    expect(item.deliverableType).toBe("product");
    expect(item.selectedCostMode).toBe("weighted");
    expect(selectedCostSource(item).costUnit).toBeGreaterThan(0);
  });

  it("guards an IA service whose input already selects manual mode without a human price", () => {
    const raw = payloadFor("service");
    raw.items[0]!.selected_cost_mode = "manual";
    raw.items[0]!.manual_unit_cost = null;
    const item = toCalculation(normalizeImportPayload(raw), "service-2", "2026-10-06T00:00:00Z").items[0]!;

    expect(selectedCostSource(item).costUnit).toBeNull();
  });

  it("allows a later human service price and preserves its mode and value on reimport", () => {
    const raw = payloadFor("service");
    const source = normalizeImportPayload(raw);
    const existing = toCalculation(source, "service-3", "2026-10-06T00:00:00Z");
    existing.items[0]!.manualUnitCost = 180_000;
    existing.items[0]!.selectedCostMode = "manual";
    existing.items[0]!.additionalCosts = [
      { id: "human-install", name: "Instalación confirmada", category: "service", mode: "fixed", amount: 25_000, notes: "Aprobado por usuario", reviewStatus: "included" },
    ];

    const incoming = toCalculation(normalizeImportPayload(payloadFor("service")), "service-3", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, source);
    const item = merged.items[0]!;

    expect(item.manualUnitCost).toBe(180_000);
    expect(item.costBasisStatus).toBeNull();
    expect(item.selectedCostMode).toBe("manual");
    expect(selectedCostSource(item).costUnit).toBe(180_000);
    expect(item.priceSources).toHaveLength(2);
    expect(item.additionalCosts).toMatchObject([{ name: "Instalación confirmada", amount: 25_000, reviewStatus: "included" }]);
  });

  it("preserves an explicitly saved empty manual choice but not the IA default", () => {
    const raw = payloadFor("service");
    const source = normalizeImportPayload(raw);
    const existing = toCalculation(source, "service-empty-manual", "2026-10-06T00:00:00Z");
    existing.items[0]!.manualUnitCost = null;
    existing.items[0]!.selectedCostMode = "manual";
    existing.items[0]!.manualCostReviewed = true;

    const incoming = toCalculation(normalizeImportPayload(payloadFor("service")), "service-empty-manual", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, source);

    expect(merged.items[0]!.manualUnitCost).toBeNull();
    expect(merged.items[0]!.selectedCostMode).toBe("manual");
    expect(merged.items[0]!.manualCostReviewed).toBe(true);
    expect(selectedCostSource(merged.items[0]!).costUnit).toBeNull();
  });

  it("preserves a human service price when reimport omits deliverable_type", () => {
    const raw = payloadFor("service");
    delete raw.items[0]!.deliverable_type;
    const source = normalizeImportPayload(raw);
    const existing = toCalculation(
      normalizeImportPayload(payloadFor("service")),
      "service-omitted-type",
      "2026-10-06T00:00:00Z",
    );
    existing.items[0]!.manualUnitCost = 175_000;
    existing.items[0]!.selectedCostMode = "manual";

    const incoming = toCalculation(source, "service-omitted-type", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, source);

    expect(merged.items[0]!.deliverableType).toBe("service");
    expect(merged.items[0]!.manualUnitCost).toBe(175_000);
    expect(merged.items[0]!.selectedCostMode).toBe("manual");
    expect(selectedCostSource(merged.items[0]!).costUnit).toBe(175_000);
  });

  it("guards an omitted type that matches an unreviewed existing service", () => {
    const original = payloadFor("service");
    original.items[0]!.additional_costs = [
      { name: "Instalación", category: "service", mode: "fixed", amount: 45_000, notes: "Alcance IA", review_status: "included" },
    ];
    const existing = toCalculation(normalizeImportPayload(original), "service-omitted-unreviewed", "2026-10-06T00:00:00Z");
    existing.items[0]!.selectedCostMode = "weighted";
    existing.items[0]!.costBasisStatus = "comparable_scenario";

    const raw = structuredClone(original);
    delete raw.items[0]!.deliverable_type;
    const source = normalizeImportPayload(raw);
    const incoming = toCalculation(source, "service-omitted-unreviewed", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, source);
    const item = merged.items[0]!;

    expect(item.deliverableType).toBe("service");
    expect(item.costBasisStatus).toBe("pending");
    expect(item.manualUnitCost).toBeNull();
    expect(item.selectedCostMode).toBe("manual");
    expect(item.additionalCosts[0]?.reviewStatus).toBe("suggested");
    expect(selectedCostSource(item).costUnit).toBeNull();
  });

  it("preserves a selected human service quote and merges new sources without duplicates", () => {
    const raw = payloadFor("service");
    const source = normalizeImportPayload(raw);
    const existing = toCalculation(source, "service-source-choice", "2026-10-06T00:00:00Z");
    const chosen = existing.items[0]!.priceSources[0]!;
    chosen.unitPrice = 123_456;
    chosen.url = "https://human.example/approved-quote";
    existing.items[0]!.selectedCostMode = "source";
    existing.items[0]!.selectedPriceSourceId = chosen.id;
    existing.items[0]!.manualCostReviewed = true;

    const updatedRaw = structuredClone(raw);
    updatedRaw.items[0]!.price_sources = [
      { name: "Proveedor A", unit_price: 222_222, currency: "COP", url: "https://ai.example/changed" },
      { name: "Proveedor B", unit_price: 260_000, currency: "COP" },
      { name: "Proveedor nuevo", unit_price: 280_000, currency: "COP" },
    ];
    const updatedSource = normalizeImportPayload(updatedRaw);
    const incoming = toCalculation(updatedSource, "service-source-choice", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, updatedSource);
    const item = merged.items[0]!;
    const selected = item.priceSources.filter((quote) => quote.id === chosen.id);

    expect(item.selectedCostMode).toBe("source");
    expect(item.costBasisStatus).toBeNull();
    expect(item.selectedPriceSourceId).toBe(chosen.id);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ unitPrice: 123_456, url: "https://human.example/approved-quote" });
    expect(item.priceSources.some((quote) => quote.label === "Proveedor nuevo")).toBe(true);
    expect(selectedCostSource(item).costUnit).toBe(123_456);
  });

  it("preserves a human-reviewed associated service cost without confirming its IA base cost", () => {
    const raw = payloadFor("service");
    raw.items[0]!.additional_costs = [
      { name: "Visita técnica", category: "service", mode: "fixed", amount: 30_000, notes: "Aprobado", review_status: "included" },
    ];
    const source = normalizeImportPayload(raw);
    const existing = toCalculation(source, "service-associated-review", "2026-10-06T00:00:00Z");
    existing.items[0]!.additionalCostsReviewed = true;
    existing.items[0]!.additionalCosts[0]!.reviewStatus = "included";

    const incoming = toCalculation(normalizeImportPayload(raw), "service-associated-review", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, source);

    expect(merged.items[0]!.additionalCosts[0]?.reviewStatus).toBe("included");
    expect(merged.items[0]!.selectedCostMode).toBe("manual");
    expect(merged.items[0]!.manualUnitCost).toBeNull();
    expect(selectedCostSource(merged.items[0]!).costUnit).toBeNull();
  });

  it("does not restore a legacy weighted service cost during AI reimport", () => {
    const raw = payloadFor("service");
    raw.items[0]!.additional_costs = [
      { name: "Servicio antiguo", category: "service", mode: "fixed", amount: 42_000, notes: "", review_status: "included" },
    ];
    const source = normalizeImportPayload(raw);
    const existing = toCalculation(source, "service-legacy", "2026-10-06T00:00:00Z");
    existing.items[0]!.selectedCostMode = "weighted";
    existing.items[0]!.manualUnitCost = null;
    existing.items[0]!.costBasisStatus = "comparable_scenario";
    existing.items[0]!.additionalCosts = [
      { id: "old-service-cost", name: "Servicio antiguo", category: "service", mode: "fixed", amount: 42_000, notes: "", reviewStatus: "included" },
    ];

    const incoming = toCalculation(normalizeImportPayload(raw), "service-legacy", "2026-10-07T00:00:00Z");
    const merged = preserveAdditionalCostsOnReimport(incoming, existing, source);
    const item = merged.items[0]!;

    expect(item.costBasisStatus).toBe("pending");
    expect(item.selectedCostMode).toBe("manual");
    expect(item.manualUnitCost).toBeNull();
    expect(item.additionalCosts[0]?.reviewStatus).toBe("suggested");
    expect(selectedCostSource(item).costUnit).toBeNull();
  });

  it("applies the service guard to an IA run even without the Odoo source-system label", () => {
    const raw = payloadFor("service", "other");
    const item = toCalculation(normalizeImportPayload(raw), "service-4", "2026-10-06T00:00:00Z").items[0]!;

    expect(item.selectedCostMode).toBe("manual");
    expect(selectedCostSource(item).costUnit).toBeNull();
  });
});

