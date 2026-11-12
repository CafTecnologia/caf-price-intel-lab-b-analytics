import type { FinancialOfferItem, FinancialOfferPriceSource } from "./contract";

export type PriceBaseItem = Pick<FinancialOfferItem,
  "id" | "item" | "description" | "technicalDescription" | "quantity" | "unit" |
  "deliverableType" | "referenceUnit" | "priceSources" | "costOptimistic" | "costModerate" |
  "costWeightedUnit" | "manualUnitCost" | "manualCostAssumption" | "selectedCostMode" | "selectedPriceSourceId" |
  "costScenarioMode" | "costScenarioDiscountPct" | "additionalCosts" |
  "analysisExcludedPriceSourceIds" | "analysisCostStatistic" | "analysisReferenceIncluded"
  | "notes"
> & {
  procurementLot?: FinancialOfferItem["procurementLot"];
  officialReferenceUnit?: number | null;
  sourceOriginal?: FinancialOfferItem["sourceOriginal"] | null;
  dataOrganization?: FinancialOfferItem["dataOrganization"];
  technicalAnnex?: FinancialOfferItem["technicalAnnex"] | null;
  costBasisStatus?: FinancialOfferItem["costBasisStatus"];
  manualCostReviewed?: boolean;
  additionalCostsReviewed?: boolean;
};
export type PriceBaseOfferSnapshot = Pick<FinancialOfferItem,
  "id" | "offerMode" | "discountPct" | "profitPct" | "manualOfferUnit" |
  "vatMode" | "vatRate" | "source1" | "source2" | "source3"
>;
export type PriceBasePatch = {
  id: string;
  item: string;
  referenceUnit?: number | null;
  expectedReferenceUnit?: number | null;
  priceSources?: FinancialOfferPriceSource[];
  expectedPriceSources?: FinancialOfferPriceSource[];
  notes?: string;
  expectedNotes?: string;
};

export class PriceBaseConflictError extends Error {
  constructor(item: string) {
    super(`Los precios del ítem ${item} cambiaron desde el estudio original.`);
    this.name = "PriceBaseConflictError";
  }
}

export function capturePriceBase(items: FinancialOfferItem[]): PriceBaseItem[] {
  return items.map(({ id, item, description, technicalDescription, procurementLot, sourceOriginal, dataOrganization, technicalAnnex,
    costBasisStatus, manualCostReviewed, additionalCostsReviewed, deliverableType, quantity, unit,
    referenceUnit, officialReferenceUnit, priceSources, costOptimistic, costModerate,
    costWeightedUnit, manualUnitCost, manualCostAssumption, selectedCostMode, selectedPriceSourceId,
    costScenarioMode, costScenarioDiscountPct, additionalCosts, analysisExcludedPriceSourceIds,
    analysisCostStatistic, analysisReferenceIncluded, notes }) => ({
    id, item, description, technicalDescription,
    ...(procurementLot !== undefined ? { procurementLot: structuredClone(procurementLot) } : {}),
    sourceOriginal: sourceOriginal ? structuredClone(sourceOriginal) : null,
    ...(dataOrganization ? {dataOrganization: structuredClone(dataOrganization)} : {}),
    technicalAnnex: technicalAnnex ? structuredClone(technicalAnnex) : null,
    costBasisStatus: costBasisStatus ?? null,
    manualCostReviewed: manualCostReviewed ?? false,
    additionalCostsReviewed: additionalCostsReviewed ?? false,
    deliverableType, quantity, unit,
    referenceUnit, ...(officialReferenceUnit != null ? { officialReferenceUnit } : {}), priceSources: structuredClone(priceSources),
    costOptimistic, costModerate, costWeightedUnit, manualUnitCost,
    manualCostAssumption: manualCostAssumption ? structuredClone(manualCostAssumption) : null,
    selectedCostMode, selectedPriceSourceId, costScenarioMode, costScenarioDiscountPct,
    analysisExcludedPriceSourceIds: structuredClone(analysisExcludedPriceSourceIds ?? []),
    analysisCostStatistic: analysisCostStatistic ?? null,
    analysisReferenceIncluded: analysisReferenceIncluded ?? true,
    additionalCosts: structuredClone(additionalCosts), notes,
  }));
}

export function capturePriceBaseOffers(items: FinancialOfferItem[]): PriceBaseOfferSnapshot[] {
  return items.map(({ id, offerMode, discountPct, profitPct, manualOfferUnit,
    vatMode, vatRate, source1, source2, source3 }) => ({
    id, offerMode, discountPct, profitPct, manualOfferUnit,
    vatMode, vatRate, source1, source2, source3,
  }));
}

export function applyPriceBasePatch(items: FinancialOfferItem[], patches: PriceBasePatch[]): FinancialOfferItem[] {
  if (!patches.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  if (byId.size !== items.length) throw new Error("El cálculo contiene identificadores de ítem repetidos.");
  const seen = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.id)) throw new Error(`El ítem ${patch.id} aparece dos veces en la revisión.`);
    seen.add(patch.id);
    const current = byId.get(patch.id);
    if (!current || current.item !== patch.item) throw new Error(`El ítem ${patch.item} ya no coincide con el cálculo.`);
    if (patch.referenceUnit === undefined && patch.priceSources === undefined && patch.notes === undefined) {
      throw new Error(`El ítem ${patch.item} no contiene cambios de precios.`);
    }
    if (patch.expectedReferenceUnit !== undefined &&
        current.referenceUnit !== patch.expectedReferenceUnit &&
        current.referenceUnit !== patch.referenceUnit) {
      throw new PriceBaseConflictError(patch.item);
    }
    if (patch.expectedPriceSources !== undefined &&
        JSON.stringify(current.priceSources) !== JSON.stringify(patch.expectedPriceSources) &&
        JSON.stringify(current.priceSources) !== JSON.stringify(patch.priceSources)) {
      throw new PriceBaseConflictError(patch.item);
    }
  }
  const patchesById = new Map(patches.map((patch) => [patch.id, patch]));
  return items.map((item) => {
    const patch = patchesById.get(item.id);
    if (!patch) return item;
    const priceSources = patch.priceSources === undefined ? item.priceSources : structuredClone(patch.priceSources);
    return {
      ...item,
      referenceUnit: patch.referenceUnit === undefined ? item.referenceUnit : patch.referenceUnit,
      priceSources,
      notes: patch.notes !== undefined && patch.expectedNotes === item.notes ? patch.notes : item.notes,
      selectedPriceSourceId: !item.selectedPriceSourceId || priceSources.some((source) => source.id === item.selectedPriceSourceId)
        ? item.selectedPriceSourceId : priceSources[0]?.id ?? null,
    };
  });
}

const COMPLETE_PRICE_BASE_KEYS = [
  "description", "technicalDescription", "quantity", "unit", "referenceUnit",
  "priceSources", "costOptimistic", "costModerate", "costWeightedUnit",
  "manualUnitCost", "selectedCostMode", "costScenarioMode",
  "costScenarioDiscountPct", "additionalCosts", "analysisExcludedPriceSourceIds",
  "analysisCostStatistic", "analysisReferenceIncluded", "notes",
] as const satisfies readonly (keyof PriceBaseItem)[];

function isCompletePriceBaseItem(item: PriceBaseItem): boolean {
  return COMPLETE_PRICE_BASE_KEYS.every((key) => Object.hasOwn(item, key))
    && typeof item.description === "string"
    && typeof item.technicalDescription === "string"
    && typeof item.unit === "string"
    && Array.isArray(item.priceSources)
    && Array.isArray(item.additionalCosts)
    && typeof item.notes === "string";
}

function restoredValue<K extends keyof PriceBaseItem>(
  original: PriceBaseItem,
  current: FinancialOfferItem,
  key: K,
): FinancialOfferItem[K] {
  return Object.hasOwn(original, key)
    ? original[key] as FinancialOfferItem[K]
    : current[key] as FinancialOfferItem[K];
}

export function restorePriceBase(
  items: FinancialOfferItem[],
  snapshot: PriceBaseItem[],
  retainedOffers: PriceBaseOfferSnapshot[] = [],
  defaultVatRate: number | null = null,
): FinancialOfferItem[] {
  const currentById = new Map(items.map((item) => [item.id, item]));
  if (currentById.size !== items.length) throw new Error("El cálculo contiene identificadores de ítem repetidos.");
  const byId = new Map(snapshot.map((entry) => [entry.id, entry]));
  if (byId.size !== snapshot.length) throw new Error("La versión de precios contiene ítems repetidos.");
  const offersById = new Map(retainedOffers.map((offer) => [offer.id, offer]));
  return snapshot.map((original) => {
    const current = currentById.get(original.id);
    if (!current && !isCompletePriceBaseItem(original)) {
      throw new Error(`La versión ${original.id} es heredada y no contiene la ficha completa necesaria para reinsertar la fila.`);
    }
    const offer = current ?? offersById.get(original.id);
    const shell: FinancialOfferItem = current ?? {
      ...original,
      sourceOriginal: original.sourceOriginal ?? undefined,
      technicalAnnex: original.technicalAnnex ?? undefined,
      deliverableType: original.deliverableType ?? null,
      offerMode: offer?.offerMode ?? null,
      discountPct: offer?.discountPct ?? null,
      profitPct: offer?.profitPct ?? null,
      manualOfferUnit: offer?.manualOfferUnit ?? null,
      vatMode: offer?.vatMode ?? "included",
      vatRate: offer?.vatRate ?? defaultVatRate,
      source1: offer?.source1 ?? "",
      source2: offer?.source2 ?? "",
      source3: offer?.source3 ?? "",
    };
    return {
      ...shell,
      item: original.item,
      description: restoredValue(original, shell, "description"),
      technicalDescription: restoredValue(original, shell, "technicalDescription"),
      procurementLot: Object.hasOwn(original, "procurementLot")
        ? structuredClone(original.procurementLot) : shell.procurementLot,
      sourceOriginal: Object.hasOwn(original, "sourceOriginal")
        ? structuredClone(original.sourceOriginal ?? undefined) : shell.sourceOriginal,
      ...(Object.hasOwn(original, "dataOrganization") ? {dataOrganization: structuredClone(original.dataOrganization)} : {}),
      technicalAnnex: Object.hasOwn(original, "technicalAnnex")
        ? structuredClone(original.technicalAnnex ?? undefined) : shell.technicalAnnex,
      costBasisStatus: restoredValue(original, shell, "costBasisStatus"),
      manualCostReviewed: restoredValue(original, shell, "manualCostReviewed"),
      additionalCostsReviewed: restoredValue(original, shell, "additionalCostsReviewed"),
      deliverableType: Object.hasOwn(original, "deliverableType")
        ? original.deliverableType ?? null
        : shell.deliverableType ?? null,
      quantity: restoredValue(original, shell, "quantity"),
      unit: restoredValue(original, shell, "unit"),
      referenceUnit: restoredValue(original, shell, "referenceUnit"),
      officialReferenceUnit: original.officialReferenceUnit ?? null,
      priceSources: structuredClone(restoredValue(original, shell, "priceSources")),
      costOptimistic: restoredValue(original, shell, "costOptimistic"),
      costModerate: restoredValue(original, shell, "costModerate"),
      costWeightedUnit: restoredValue(original, shell, "costWeightedUnit"),
      manualUnitCost: restoredValue(original, shell, "manualUnitCost"),
      manualCostAssumption: original.manualCostAssumption ? structuredClone(original.manualCostAssumption) : null,
      selectedCostMode: restoredValue(original, shell, "selectedCostMode"),
      selectedPriceSourceId: Object.hasOwn(original, "selectedPriceSourceId")
        ? original.selectedPriceSourceId : shell.selectedPriceSourceId,
      costScenarioMode: restoredValue(original, shell, "costScenarioMode"),
      costScenarioDiscountPct: restoredValue(original, shell, "costScenarioDiscountPct"),
      analysisExcludedPriceSourceIds: structuredClone(
        restoredValue(original, shell, "analysisExcludedPriceSourceIds") ?? [],
      ),
      analysisCostStatistic: restoredValue(original, shell, "analysisCostStatistic") ?? null,
      analysisReferenceIncluded: restoredValue(original, shell, "analysisReferenceIncluded") ?? true,
      additionalCosts: structuredClone(restoredValue(original, shell, "additionalCosts")),
      notes: restoredValue(original, shell, "notes"),
    };
  });
}

export function priceBaseRestoreImpact(current: FinancialOfferItem[], restored: PriceBaseItem[]) {
  const positive = (item: Pick<PriceBaseItem, "priceSources" | "manualUnitCost">) =>
    (item.priceSources ?? []).some((source) => (source.unitPrice ?? 0) > 0) || (item.manualUnitCost ?? 0) > 0;
  const byId = new Map(restored.map((item) => [item.id, item]));
  return {
    lostPricedItemIds: current.filter((item) => positive(item) && (!byId.has(item.id) || !positive(byId.get(item.id)!))).map((item) => item.id),
    removedItemIds: current.filter((item) => !byId.has(item.id)).map((item) => item.id),
    pricedItems: restored.filter(positive).length,
  };
}
