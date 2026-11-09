import { describe, expect, it } from "vitest";

import type { FinancialOfferItem, FinancialOfferProject } from "../lib/contract";
import { buildInitialOfferControls, buildRowKey } from "../lib/financial-engine";
import { isNewerExternalRevision, synchronizePristineOfferControls } from "../lib/offer-controls-sync";

const settings = {
  vatRate: 19,
  defaultMargin: 20,
  defaultCostMode: "weighted",
  manualCostPriority: false,
  usdToCopRate: null,
  usdImportPct: 30,
  manualReferenceTotal: null,
} as FinancialOfferProject["settings"];

function item(patch: Partial<FinancialOfferItem> = {}): FinancialOfferItem {
  return {
    id: "row-1",
    item: "1",
    description: "Ítem de prueba",
    technicalDescription: "",
    quantity: 1,
    unit: "UND",
    referenceUnit: 100,
    costOptimistic: 50,
    costModerate: 50,
    costWeightedUnit: 50,
    manualUnitCost: null,
    selectedCostMode: "weighted",
    selectedPriceSourceId: null,
    costScenarioMode: null,
    costScenarioDiscountPct: null,
    priceSources: [],
    additionalCosts: [],
    offerMode: null,
    discountPct: null,
    profitPct: null,
    manualOfferUnit: null,
    vatMode: "excluded",
    vatRate: 19,
    source1: "",
    source2: "",
    source3: "",
    notes: "",
    ...patch,
    deliverableType: patch.deliverableType ?? null,
  };
}

function synchronize(previousItems: FinancialOfferItem[], nextItems: FinancialOfferItem[], controls = buildInitialOfferControls({ items: previousItems, settings })) {
  return synchronizePristineOfferControls({ previousItems, nextItems, controls, settings });
}

describe("synchronizePristineOfferControls", () => {
  it("reanchors an untouched automatic offer when an external ceiling changes", () => {
    const previousItems = [item({ referenceUnit: 100 })];
    const nextItems = [item({ referenceUnit: 120 })];
    const controls = buildInitialOfferControls({ items: previousItems, settings });
    const rowKey = buildRowKey(previousItems[0]!, 0);

    const nextAutomatic = buildInitialOfferControls({ items: nextItems, settings });

    expect(synchronize(previousItems, nextItems, controls)[rowKey]).toEqual(nextAutomatic[rowKey]);
  });

  it("anchors an untouched offer when a ceiling arrives after initial import", () => {
    const previous = [item({ referenceUnit: null, costWeightedUnit: 50, vatMode: "included" })];
    const next = [item({ referenceUnit: 120, costWeightedUnit: 50, vatMode: "included" })];
    const rowKey = buildRowKey(previous[0]!, 0);
    const identity = { sourceSystem: "odoo_caf", iaRunId: "future-study" };
    const before = buildInitialOfferControls({ items: previous, settings, ...identity });
    const after = synchronizePristineOfferControls({ previousItems: previous, nextItems: next, controls: before, settings, ...identity });

    expect(before[rowKey]?.manualOfferUnit).toBeNull();
    expect(after[rowKey]?.manualOfferUnit).toBe(120);
    expect(after[rowKey]?.discountPct).toBe(0);
  });

  it("anchors an AI offer after autosave persisted its blank default", () => {
    const previous = [item({ referenceUnit: null, vatMode: "included", offerMode: "discount", discountPct: 0, manualOfferUnit: null })];
    const next = [item({ ...previous[0], referenceUnit: 120 })];
    const identity = { sourceSystem: "odoo_caf", iaRunId: "future-study" };
    const rowKey = buildRowKey(previous[0]!, 0);
    const controls = buildInitialOfferControls({ items: previous, settings, ...identity });
    const result = synchronizePristineOfferControls({ previousItems: previous, nextItems: next, controls, settings, ...identity });

    expect(result[rowKey]?.manualOfferUnit).toBe(120);
  });

  it("keeps a human offer adjustment when an AI ceiling arrives later", () => {
    const previous = [item({ referenceUnit: null, vatMode: "included" })];
    const next = [item({ referenceUnit: 120, vatMode: "included" })];
    const identity = { sourceSystem: "odoo_caf", iaRunId: "future-study" };
    const rowKey = buildRowKey(previous[0]!, 0);
    const untouched = buildInitialOfferControls({ items: previous, settings, ...identity });
    const edited = { ...untouched, [rowKey]: { ...untouched[rowKey]!, manualOfferUnit: 80 } };
    const result = synchronizePristineOfferControls({ previousItems: previous, nextItems: next, controls: edited, settings, ...identity });

    expect(result).toBe(edited);
    expect(result[rowKey]?.manualOfferUnit).toBe(80);
  });

  it("uses the gross ceiling without adding VAT again", () => {
    const previous = [item({ vatMode: "included", referenceUnit: 100 })];
    const next = [item({ vatMode: "included", referenceUnit: 119 })];
    const control = synchronize(previous, next)[buildRowKey(previous[0]!, 0)]!;
    expect(control.manualOfferUnit).toBe(119);
    expect(control.discountPct).toBe(0);
  });

  it("does not reanchor when only costs or notes change", () => {
    const previous = [item()];
    const next = [item({ costOptimistic: 75, costModerate: 75, costWeightedUnit: 75, notes: "New source" })];
    const controls = buildInitialOfferControls({ items: previous, settings });
    expect(synchronize(previous, next, controls)).toBe(controls);
  });

  it("preserves a local offer adjustment", () => {
    const previousItems = [item({ referenceUnit: 100 })];
    const nextItems = [item({ referenceUnit: 120 })];
    const controls = buildInitialOfferControls({ items: previousItems, settings });
    const rowKey = buildRowKey(previousItems[0]!, 0);
    const adjusted = { ...controls, [rowKey]: { ...controls[rowKey]!, manualOfferUnit: 90 } };

    expect(synchronize(previousItems, nextItems, adjusted)).toBe(adjusted);
  });

  it.each([
    ["offerMode", "discount"],
    ["discountPct", 0],
    ["profitPct", 100],
    ["manualOfferUnit", 100],
  ] as const)("preserves a persisted %s value", (field, value) => {
    const previousItems = [item({ [field]: value })];
    const nextItems = [item({ [field]: value, referenceUnit: 120 })];
    const controls = buildInitialOfferControls({ items: previousItems, settings });

    expect(synchronize(previousItems, nextItems, controls)).toBe(controls);
  });
});


describe("external revision ordering", () => {
  it("ignores an older response that arrives after a newer one", () => {
    let revision = "2026-09-27T20:00:00.000Z";
    for (const incoming of ["2026-09-27T20:00:02.000Z", "2026-09-27T20:00:01.000Z"]) {
      if (isNewerExternalRevision(incoming, revision)) revision = incoming;
    }
    expect(revision).toBe("2026-09-27T20:00:02.000Z");
    expect(isNewerExternalRevision(revision, revision)).toBe(false);
    expect(isNewerExternalRevision("invalid", revision)).toBe(false);
  });
});
