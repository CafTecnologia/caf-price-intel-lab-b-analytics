import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { mergeCalculationLinkFields, normalizeImportPayload, parseMoneyLike, sampleImportPayload, toProject } from "../lib/contract";
import { itemPatchesFromPastedText, previewSpreadsheetBuffer } from "../lib/client-ingest";
import { buildProjectExport } from "../lib/export";
import { applyExternalProjectUpdate } from "../lib/external-updates";
import {
  buildInitialOfferControls,
  buildOfferPresentation,
  buildSimulation,
  buildVatControls,
  convertOfferControlMode,
  selectedCostUnit,
} from "../lib/financial-engine";

describe("financial offer contract", () => {
  it("parses pasted tables as item field updates", () => {
    const patches = itemPatchesFromPastedText(`
| Item | Precio techo unitario | Costo manual unitario |
| --- | ---: | ---: |
| 42 | 190.000 | 150.000 |
`);

    expect(patches).toEqual([
      {
        item: "42",
        rowNumber: 1,
        referenceUnit: "190.000",
        manualUnitCost: "150.000",
      },
    ]);
  });

  it("parses accounting-style pasted money split across currency and value cells", () => {
    const patches = itemPatchesFromPastedText(`
Item	Precio techo unitario
28	$	1.181.882
29	$	8.734.475
`);

    expect(patches).toEqual([
      { item: "28", rowNumber: 1, referenceUnit: "$ 1.181.882" },
      { item: "29", rowNumber: 2, referenceUnit: "$ 8.734.475" },
    ]);
  });

  it("infers reference price updates from item and money rows without headers", () => {
    const patches = itemPatchesFromPastedText(`
28	$	1.181.882
29	$	8.734.475
`);

    expect(patches).toEqual([
      { item: "28", rowNumber: 1, referenceUnit: "$ 1.181.882" },
      { item: "29", rowNumber: 2, referenceUnit: "$ 8.734.475" },
    ]);
  });

  it("parses ordered single-field paste values without item ids", () => {
    const patches = itemPatchesFromPastedText(`
$ 110.156
$ 93.630
$ 100.305
`, "referenceUnit");

    expect(patches).toEqual([
      { item: null, rowNumber: 1, referenceUnit: "$ 110.156" },
      { item: null, rowNumber: 2, referenceUnit: "$ 93.630" },
      { item: null, rowNumber: 3, referenceUnit: "$ 100.305" },
    ]);
  });

  it("keeps formatted money input growing after thousands separators", () => {
    expect(parseMoneyLike("1.0000")).toBe(10000);
    expect(parseMoneyLike("10.0000")).toBe(100000);
    expect(parseMoneyLike("1.000.0000")).toBe(10000000);
  });

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


  it("applies external IA updates only to the fields sent in the patch", () => {
    const payload = normalizeImportPayload({
      version: 2,
      source: { system: "ia-stages-web", analysis_id: "analysis-1" },
      items: [
        {
          item: "28",
          name: "Item original",
          description: "Ficha original",
          quantity: 2,
          unit: "UND",
          ceiling_unit_price: 100000,
          price_sources: [{ name: "Proveedor inicial", unit_price: 70000, currency: "COP", url: "https://old.example" }],
        },
      ],
    });
    const project = toProject(payload, "external-update", "2026-06-05T00:00:00.000Z");
    const originalItem = project.items[0]!;
    const prepared = {
      ...project,
      items: [
        {
          ...originalItem,
          manualUnitCost: 77777,
          selectedCostMode: "manual" as const,
          offerMode: "discount" as const,
          discountPct: 5,
          manualOfferUnit: 95000,
        },
      ],
    };

    const result = applyExternalProjectUpdate(prepared, {
      version: 2,
      source: { system: "ia-stages-web", analysis_id: "analysis-1", run_id: "run-1", stage: "stage3" },
      idempotency_key: "analysis-1-run-1-item-28-v2",
      items: [
        {
          match: { item: "28" },
          fields: {
            ceiling_unit_price: "$ 118.000",
            price_sources: [
              {
                source_id: "source-1",
                name: "Proveedor inicial",
                unit_price: "$ 80.000",
                currency: "COP",
                url: "https://old.example",
                notes: "Precio actualizado por IA",
              },
              {
                source_id: "web-2",
                name: "Proveedor nuevo",
                unit_price: 76000,
                currency: "COP",
                url: "https://new.example",
              },
            ],
          },
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.applied).toEqual([
      { itemId: originalItem.id, item: "28", fields: ["ceiling_unit_price", "price_sources"] },
    ]);
    expect(result.project.items[0]?.referenceUnit).toBe(118000);
    expect(result.project.items[0]?.priceSources).toHaveLength(2);
    expect(result.project.items[0]?.priceSources[0]).toMatchObject({ unitPrice: 80000, notes: "Precio actualizado por IA" });
    expect(result.project.items[0]?.priceSources[1]).toMatchObject({ id: "web-2", label: "Proveedor nuevo", unitPrice: 76000 });
    expect(result.project.items[0]?.manualUnitCost).toBe(77777);
    expect(result.project.items[0]?.selectedCostMode).toBe("manual");
    expect(result.project.items[0]?.offerMode).toBe("discount");
    expect(result.project.items[0]?.discountPct).toBe(5);
    expect(result.project.items[0]?.manualOfferUnit).toBe(95000);
  });

  it("reports unmatched external IA updates without modifying the project", () => {
    const payload = normalizeImportPayload({ version: 2, items: [{ item: "1", name: "Item existente" }] });
    const project = toProject(payload, "external-conflict", "2026-06-05T00:00:00.000Z");
    const result = applyExternalProjectUpdate(project, {
      version: 2,
      items: [{ match: { item: "999" }, fields: { ceiling_unit_price: 123 } }],
    });

    expect(result.changed).toBe(false);
    expect(result.project).toBe(project);
    expect(result.conflicts).toEqual([{ item: "999", reason: "item_not_found" }]);
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
    expect(simulation.summary.total.totalReference).toBe(9210000);
    expect(simulation.summary.referenceKnownTotal).toBe(10710000);
    expect(simulation.summary.referenceKnownCount).toBe(7);
    expect(simulation.summary.missingCostCount).toBe(1);
    expect(simulation.summary.missingReferenceCount).toBe(1);
    expect(simulation.summary.partial.evaluableCount).toBe(7);
    expect(simulation.summary.partial.totalReference).toBe(9210000);
    expect(simulation.summary.partial.totalCost).toBe(43575750);
    expect(simulation.summary.partial.totalOffer).toBe(9780000);
    expect(simulation.summary.partial.totalMargin).toBe(-33795750);
  });

  it("applies a reversible scenario discount over the visible unit cost", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Escenario de costo" },
      items: [
        {
          item: "1",
          description: "Costo con escenario",
          quantity: 4,
          reference_unit: 200000,
          manual_unit_cost: 100000,
          selected_cost_mode: "manual",
          cost_scenario_mode: "unit",
          cost_scenario_discount_pct: 15,
        },
      ],
      settings: {},
    });
    const project = toProject(payload, "cost-scenario", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const row = simulation.rows[0]!;

    expect(row.baseCostUnit).toBe(100000);
    expect(row.costUnit).toBe(85000);
    expect(row.costTotal).toBe(340000);
    expect(row.costSourceLabel).toBe("Costo manual");
    expect(row.costScenarioDiscountPct).toBe(15);
  });

  it("ignores invalid cost discounts instead of changing the calculation", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Descuento fuera de rango" },
      items: [{
        item: "1",
        description: "Costo base",
        quantity: 2,
        reference_unit: 200000,
        manual_unit_cost: 100000,
        selected_cost_mode: "manual",
        cost_scenario_mode: "unit",
        cost_scenario_discount_pct: 150,
      }],
      settings: {},
    });
    const project = toProject(payload, "invalid-cost-discount", "2026-05-01T00:00:00.000Z");
    expect(buildSimulation(project, buildInitialOfferControls(project)).rows[0]?.costUnit).toBe(100000);
    project.items[0]!.costScenarioDiscountPct = -10;
    expect(buildSimulation(project, buildInitialOfferControls(project)).rows[0]?.costUnit).toBe(100000);
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

  it("starts automatic offer controls at the maximum ceiling price", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Arranque en techo" },
      items: [
        {
          item: "1",
          description: "Descuento base",
          quantity: 1,
          reference_unit: 100000,
          cost_weighted_unit: 70000,
        },
        {
          item: "2",
          description: "Utilidad base",
          quantity: 1,
          reference_unit: 100000,
          cost_weighted_unit: 70000,
          offer_mode: "profit",
        },
        {
          item: "3",
          description: "Utilidad alta",
          quantity: 1,
          reference_unit: 500000,
          cost_weighted_unit: 80000,
          offer_mode: "profit",
        },
      ],
      settings: {},
    });
    const project = toProject(payload, "ceiling-start", "2026-05-01T00:00:00.000Z");
    const controls = buildInitialOfferControls(project);
    const simulation = buildSimulation(project, controls);

    expect(controls["1-0"]?.discountPct).toBe(0);
    expect(simulation.rows[0]?.offerUnit).toBe(100000);
    expect(controls["2-1"]?.profitPct).toBeCloseTo(42.8571, 4);
    expect(simulation.rows[1]?.offerUnit).toBeCloseTo(100000, 4);
    expect(simulation.rows[1]?.status).toBe("viable");
    expect(controls["3-2"]?.profitPct).toBeCloseTo(525, 4);
    expect(simulation.rows[2]?.offerUnit).toBeCloseTo(500000, 4);
    expect(simulation.rows[2]?.status).toBe("viable");
  });

  it("starts a public AI calculation at each gross ceiling, never at supplier cost", () => {
    const payload = normalizeImportPayload({
      version: 2,
      source: { system: "odoo_caf", run_id: "future-study" },
      items: [
        { item: "1", name: "Con techo", quantity: 2, unit: "UND", ceiling_unit_price: 119000,
          price_sources: [{ name: "Proveedor", unit_price: 70000, currency: "COP" }] },
        { item: "2", name: "Sin techo", quantity: 1, unit: "UND", ceiling_unit_price: null,
          price_sources: [{ name: "Proveedor", unit_price: 30000, currency: "COP" }] },
      ],
    });
    const project = toProject(payload, "future-study", "2026-09-28T00:00:00.000Z");
    const initial = buildSimulation(project, buildInitialOfferControls(project));

    expect(initial.rows[0]?.costUnit).toBe(70000);
    expect(initial.rows[0]?.offerUnit).toBe(119000);
    expect(initial.rows[1]?.costUnit).toBe(30000);
    expect(initial.rows[1]?.offerUnit).toBeNull();
    expect(project.items[0]?.manualOfferUnit).toBeNull();
  });

  it("keeps the current offer value when cost changes", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Oferta como verdad" },
      items: [
        {
          item: "1",
          description: "Item con costo cambiante",
          quantity: 1,
          reference_unit: 100,
          manual_unit_cost: 80,
          selected_cost_mode: "manual",
          offer_mode: "profit",
        },
      ],
      settings: { manual_cost_priority: true },
    });
    const project = toProject(payload, "offer-truth", "2026-05-01T00:00:00.000Z");
    const controls = buildInitialOfferControls(project);
    const initial = buildSimulation(project, controls);
    const lowerCost = buildSimulation({ ...project, items: [{ ...project.items[0]!, manualUnitCost: 60 }] }, controls);

    expect(initial.rows[0]?.offerUnit).toBe(100);
    expect(initial.rows[0]?.marginPctOnCost).toBeCloseTo(25, 4);
    expect(lowerCost.rows[0]?.offerUnit).toBe(100);
    expect(lowerCost.rows[0]?.marginPctOnCost).toBeCloseTo(66.6667, 4);
  });

  it("does not mark over ceiling when offer equals the reference price", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Igual al techo" },
      items: [
        {
          item: "1",
          description: "Oferta igual",
          quantity: 1,
          reference_unit: 100000,
          cost_weighted_unit: 80000,
          offer_mode: "manual",
          manual_offer_unit: 100000,
        },
        {
          item: "2",
          description: "Oferta un peso arriba",
          quantity: 1,
          reference_unit: 100000,
          cost_weighted_unit: 80000,
          offer_mode: "manual",
          manual_offer_unit: 100000.1,
        },
        {
          item: "3",
          description: "Ruido decimal flotante",
          quantity: 1,
          reference_unit: 100000,
          cost_weighted_unit: 80000,
          offer_mode: "manual",
          manual_offer_unit: 100000.0000001,
        },
      ],
      settings: {},
    });
    const project = toProject(payload, "ceiling-boundary", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const offer = buildOfferPresentation(simulation, {});

    expect(simulation.rows[0]?.status).toBe("viable");
    expect(simulation.rows[0]?.warnings).not.toContain("La oferta supera el precio techo.");
    expect(offer.rows[0]?.status).toBe("within_ceiling");
    expect(simulation.rows[1]?.status).toBe("over_ceiling");
    expect(offer.rows[1]?.status).toBe("above_ceiling");
    expect(simulation.rows[2]?.status).toBe("viable");
    expect(simulation.rows[2]?.warnings).not.toContain("La oferta supera el precio techo.");
    expect(offer.rows[2]?.status).toBe("within_ceiling");
  });

  it("rounds economic offer values down without exceeding the ceiling by presentation rounding", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Oferta redondeada" },
      items: [
        {
          item: "1",
          description: "Valor alto",
          quantity: 1,
          unit: "UND",
          reference_unit: 1150460,
          cost_weighted_unit: 1000000,
          offer_mode: "manual",
          manual_offer_unit: 1150459.57,
          vat_mode: "exempt",
        },
        {
          item: "2",
          description: "Valor pequeño",
          quantity: 1,
          unit: "UND",
          reference_unit: 200,
          cost_weighted_unit: 100,
          offer_mode: "manual",
          manual_offer_unit: 149.58,
          vat_mode: "exempt",
        },
        {
          item: "3",
          description: "Con IVA cerca al techo",
          quantity: 1,
          unit: "UND",
          reference_unit: 1190,
          cost_weighted_unit: 900,
          offer_mode: "manual",
          manual_offer_unit: 1189.99,
          vat_mode: "included",
          vat_rate: 19,
        },
      ],
      settings: {},
    });
    const project = toProject(payload, "rounded-offer", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const offer = buildOfferPresentation(simulation, buildVatControls(project));

    expect(offer.rows[0]?.unitPriceWithVat).toBe(1150450);
    expect(offer.rows[0]?.differenceVsReferenceTotal).toBe(10);
    expect(offer.rows[1]?.unitPriceWithVat).toBe(149);
    expect(offer.rows[2]?.unitPriceWithoutVat).toBe(999);
    expect(offer.rows[2]?.unitPriceWithVat).toBeLessThanOrEqual(1190);
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

  it("starts imported profit mode at the ceiling when no offer value exists", () => {
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

    expect(simulation.rows[0]?.offerUnit).toBe(50000);
    expect(simulation.rows[0]?.discountPctVsReference).toBeCloseTo(0);
    expect(simulation.rows[0]?.status).toBe("loss");
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
    expect(offer.summary.totalOfferWithVat).toBe(11279034);
    expect(Number.isInteger(offer.summary.totalOfferWithVat)).toBe(true);
    expect(offer.summary.totalVat).toBeGreaterThan(100000);
  });

  it("calculates retentions over their configured bases without changing product cost", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Retenciones" },
      items: [{ item: "1", description: "Servicio", quantity: 1, manual_unit_cost: 800000, selected_cost_mode: "manual", reference_unit: 1190000, vat_mode: "included", vat_rate: 19 }],
      settings: { vat_rate: 19 },
    });
    const project = toProject(payload, "retentions", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const offer = buildOfferPresentation(simulation, buildVatControls(project), {
      applyReteFuente: true,
      reteFuenteRate: 2.5,
      reteFuenteBase: "pre_vat",
      applyReteIva: true,
      reteIvaRate: 15,
      reteIvaBase: "vat",
      applyReteIca: true,
      reteIcaRate: 1,
      reteIcaBase: "pre_vat",
      stampTaxRate: 2,
    });

    expect(offer.summary.totalProjectCost).toBe(800000);
    expect(offer.summary.totalOfferWithoutVat).toBe(1000000);
    expect(offer.summary.totalVat).toBe(190000);
    expect(offer.summary.reteFuente).toBe(25000);
    expect(offer.summary.reteIva).toBe(28500);
    expect(offer.summary.reteIca).toBe(10000);
    expect(offer.summary.stampTax).toBe(23800);
    expect(offer.summary.expectedNetCollection).toBe(1102700);
    expect(offer.summary.estimatedNetUtility).toBe(302700);
  });

  it("imports Colombian Excel money formats without dropping thousands", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Item", "Nombre", "Und de medida", "Cant", "Precio techo unitario", "Proveedor 1", "Precio proveedor 1", "Moneda proveedor 1"],
      [1, "Equipo A", "UND", 2, "$ 1.250.000,00", "Proveedor", "$ 980.500", "COP"],
      [2, "Equipo B", "UND", 1, 3500000, "Proveedor", 2750000, "COP"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Carga de items");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const preview = previewSpreadsheetBuffer(bytes);
    const normalized = normalizeImportPayload(preview.payload);
    const project = toProject(normalized, "excel", "2026-05-01T00:00:00.000Z");

    expect(preview.sourceRowCount).toBe(2);
    expect(preview.warnings).toEqual([]);
    expect(project.items[0]?.referenceUnit).toBe(1250000);
    expect(project.items[0]?.priceSources[0]?.unitPrice).toBe(980500);
    expect(project.items[1]?.referenceUnit).toBe(3500000);
    expect(project.items[1]?.priceSources[0]?.unitPrice).toBe(2750000);
  });

  it("accepts well-formed uncertain or above-ceiling source facts without auditing the study", () => {
    const normalized = normalizeImportPayload({
      version: 2,
      source: { system: "odoo_caf", run_id: "study-1" },
      items: [
        { item: "1", name: "Precio por revisar", quantity: 1, unit: "UND", ceiling_unit_price: 100, price_sources: [{ name: "Fuente", unit_price: 150, currency: "COP" }] },
        { item: "2", name: "Costo pendiente", quantity: 1, unit: "UND", ceiling_unit_price: null, price_sources: [] },
      ],
    });
    expect(normalized.items).toHaveLength(2);
    expect(normalized.items[0]?.reference_unit).toBe(100);
    expect(normalized.items[0]?.price_sources[0]?.unit_price).toBe(150);
    expect(normalized.items[1]?.reference_unit).toBeNull();
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

  it.each(["name", "notes"])("treats CAF pending zero in %s as an existing missing cost", (field) => {
    const payload = normalizeImportPayload({
      calculation: { name: "Pending CAF cost" },
      items: [
        { item: "1", description: "Known", quantity: 1, reference_unit: 100000, cost_weighted_unit: 70000 },
        { item: "2", description: "Pending", quantity: 1, reference_unit: 200000,
          price_sources: [{ name: "Pending reference", unit_price: 0, currency: "COP", [field]: "PENDIENTE_COSTO: no verified price" }] },
      ], settings: {},
    });
    const project = toProject(payload, "pending-marker", "2026-09-27T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    expect(simulation.rows[1]?.costUnit).toBeNull();
    expect(simulation.rows[1]?.status).toBe("incomplete");
    expect(simulation.summary.missingCostCount).toBe(1);
    expect(simulation.summary.partial.evaluableCount).toBe(1);
    expect(simulation.summary.total.isComplete).toBe(false);
    expect(simulation.summary.total.totalCost).toBe(70000);
    expect(selectedCostUnit({ ...project.items[1]!, selectedCostMode: "manual", manualUnitCost: 12345 }, project.settings)).toBe(12345);
  });

  it("uses the row observation marker when source notes omit it", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Row pending" },
      items: [{ item: "2", description: "Pending", quantity: 1, reference_unit: 200000,
        notes: "PENDIENTE_COSTO: no compliant quote", cost_weighted_unit: 0,
        price_sources: [{ name: "Pending reference", unit_price: 0, currency: "COP", notes: "No quote" }] }], settings: {},
    });
    const project = toProject(payload, "row-pending", "2026-09-27T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    expect(simulation.rows[0]?.costUnit).toBeNull();
    expect(simulation.rows[0]?.status).toBe("incomplete");
    expect(simulation.summary.missingCostCount).toBe(1);
    expect(selectedCostUnit({ ...project.items[0]!, selectedCostMode: "manual", manualUnitCost: 0 }, project.settings)).toBe(0);
  });

  it("does not revive pending prices through legacy zero fallbacks", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Legacy pending" },
      items: [{ item: "1", description: "Pending", quantity: 1, reference_unit: 200000,
        cost_optimistic: 0, cost_moderate: 0, cost_weighted_unit: 0,
        price_sources: [{ name: "Vendor", unit_price: 0, currency: "COP", notes: "PENDIENTE_COSTO" }] }], settings: {},
    });
    const project = toProject(payload, "legacy-pending", "2026-09-27T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    expect(simulation.rows[0]?.costUnit).toBeNull();
    expect(simulation.rows[0]?.status).toBe("incomplete");
    expect(simulation.summary.missingCostCount).toBe(1);
    expect(simulation.summary.total.isComplete).toBe(false);
    const item = project.items[0]!;
    expect(selectedCostUnit({ ...item, selectedCostMode: "manual", manualUnitCost: 12345 }, project.settings)).toBe(12345);
    expect(selectedCostUnit({ ...item, costWeightedUnit: 15000 }, project.settings)).toBe(15000);
  });

  it("preserves genuine zero and a positive replacement of a pending reference", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Known zero" },
      items: [
        { item: "1", description: "Free", quantity: 1, reference_unit: 100, price_sources: [{ label: "Gift", unit_price: 0, currency: "COP" }] },
        { item: "2", description: "Quoted", quantity: 1, reference_unit: 100, price_sources: [{ label: "Vendor", unit_price: 80, currency: "COP", notes: "PENDIENTE_COSTO resolved" }] },
      ], settings: {},
    });
    const project = toProject(payload, "known-zero", "2026-09-27T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    expect(simulation.rows[0]?.costUnit).toBe(0);
    expect(simulation.rows[1]?.costUnit).toBe(80);
    expect(simulation.summary.missingCostCount).toBe(0);
    expect(simulation.summary.total.isComplete).toBe(true);
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
    expect(simulation.summary.total.totalCost).toBe(70000);
    expect(simulation.summary.total.totalReference).toBe(100000);
    expect(simulation.summary.referenceKnownTotal).toBe(300000);
    expect(simulation.summary.referenceIsComplete).toBe(true);
    expect(simulation.summary.partial.evaluableCount).toBe(1);
    expect(simulation.summary.partial.totalCost).toBe(70000);
    expect(simulation.summary.missingCostCount).toBe(1);
  });

  it("uses a manual global ceiling without requiring item-level ceilings", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Techo global" },
      items: [
        { item: "1", description: "A", quantity: 2, manual_unit_cost: 100000, selected_cost_mode: "manual" },
        { item: "2", description: "B", quantity: 1, manual_unit_cost: 50000, selected_cost_mode: "manual" },
      ],
      settings: { manual_reference_total: 400000, default_margin: 20 },
    });
    const project = toProject(payload, "global-ceiling", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(project.settings.manualReferenceTotal).toBe(400000);
    expect(simulation.summary.total.isComplete).toBe(true);
    expect(simulation.summary.total.totalReference).toBe(400000);
    expect(simulation.summary.total.totalCost).toBe(250000);
    expect(simulation.summary.total.totalOffer).toBe(300000);
    expect(simulation.summary.total.totalMargin).toBe(50000);
    expect(simulation.summary.referenceKnownTotal).toBe(400000);
    expect(simulation.summary.referenceKnownCount).toBe(0);
    expect(simulation.summary.referenceIsComplete).toBe(true);
    expect(simulation.rows.every((row) => row.status === "no_ceiling")).toBe(true);
  });

  it("uses one clearly assumed unit when quantity is absent from the pliego", () => {
    const payload = normalizeImportPayload({
      calculation: { name: "Cantidad implicita" },
      items: [{ item: "1", description: "Repuesto", reference_unit: 500000, cost_weighted_unit: 300000 }],
      settings: {},
    });
    const project = toProject(payload, "implicit-quantity", "2026-05-01T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(project.items[0]?.quantity).toBeNull();
    expect(simulation.rows[0]?.quantity).toBe(1);
    expect(simulation.rows[0]?.quantityAssumed).toBe(true);
    expect(simulation.rows[0]?.referenceTotal).toBe(500000);
    expect(simulation.rows[0]?.costTotal).toBe(300000);
    expect(simulation.rows[0]?.offerTotal).toBe(500000);
    expect(simulation.rows[0]?.warnings).toContain("Cantidad no indicada: cálculo con 1 unidad asumida.");
    expect(simulation.summary.assumedQuantityCount).toBe(1);
    expect(simulation.summary.missingQuantityCount).toBe(0);
    expect(simulation.summary.total.isComplete).toBe(true);
  });

  it("does not mistake malformed or ambiguous quantities for an omitted one", () => {
    for (const quantity of ["abc", "abc1", "1/2", "1e3"]) {
      expect(() => normalizeImportPayload({
        calculation: { name: "Cantidad inválida" },
        items: [{ item: "1", description: "Repuesto", quantity, reference_unit: 500000, cost_weighted_unit: 300000 }],
        settings: {},
      })).toThrow(/cantidad/i);
    }
    const valid = normalizeImportPayload({
      calculation: { name: "Cantidad colombiana" },
      items: [{ item: "1", description: "Repuesto", quantity: "1.000,5", reference_unit: 500000, cost_weighted_unit: 300000 }],
      settings: {},
    });
    expect(toProject(valid, "valid-quantity", "2026-10-05T00:00:00.000Z").items[0]?.quantity).toBe(1000.5);
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

    expect(simulation.rows[0]?.offerUnit).toBe(200000);
    expect(exported.simulation.rows[0]?.offerUnit).toBe(200000);
  });

  it("accepts the public v2 contract with only item names", () => {
    const payload = normalizeImportPayload({
      version: 2,
      items: [{ name: "Taladro profesional" }],
    });
    const project = toProject(payload, "v2-min", "2026-05-04T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(project.items[0]?.description).toBe("Taladro profesional");
    expect(project.items[0]?.technicalDescription).toBe("");
    expect(simulation.rows[0]?.status).toBe("incomplete");
    expect(simulation.rows[0]?.warnings).toEqual(["Item incompleto: faltan datos base y costo."]);
    expect(simulation.summary.total.isComplete).toBe(false);
  });

  it("keeps a completely blank manual placeholder out of observations", () => {
    const payload = normalizeImportPayload({
      version: 2,
      items: [{ name: "Temporal" }],
    });
    const project = toProject(payload, "blank-placeholder", "2026-05-04T00:00:00.000Z");
    project.items[0] = {
      ...project.items[0]!,
      item: "4",
      description: "Item manual 4",
      technicalDescription: "",
      unit: "UND",
      notes: "",
      source1: "",
      source2: "",
      source3: "",
      priceSources: [],
    };

    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(simulation.rows[0]?.warnings).toEqual([]);
  });

  it("maps the public v2 recommended fields into internal calculation data", () => {
    const payload = normalizeImportPayload({
      version: 2,
      source: { system: "ia-stages-web", analysis_id: "an-1", odoo_project_id: "123" },
      items: [
        {
          item: "1",
          name: "Taladro profesional",
          description: "Taladro 1/2 pulg.",
          quantity: 2,
          unit: "UND",
          ceiling_unit_price: 350000,
          price_sources: [
            { name: "Proveedor A", unit_price: 210000, currency: "COP" },
            { name: "Proveedor USA", unit_price: 55, currency: "USD", trm: 4000 },
          ],
          notes: "Revisar garantía.",
        },
      ],
    });
    const project = toProject(payload, "v2-rec", "2026-05-04T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));

    expect(project.sourceSystem).toBe("ia-stages-web");
    expect(project.sourceAnalysisId).toBe("an-1");
    expect(project.odooProjectId).toBe("123");
    expect(project.items[0]?.description).toBe("Taladro profesional");
    expect(project.items[0]?.technicalDescription).toBe("Taladro 1/2 pulg.");
    expect(project.items[0]?.referenceUnit).toBe(350000);
    expect(project.items[0]?.priceSources).toHaveLength(2);
    expect(simulation.rows[0]?.costUnit).toBe(229000);
    expect(simulation.rows[0]?.control.discountPct).toBe(0);
    expect(simulation.rows[0]?.offerUnit).toBeCloseTo(350000, 4);
  });

  it("rejects unsupported contract versions and currencies", () => {
    expect(() =>
      normalizeImportPayload({
        version: 99,
        calculation: { name: "Version no soportada", currency: "COP" },
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
