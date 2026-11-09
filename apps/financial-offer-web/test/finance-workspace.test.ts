import { describe, expect, it, vi } from "vitest";
import { normalizeImportPayload, toCalculation, preserveAdditionalCostsOnReimport } from "../lib/contract";
import { buildProjectExport, clientOfferRows } from "../lib/export";
import { buildSimulation, buildInitialOfferControls } from "../lib/financial-engine";
import { costOptions, costModePatch } from "../lib/cost-options";
import { capturePriceBase, restorePriceBase } from "../lib/price-base";
import { mergeWorkspace, workspaceDataKey } from "../lib/workspace-merge";
import { rowFilters } from "../lib/row-filters";
import { downloadExport } from "../lib/client-download";

function project() {
  return toCalculation(normalizeImportPayload({ version: 2, items: [
    { item: "1", name: "Uno", quantity: 2, unit: "UND", ceiling_unit_price: 50000, procurement_lot: { id: "I", label: "Lote I", document: "I.xlsx", locator: "Oferta" }, price_sources: [{ name: "Proveedor", unit_price: 20000, currency: "COP" }] },
    { item: "1", name: "Dos", quantity: 3, unit: "UND", ceiling_unit_price: 10000, procurement_lot: { id: "II", label: "Lote II", document: "II.xlsx", locator: "Oferta" }, cost_basis_status: "pending", price_sources: [{ name: "PENDIENTE_COSTO", unit_price: 0, currency: "COP" }] },
  ] }), "calc", "2026-10-14T00:00:00.000Z");
}
describe("lotes activos y alternativas reales", () => {
  it("restaura el supuesto con su costo y limpia etiquetas de bases históricas", () => {
    const p = project(); p.items[0]!.manualUnitCost = 40000;
    p.items[0]!.manualCostAssumption = { base: "reference", discountPct: 20 };
    const snapshot = capturePriceBase(p.items);
    p.items[0]!.manualUnitCost = 30000; p.items[0]!.manualCostAssumption = null;
    const restored = restorePriceBase(p.items, snapshot);
    expect(restored[0]!.manualUnitCost).toBe(40000);
    expect(restored[0]!.manualCostAssumption?.discountPct).toBe(20);
    delete snapshot[0]!.manualCostAssumption;
    expect(restorePriceBase(restored, snapshot)[0]!.manualCostAssumption).toBeNull();
  });

  it("excluye pendientes de otro lote de sumas, integridad y exportación sin eliminar filas", () => {
    const p = project(); p.settings.excludedProcurementLotIds = ["II"]; p.settings.manualReferenceTotal = 999999;
    const exp = buildProjectExport(p);
    expect(exp.simulation.rows).toHaveLength(2); expect(exp.offer.rows).toHaveLength(2);
    expect(exp.simulation.summary.itemCount).toBe(1); expect(exp.simulation.summary.missingCostCount).toBe(0);
    expect(exp.simulation.summary.referenceKnownTotal).toBe(exp.simulation.rows[0]!.referenceTotal);
    expect(exp.offer.summary.totalProjectCost).toBe(exp.simulation.rows[0]!.costTotal);
    expect(exp.offer.summary.totalOfferWithVat).toBe(exp.offer.rows[0]!.totalWithVat);
    expect(clientOfferRows(exp).map(row => row["ID lote"])).toEqual(["I"]);
    p.settings.excludedProcurementLotIds = [];
    expect(clientOfferRows(buildProjectExport(p))).toHaveLength(2);
  });
  it("mantiene gastos generales una sola vez y retenciones solo sobre oferta activa", () => {
    const p = project(); p.settings.excludedProcurementLotIds = ["II"];
    p.generalCosts = [{ id: "g", name: "Gasto general", amount: 7000, category: "other", notes: "" }];
    p.settings.applyReteFuente = true; p.settings.reteFuenteRate = 2.5; p.settings.reteFuenteBase = "pre_vat";
    const exp = buildProjectExport(p);
    expect(exp.offer.summary.generalCostsTotal).toBe(7000);
    expect(exp.offer.summary.totalProjectCost).toBe(exp.offer.rows[0]!.costTotal! + 7000);
    expect(exp.offer.summary.reteFuente).toBe(exp.offer.rows[0]!.totalWithoutVat! * .025);
  });
  it("conserva participación en reimportación", () => {
    const old = project(); old.settings.excludedProcurementLotIds = ["II"];
    expect(preserveAdditionalCostsOnReimport(project(), old).settings.excludedProcurementLotIds).toEqual(["II"]);
  });
  it("muestra costo único, conserva manual alternativo y omite opciones inexistentes", () => {
    const p = project(), item = p.items[0]!;
    expect(costOptions(item, p.settings).map(option => option.label)).toEqual(["Costo único"]);
    expect(costModePatch(item, p.settings, "manual")).toBeNull();
    item.manualUnitCost = 40000; item.selectedCostMode = "manual";
    expect(costOptions(item, p.settings).map(option => option.label)).toEqual(["Costo único", "Manual"]);
    const patch = costModePatch(item, p.settings, "unique")!;
    expect(patch.selectedCostMode).not.toBe("manual");
    expect(costModePatch(p.items[1]!, p.settings, "unique")).toBeNull();
  });
  it("el filtro sin costo conserva el índice original del otro lote", () => {
    const p = project(), simulation = buildSimulation(p, buildInitialOfferControls(p));
    const filter = rowFilters.find(filter => filter.key === "missing_cost")!;
    expect(simulation.rows.flatMap((row, index) => filter.test(row) ? [index] : [])).toEqual([1]);
  });
});

describe("conciliación de guardado concurrente", () => {
  it("no considera edición el orden de campos devuelto por el servidor", () => {
    const base = project();
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
    reordered.settings = Object.fromEntries(Object.entries(base.settings).reverse()) as typeof base.settings;
    reordered.items = base.items.map(item => Object.fromEntries(Object.entries(item).reverse()) as typeof item);
    expect(workspaceDataKey(base)).toBe(workspaceDataKey(reordered));
    expect(mergeWorkspace(base, base, reordered).conflicts).toEqual([]);
  });
  it("une edición de oferta y nueva investigación; preserva filas agregadas por IA", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    local.items[0]!.discountPct = 10;
    remote.items[1]!.manualUnitCost = 8000;
    remote.items.push({ ...remote.items[0]!, id: "new", item: "2" });
    const result = mergeWorkspace(base, local, remote);
    expect(result.conflicts).toEqual([]); expect(result.value.items).toHaveLength(3);
    expect(result.value.items[0]!.discountPct).toBe(10); expect(result.value.items[1]!.manualUnitCost).toBe(8000);
    expect(base.items).toHaveLength(2);
  });
  it("no mezcla selecciones de costo incompatibles ni borra una fila modificada", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    local.items[0]!.selectedCostMode = "manual"; remote.items[0]!.selectedCostMode = "optimistic";
    expect(mergeWorkspace(base, local, remote).conflicts.join(" ")).toContain("selectedCostMode");
    local.items.shift(); remote.items[0]!.description = "Cambio remoto";
    expect(mergeWorkspace(base, local, remote).conflicts.join(" ")).toContain("eliminación");
  });
  it("resuelve solo por decisión explícita conservando otros datos remotos", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    local.items[0]!.manualUnitCost = 111; remote.items[0]!.manualUnitCost = 222;
    remote.items[1]!.notes = "Investigación nueva";
    remote.items.push({ ...remote.items[1]!, id: "new", item: "3" });
    expect(mergeWorkspace(base, local, remote).conflicts).not.toEqual([]);
    const resolved = mergeWorkspace(base, local, remote, true).value;
    expect(resolved.items[0]!.manualUnitCost).toBe(111);
    expect(resolved.items[1]!.notes).toBe("Investigación nueva");
    expect(resolved.items).toHaveLength(3);
  });
  it("conserva ediciones que llegaron durante el guardado y acepta cambios idénticos", () => {
    const submitted = project(), current = structuredClone(submitted), saved = structuredClone(submitted);
    current.items[0]!.manualUnitCost = 123; saved.items[1]!.notes = "Nueva fuente";
    const result = mergeWorkspace(submitted, current, saved);
    expect(result.conflicts).toEqual([]); expect(result.value.items[0]!.manualUnitCost).toBe(123);
    expect(result.value.items[1]!.notes).toBe("Nueva fuente");
    saved.items[0]!.manualUnitCost = 123;
    expect(mergeWorkspace(submitted, current, saved).conflicts).toEqual([]);
  });
});

describe("descarga de Excel", () => {
  it("muestra fallo HTTP sin intentar una descarga vacía", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "No tienes acceso" }), { status: 403 })));
    await expect(downloadExport("/export")).rejects.toThrow("No tienes acceso"); vi.unstubAllGlobals();
  });
  it("descarga después de la respuesta sin abrir ventanas", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn(); const revoke = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("xlsx", { headers: { "content-disposition": 'attachment; filename="oferta.xlsx"' } })));
    vi.stubGlobal("document", { createElement: () => anchor, body: { append } });
    vi.stubGlobal("window", { setTimeout: (fn: () => void) => fn(), open: vi.fn() });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:export", revokeObjectURL: revoke });
    await downloadExport("/export"); expect(anchor.download).toBe("oferta.xlsx"); expect(anchor.click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith("blob:export");
    vi.unstubAllGlobals();
  });
});
