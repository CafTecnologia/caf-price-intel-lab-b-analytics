import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UnifiedItemDetail } from "../components/unified-item-detail";
import { normalizeImportPayload, toCalculation, preserveAdditionalCostsOnReimport, type FinancialOfferItem } from "../lib/contract";
import type { SimulationRow } from "../lib/financial-engine";

function renderDetail(withEvidence: boolean, withOriginal = false, reviewStatus?: "suggested" | "included" | "excluded", rowOverride: Partial<SimulationRow> = {}, extra: Record<string, unknown> = {}) {
  const item = {
    id: "item-9", item: "9", description: "Equipo con marcación", technicalDescription: "Ficha técnica del pliego",
    ...(withOriginal ? { sourceOriginal: {
      description: "Equipo industrial, renglón literal",
      technical_description: "Marcación indeleble exigida en anexo",
      quantity: "01",
      unit: "UND",
      ceiling_unit_price: "$ 1.000",
      document: "Anexo técnico",
      locator: "página 4, ítem 9",
    } } : {}),
    ...(withOriginal ? { technicalAnnex: [{ document: "Ficha guía v9", locator: "ITEM 5, Insumos", text: "Se debe entregar DOS (2) juegos completos de tóner original sellados." }] } : {}),
    quantity: null, unit: "UND", referenceUnit: 1000,
    selectedCostMode: "weighted", selectedPriceSourceId: null,
    notes: withEvidence ? "Se investigó la marcación exigida." : "",
    additionalCosts: withEvidence ? [{ id: "cost-9", name: "Marcación", category: "service", mode: "fixed", amount: null, notes: "Anexo 2", reviewStatus }] : [],
  } as FinancialOfferItem;
  const row = {
    item: "9", quantity: 1, quantityAssumed: true, unit: "UND",
    costTotal: 600, costModeUsed: "weighted", costSourceLabel: "Costo moderado",
    baseCostUnit: 600, productCostTotal: 600, additionalCostTotal: 0, knownCostTotal: 600, offerTotal: 900,
    hasPendingAssociatedCosts: withEvidence, utilityValue: 300,
    costBreakdown: { sources: withEvidence ? [{
      id: "source-9", label: "Proveedor", currency: "COP", unitPrice: 600,
      normalizedUnit: 600, url: "https://proveedor.example/equipo", notes: "Modelo investigado", warning: "",
    }] : [] },
    ...rowOverride,
  } as unknown as SimulationRow;
  return renderToStaticMarkup(createElement(UnifiedItemDetail, {
    item, row, index: 0, count: 1,
    onClose: () => {}, onEdit: () => {}, onAddCost: () => {}, onSetManualCost: () => {}, onSetAdditionalCost: () => {}, onUpdateAdditionalCost: () => {}, onRemoveAdditionalCost: () => {}, onNavigate: () => {}, ...extra,
  }));
}

describe("comparación del ítem desplegado", () => {
  it("separa datos registrados de investigación y declara que falta el original literal", () => {
    const html = renderDetail(true);
    expect(html.indexOf("Datos usados en el cálculo")).toBeLessThan(html.indexOf("Investigación de mercado"));
    expect(html).toContain("Origen documental no aportado para este ítem");
    expect(html).toContain("Equipo con marcación");
    expect(html).toContain("Ficha técnica del pliego");
    expect(html).toContain("El cálculo usa 1 unidad asumida");
    expect(html).toContain("Techo unitario registrado");
    expect(html).toContain("Se investigó la marcación exigida");
    expect(html).toContain("Ver en proveedor.example");
    expect(html).toContain("Marcación");
    expect(html).toContain("Anexo 2");
    expect(html).toMatch(/Utilidad bruta.*?<dd>300<\/dd>/s);
    expect(html).toContain("Costos asociados sin valorar");
    expect(html).toContain("Agregar precio");
    expect(html).toContain("Editar costo");
    expect(html).toContain("Editar datos");
    expect(html).toContain("Eliminar");
    expect(html).toContain("Producto base");
    expect(html).toContain("Costo moderado");
  });

  it("separa una transcripción documental aportada de la interpretación y la conserva al reimportar", () => {
    const html = renderDetail(true, true);
    expect(html.indexOf("Ver transcripción y ubicación en el pliego")).toBeLessThan(html.indexOf("Datos usados en el cálculo"));
    expect(html).toContain("Equipo industrial, renglón literal");
    expect(html).toContain("Marcación indeleble exigida en anexo");
    expect(html).toContain("página 4, ítem 9");
    expect(html).toContain("Ficha técnica anexa");
    expect(html).toContain("Ver ficha completa");
    expect(html).toContain("fragmento del documento");
    expect(html).toContain("01");
    expect(html).not.toContain("Origen documental no aportado");

    const existing = toCalculation(normalizeImportPayload({
      version: 2,
      items: [{ name: "Equipo interpretado", description: "Ficha interpretada", source_original: {
        description: "Equipo industrial, renglón literal", technical_description: "Marcación indeleble exigida en anexo",
        quantity: "01", unit: "UND", ceiling_unit_price: "$ 1.000", document: "Anexo técnico", locator: "página 4, ítem 9",
      } }],
    }), "original-check", "2026-10-05T00:00:00.000Z");
    const incoming = toCalculation(normalizeImportPayload({
      version: 2,
      items: [{ name: "Equipo interpretado", description: "Ficha interpretada" }],
    }), "original-check", "2026-10-05T00:00:00.000Z");
    expect(preserveAdditionalCostsOnReimport(incoming, existing).items[0]?.sourceOriginal)
      .toEqual(existing.items[0]?.sourceOriginal);
  });

  it("muestra ausencias sin presentarlas como hallazgos de IA", () => {
    const html = renderDetail(false);
    expect(html).toContain("Sin notas de investigación registradas");
    expect(html).toContain("Sin fuentes registradas");
    expect(html).toContain("Sin costos asociados separados");
    expect(html).not.toContain("Utilidad provisional");
  });

  it("presenta la sugerencia como decisión explícita y permite aplicarla o descartarla", () => {
    const html = renderDetail(true, false, "suggested");
    expect(html).toContain("Aplicar");
    expect(html).toContain("No aplica");
    expect(html).toContain("Sugerido");
  });

  // Preserve DEV regression contracts during convergence.
it("ofrece tres vistas previas cerradas sin mezclar precio investigado y escenario", () => {
    const html = renderDetail(true, true, undefined, {
      baseCostUnit: 600, productCostTotal: 540, knownCostTotal: 540, costTotal: 540,
      quantity: 1, offerTotal: 900, utilityValue: 360, costScenarioDiscountPct: 10,
    });
    const summaries = [...html.matchAll(/<details class="unified-primary-section ([^"]+)"[^>]*><summary>(.*?)<\/summary>/gs)];
    expect(summaries).toHaveLength(3);
    expect(summaries.every((match) => !match[0].includes(' open=""'))).toBe(true);
    expect(summaries[0][2]).toContain("Anexo técnico");
    expect(summaries[0][2]).toContain("01 UND");
    expect(summaries[1][2]).toContain("COP 600");
    expect(summaries[1][2]).toContain("1 fuente");
    expect(summaries[2][2]).toMatch(/Costo conocido.*?540.*?Oferta.*?900.*?Utilidad bruta.*?360/s);
    expect(html).toContain("540 por unidad");
  });

it("distingue el precio del producto, asociados, total y pérdida sin llamar neto al resultado", () => {
    const html = renderDetail(false, false, undefined, {
      quantity: 3, quantityAssumed: false, baseCostUnit: 30, productCostTotal: 90,
      additionalCostTotal: 15, costUnit: 35, costTotal: 105, knownCostTotal: 105,
      offerTotal: 90, utilityValue: -15,
    });
    expect(html).toMatch(/Producto base · por unidad<\/small><strong>30<\/strong>/);
    expect(html).toMatch(/Costos asociados.*?<dd>15<\/dd>/s);
    expect(html).not.toContain("Equivale a");
    expect(html).toMatch(/Costo conocido.*?<dd>105<\/dd>/s);
    expect(html).toMatch(/Pérdida bruta.*?<dd>-15<\/dd>/s);
    expect(html).not.toContain("Utilidad neta");
    expect(html).toContain('aria-label="Costos del ítem"');
    expect(html).toContain('aria-label="Oferta y utilidad del ítem"');
  });

it("conserva pendiente cuando falta el costo y no anuncia utilidad cero", () => {
    const html = renderDetail(false, false, undefined, {
      baseCostUnit: null, productCostTotal: null, knownCostTotal: null, costTotal: null, costUnit: null, utilityValue: null,
    });
    expect(html).toMatch(/Producto base · por unidad<\/small><strong>Pendiente<\/strong>/);
    expect(html).toMatch(/Utilidad bruta<\/dt><dd>Pendiente<\/dd>/);
  });

it("ordena documento, mercado, asociados plegados y resultados con margen", () => {
    const html = renderDetail(true, true, "suggested", {
      quantity: 3, quantityAssumed: false, referenceUnit: 1000, referenceTotal: 3000, baseCostUnit: 30, productCostTotal: 90,
      additionalCostTotal: 15, costUnit: 35, costTotal: 105, knownCostTotal: 105,
      offerUnit: 30, offerTotal: 90, utilityValue: -15,
    }, { desktop: true });
    expect(html).toContain("Ítem 1 de 1");
    expect(html).toContain("<h4>Documento original</h4>");
    expect(html).toContain("<h4>Investigación de mercado</h4>");
    expect(html).not.toMatch(/[1-4] · (Documento|Investigación|Costos|Resultados)/);
    // Techo y costo de mercado a la misma altura: cifras justo bajo el título, en el mismo orden.
    expect(html).toMatch(/<h4>Documento original<\/h4><div class="unified-desk-kv"><span>Techo por unidad<\/span><span>[^<]*<\/span><span>Techo total<\/span><span>[^<]*<\/span><span>Cantidad/);
    expect(html).toMatch(/<h4>Investigación de mercado<\/h4><div class="unified-desk-kv"><span>Costo de mercado por unidad<\/span><span>[^<]*<\/span><span>Costo de mercado total<\/span><span>[^<]*<\/span><span>Fuentes/);
    expect(html).toMatch(/unified-desk-associated"><button type="button" class="unified-desk-fold"/);
    expect(html).not.toContain("unified-associated-list");
    expect(html).not.toContain("unified-desk-overlay");
    expect(html).toContain("<b>Costos asociados</b>");
    expect(html).toContain("0 de 1 incluidos");
    expect(html).toContain("1 señal");
    expect(html).toMatch(/Costo usado<\/td><td>35<\/td><td>105<\/td>/);
    expect(html).toMatch(/Pérdida bruta<\/td><td>−5<\/td><td>−15<\/td><td>−16,7 % margen/);
    expect(html).toContain("3 % del techo");
    expect(html).not.toContain("Ajustar oferta");
  });
});
