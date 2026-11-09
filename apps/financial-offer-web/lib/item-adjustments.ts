import type { FinancialOfferItem } from "./contract";
import type { SimulationRow } from "./financial-engine";

export type AdjustmentTag = { key: string; label: string };
const percentKey = (value: number) => String(Number(value.toFixed(8)));
const pctLabel = (value: number) => `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 8 }).format(value)} %`;
const tag = (kind: string, pct: number, label: string): AdjustmentTag => ({ key: `adj:${kind}:${percentKey(pct)}`, label });

// Groups describe the current saved adjustment, including a group of one item.
export function adjustmentTagsFor(item: FinancialOfferItem, row: Pick<SimulationRow, "offerUnit" | "costUnit" | "referenceUnit" | "control">): AdjustmentTag[] {
  const tags: AdjustmentTag[] = [];
  if (item.manualCostAssumption && item.selectedCostMode === "manual") tags.push(tag("cost-ref", item.manualCostAssumption.discountPct, `Costo: techo −${pctLabel(item.manualCostAssumption.discountPct)}`));
  if (item.costScenarioMode === "lot" && item.costScenarioDiscountPct != null) tags.push(tag("cost-lot", item.costScenarioDiscountPct, `Costo −${pctLabel(item.costScenarioDiscountPct)}`));
  if (row.offerUnit !== null) {
    const adjustment = item.offerAdjustment;
    if (adjustment) {
      const pct = adjustment.percent;
      tags.push(tag(`offer-${adjustment.kind}`, pct, adjustment.kind === "profit" ? `Oferta: costo +${pctLabel(pct)}` : `Oferta: techo ${pct >= 0 ? "−" : "+"}${pctLabel(Math.abs(pct))}`));
    } else if (row.control.mode === "profit" && row.costUnit !== null && Number.isFinite(row.control.profitPct)) {
      tags.push(tag("offer-profit", row.control.profitPct, `Oferta: costo +${pctLabel(row.control.profitPct)}`));
    } else if (row.control.mode === "discount" && row.referenceUnit !== null && row.control.discountPct !== 0) {
      const pct = row.control.discountPct;
      tags.push(tag("offer-ceiling", pct, `Oferta: techo ${pct > 0 ? "−" : "+"}${pctLabel(Math.abs(pct))}`));
    }
  }
  return tags;
}

export function estimateCostFromCeiling(item: FinancialOfferItem, reference: number, discountPct: number): FinancialOfferItem {
  const previous = item.selectedCostMode === "manual" && item.manualCostAssumption
    ? item.manualCostAssumption.previous
    : { manualUnitCost: item.manualUnitCost, selectedCostMode: item.selectedCostMode, selectedPriceSourceId: item.selectedPriceSourceId ?? null, analysisCostStatistic: item.analysisCostStatistic ?? null, costScenarioMode: item.costScenarioMode, costScenarioDiscountPct: item.costScenarioDiscountPct };
  return { ...item, manualUnitCost: Math.max(0, reference * (1 - discountPct / 100)), manualCostAssumption: { base: "reference", discountPct, ...(previous ? { previous } : {}) }, selectedCostMode: "manual", analysisCostStatistic: null, costScenarioMode: null, costScenarioDiscountPct: null };
}

export function rememberOfferAdjustment(item: FinancialOfferItem, kind: "profit" | "ceiling", percent: number, previous: NonNullable<FinancialOfferItem["offerAdjustment"]>["previous"]): FinancialOfferItem["offerAdjustment"] {
  return { kind, percent: Number(percent.toFixed(8)), previous: item.offerAdjustment?.previous ?? previous };
}

export function adjustmentRemovalDetail(item: FinancialOfferItem, key: string): string {
  if (key.startsWith("adj:cost-ref:")) return item.manualCostAssumption?.previous ? "Restaura el costo anterior a la estimación." : "Esta estimación antigua no conserva el costo anterior. Al quitarla, se usará el costo investigado; si falta, quedará pendiente.";
  if (key.startsWith("adj:cost-lot:")) return "Quita el descuento y conserva el costo base.";
  return item.offerAdjustment ? "Restaura la oferta anterior al ajuste." : "Este ajuste antiguo no conserva la oferta anterior. Al quitarlo, la oferta volverá al techo; si falta, quedará pendiente.";
}

// The caller intersects the explicit scope with the selected chip before invoking this.
// Restore only the adjustment's fields; unrelated offers, notes and costs remain intact.
export function removeItemAdjustment(item: FinancialOfferItem, key: string): FinancialOfferItem {
  if (key.startsWith("adj:cost-ref:")) {
    const previous = item.manualCostAssumption?.previous;
    return { ...item, ...(previous ?? { manualUnitCost: null, selectedCostMode: "weighted" as const, analysisCostStatistic: null }), manualCostAssumption: null,
      ...(item.costScenarioMode === "lot" ? { costScenarioMode: item.costScenarioMode, costScenarioDiscountPct: item.costScenarioDiscountPct } : {}) };
  }
  if (key.startsWith("adj:cost-lot:")) return { ...item, costScenarioMode: null, costScenarioDiscountPct: null };
  if (key.startsWith("adj:offer-")) return { ...item, ...(item.offerAdjustment?.previous ?? { offerMode: "discount" as const, discountPct: 0, profitPct: null, manualOfferUnit: item.referenceUnit }), offerAdjustment: null };
  return item;
}
