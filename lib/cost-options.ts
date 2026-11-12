import type { CostMode, FinancialOfferItem, FinancialOfferProject } from "./contract";
import { buildCostBreakdown } from "./financial-engine";

export type CostOption = { mode: CostMode; label: string; sourceId?: string };
export function costOptions(item: FinancialOfferItem, settings: FinancialOfferProject["settings"]): CostOption[] {
  const breakdown = buildCostBreakdown(item, settings);
  const sources = breakdown.sources.filter(source => source.normalizedUnit !== null);
  const values = [breakdown.minimum, breakdown.average, breakdown.moderate].filter((value): value is number => value !== null);
  const unique = sources.length === 1 || (sources.length === 0 && values.length > 0 && new Set(values).size === 1);
  const options: CostOption[] = unique
    ? [{ mode: item.selectedCostMode !== "manual" && item.selectedCostMode !== "source" ? item.selectedCostMode : sources.length ? "source" : "weighted", label: "Costo único", ...(sources.length ? { sourceId: sources[0]!.id } : {}) }]
    : ([{ mode: "weighted", label: "Moderado", value: breakdown.moderate }, { mode: "moderate", label: "Promedio", value: breakdown.average }, { mode: "optimistic", label: "Mínimo", value: breakdown.minimum }] as const).filter(option => option.value !== null).map(({ mode, label }) => ({ mode, label }));
  if (item.manualUnitCost !== null) options.push({ mode: "manual", label: item.manualCostAssumption ? "Manual · supuesto" : "Manual" });
  if (!unique && sources.length) options.push({ mode: "source", label: "Cotización elegida" });
  return options;
}

export function costModePatch(item: FinancialOfferItem, settings: FinancialOfferProject["settings"], mode: CostMode | "unique"): Partial<FinancialOfferItem> | null {
  const options = costOptions(item, settings);
  const option = mode === "unique" ? options.find(option => option.label === "Costo único")
    : options.find(option => option.mode === mode) ?? (mode !== "manual" && mode !== "source" ? options.find(option => option.label === "Costo único") : undefined);
  if (!option) return null;
  if (option.mode === "source" && !option.sourceId && !item.priceSources.some(source => source.id === item.selectedPriceSourceId)) return null;
  return { selectedCostMode: option.mode, analysisCostStatistic: null, ...(option.sourceId ? { selectedPriceSourceId: option.sourceId } : {}) };
}
