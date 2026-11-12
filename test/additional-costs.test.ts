import { describe, expect, it } from "vitest";

import { SAMPLE_PUBLIC_IMPORT_PAYLOAD, normalizeImportPayload, preserveAdditionalCostsOnReimport, toCalculation } from "../lib/contract";
import { associatedCostNeedsReview, buildInitialOfferControls, buildOfferPresentation, buildSimulation, buildVatControls, manualBaseCostInputForRow, selectedQuoteLinks } from "../lib/financial-engine";
import { buildProjectExport } from "../lib/export";
import { previewSpreadsheetBuffer, rowsToPayload } from "../lib/client-ingest";
import { GET as downloadTemplate } from "../app/api/template/route";
import * as XLSX from "xlsx";

function calculation() {
  return toCalculation(normalizeImportPayload({
    calculation: { name: "Costos adicionales", currency: "COP" },
    items: [{
      item: "1",
      description: "Equipo",
      quantity: 2,
      unit: "UND",
      reference_unit: 300000,
      manual_unit_cost: 100000,
      selected_cost_mode: "manual",
      offer_mode: "manual",
      manual_offer_unit: 300000,
      additional_costs: [
        { name: "Instalacion", category: "service", mode: "per_unit", amount: 20000 },
        { name: "Transporte", category: "logistics", mode: "fixed", amount: 50000 },
      ],
    }],
    general_costs: [{ name: "Poliza", category: "other", amount: 30000 }],
    settings: {},
  }), "calc-costs", "2026-09-22T00:00:00.000Z");
}

describe("costos adicionales", () => {
  it("deja costos de IA por decidir fuera del total hasta que el usuario los aplique", () => {
    const project = calculation();
    project.items[0]!.additionalCosts = [{ id: "toner", name: "Tóner sugerido", category: "other", mode: "per_unit", amount: 600000, notes: "Verificar ficha guía", reviewStatus: "suggested" }];
    const first = buildSimulation(project, buildInitialOfferControls(project));
    expect(first.rows[0]?.additionalCostTotal).toBe(0);
    expect(first.rows[0]?.costTotal).toBe(200000);
    expect(first.rows[0]?.hasSuggestedAssociatedCosts).toBe(true);
    expect(first.rows[0]?.isFinanciallyEvaluable).toBe(true);
    project.items[0]!.additionalCosts[0]!.reviewStatus = "included";
    expect(buildSimulation(project, buildInitialOfferControls(project)).rows[0]?.additionalCostTotal).toBe(1200000);
    project.items[0]!.additionalCosts[0]!.reviewStatus = "excluded";
    expect(buildSimulation(project, buildInitialOfferControls(project)).rows[0]?.additionalCostTotal).toBe(0);
  });

  it("edita el costo base activo aunque exista un manual histórico distinto", () => {
    const project = calculation();
    project.items[0]!.costWeightedUnit = 200000;
    project.items[0]!.selectedCostMode = "weighted";
    const row = buildSimulation(project, buildInitialOfferControls(project)).rows[0]!;
    expect(project.items[0]!.manualUnitCost).toBe(100000);
    expect(manualBaseCostInputForRow(row)).toBe(200000);
    expect(row.costUnit).toBe(245000);
  });

  it("trata COP 0 y COP 1 por confirmar como pendientes sin bloquear la utilidad", () => {
    const project = calculation();
    project.items[0]!.additionalCosts = [
      { id: "ai-install", name: "Instalación", category: "service", mode: "per_unit", amount: 1, notes: "Costo por confirmar" },
      { id: "ai-freight", name: "Flete", category: "logistics", mode: "fixed", amount: 0, notes: "Según ciudad; costo por confirmar" },
    ];
    const row = buildSimulation(project, buildInitialOfferControls(project)).rows[0]!;
    expect(project.items[0]!.additionalCosts.every(associatedCostNeedsReview)).toBe(true);
    expect(row.additionalCostTotal).toBe(0);
    expect(row.productCostTotal).toBe(200000);
    expect(row.costTotal).toBe(200000);
    expect(row.utilityValue).toBe(400000);
    expect(row.hasPendingAssociatedCosts).toBe(true);
    expect(row.isFinanciallyEvaluable).toBe(true);
    expect(associatedCostNeedsReview({ id: "free", name: "Cargo gratuito", category: "service", mode: "fixed", amount: 0, notes: "Sin costo confirmado" })).toBe(false);
  });

  it("precarga el costo base sin servicios y respeta el IVA de entrada", () => {
    const project = calculation();
    project.items[0]!.vatMode = "excluded";
    project.items[0]!.vatRate = 19;
    const row = buildSimulation(project, buildInitialOfferControls(project)).rows[0]!;
    expect(row.baseCostUnit).toBe(119000);
    expect(row.productCostTotal).toBe(238000);
    expect(row.additionalCostTotal).toBe(90000);
    expect(row.costUnit).toBe(164000);
    expect(manualBaseCostInputForRow(row)).toBeCloseTo(100000);
  });

  it("conserva extractos literales anexos en importación, exportación y reimportación", () => {
    const excerpt = { document: "Ficha guía v9", locator: "ITEM 5, Insumos", text: "Se debe entregar DOS (2) juegos completos de tóner original sellados." };
    const existing = toCalculation(normalizeImportPayload({ version: 2, items: [{ item: "5", name: "Impresora", technical_annex: [excerpt] }] }), "annex-test", "2026-10-06T00:00:00.000Z");
    expect(existing.items[0]?.technicalAnnex).toEqual([excerpt]);
    expect(buildProjectExport(existing).calculation.items[0]?.technicalAnnex).toEqual([excerpt]);
    const incoming = toCalculation(normalizeImportPayload({ version: 2, items: [{ item: "5", name: "Impresora" }] }), "annex-test", "2026-10-06T00:00:00.000Z");
    expect(preserveAdditionalCostsOnReimport(incoming, existing).items[0]?.technicalAnnex).toEqual([excerpt]);
    const second = { document: "Otro anexo", locator: "página 2", text: "  Texto literal\n" };
    const added = toCalculation(normalizeImportPayload({ version: 2, items: [{ item: "5", name: "Impresora", technical_annex: [second] }] }), "annex-test", "2026-10-06T00:00:00.000Z");
    expect(preserveAdditionalCostsOnReimport(added, existing).items[0]?.technicalAnnex).toEqual([excerpt, second]);
  });

  it("rechaza IDs duplicados en JSON público y singulariza los heredados", () => {
    const costs = [{ id: "same", name: "Flete", amount: 10 }, { id: "same", name: "Instalación", amount: 20 }];
    expect(() => normalizeImportPayload({ version: 2, items: [{ name: "Equipo", additional_costs: costs }] })).toThrow();
    const legacy = toCalculation(normalizeImportPayload({ calculation: { name: "Heredado", currency: "COP" }, items: [{ description: "Equipo", additional_costs: costs }], settings: {} }), "dup-costs", "2026-10-06T00:00:00.000Z");
    expect(new Set(legacy.items[0]!.additionalCosts.map((cost) => cost.id)).size).toBe(2);
  });

  it("separa costo base, servicios por unidad, fijos y generales sin doble conteo", () => {
    const project = calculation();
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const row = simulation.rows[0]!;

    expect(row.productCostTotal).toBe(200000);
    expect(row.additionalUnitCost).toBe(20000);
    expect(row.additionalFixedCost).toBe(50000);
    expect(row.additionalCostTotal).toBe(90000);
    expect(row.costTotal).toBe(290000);
    expect(row.costUnit).toBe(145000);
    expect(simulation.summary.total.itemCostTotal).toBe(290000);
    expect(simulation.summary.total.generalCostsTotal).toBe(30000);
    expect(simulation.summary.total.totalCost).toBe(320000);
  });

  it("resta los costos generales una sola vez de la utilidad del proyecto", () => {
    const project = calculation();
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const offer = buildOfferPresentation(simulation, buildVatControls(project), project.settings);
    const withoutGeneralCosts = { ...project, generalCosts: [] };
    const simulationWithoutGeneralCosts = buildSimulation(withoutGeneralCosts, buildInitialOfferControls(withoutGeneralCosts));
    const offerWithoutGeneralCosts = buildOfferPresentation(
      simulationWithoutGeneralCosts,
      buildVatControls(withoutGeneralCosts),
      withoutGeneralCosts.settings,
    );

    expect(offer.summary.itemAdditionalCostsTotal).toBe(90000);
    expect(offer.summary.generalCostsTotal).toBe(30000);
    expect(offer.summary.totalProjectCost).toBe(320000);
    expect(offer.summary.totalProjectCost - offerWithoutGeneralCosts.summary.totalProjectCost).toBe(30000);
    expect(offerWithoutGeneralCosts.summary.estimatedUtility! - offer.summary.estimatedUtility!).toBe(30000);
  });

  it("mantiene compatibles los calculos sin nuevos campos", () => {
    const project = toCalculation(normalizeImportPayload({
      calculation: { name: "Anterior", currency: "COP" },
      items: [{ description: "Item anterior", quantity: 1, unit: "UND" }],
      settings: {},
    }), "old", "2026-09-22T00:00:00.000Z");

    expect(project.generalCosts).toEqual([]);
    expect(project.items[0]?.additionalCosts).toEqual([]);
  });

  it("conserva el detalle de costos nuevos en la exportacion JSON", () => {
    const exported = buildProjectExport(calculation());

    expect(exported.calculation.generalCosts[0]?.name).toBe("Poliza");
    expect(exported.calculation.items[0]?.additionalCosts).toHaveLength(2);
    expect(exported.simulation.rows[0]?.additionalCostTotal).toBe(90000);
  });

  it("conserva costos manuales cuando una fuente reimporta el mismo calculo sin costos", () => {
    const existing = calculation();
    const incoming = {
      ...existing,
      generalCosts: [],
      items: existing.items.map((item) => ({ ...item, id: "incoming-item", additionalCosts: [] })),
    };
    const merged = preserveAdditionalCostsOnReimport(incoming, existing);

    expect(merged.generalCosts).toEqual(existing.generalCosts);
    expect(merged.items[0]?.additionalCosts).toEqual(existing.items[0]?.additionalCosts);
  });

  it("no reemplaza ni reintroduce costos corregidos por una persona al reimportar IA", () => {
    const original = calculation();
    const humanCorrection = {
      ...original,
      items: original.items.map((item) => ({
        ...item,
        additionalCosts: [{ ...item.additionalCosts[0]!, amount: 35000 }],
      })),
    };
    const incoming = {
      ...original,
      items: original.items.map((item) => ({
        ...item,
        additionalCosts: [{ id: "ai-delivery", name: "Entrega en sitio", category: "logistics" as const, mode: "fixed" as const, amount: null, notes: "" }],
      })),
    };
    expect(preserveAdditionalCostsOnReimport(incoming, humanCorrection).items[0]?.additionalCosts)
      .toEqual(humanCorrection.items[0]?.additionalCosts);

    const humanRemoved = {
      ...original,
      items: original.items.map((item) => ({ ...item, additionalCosts: [] })),
    };
    expect(preserveAdditionalCostsOnReimport(incoming, humanRemoved).items[0]?.additionalCosts).toEqual([]);
  });

  it("preserva las correcciones por posicion cuando hay renglones indistinguibles", () => {
    const original = calculation();
    const first = { ...original.items[0]!, id: "item-a", additionalCosts: [] };
    const second = {
      ...original.items[0]!,
      id: "item-b",
      additionalCosts: [{ ...original.items[0]!.additionalCosts[0]!, amount: 35000 }],
    };
    const existing = { ...original, items: [first, second] };
    const incoming = {
      ...original,
      items: [first, second].map((item, index) => ({
        ...item,
        id: `incoming-${index}`,
        additionalCosts: [{ id: "ai-delivery", name: "Entrega en sitio", category: "logistics" as const, mode: "fixed" as const, amount: null, notes: "" }],
      })),
    };
    const merged = preserveAdditionalCostsOnReimport(incoming, existing);

    expect(merged.items[0]?.additionalCosts).toEqual([]);
    expect(merged.items[1]?.additionalCosts).toEqual(second.additionalCosts);
  });

  it("un marcador pendiente de reimportación no borra costos ya completados", () => {
    const existing = calculation();
    const incoming = {
      ...existing,
      items: existing.items.map((item) => ({
        ...item,
        additionalCosts: [{ id: "pending", name: "Costo asociado pendiente", category: "service" as const, mode: "fixed" as const, amount: null, notes: "" }],
      })),
    };
    expect(preserveAdditionalCostsOnReimport(incoming, existing).items[0]?.additionalCosts).toEqual(existing.items[0]?.additionalCosts);
  });

  it("acepta en JSON un servicio marcado sin valor y no lo confunde con cero", () => {
    const project = toCalculation(normalizeImportPayload({
      version: 2,
      source: { system: "qa" },
      items: [{ name: "Equipo", quantity: 1, has_associated_cost: true }],
    }), "pending-cost", "2026-09-22T00:00:00.000Z");
    const cost = project.items[0]?.additionalCosts[0];
    const row = buildSimulation(project, buildInitialOfferControls(project)).rows[0];

    expect(cost?.amount).toBeNull();
    expect(cost?.reviewStatus).toBe("suggested");
    expect(row?.warnings).toContain("1 costo asociado sugerido pendiente de decidir; no incluido en el cálculo.");
  });

  it("normaliza columnas de Excel para costo asociado con valor y pendiente", () => {
    const sheet = XLSX.utils.json_to_sheet([
      { Nombre: "Equipo", "Tiene costo asociado": "Sí", "Servicio o costo asociado": "Instalación", "Valor costo asociado": "120.000", "Aplicación costo asociado": "Por unidad" },
      { Nombre: "Pantalla", "Tiene costo asociado": "Sí" },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Carga de items");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const preview = previewSpreadsheetBuffer(data);
    const first = preview.payload.items[0] as { additional_costs: Array<{ amount: string; mode: string }> };
    const second = preview.payload.items[1] as { additional_costs: Array<{ amount: null }> };

    expect(first.additional_costs[0]).toMatchObject({ amount: "120.000", mode: "per_unit" });
    expect(second.additional_costs[0]?.amount).toBeNull();
    expect(rowsToPayload([{ Nombre: "Sin servicio", "Tiene costo asociado": "No" }]).items[0]).toMatchObject({ additional_costs: [] });
  });

  it("usa y enlaza la fuente elegida, aunque no sea la más barata", () => {
    const input = {
      calculation: { name: "Fuentes", currency: "COP" },
      items: [{
        description: "Equipo", quantity: 1, selected_cost_mode: "source", selected_price_source_id: "source-1",
        price_sources: [
          { name: "Primera", unit_price: 80000, url: "https://proveedor.example/alto" },
          { name: "Segunda", unit_price: 70000, url: "proveedor.example/bajo" },
        ],
      }],
      settings: {},
    };
    const chosen = toCalculation(normalizeImportPayload(input), "quote-chosen", "2026-09-22T00:00:00.000Z");
    const firstRow = buildSimulation(chosen, buildInitialOfferControls(chosen)).rows[0]!;
    expect(firstRow.baseCostUnit).toBe(80000);
    expect(firstRow.costSourceLabel).toBe("Cotización: Primera");
    expect(selectedQuoteLinks(firstRow, chosen.items[0]!)).toEqual([{ label: "Primera", href: "https://proveedor.example/alto", isBasis: true }]);

    const second = { ...chosen, items: chosen.items.map((item) => ({ ...item, selectedPriceSourceId: "source-2" })) };
    const secondRow = buildSimulation(second, buildInitialOfferControls(second)).rows[0]!;
    expect(secondRow.baseCostUnit).toBe(70000);
    expect(selectedQuoteLinks(secondRow, second.items[0]!)).toEqual([{ label: "Segunda", href: "https://proveedor.example/bajo", isBasis: true }]);

    const minimum = { ...chosen, items: chosen.items.map((item) => ({ ...item, selectedCostMode: "optimistic" as const })) };
    expect(selectedQuoteLinks(buildSimulation(minimum, buildInitialOfferControls(minimum)).rows[0]!, minimum.items[0]!)).toEqual([{ label: "Segunda", href: "https://proveedor.example/bajo", isBasis: true }]);
    const average = { ...chosen, items: chosen.items.map((item) => ({ ...item, selectedCostMode: "moderate" as const })) };
    expect(selectedQuoteLinks(buildSimulation(average, buildInitialOfferControls(average)).rows[0]!, average.items[0]!)).toHaveLength(2);
    const weighted = { ...chosen, items: chosen.items.map((item) => ({ ...item, selectedCostMode: "weighted" as const })) };
    expect(selectedQuoteLinks(buildSimulation(weighted, buildInitialOfferControls(weighted)).rows[0]!, weighted.items[0]!)).toHaveLength(2);
    const missing = { ...chosen, items: chosen.items.map((item) => ({ ...item, selectedPriceSourceId: "not-found" })) };
    const missingRow = buildSimulation(missing, buildInitialOfferControls(missing)).rows[0]!;
    expect(missingRow.baseCostUnit).toBeNull();
    expect(missingRow.warnings).toContain("Elige una cotización con precio válido para calcular este ítem.");
    expect(selectedQuoteLinks(missingRow, missing.items[0]!)).toHaveLength(2);

    const fromExcel = rowsToPayload([{ Nombre: "Equipo", "Proveedor 1": "Primera", "Precio proveedor 1": "80.000", "Proveedor 2": "Segunda", "Precio proveedor 2": "70.000", "Fuente elegida": "Proveedor 1" }]);
    expect(fromExcel.items[0]).not.toHaveProperty("selected_cost_mode");
    expect(fromExcel.items[0]).not.toHaveProperty("selected_price_source_id");
  });

  it("mantiene accesibles las fuentes con enlace en todos los modos", () => {
    const base = toCalculation(normalizeImportPayload({
      version: 2,
      items: [{ name: "Equipo", price_sources: [
        { name: "A", unit_price: 100, url: "proveedor.example/a" },
        { name: "B", unit_price: 100, url: "https://proveedor.example/b" },
        { name: "C", unit_price: 120, url: "javascript:alert(1)" },
      ] }],
    }), "link-cases", "2026-09-23T00:00:00.000Z");
    const linksFor = (calculation: typeof base) => selectedQuoteLinks(
      buildSimulation(calculation, buildInitialOfferControls(calculation)).rows[0]!, calculation.items[0]!,
    );
    const one = { ...base, items: [{ ...base.items[0]!, priceSources: [base.items[0]!.priceSources[0]!], selectedCostMode: "manual" as const, manualUnitCost: 110 }] };
    expect(linksFor(one)).toEqual([{ label: "A", href: "https://proveedor.example/a", isBasis: false }]);
    const tiedMinimum = { ...base, items: [{ ...base.items[0]!, selectedCostMode: "optimistic" as const }] };
    expect(linksFor(tiedMinimum).map((link) => link.label)).toEqual(["A", "B"]);
    const average = { ...base, items: [{ ...base.items[0]!, selectedCostMode: "moderate" as const }] };
    expect(linksFor(average).map((link) => link.label)).toEqual(["A", "B"]);
    const noUrlOnMinimum = { ...base, items: [{ ...base.items[0]!, selectedCostMode: "optimistic" as const, priceSources: [
      { ...base.items[0]!.priceSources[0]!, url: "" }, { ...base.items[0]!.priceSources[1]!, unitPrice: 120 },
    ] }] };
    expect(linksFor(noUrlOnMinimum)).toEqual([{ label: "B", href: "https://proveedor.example/b", isBasis: false }]);
    const invalidOnly = { ...base, items: [{ ...base.items[0]!, priceSources: [base.items[0]!.priceSources[2]!] }] };
    expect(linksFor(invalidOnly)).toEqual([]);
  });

  it("el ejemplo JSON publico conserva fuente, servicio y costo general", () => {
    const project = toCalculation(normalizeImportPayload(SAMPLE_PUBLIC_IMPORT_PAYLOAD), "public-demo", "2026-09-22T00:00:00.000Z");
    const simulation = buildSimulation(project, buildInitialOfferControls(project));
    const offer = buildOfferPresentation(simulation, buildVatControls(project), project.settings);

    expect(project.items[0]?.selectedCostMode).toBe("weighted");
    expect(project.items[0]?.selectedPriceSourceId).toBeNull();
    expect(project.items[0]?.priceSources).toHaveLength(2);
    expect(selectedQuoteLinks(simulation.rows[0]!, project.items[0]!)).toHaveLength(2);
    expect(simulation.rows[0]?.additionalCostTotal).toBe(30000);
    expect(offer.summary.generalCostsTotal).toBe(15000);
  });

  it("el contrato publico no decide la fuente y rechaza IDs duplicados", () => {
    const project = toCalculation(normalizeImportPayload({ version: 2, items: [{ name: "Equipo", selected_cost_mode: "source", selected_price_source_id: "a", price_sources: [{ id: "a", unit_price: 100 }] }] }), "no-selection", "2026-09-22T00:00:00.000Z");
    expect(project.items[0]).toMatchObject({ selectedCostMode: "weighted", selectedPriceSourceId: null });
    expect(() => normalizeImportPayload({ version: 2, items: [{ name: "Equipo", price_sources: [{ id: "a", unit_price: 100 }, { id: "a", unit_price: 200 }] }] })).toThrow(/ID distinto/i);
    expect(rowsToPayload([{ Nombre: "Equipo", "Proveedor 1": "A", "Precio proveedor 1": "100", "Fuente elegida": "B" }]).items[0]).not.toHaveProperty("selected_price_source_id");
  });

  it("rechaza costos generales incompletos o negativos", () => {
    for (const amount of [null, "", -1, "-2", "no es un numero"]) {
      expect(() => normalizeImportPayload({ version: 2, items: [{ name: "Equipo" }], general_costs: [{ name: "Poliza", amount }] })).toThrow();
    }
    expect(() => normalizeImportPayload({ version: 2, items: [{ name: "Equipo" }], general_costs: [{ name: "Poliza", amount: 0 }] })).not.toThrow();
  });

  it("la plantilla descargada importa fuentes y ambos tipos de costo sin elegir por el usuario", async () => {
    const response = await downloadTemplate();
    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const headers = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Carga de items"]!, { header: 1 })[1];
    const preview = previewSpreadsheetBuffer(buffer);
    const project = toCalculation(normalizeImportPayload(preview.payload), "sheet-demo", "2026-09-22T00:00:00.000Z");
    const row = buildSimulation(project, buildInitialOfferControls(project)).rows[0]!;

    expect(headers).toHaveLength(30);
    expect(headers).not.toContain("Fuente elegida");
    expect(workbook.SheetNames).toContain("Costos generales");
    expect(project.items[0]).toMatchObject({ selectedCostMode: "weighted", selectedPriceSourceId: null });
    expect(project.items[0]?.priceSources).toHaveLength(3);
    expect(project.items[0]?.priceSources[0]).toMatchObject({ unitPrice: 210000, url: "https://proveedor-a.example/taladro" });
    expect(project.items[0]?.priceSources[1]).toMatchObject({ unitPrice: 240000, url: "https://proveedor-b.example/taladro" });
    expect(project.items[0]?.priceSources[2]).toMatchObject({ unitPrice: 55, currency: "USD", trm: 4000 });
    expect(row.baseCostUnit).not.toBeNull();
    expect(row.additionalCostTotal).toBe(30000);
    expect(project.generalCosts[0]).toMatchObject({ name: "Póliza global", amount: 15000 });
  });
});
