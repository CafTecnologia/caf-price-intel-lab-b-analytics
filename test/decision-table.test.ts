import { readFileSync } from "node:fs";
import { rowFilters } from "../lib/row-filters";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DecisionTable, sortedDecisionIndexes } from "../components/decision-table";
import type { FinancialOfferItem } from "../lib/contract";
import type { SimulationRow } from "../lib/financial-engine";

let testBasis: FinancialOfferItem["costBasisStatus"];
let testCostLabel = "Costo moderado";

function renderRow(quantity: number | null, unit: number | null, total: number | null, status: SimulationRow["status"] = "viable", previewIndex: number | null = null, sourceUrl: string | null = null, expandedAll = false, columnPrefs?: { offerAdjust?: { visible: boolean; width: number }; description?: { visible: boolean; width: number } }) {
  const row = {
    rowKey: "item-1", item: "1", quantity: quantity ?? 1, quantityAssumed: quantity === null, unit: "UND",
    referenceUnit: unit, referenceTotal: total,
    costUnit: unit, costTotal: total,
    offerUnit: unit, offerTotal: total,
    utilityValue: 100, status, costSourceLabel: testCostLabel, costBreakdown: { sources: sourceUrl ? [{ id: "source-1", label: "Proveedor", url: sourceUrl, unitPrice: 1000, normalizedUnit: 1000, currency: "COP" }] : [] },
  } as unknown as SimulationRow;
  const item = { id: "item-1", item: "1", description: "Producto de prueba", technicalDescription: "Ficha de prueba", quantity, costBasisStatus: testBasis } as FinancialOfferItem;
  return renderToStaticMarkup(createElement(DecisionTable, {
    items: [item], rows: [row], selectedRowKeys: new Set<string>(),
    filterKey: "all", collapsedLots: new Set<string>(), onToggleLot: () => {}, onSelectLot: () => {},
    onToggleRowSelection: () => {}, onToggleAllRows: () => {}, onOpenDetail: () => {},
    onAddCost: () => {}, onSetManualCost: () => {}, onSetAdditionalCost: () => {}, onUpdateAdditionalCost: () => {}, onRemoveAdditionalCost: () => {}, expandedAll, onExpandedAllChange: () => {},
    editingIndex: null, onManualCostChange: () => {},
    onSearch: () => {}, renderOfferAdjustment: () => createElement("span", null, "Cinta de ajuste"),
    previewIndex, onPreviewChange: () => {}, columnPrefs,
  }));
}

const amounts = (...args: Parameters<typeof renderRow>) => renderRow(...args).replace(/<span class="decision-amount-label">[^<]*<\/span>/g, "");

describe("lectura compacta de importes", () => {
  it("no duplica el importe cuando cantidad uno tiene unitario y total iguales", () => {
    const html = renderRow(1, 1000, 1000);
    expect(html).not.toContain("Unit. = total");
    expect(html.match(/decision-amount-unit">–<\/small><strong><span class="decision-amount-label">Total <\/span>1\.000<\/strong>/g)).toHaveLength(3);
    expect(html.match(/decision-amount-label">Total <\/span>1\.000/g)).toHaveLength(3);
  });

  it("conserva ambas cifras si cantidad uno tiene un total distinto", () => {
    const html = renderRow(1, 1000, 1200);
    expect(html.match(/decision-amount-label">Total <\/span>1\.200/g)).toHaveLength(3);
    expect(html).toContain("Unitario: 1.000 COP con IVA.");
  });

  it("muestra total y unitario para varias unidades y distingue faltantes", () => {
    const html = renderRow(3, 1000, 3000);
    expect(html.match(/decision-amount-label">Total <\/span>3\.000/g)).toHaveLength(3);
    expect(html).toContain("Unitario: 1.000 COP con IVA.");
    expect(html).not.toContain("3 × 1.000");
    const missing = renderRow(2, null, null);
    expect(missing).toContain("Sin techo");
    expect(missing).toContain('aria-label="Buscar precio del ítem 1 en Google"');
    expect(missing).toContain(">Pendiente</strong>");
    const implicit = renderRow(null, 1000, 1000);
    expect(implicit).toContain("1 asumida");
    expect(implicit).toContain("Cantidad no indicada en el pliego");
    expect(implicit).not.toContain("Cantidad pendiente");
    expect(implicit).not.toContain("1 implícita");
    expect(implicit).not.toContain("Unit. = total");
  });

  it("prioriza el estado que exige revisión frente a la diferencia con el techo", () => {
    const html = renderRow(1, 1000, 1000, "incomplete");
    expect(html).toContain("<strong>Faltan datos</strong>");
    expect(html).toContain("<small>Revisar datos del ítem</small>");
    expect(renderRow(1, null, null, "incomplete")).toContain("<strong>Sin costo</strong>");
  });

  it("empieza plegada y despliega ficha, fuentes y costos bajo la fila", () => {
    const folded = renderRow(1, 1000, 1000);
    expect(folded).not.toContain('class="unified-detail-row"');
    const expanded = renderRow(1, 1000, 1000, "viable", 0);
    expect(expanded).toContain('class="unified-detail-row"');
    expect(expanded).toContain("Datos usados en el cálculo");
    expect(expanded).toContain("Investigación de mercado");
    expect(expanded).toContain("Fuentes de precio");
    expect(expanded).toContain("Sin costos asociados separados.");
    expect(expanded).toContain("+ Añadir costo al ítem");
    expect(expanded).toContain("Editar datos, fuentes y costos");
    expect(expanded).not.toContain('role="dialog"');
    expect(renderRow(1, 1000, 1000, "viable", null, null, true)).toContain('class="unified-detail-row"');
  });

  it("aplica visibilidad y ancho a la mesa y ajusta el detalle a las columnas visibles", () => {
    const html = renderRow(1, 1000, 1000, "viable", 0, null, false, {
      offerAdjust: { visible: false, width: 245 },
      description: { visible: true, width: 420 },
    });
    expect(html).toContain('class="decision-col-description" style="width:420px"');
    expect(html).toContain('<th hidden="" aria-sort="none"><div class="decision-header-content"><span class="decision-header-label">Ajuste</span>');
    expect(html).toContain('colSpan="7"');
  });

  it("deja visibles el ajuste, el enlace de cotización y la búsqueda por ítem", () => {
    const html = renderRow(1, 1000, 1000, "viable", null, "https://proveedor.example/cotizacion");
    expect(html).toContain('aria-label="Ordenar ajuste de precio: de menor a mayor"');
    expect(html).toContain('class="decision-adjust-chip risk-ok"');
    expect(html).not.toContain("Cinta de ajuste");
    expect(html).toContain('href="https://proveedor.example/cotizacion"');
    expect(renderRow(1, null, null)).toContain('aria-label="Buscar precio del ítem 1 en Google"');
    expect(renderRow(1, 1000, 1000, "viable", 0)).toContain("Editar datos, fuentes y costos");
    expect(html).toContain("Citar el ítem 1 en el chat IA");
    expect(html).toContain("Cambiar costo de referencia por unidad del ítem 1");
  });

  it("ordena los importes totales visibles en ambos sentidos y deja pendientes al final", () => {
    const rows = [
      { referenceTotal: 300, costTotal: 200, offerTotal: 250 },
      { referenceTotal: 100, costTotal: 90, offerTotal: 95 },
      { referenceTotal: null, costTotal: null, offerTotal: null },
    ] as SimulationRow[];
    expect(sortedDecisionIndexes(rows, "reference", "asc")).toEqual([1, 0, 2]);
    expect(sortedDecisionIndexes(rows, "reference", "desc")).toEqual([0, 1, 2]);
    expect(sortedDecisionIndexes(rows, "costUnit", "asc")).toEqual([1, 0, 2]);
  });

  it("abre el origen de la ficha en otra pestaña y evita enlaces no web", () => {
    const valid = renderRow(1, 1000, 1000, "viable", 0, "https://proveedor.example/cotizacion");
    const preview = valid.slice(valid.indexOf('class="unified-detail-row"'));
    expect(preview).toContain('target="_blank" rel="noopener noreferrer"');
    expect(preview).toContain("https://proveedor.example/cotizacion");
    const unsafe = renderRow(1, 1000, 1000, "viable", 0, "javascript:alert(1)");
    expect(unsafe).not.toContain('href="javascript:alert(1)"');
  });

  // Preserve DEV regression contracts during convergence.
it("muestra el total de la fila aunque difiera del unitario con cantidad uno", () => {
    const html = amounts(1, 1000, 1200);
    expect(html.match(/<strong>1\.200<\/strong>/g)).toHaveLength(3);
  });

it("pasa toda la fila a millones si un total llega a 1.000.000 y deja en pesos lo menor de 10.000", () => {
    const html = amounts(3, 400000, 1200000);
    expect(html.match(/<small class="decision-amount-unit">0,400 M<\/small><strong>1,20 M<\/strong>/g)).toHaveLength(3);
    // Utilidad 100: bajo 10.000 sigue en pesos; el margen ínfimo no se muestra como 0,0 %.
    expect(html).toContain('<small class="decision-amount-unit">33</small><strong>100<span class="decision-margin">&lt;0,1 %</span></strong>');
    expect(html).not.toContain("0,00 M");
  });

it("mantiene ficha y detalle en el mismo grupo y enlaza el control con su contenido", () => {
    const folded = renderRow(1, 1000, 1000);
    expect(folded).toContain('class="decision-item-group" aria-label="Ítem 1: Producto de prueba"');
    expect(folded).toMatch(/class="decision-item-number"><span class="decision-item-word">Ítem <\/span>1<\/span>/);
    expect(folded).toContain('class="decision-item-name">Producto de prueba');
    expect(folded).toContain("Ver detalles");
    const expanded = renderRow(1, 1000, 1000, "viable", 0);
    expect(expanded).toContain('aria-controls="decision-item-detail-0"');
    expect(expanded).toMatch(/<tbody[^>]*decision-item-group.*?id="decision-item-detail-0".*?aria-label="Detalle del ítem 1".*?Ítem (?:<!-- -->)?1(?:<!-- -->)? de.*?<\/section>.*?<\/tbody>/s);
    expect(expanded).not.toMatch(/Fin del ítem|unified-detail-owner/);
    expect(expanded).toContain('aria-labelledby="decision-item-heading-0"');
  });

it("marca solo la pérdida para el rosado y ofrece Costos asociados en vez de Por revisar", () => {
    expect(renderRow(1, 1000, 1000, "loss")).toMatch(/class="decision-row[^"]*is-loss/);
    expect(renderRow(1, 1000, 1000, "over_ceiling")).not.toContain("is-loss");
    expect(rowFilters.map(filter => filter.label)).toEqual(["Todos", "Sin costo", "Incompletos", "Pérdida", "Margen estrecho", "Costos asociados"]);
    const associated = rowFilters.find(filter => filter.key === "associated")!.test;
    expect(associated({ status: "loss" } as SimulationRow)).toBe(false);
    expect(associated({ status: "viable", hasSuggestedAssociatedCosts: true } as SimulationRow)).toBe(true);
  });

it("Mesa PC bloque 1: flecha que gira, Resultados sin margen ni «Sin techo» repetido", () => {
    expect(renderRow(1, 1000, 1000)).toContain('class="decision-chevron "');
    expect(renderRow(1, 1000, 1000, "viable", 0)).toContain('class="decision-chevron is-open"');
    // Resultados usa el mismo formato que Oferta: unitario arriba, total abajo.
    const html = renderRow(3, 1000, 3000);
    expect(html).toMatch(/decision-result[^>]*><small class="decision-amount-unit"><span class="decision-amount-label">Unit\. <\/span>33<\/small><strong><span class="decision-amount-label">Total <\/span>100/);
    // «Sin techo» queda solo en la columna Techo.
    const noCeiling = renderRow(2, null, null, "no_ceiling");
    expect(noCeiling).not.toContain("<small>Sin techo</small>");
    const css = readFileSync("app/globals.css", "utf8");
    const block = css.slice(css.indexOf("/* === Bloque 1 mesa PC (27/10) === */"));
    expect(block).toMatch(/@media \(min-width: 641px\)[\s\S]*\.decision-result \.decision-margin \{ display: none; \}/);
    expect(block).not.toMatch(/^\.decision-table[^{]*\.decision-margin/m);
    expect(block).toContain(".decision-adjust-chip::after");
  });

it("rótulos Unit. y Total pequeños en techo, costo, oferta y resultado, visibles únicamente en PC", () => {
    const html = renderRow(3, 1000, 3000);
    expect(html.match(/decision-amount-label">Unit\. /g)).toHaveLength(4);
    expect(html.match(/decision-amount-label">Total /g)).toHaveLength(4);
    // Con cantidad 1 no hay unitario aparte: no se rotula el guion.
    expect(renderRow(1, 1000, 1000)).not.toContain('decision-amount-label">Unit.');
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/^\.decision-amount-label \{ display: none; \}/m);
    // Rótulo discreto: no compite con el número (Carlos, 27/10).
    // El selector debe ganarle a «.decision-table tbody td:nth-child(n) span { font-size: inherit }», o «Total» hereda 15 px.
    expect(css).toMatch(/body \.calculation-workspace \.decision-table tbody td \.decision-amount-label \{ display: inline; color: #a39a90; font-size: 10px; font-weight: 400;/);
    expect(css).toMatch(/@media \(min-width: 641px\) \{\s*(\/\*[^*]*\*\/\s*)?body \.calculation-workspace \.decision-table tbody td \.decision-amount-label \{ display: inline;/);
  });

it("sin «Costo único» bajo el costo, cantidad rotulada con su unidad y «Sin techo» marcado (Carlos, 27/10)", () => {
    testCostLabel = "Costo único";
    try {
      expect(renderRow(3, 1000, 3000)).not.toContain("Costo único");
    } finally {
      testCostLabel = "Costo moderado";
    }
    expect(renderRow(3, 1000, 3000)).toContain("Cant. / Und.");
    expect(renderRow(1, null, null)).toMatch(/data-label="Techo con IVA" class="decision-number is-no-ceiling"/);
    expect(renderRow(1, 1000, 1000)).not.toContain("is-no-ceiling");
  });

it("comparable exploratorio: solo un punto con explicación en la fila y aviso claro en el detalle", () => {
    testBasis = "comparable_scenario";
    try {
      const folded = renderRow(1, 1000, 1000);
      expect(folded).toContain('class="decision-basis-dot"');
      expect(folded).toContain("no del mismo ítem del pliego (no homologado)");
      // El detalle de PC se arma solo con el ancho del navegador; se comprueba en su fuente.
      const detail = readFileSync("components/unified-item-detail.tsx", "utf8");
      expect(detail).toContain('costBasisStatus === "comparable_scenario" ? <p className="unified-basis-notice">El costo sale de un producto comparable, no del mismo ítem del pliego (no homologado).</p>');
    } finally { testBasis = undefined; }
    expect(renderRow(1, 1000, 1000)).not.toContain("decision-basis-dot");
  });

it("incluye ítems con costos asociados ya valorados, no solo pendientes o sugeridos (Carlos, 27/10)", () => {
    const test = rowFilters.find((filter) => filter.key === "associated")!.test;
    const base = { additionalCostTotal: 0, hasPendingAssociatedCosts: false, hasSuggestedAssociatedCosts: false } as unknown as SimulationRow;
    expect(test(base)).toBe(false);
    expect(test({ ...base, additionalCostTotal: 52000 })).toBe(true);
    expect(test({ ...base, hasPendingAssociatedCosts: true })).toBe(true);
  });

it("cada costo trae casilla de inclusión y precio editable, también los excluidos (Carlos, 27/10)", () => {
    const row = { rowKey: "item-1", item: "1", quantity: 2, unit: "UND", status: "viable", associatedCostCount: 2, additionalCostTotal: 30000, costBreakdown: { sources: [] } } as unknown as SimulationRow;
    const item = { id: "item-1", item: "1", description: "Producto", quantity: 2, additionalCosts: [
      { id: "c1", name: "Instalación", category: "service", mode: "fixed", amount: 30000, notes: "", reviewStatus: "included" },
      { id: "c2", name: "Transporte", category: "service", mode: "per_unit", amount: null, notes: "", reviewStatus: "excluded" },
    ] } as unknown as FinancialOfferItem;
    const html = renderToStaticMarkup(createElement(DecisionTable, {
      filterKey: "associated", collapsedLots: new Set<string>(), onToggleLot: () => {}, onSelectLot: () => {},
      items: [item], rows: [row], selectedRowKeys: new Set<string>(),
      onToggleRowSelection: () => {}, onToggleAllRows: () => {}, onOpenDetail: () => {},
      onAddCost: () => {}, onSetManualCost: () => {}, onSetAdditionalCost: () => {}, onUpdateAdditionalCost: () => {}, onRemoveAdditionalCost: () => {}, expandedAll: false, onExpandedAllChange: () => {},
      editingIndex: null, onManualCostChange: () => {},
      onSearch: () => {}, renderOfferAdjustment: () => null,
      previewIndex: null, onPreviewChange: () => {},
    }));
    const list = html.slice(html.indexOf("decision-associated-list"));
    expect(list.match(/type="checkbox"/g)).toHaveLength(2);
    expect(list).toMatch(/aria-label="Incluir Instalación en el proyecto" checked=""/);
    expect(list).toMatch(/class="is-excluded is-pending"/);
    expect(list).toMatch(/aria-label="Precio de Instalación" value="30\.000"/);
    expect(list).toMatch(/aria-label="Precio de Transporte" value=""/);
    expect(html).toMatch(/decision-row is-associated-ref/);
  });
});
