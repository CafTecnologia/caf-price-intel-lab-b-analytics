import type { CostMode, FinancialItemAdditionalCost, FinancialOfferItem, FinancialOfferPriceSource, FinancialOfferProject, VatMode, WithholdingBase } from "./contract";

export type OfferMode = "discount" | "profit" | "manual";
export type OfferStatus = "viable" | "tight" | "over_ceiling" | "loss" | "no_ceiling" | "incomplete";

export type OfferControl = {
  mode: OfferMode;
  discountPct: number;
  profitPct: number;
  manualOfferUnit: number | null;
};

export type OfferControlContext = {
  costUnit: number | null;
  referenceUnit: number | null;
  offerUnit: number | null;
};

export type SimulationInputItem = FinancialOfferItem & {
  selectedCostMode: CostMode;
  manualUnitCost: number | null;
};

type CostCalculationSettings = Pick<FinancialOfferProject["settings"], "manualCostPriority" | "usdToCopRate" | "usdImportPct">;

export type CostSelection = {
  costUnit: number | null;
  modeUsed: CostMode | "manual_priority" | "analysis_statistic";
  label: string;
  warnings: string[];
};

export type NormalizedPriceSource = FinancialOfferPriceSource & {
  normalizedUnit: number | null;
  appliedTrm: number | null;
  appliedImportPct: number | null;
  warning: string | null;
};

export type CostBreakdown = {
  sources: NormalizedPriceSource[];
  minimum: number | null;
  average: number | null;
  median: number | null;
  moderate: number | null;
  sourceCount: number;
  warnings: string[];
};

export type SimulationRow = {
  includedInOffer?: boolean;
  rowKey: string;
  item: string;
  description: string;
  technicalDescription: string;
  quantity: number | null;
  quantityAssumed: boolean;
  unit: string;
  baseCostUnit: number | null;
  productCostTotal: number | null;
  additionalUnitCost: number;
  additionalFixedCost: number;
  additionalCostTotal: number | null;
  costUnit: number | null;
  costScenarioDiscountPct: number | null;
  costScenarioMode: "unit" | "lot" | null;
  selectedCostMode: CostMode;
  costModeUsed: CostMode | "manual_priority" | "analysis_statistic";
  costSourceLabel: string;
  costBreakdown: CostBreakdown;
  referenceUnit: number | null;
  referenceTotal: number | null;
  costTotal: number | null;
  offerUnit: number | null;
  offerTotal: number | null;
  marginUnit: number | null;
  utilityValue: number | null;
  marginPctOnCost: number | null;
  maxProfitPctBeforeCeiling: number | null;
  offerVsReferencePct: number | null;
  discountPctVsReference: number | null;
  status: OfferStatus;
  warnings: string[];
  sourceNotes: string;
  control: OfferControl;
  costBasisStatus: FinancialOfferItem["costBasisStatus"];
  vatMode: VatMode;
  vatRatePct: number;
  isFinanciallyEvaluable: boolean;
  knownCostTotal: number | null;
  hasPendingAssociatedCosts: boolean;
  hasSuggestedAssociatedCosts: boolean;
  associatedCostCount?: number;
};

export type SimulationSummaryScope = {
  isComplete: boolean;
  itemCount: number;
  evaluableCount: number;
  totalReference: number | null;
  totalCost: number | null;
  totalOffer: number | null;
  totalMargin: number | null;
  itemCostTotal: number | null;
  generalCostsTotal: number;
  marginPctOnCost: number | null;
  offerVsReferencePct: number | null;
  discountPctVsReference: number | null;
};

export type SimulationSummary = {
  itemCount: number;
  total: SimulationSummaryScope;
  partial: SimulationSummaryScope;
  referenceKnownTotal: number | null;
  referenceKnownCount: number;
  knownCostTotal: number | null;
  knownCostCount: number;
  knownOfferTotal: number | null;
  knownOfferCount: number;
  costIsComplete: boolean;
  missingAssociatedCostCount: number;
  referenceIsComplete: boolean;
  manualReferenceTotal: number | null;
  nonFinalCostBasisCount: number;
  missingQuantityCount: number;
  assumedQuantityCount: number;
  missingCostCount: number;
  missingReferenceCount: number;
  missingOfferCount: number;
  overCeilingCount: number;
  lossCount: number;
  incompleteCount: number;
  totalReference: number;
  totalCost: number;
  totalOffer: number;
  totalMargin: number;
  marginPctOnCost: number | null;
  offerVsReferencePct: number | null;
  discountPctVsReference: number | null;
};

export type SimulationResult = {
  rows: SimulationRow[];
  summary: SimulationSummary;
};

export type VatControl = {
  mode: VatMode;
  ratePct: number;
};

export type OfferPresentationRow = {
  rowKey: string;
  item: string;
  description: string;
  technicalDescription: string;
  quantity: number | null;
  unit: string;
  unitPriceWithoutVat: number | null;
  vatRatePct: number;
  vatMode: VatMode;
  vatUnitValue: number | null;
  unitPriceWithVat: number | null;
  totalWithoutVat: number | null;
  totalVatValue: number | null;
  totalWithVat: number | null;
  referenceUnit: number | null;
  referenceTotal: number | null;
  costUnit: number | null;
  costTotal: number | null;
  utilityValue: number | null;
  marginPctOnCost: number | null;
  differenceVsReferenceTotal: number | null;
  status: "within_ceiling" | "above_ceiling" | "no_ceiling";
  warnings: string[];
};

export type OfferPresentation = {
  rows: OfferPresentationRow[];
  summary: {
    totalProjectCost: number;
    itemCostTotal: number;
    itemAdditionalCostsTotal: number;
    generalCostsTotal: number;
    totalOfferWithoutVat: number;
    totalVat: number;
    totalOfferWithVat: number;
    estimatedUtility: number | null;
    isComplete: boolean;
    reteFuente: number;
    reteIva: number;
    reteIca: number;
    stampTax: number;
    totalDeductions: number;
    expectedNetCollection: number;
    estimatedNetUtility: number | null;
    rowsAboveCeiling: number;
  };
};

type SettlementSettings = Pick<
  FinancialOfferProject["settings"],
  | "applyReteFuente"
  | "reteFuenteRate"
  | "reteFuenteBase"
  | "applyReteIva"
  | "reteIvaRate"
  | "reteIvaBase"
  | "applyReteIca"
  | "reteIcaRate"
  | "reteIcaBase"
  | "stampTaxRate"
>;

export function formatCop(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `$ ${formatNumber(value)}`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  const fixed = value.toFixed(decimals);
  const [integerPart = "0", decimalPart = ""] = fixed.split(".");
  const sign = integerPart.startsWith("-") ? "-" : "";
  const normalizedInteger = sign ? integerPart.slice(1) : integerPart;
  const grouped = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimals > 0 ? `${sign}${grouped},${decimalPart}` : `${sign}${grouped}`;
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `${formatNumber(value, decimals)} %`;
}

function vatRateFor(mode: VatMode, ratePct: number | null | undefined): number {
  if (mode === "exempt") return 0;
  return Math.max(0, ratePct ?? 19);
}

function grossFromInput(value: number | null, mode: VatMode, ratePct: number): number | null {
  if (value === null) return null;
  if (mode === "excluded") return value * (1 + ratePct / 100);
  return value;
}

function decomposeGross(value: number | null, mode: VatMode, ratePct: number): { gross: number | null; net: number | null; vat: number | null } {
  if (value === null) {
    return { gross: null, net: null, vat: null };
  }
  if (mode === "exempt" || ratePct <= 0) {
    return { gross: value, net: value, vat: 0 };
  }
  const net = value / (1 + ratePct / 100);
  return { gross: value, net, vat: value - net };
}

function presentationRoundStep(value: number): number {
  return Math.abs(value) < 1000 ? 1 : 10;
}

function roundMoneyDownForOffer(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const step = presentationRoundStep(value);
  return Math.floor(value / step) * step;
}

function isOfferOverReference(offerUnit: number | null, referenceUnit: number | null): boolean {
  if (offerUnit === null || referenceUnit === null) return false;
  return offerUnit - referenceUnit > 0.000001;
}

function applyCostScenario(
  costUnit: number | null,
  discountPct: number | null,
): number | null {
  if (costUnit === null || discountPct === null || !Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) return costUnit;
  return Math.max(0, costUnit * (1 - discountPct / 100));
}

function buildRoundedOfferValues(input: {
  grossUnit: number | null;
  referenceGrossUnit: number | null;
  quantity: number | null;
  vatMode: VatMode;
  vatRatePct: number;
}): {
  unitNet: number | null;
  unitVat: number | null;
  unitGross: number | null;
  totalNet: number | null;
  totalVat: number | null;
  totalGross: number | null;
} {
  const rawOffer = decomposeGross(input.grossUnit, input.vatMode, input.vatRatePct);
  const rawReference = decomposeGross(input.referenceGrossUnit, input.vatMode, input.vatRatePct);
  const ceilingGuardApplies =
    input.grossUnit !== null &&
    input.referenceGrossUnit !== null &&
    input.grossUnit <= input.referenceGrossUnit &&
    rawReference.net !== null;
  const maxNet = ceilingGuardApplies ? roundMoneyDownForOffer(rawReference.net) : null;
  const roundedNet = roundMoneyDownForOffer(rawOffer.net);
  const unitNet = roundedNet !== null && maxNet !== null ? Math.min(roundedNet, maxNet) : roundedNet;
  const unitVat = unitNet !== null ? Math.floor(unitNet * (input.vatRatePct / 100)) : null;
  const unitGross = unitNet !== null && unitVat !== null ? unitNet + unitVat : null;
  const totalNet = input.quantity !== null && unitNet !== null ? unitNet * input.quantity : null;
  const totalVat = input.quantity !== null && unitVat !== null ? unitVat * input.quantity : null;
  const totalGross = input.quantity !== null && unitGross !== null ? unitGross * input.quantity : null;

  return { unitNet, unitVat, unitGross, totalNet, totalVat, totalGross };
}

function resolveCostSettings(context: Partial<CostCalculationSettings> | boolean = false): CostCalculationSettings {
  if (typeof context === "boolean") {
    return { manualCostPriority: context, usdToCopRate: null, usdImportPct: 30 };
  }
  return {
    manualCostPriority: context.manualCostPriority ?? false,
    usdToCopRate: context.usdToCopRate ?? null,
    usdImportPct: context.usdImportPct ?? 30,
  };
}

function isPendingCostPlaceholder(source: FinancialOfferPriceSource, itemNotes = ""): boolean {
  return source.unitPrice === 0 && /\bPENDIENTE_COSTO\b/i.test(`${source.label} ${source.notes} ${itemNotes}`);
}

export function normalizeSourcePrice(source: FinancialOfferPriceSource, settings: CostCalculationSettings, itemNotes = ""): NormalizedPriceSource {
  const importPct = source.importPct ?? settings.usdImportPct;
  // CAF uses zero plus this explicit marker for an unknown cost, not a free item.
  if (isPendingCostPlaceholder(source, itemNotes)) {
    return { ...source, normalizedUnit: null, appliedTrm: null, appliedImportPct: null, warning: `${source.label}: costo pendiente de valorar.` };
  }
  if (source.unitPrice === null) {
    return { ...source, normalizedUnit: null, appliedTrm: null, appliedImportPct: null, warning: `${source.label}: precio no disponible.` };
  }
  if (source.currency === "COP") {
    return { ...source, normalizedUnit: source.unitPrice, appliedTrm: null, appliedImportPct: null, warning: null };
  }

  const trm = source.trm ?? settings.usdToCopRate;
  if (!trm || trm <= 0) {
    return { ...source, normalizedUnit: null, appliedTrm: null, appliedImportPct: importPct, warning: `${source.label}: precio USD sin TRM para normalizar.` };
  }

  return {
    ...source,
    normalizedUnit: source.unitPrice * trm * (1 + importPct / 100),
    appliedTrm: trm,
    appliedImportPct: importPct,
    warning: null,
  };
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export function buildCostBreakdown(item: SimulationInputItem, context: Partial<CostCalculationSettings> | boolean = false): CostBreakdown {
  const settings = resolveCostSettings(context);
  const excluded = new Set(item.analysisExcludedPriceSourceIds ?? []);
  const normalizedSources = (item.priceSources ?? [])
    .filter((source) => !excluded.has(source.id))
    .map((source) => normalizeSourcePrice(source, settings, item.notes));
  const validValues = normalizedSources
    .map((source) => source.normalizedUnit)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);

  if (validValues.length) {
    const minimum = Math.min(...validValues);
    const averageValue = average(validValues);
    const medianValue = median(validValues);
    const moderate = averageValue === null ? null : (minimum + averageValue) / 2;
    return {
      sources: normalizedSources,
      minimum,
      average: averageValue,
      median: medianValue,
      moderate,
      sourceCount: validValues.length,
      warnings: normalizedSources.map((source) => source.warning).filter((warning): warning is string => Boolean(warning)),
    };
  }

  const hasExplicitSourceBasis = excluded.size > 0 || Boolean(item.analysisCostStatistic);
  if (hasExplicitSourceBasis) {
    const warnings = normalizedSources.map((source) => source.warning).filter((warning): warning is string => Boolean(warning));
    if (!normalizedSources.length && (item.priceSources ?? []).length > 0) {
      warnings.push("No hay fuentes de precio incluidas para calcular el costo.");
    }
    return {
      sources: normalizedSources,
      minimum: null,
      average: null,
      median: null,
      moderate: null,
      sourceCount: 0,
      warnings,
    };
  }

  const hasPendingCost = (item.priceSources ?? []).some((source) => isPendingCostPlaceholder(source, item.notes));
  const legacyCost = (value: number | null): number | null => hasPendingCost && value === 0 ? null : value;
  const optimistic = legacyCost(item.costOptimistic);
  const moderate = legacyCost(item.costModerate);
  const weighted = legacyCost(item.costWeightedUnit);
  const legacyValues = [optimistic, moderate, weighted].filter(
    (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
  );
  const legacyMinimum = optimistic ?? (legacyValues.length ? Math.min(...legacyValues) : null);
  const legacyAverage = moderate ?? average(legacyValues);
  const legacyModerate = weighted ?? (legacyMinimum !== null && legacyAverage !== null ? (legacyMinimum + legacyAverage) / 2 : null);

  return {
    sources: normalizedSources,
    minimum: legacyMinimum,
    average: legacyAverage,
    median: median(legacyValues),
    moderate: legacyModerate,
    sourceCount: 0,
    warnings: normalizedSources.map((source) => source.warning).filter((warning): warning is string => Boolean(warning)),
  };
}

export function selectedCostSource(item: SimulationInputItem, context: Partial<CostCalculationSettings> | boolean = false): CostSelection {
  const settings = resolveCostSettings(context);
  const breakdown = buildCostBreakdown(item, settings);
  const uniqueCost = breakdown.sourceCount === 1 || (breakdown.sourceCount === 0 && breakdown.minimum !== null && breakdown.minimum === breakdown.average && breakdown.average === breakdown.moderate);

  if (item.analysisCostStatistic) {
    const costUnit = breakdown[item.analysisCostStatistic];
    const names = { minimum: "mínimo", average: "promedio", median: "mediana", moderate: "moderado" } as const;
    return {
      costUnit,
      modeUsed: "analysis_statistic",
      label: uniqueCost ? "Costo único" : `Criterio aceptado: ${names[item.analysisCostStatistic]}`,
      warnings: [...breakdown.warnings, ...(costUnit === null ? [`No hay costo ${names[item.analysisCostStatistic]} disponible.`] : [])],
    };
  }

  if (settings.manualCostPriority && item.manualUnitCost !== null) {
    return { costUnit: item.manualUnitCost, modeUsed: "manual_priority", label: "Costo manual priorizado", warnings: breakdown.warnings };
  }

  const pendingAutomaticBasis =
    item.costBasisStatus === "pending" &&
    item.selectedCostMode !== "manual" &&
    item.selectedCostMode !== "source";
  if (pendingAutomaticBasis) {
    return {
      costUnit: null,
      modeUsed: item.selectedCostMode,
      label: "Costo pendiente de confirmar",
      warnings: [...breakdown.warnings, "El costo pendiente de IA no se usa hasta elegir una cotización o registrar un costo manual."],
    };
  }

  if (item.selectedCostMode === "source") {
    const source = breakdown.sources.find((candidate) => candidate.id === item.selectedPriceSourceId);
    const costUnit = source?.normalizedUnit ?? null;
    return {
      costUnit,
      modeUsed: "source",
      label: costUnit !== null ? (uniqueCost ? "Costo único" : `Cotización: ${source!.label}`) : "Cotización por elegir",
      warnings: costUnit !== null ? breakdown.warnings : [...breakdown.warnings, "Elige una cotización con precio válido para calcular este ítem."],
    };
  }

  if (item.selectedCostMode === "optimistic") {
    return {
      costUnit: breakdown.minimum,
      modeUsed: "optimistic",
      label: uniqueCost ? "Costo único" : "Costo minimo",
      warnings: [...breakdown.warnings, ...(breakdown.minimum === null ? ["No hay costo minimo disponible."] : [])],
    };
  }
  if (item.selectedCostMode === "moderate") {
    return {
      costUnit: breakdown.average,
      modeUsed: "moderate",
      label: uniqueCost ? "Costo único" : "Costo promedio",
      warnings: [...breakdown.warnings, ...(breakdown.average === null ? ["No hay costo promedio disponible."] : [])],
    };
  }
  if (item.selectedCostMode === "manual") {
    return {
      costUnit: item.manualUnitCost,
      modeUsed: "manual",
      label: item.manualCostAssumption ? "Manual · supuesto desde techo" : "Costo manual",
      warnings: [...breakdown.warnings, ...(item.manualUnitCost === null ? ["Seleccionaste costo manual, pero no hay valor manual."] : [])],
    };
  }

  return {
    costUnit: breakdown.moderate,
    modeUsed: "weighted",
    label: uniqueCost ? "Costo único" : "Costo moderado",
    warnings: [...breakdown.warnings, ...(breakdown.moderate === null ? ["No hay costo moderado disponible."] : [])],
  };
}

export function selectedCostUnit(item: SimulationInputItem, context: Partial<CostCalculationSettings> | boolean = false): number | null {
  return selectedCostSource(item, context).costUnit;
}

export type QuoteLink = { label: string; href: string; isBasis: boolean };

function quoteHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

export function selectedQuoteLinks(row: SimulationRow, item: FinancialOfferItem): QuoteLink[] {
  const sources = row.costBreakdown.sources;
  const linked = sources.flatMap((source) => {
    const href = quoteHref(source.url ?? "");
    return href ? [{ source, href }] : [];
  });
  if (!linked.length) return [];

  const basisIds = new Set<string>();
  if (row.costModeUsed === "source") {
    const selected = sources.find((source) => source.id === item.selectedPriceSourceId);
    if (selected && selected.normalizedUnit !== null) basisIds.add(selected.id);
  } else if (row.costModeUsed === "optimistic") {
    sources.filter((source) => source.normalizedUnit !== null && source.normalizedUnit === row.costBreakdown.minimum)
      .forEach((source) => basisIds.add(source.id));
  } else if (row.costModeUsed === "moderate" || row.costModeUsed === "weighted") {
    sources.filter((source) => source.normalizedUnit !== null).forEach((source) => basisIds.add(source.id));
  }

  const relevant = linked.filter(({ source }) => basisIds.has(source.id));
  return (relevant.length ? relevant : linked).map(({ source, href }) => ({
    label: source.label || "Fuente sin nombre",
    href,
    isBasis: basisIds.has(source.id),
  }));
}

function maxSafeProfitPct(costUnit: number | null, referenceUnit: number | null): number | null {
  if (costUnit === null || costUnit <= 0 || referenceUnit === null || referenceUnit <= 0) return null;
  return Math.max(0, (referenceUnit / costUnit - 1) * 100);
}

export function buildInitialOfferControls(project: Pick<FinancialOfferProject, "items" | "settings"> & Partial<Pick<FinancialOfferProject, "sourceSystem" | "iaRunId">>): Record<string, OfferControl> {
  return Object.fromEntries(
    project.items.map((item, index) => {
      const rowKey = buildRowKey(item, index);
      const vatRate = vatRateFor(item.vatMode, item.vatRate ?? project.settings.vatRate);
      const rawCostUnit = selectedCostUnit(item, project.settings);
      const costUnit = grossFromInput(rawCostUnit, item.vatMode, vatRate);
      const referenceUnit = project.settings.analysisReferenceIncluded === false || item.analysisReferenceIncluded === false
        ? null : grossFromInput(item.referenceUnit, item.vatMode, vatRate);
      const defaultDiscountPct = 0;
      const defaultProfitPct = maxSafeProfitPct(costUnit, referenceUnit) ?? project.settings.defaultMargin;
      const isAiStudy = Boolean(project.iaRunId) || project.sourceSystem === "odoo_caf";
      return [
        rowKey,
        {
          mode: item.offerMode ?? (referenceUnit !== null || isAiStudy ? "discount" : "profit"),
          discountPct: item.discountPct ?? defaultDiscountPct,
          profitPct: item.profitPct ?? defaultProfitPct,
          // An AI study's supplier cost is never an initial offer without a ceiling.
          manualOfferUnit: item.manualOfferUnit ?? referenceUnit ?? (isAiStudy ? null : costUnit ? costUnit * (1 + project.settings.defaultMargin / 100) : null),
        },
      ];
    }),
  );
}

export function buildRowKey(item: FinancialOfferItem, index: number): string {
  return `${item.item || "item"}-${index}`;
}

function calculateOfferUnit(control: OfferControl, costUnit: number | null, referenceUnit: number | null): number | null {
  // Despite the historical field name, manualOfferUnit is the persisted
  // current offer value. Modes derive percentages from this value instead of
  // letting cost changes move the offer.
  if (control.manualOfferUnit !== null) {
    return control.manualOfferUnit;
  }
  if (control.mode === "discount") {
    return referenceUnit === null ? null : referenceUnit * (1 - control.discountPct / 100);
  }
  if (control.mode === "profit") {
    return costUnit === null ? null : costUnit * (1 + control.profitPct / 100);
  }
  return control.manualOfferUnit;
}

function equivalentDiscountPct(referenceUnit: number | null, offerUnit: number | null): number | null {
  if (referenceUnit === null || referenceUnit === 0 || offerUnit === null) return null;
  return 100 - (offerUnit / referenceUnit) * 100;
}

function equivalentProfitPct(costUnit: number | null, offerUnit: number | null): number | null {
  if (costUnit === null || costUnit === 0 || offerUnit === null) return null;
  return (offerUnit / costUnit - 1) * 100;
}

// Set the persisted offer as well as its percentage: manualOfferUnit has priority.
export function offerControlWithDiscountPct(current: OfferControl, discountPct: number, context: OfferControlContext): OfferControl | null {
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100 || context.referenceUnit === null || context.referenceUnit < 0) return null;
  const offerUnit = context.referenceUnit * (1 - discountPct / 100);
  return { mode: "discount", discountPct, profitPct: equivalentProfitPct(context.costUnit, offerUnit) ?? current.profitPct, manualOfferUnit: offerUnit };
}

export function offerControlWithProfitPct(
  current: OfferControl,
  profitPct: number,
  context: OfferControlContext,
): OfferControl | null {
  if (!Number.isFinite(profitPct) || profitPct < 0 || context.costUnit === null || context.costUnit < 0) return null;
  const offerUnit = context.costUnit * (1 + profitPct / 100);
  const discountPct = equivalentDiscountPct(context.referenceUnit, offerUnit);
  return {
    mode: "profit",
    discountPct: discountPct ?? current.discountPct,
    profitPct,
    manualOfferUnit: offerUnit,
  };
}

function effectiveQuantityForTotals(quantity: number | null, unitValues: Array<number | null>): number | null {
  if (quantity === null) return unitValues.some((value) => value !== null) ? 1 : null;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function isBlankItemForObservations(item: FinancialOfferItem): boolean {
  const hasText = [item.technicalDescription, item.notes, item.source1, item.source2, item.source3].some((value) => value.trim().length > 0);
  const hasDescription = item.description.trim().length > 0 && !/^item manual\s+\d+$/i.test(item.description.trim());
  const hasSpecificUnit = item.unit.trim().length > 0 && !/^(und|un)$/i.test(item.unit.trim());
  const hasValue = [
    item.quantity,
    item.referenceUnit,
    item.costOptimistic,
    item.costModerate,
    item.costWeightedUnit,
    item.manualUnitCost,
    item.manualOfferUnit,
    item.costScenarioDiscountPct,
  ].some((value) => value !== null);
  const hasSource = item.priceSources.some(
    (source) =>
      source.unitPrice !== null ||
      source.url.trim().length > 0 ||
      source.notes.trim().length > 0 ||
      (source.label.trim().length > 0 && !/^fuente\s+\d+$/i.test(source.label.trim())),
  );

  return !hasDescription && !hasText && !hasSpecificUnit && !hasValue && !hasSource;
}

export function convertOfferControlMode(current: OfferControl, nextMode: OfferMode, context: OfferControlContext): OfferControl {
  const offerUnit = context.offerUnit ?? context.referenceUnit ?? context.costUnit ?? current.manualOfferUnit;
  const discountPct = equivalentDiscountPct(context.referenceUnit, offerUnit);
  const profitPct = equivalentProfitPct(context.costUnit, offerUnit);

  return {
    mode: nextMode,
    discountPct: discountPct ?? current.discountPct,
    profitPct: profitPct ?? current.profitPct,
    manualOfferUnit: offerUnit,
  };
}

function warningsFor(input: {
  quantity: number | null;
  costUnit: number | null;
  referenceUnit: number | null;
  offerUnit: number | null;
  marginPctOnCost: number | null;
  costWarnings: string[];
  isBlankItem: boolean;
}): string[] {
  if (input.isBlankItem) return [];

  const uniqueCostWarnings = [...new Set(input.costWarnings)];
  const sourceWarnings = uniqueCostWarnings.filter((warning) => /usd|trm|importaci.n|fuente/i.test(warning));
  const costWarnings = uniqueCostWarnings.filter((warning) => !sourceWarnings.includes(warning));
  const warnings: string[] = [...sourceWarnings];
  const isEmptyFinancialRow =
    input.quantity === null &&
    input.costUnit === null &&
    input.referenceUnit === null &&
    input.offerUnit === null;

  // A blank row produces several missing-value symptoms. Surface one root cause
  // instead, while keeping independent source-normalization issues visible.
  if (isEmptyFinancialRow) {
    warnings.push("Item incompleto: faltan datos base y costo.");
    return [...new Set(warnings)];
  }

  if (input.quantity === null) warnings.push("Falta cantidad.");
  if (input.costUnit === null) {
    const rootCostWarning = costWarnings.find((warning) => /costo manual|no hay costo|elige una cotizaci.n/i.test(warning));
    warnings.push(rootCostWarning ?? "Falta costo unitario.");
  }
  if (input.referenceUnit === null) warnings.push("Falta precio techo.");
  // The offer is derived from the cost. Do not add an extra symptom when its
  // only cause is a missing cost.
  if (input.offerUnit === null && input.costUnit !== null) warnings.push("Falta oferta unitaria.");
  if (isOfferOverReference(input.offerUnit, input.referenceUnit)) {
    warnings.push("La oferta supera el precio techo.");
  }
  if (input.offerUnit !== null && input.costUnit !== null && input.offerUnit < input.costUnit) {
    warnings.push("La oferta queda por debajo del costo.");
  }
  if (input.marginPctOnCost !== null && input.marginPctOnCost >= 0 && input.marginPctOnCost < 10) {
    warnings.push("Margen bajo frente al costo.");
  }
  return [...new Set(warnings)];
}

function statusFor(input: {
  quantity: number | null;
  costUnit: number | null;
  referenceUnit: number | null;
  offerUnit: number | null;
  marginPctOnCost: number | null;
}): OfferStatus {
  if (input.quantity === null || input.costUnit === null || input.offerUnit === null) {
    return "incomplete";
  }
  if (isOfferOverReference(input.offerUnit, input.referenceUnit)) return "over_ceiling";
  if (input.offerUnit < input.costUnit) return "loss";
  if (input.referenceUnit === null) return "no_ceiling";
  if (input.marginPctOnCost !== null && input.marginPctOnCost < 10) return "tight";
  return "viable";
}

export function provisionalUtilityForRow(row: SimulationRow): number | null {
  if (row.utilityValue !== null || !row.hasPendingAssociatedCosts || row.quantity === null || row.quantity <= 0 ||
      row.baseCostUnit === null || row.offerTotal === null || row.knownCostTotal === null) return null;
  return row.offerTotal - row.knownCostTotal;
}

// El editor manual modifica solo el producto. El total de la fila ya incluye
// servicios y no puede usarse como valor inicial del costo base.
export function manualBaseCostInputForRow(row: SimulationRow): number | null {
  if (row.baseCostUnit === null) return null;
  return row.vatMode === "excluded" ? row.baseCostUnit / (1 + row.vatRatePct / 100) : row.baseCostUnit;
}

export function associatedCostNeedsReview(cost: FinancialItemAdditionalCost): boolean {
  if (cost.amount === null) return true;
  // Algunas corridas de IA usaron COP 0/COP 1 como marcador y anotaron que el
  // costo seguía sin cotizar. No sumar esos importes como si fueran reales.
  return cost.amount <= 1 && /por confirmar|sin valorar|no valorado|por cotizar|seg[uú]n ciudad|pendiente|por definir/i.test(cost.notes);
}

export function buildSimulation(project: FinancialOfferProject, controls: Record<string, OfferControl>): SimulationResult {
  const rows = project.items.map((item, index): SimulationRow => {
    const rowKey = buildRowKey(item, index);
    const control = controls[rowKey] ?? buildInitialOfferControls(project)[rowKey]!;
    const vatRate = vatRateFor(item.vatMode, item.vatRate ?? project.settings.vatRate);
    const costBreakdown = buildCostBreakdown(item, project.settings);
    const costSelection = selectedCostSource(item, project.settings);
    const baseCostUnit = grossFromInput(costSelection.costUnit, item.vatMode, vatRate);
    const adjustedProductCostUnit = applyCostScenario(baseCostUnit, item.costScenarioDiscountPct);
    const includedAdditionalCosts = (item.additionalCosts ?? []).filter((cost) => (cost.reviewStatus ?? "included") === "included");
    const suggestedCostCount = (item.additionalCosts ?? []).filter((cost) => cost.reviewStatus === "suggested").length;
    const valuedAdditionalCosts = includedAdditionalCosts.filter((cost) => !associatedCostNeedsReview(cost));
    const additionalUnitCost = sum(valuedAdditionalCosts.filter((cost) => cost.mode === "per_unit").map((cost) => cost.amount));
    const additionalFixedCost = sum(valuedAdditionalCosts.filter((cost) => cost.mode === "fixed").map((cost) => cost.amount));
    const referenceUnit = project.settings.analysisReferenceIncluded === false || item.analysisReferenceIncluded === false
      ? null : grossFromInput(item.referenceUnit, item.vatMode, vatRate);
    const quantityForCost = effectiveQuantityForTotals(item.quantity, [adjustedProductCostUnit, referenceUnit, control.manualOfferUnit]);
    const productCostTotal = quantityForCost !== null && adjustedProductCostUnit !== null ? quantityForCost * adjustedProductCostUnit : null;
    const additionalCostTotal = quantityForCost !== null ? quantityForCost * additionalUnitCost + additionalFixedCost : null;
    const costTotal = productCostTotal !== null && additionalCostTotal !== null ? productCostTotal + additionalCostTotal : null;
    const costUnit = quantityForCost !== null && quantityForCost > 0 && costTotal !== null ? costTotal / quantityForCost : adjustedProductCostUnit;
    const hasPendingAssociatedCosts = includedAdditionalCosts.some(associatedCostNeedsReview);
    const knownAdditionalTotal = (quantityForCost === null ? 0 : quantityForCost * additionalUnitCost) + additionalFixedCost;
    const hasKnownAdditionalCost = valuedAdditionalCosts.some((cost) => cost.amount !== null && (cost.mode === "fixed" || quantityForCost !== null));
    const knownCostTotal = productCostTotal !== null || hasKnownAdditionalCost
      ? (productCostTotal ?? 0) + knownAdditionalTotal : null;
    const offerUnit = calculateOfferUnit(control, costUnit, referenceUnit);
    const quantity = effectiveQuantityForTotals(item.quantity, [costUnit, referenceUnit, offerUnit]);
    const quantityAssumed = item.quantity === null && quantity !== null;
    const referenceTotal = quantity !== null && referenceUnit !== null ? quantity * referenceUnit : null;
    const offerTotal = quantity !== null && offerUnit !== null ? quantity * offerUnit : null;
    const marginUnit = offerUnit !== null && costUnit !== null ? offerUnit - costUnit : null;
    const utilityValue = offerTotal !== null && costTotal !== null ? offerTotal - costTotal : null;
    const marginPctOnCost = marginUnit !== null && costUnit ? (marginUnit / costUnit) * 100 : null;
    const maxProfitPctBeforeCeiling = referenceUnit !== null && costUnit ? (referenceUnit / costUnit - 1) * 100 : null;
    const offerVsReferencePct = offerUnit !== null && referenceUnit ? (offerUnit / referenceUnit) * 100 : null;
    const discountPctVsReference = offerVsReferencePct !== null ? 100 - offerVsReferencePct : null;
    const hasUnitValue = costUnit !== null || referenceUnit !== null || offerUnit !== null;
    const warnings = warningsFor({
      quantity: quantityAssumed && !hasUnitValue ? null : quantity,
      costUnit,
      referenceUnit,
      offerUnit,
      marginPctOnCost,
      costWarnings: costSelection.warnings,
      isBlankItem: isBlankItemForObservations(item),
    });
    if (project.settings.analysisReferenceIncluded !== false
        && project.settings.manualReferenceTotal !== null && project.settings.manualReferenceTotal !== undefined) {
      const missingUnitReference = warnings.indexOf("Falta precio techo.");
      if (missingUnitReference >= 0) warnings.splice(missingUnitReference, 1);
    }
    if (quantityAssumed && hasUnitValue && !isBlankItemForObservations(item)) warnings.push("Cantidad no indicada: cálculo con 1 unidad asumida.");
    if (hasPendingAssociatedCosts) {
      warnings.unshift("Hay servicios o costos asociados sin valorar; la utilidad usa solo costos conocidos.");
    }
    if (suggestedCostCount > 0) warnings.unshift(`${suggestedCostCount} ${suggestedCostCount === 1 ? "costo asociado sugerido pendiente de decidir; no incluido" : "costos asociados sugeridos pendientes de decidir; no incluidos"} en el cálculo.`);
    if (item.manualCostAssumption && item.selectedCostMode === "manual") warnings.unshift(`Costo supuesto: techo menos ${item.manualCostAssumption.discountPct}%; no es un precio investigado.`);
    const status = statusFor({ quantity, costUnit, referenceUnit, offerUnit, marginPctOnCost });
    const isFinanciallyEvaluable = quantity !== null && costUnit !== null && offerUnit !== null;

    return {
      rowKey,
      includedInOffer: !item.procurementLot || !(project.settings.excludedProcurementLotIds ?? []).includes(item.procurementLot.id),
      item: item.item,
      description: item.description,
      technicalDescription: item.technicalDescription,
      quantity,
      quantityAssumed,
      unit: item.unit,
      baseCostUnit,
      productCostTotal,
      additionalUnitCost,
      additionalFixedCost,
      additionalCostTotal,
      costUnit,
      costScenarioDiscountPct: item.costScenarioDiscountPct,
      costScenarioMode: item.costScenarioMode,
      selectedCostMode: item.selectedCostMode,
      costModeUsed: costSelection.modeUsed,
      costSourceLabel: costSelection.label,
      costBreakdown,
      referenceUnit,
      referenceTotal,
      costTotal,
      offerUnit,
      offerTotal,
      marginUnit,
      utilityValue,
      marginPctOnCost,
      maxProfitPctBeforeCeiling,
      offerVsReferencePct,
      discountPctVsReference,
      status,
      warnings,
      sourceNotes: item.notes,
      control,
      costBasisStatus: item.manualCostAssumption && item.selectedCostMode === "manual" ? "comparable_scenario" : item.costBasisStatus,
      vatMode: item.vatMode,
      vatRatePct: vatRate,
      isFinanciallyEvaluable,
      knownCostTotal,
      hasPendingAssociatedCosts,
      hasSuggestedAssociatedCosts: suggestedCostCount > 0,
      associatedCostCount: (item.additionalCosts ?? []).length,
    };
  });

  const activeRows = rows.filter(row => row.includedInOffer !== false);
  const partialRows = activeRows.filter((row) => row.isFinanciallyEvaluable);
  const totalIsComplete = activeRows.length > 0 && partialRows.length === activeRows.length;
  const generalCostsTotal = sum((project.generalCosts ?? []).map((cost) => cost.amount));
  const manualReferenceTotal = project.settings.analysisReferenceIncluded === false
    ? null : (project.settings.excludedProcurementLotIds?.length ? null : project.settings.manualReferenceTotal) ?? null;
  const knownCostRows = activeRows.filter((row) => row.knownCostTotal !== null);
  const knownCostTotal = knownCostRows.length || (project.generalCosts ?? []).length
    ? sum(knownCostRows.map((row) => row.knownCostTotal)) + generalCostsTotal : null;
  const knownOfferRows = activeRows.filter((row) => row.offerTotal !== null);
  const knownOfferTotal = knownOfferRows.length
    ? sum(knownOfferRows.map((row) => row.offerTotal)) : null;
  const costIsComplete = activeRows.length > 0 && activeRows.every((row) => row.quantity !== null && row.costUnit !== null);
  const partial = buildScope(partialRows, activeRows.length, totalIsComplete, null, generalCostsTotal);
  const total = buildScope(totalIsComplete ? activeRows : partialRows, activeRows.length, totalIsComplete, manualReferenceTotal, generalCostsTotal);
  const referenceRows = activeRows.filter((row) => row.referenceTotal !== null);
  const rowReferenceKnownTotal = referenceRows.length > 0 ? sum(referenceRows.map((row) => row.referenceTotal)) : null;
  const referenceKnownTotal = manualReferenceTotal ?? rowReferenceKnownTotal;
  const referenceIsComplete = manualReferenceTotal !== null || (activeRows.length > 0 && referenceRows.length === activeRows.length);

  return {
    rows,
    summary: {
      itemCount: activeRows.length,
      total,
      partial,
      referenceKnownTotal,
      referenceKnownCount: referenceRows.length,
      knownCostTotal,
      knownCostCount: knownCostRows.length,
      knownOfferTotal,
      knownOfferCount: knownOfferRows.length,
      costIsComplete,
      missingAssociatedCostCount: activeRows.filter((row) => row.hasPendingAssociatedCosts).length,
      referenceIsComplete,
      manualReferenceTotal,
      nonFinalCostBasisCount: activeRows.filter((row) =>
        row.costBasisStatus === "partial" || row.costBasisStatus === "comparable_scenario" || row.costBasisStatus === "pending"
      ).length,
      missingQuantityCount: activeRows.filter((row) => row.quantity === null).length,
      assumedQuantityCount: activeRows.filter((row) => row.quantityAssumed).length,
      missingCostCount: activeRows.filter((row) => row.costUnit === null).length,
      missingReferenceCount: activeRows.filter((row) => row.referenceUnit === null).length,
      missingOfferCount: activeRows.filter((row) => row.offerUnit === null).length,
      overCeilingCount: activeRows.filter((row) => row.status === "over_ceiling").length,
      lossCount: activeRows.filter((row) => row.status === "loss").length,
      incompleteCount: activeRows.filter((row) => row.status === "incomplete").length,
      totalReference: total.totalReference ?? 0,
      totalCost: total.totalCost ?? 0,
      totalOffer: total.totalOffer ?? 0,
      totalMargin: total.totalMargin ?? 0,
      marginPctOnCost: total.marginPctOnCost,
      offerVsReferencePct: total.offerVsReferencePct,
      discountPctVsReference: total.discountPctVsReference,
    },
  };
}

function buildScope(rows: SimulationRow[], itemCount: number, isComplete: boolean, referenceOverride: number | null = null, generalCostsTotal = 0): SimulationSummaryScope {
  const referenceValues = rows.map((row) => row.referenceTotal).filter((value): value is number => value !== null);
  const totalReference = referenceOverride ?? (referenceValues.length ? sum(referenceValues) : null);
  const itemCostTotal = rows.length ? sum(rows.map((row) => row.costTotal)) : null;
  const totalCost = itemCostTotal !== null ? itemCostTotal + generalCostsTotal : null;
  const totalOffer = rows.length ? sum(rows.map((row) => row.offerTotal)) : null;
  const totalMargin = totalOffer !== null && totalCost !== null ? totalOffer - totalCost : null;
  return {
    isComplete,
    itemCount,
    evaluableCount: rows.length,
    totalReference,
    totalCost,
    totalOffer,
    totalMargin,
    itemCostTotal,
    generalCostsTotal,
    marginPctOnCost: totalCost !== null && totalMargin !== null && totalCost > 0 ? (totalMargin / totalCost) * 100 : null,
    offerVsReferencePct: totalReference !== null && totalOffer !== null && totalReference > 0 ? (totalOffer / totalReference) * 100 : null,
    discountPctVsReference: totalReference !== null && totalOffer !== null && totalReference > 0 ? 100 - (totalOffer / totalReference) * 100 : null,
  };
}

function incompleteScope(itemCount: number, evaluableCount: number): SimulationSummaryScope {
  return {
    isComplete: false,
    itemCount,
    evaluableCount,
    totalReference: null,
    totalCost: null,
    totalOffer: null,
    totalMargin: null,
    itemCostTotal: null,
    generalCostsTotal: 0,
    marginPctOnCost: null,
    offerVsReferencePct: null,
    discountPctVsReference: null,
  };
}

export function buildVatControls(project: FinancialOfferProject): Record<string, VatControl> {
  return Object.fromEntries(
    project.items.map((item, index) => [
      buildRowKey(item, index),
      { mode: item.vatMode, ratePct: vatRateFor(item.vatMode, item.vatRate ?? project.settings.vatRate) },
    ]),
  );
}

export function buildOfferPresentation(
  simulation: SimulationResult,
  vatControls: Record<string, VatControl>,
  settlementSettings?: Partial<SettlementSettings>,
): OfferPresentation {
  const rows = simulation.rows.map((row) => {
    const vat = vatControls[row.rowKey] ?? { mode: row.vatMode, ratePct: row.vatRatePct };
    const ratePct = vatRateFor(vat.mode, vat.ratePct);
    const roundedOffer = buildRoundedOfferValues({
      grossUnit: row.offerUnit,
      referenceGrossUnit: row.referenceUnit,
      quantity: row.quantity,
      vatMode: vat.mode,
      vatRatePct: ratePct,
    });
    const utilityValue = roundedOffer.totalGross !== null && row.costTotal !== null ? roundedOffer.totalGross - row.costTotal : row.utilityValue;
    const status = row.referenceUnit === null ? "no_ceiling" : isOfferOverReference(row.offerUnit, row.referenceUnit) ? "above_ceiling" : "within_ceiling";

    return {
      rowKey: row.rowKey,
      item: row.item,
      description: row.description,
      technicalDescription: row.technicalDescription,
      quantity: row.quantity,
      unit: row.unit,
      unitPriceWithoutVat: roundedOffer.unitNet,
      vatRatePct: ratePct,
      vatMode: vat.mode,
      vatUnitValue: roundedOffer.unitVat,
      unitPriceWithVat: roundedOffer.unitGross,
      totalWithoutVat: roundedOffer.totalNet,
      totalVatValue: roundedOffer.totalVat,
      totalWithVat: roundedOffer.totalGross,
      referenceUnit: row.referenceUnit,
      referenceTotal: row.referenceTotal,
      costUnit: row.costUnit,
      costTotal: row.costTotal,
      utilityValue,
      marginPctOnCost: row.marginPctOnCost,
      differenceVsReferenceTotal: row.referenceTotal !== null && roundedOffer.totalGross !== null ? row.referenceTotal - roundedOffer.totalGross : null,
      status,
      warnings: status === "above_ceiling" ? ["La oferta supera el precio techo.", ...row.warnings] : row.warnings,
    } satisfies OfferPresentationRow;
  });

  const activeSimulationRows = simulation.rows.filter(row => row.includedInOffer !== false);
  const includedKeys = new Set(activeSimulationRows.map(row => row.rowKey));
  const activeRows = rows.filter(row => includedKeys.has(row.rowKey));
  const isComplete = activeSimulationRows.length > 0 && activeSimulationRows.every((row) => row.isFinanciallyEvaluable);
  const itemCostTotal = sum(activeRows.map((row) => row.costTotal));
  const itemAdditionalCostsTotal = sum(activeSimulationRows.map((row) => row.additionalCostTotal));
  const generalCostsTotal = simulation.summary.total.generalCostsTotal;
  const totalProjectCost = itemCostTotal + generalCostsTotal;
  const totalOfferWithoutVat = sum(activeRows.map((row) => row.totalWithoutVat));
  const totalVat = sum(activeRows.map((row) => row.totalVatValue));
  const totalOfferWithVat = sum(activeRows.map((row) => row.totalWithVat));
  const baseValue = (base: WithholdingBase | undefined) => {
    if (base === "vat") return totalVat;
    if (base === "total") return totalOfferWithVat;
    return totalOfferWithoutVat;
  };
  const withholding = (enabled: boolean | undefined, rate: number | undefined, base: WithholdingBase | undefined) =>
    enabled ? baseValue(base) * Math.max(0, rate ?? 0) / 100 : 0;
  const reteFuente = withholding(
    settlementSettings?.applyReteFuente,
    settlementSettings?.reteFuenteRate,
    settlementSettings?.reteFuenteBase,
  );
  const reteIva = withholding(
    settlementSettings?.applyReteIva,
    settlementSettings?.reteIvaRate,
    settlementSettings?.reteIvaBase,
  );
  const reteIca = withholding(
    settlementSettings?.applyReteIca,
    settlementSettings?.reteIcaRate,
    settlementSettings?.reteIcaBase,
  );
  const stampTax = totalOfferWithVat * Math.max(0, settlementSettings?.stampTaxRate ?? 0) / 100;
  const totalDeductions = reteFuente + reteIva + reteIca + stampTax;
  const expectedNetCollection = totalOfferWithVat - totalDeductions;

  return {
    rows,
    summary: {
      totalProjectCost,
      itemCostTotal,
      itemAdditionalCostsTotal,
      generalCostsTotal,
      totalOfferWithoutVat,
      totalVat,
      totalOfferWithVat,
      estimatedUtility: isComplete ? totalOfferWithVat - totalProjectCost : null,
      isComplete,
      reteFuente,
      reteIva,
      reteIca,
      stampTax,
      totalDeductions,
      expectedNetCollection,
      estimatedNetUtility: isComplete ? expectedNetCollection - totalProjectCost : null,
      rowsAboveCeiling: activeRows.filter((row) => row.status === "above_ceiling").length,
    },
  };
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
