import type { CostMode, FinancialOfferItem, FinancialOfferPriceSource, FinancialOfferProject, VatMode } from "./contract";

export type OfferMode = "discount" | "profit" | "manual";
export type OfferStatus = "viable" | "tight" | "over_ceiling" | "loss" | "incomplete";

export type OfferControl = {
  mode: OfferMode;
  discountPct: number;
  profitPct: number;
  manualOfferUnit: number | null;
};

type OfferControlContext = {
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
  modeUsed: CostMode | "manual_priority";
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
  moderate: number | null;
  sourceCount: number;
  warnings: string[];
};

export type SimulationRow = {
  rowKey: string;
  item: string;
  description: string;
  technicalDescription: string;
  quantity: number | null;
  unit: string;
  costUnit: number | null;
  selectedCostMode: CostMode;
  costModeUsed: CostMode | "manual_priority";
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
  vatMode: VatMode;
  vatRatePct: number;
  isFinanciallyEvaluable: boolean;
};

export type SimulationSummaryScope = {
  isComplete: boolean;
  itemCount: number;
  evaluableCount: number;
  totalReference: number | null;
  totalCost: number | null;
  totalOffer: number | null;
  totalMargin: number | null;
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
  referenceIsComplete: boolean;
  missingQuantityCount: number;
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
  unitPriceWithoutVat: number | null;
  vatRatePct: number;
  vatMode: VatMode;
  vatUnitValue: number | null;
  unitPriceWithVat: number | null;
  totalWithoutVat: number | null;
  totalVatValue: number | null;
  totalWithVat: number | null;
  referenceUnit: number | null;
  costUnit: number | null;
  utilityValue: number | null;
  status: "within_ceiling" | "above_ceiling" | "no_ceiling";
  warnings: string[];
};

export type OfferPresentation = {
  rows: OfferPresentationRow[];
  summary: {
    totalProjectCost: number;
    totalOfferWithoutVat: number;
    totalVat: number;
    totalOfferWithVat: number;
    estimatedUtility: number;
    rowsAboveCeiling: number;
  };
};

export function formatCop(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/D";
  }
  return `$ ${formatNumber(value)}`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/D";
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
    return "N/D";
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

export function normalizeSourcePrice(source: FinancialOfferPriceSource, settings: CostCalculationSettings): NormalizedPriceSource {
  const importPct = source.importPct ?? settings.usdImportPct;
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

export function buildCostBreakdown(item: SimulationInputItem, context: Partial<CostCalculationSettings> | boolean = false): CostBreakdown {
  const settings = resolveCostSettings(context);
  const normalizedSources = (item.priceSources ?? []).map((source) => normalizeSourcePrice(source, settings));
  const validValues = normalizedSources
    .map((source) => source.normalizedUnit)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);

  if (validValues.length) {
    const minimum = Math.min(...validValues);
    const averageValue = average(validValues);
    const moderate = averageValue === null ? null : (minimum + averageValue) / 2;
    return {
      sources: normalizedSources,
      minimum,
      average: averageValue,
      moderate,
      sourceCount: validValues.length,
      warnings: normalizedSources.map((source) => source.warning).filter((warning): warning is string => Boolean(warning)),
    };
  }

  const legacyValues = [item.costOptimistic, item.costModerate, item.costWeightedUnit].filter(
    (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
  );
  const legacyMinimum = item.costOptimistic ?? (legacyValues.length ? Math.min(...legacyValues) : null);
  const legacyAverage = item.costModerate ?? average(legacyValues);
  const legacyModerate = item.costWeightedUnit ?? (legacyMinimum !== null && legacyAverage !== null ? (legacyMinimum + legacyAverage) / 2 : null);

  return {
    sources: normalizedSources,
    minimum: legacyMinimum,
    average: legacyAverage,
    moderate: legacyModerate,
    sourceCount: 0,
    warnings: normalizedSources.map((source) => source.warning).filter((warning): warning is string => Boolean(warning)),
  };
}

export function selectedCostSource(item: SimulationInputItem, context: Partial<CostCalculationSettings> | boolean = false): CostSelection {
  const settings = resolveCostSettings(context);
  const breakdown = buildCostBreakdown(item, settings);

  if (settings.manualCostPriority && item.manualUnitCost !== null) {
    return { costUnit: item.manualUnitCost, modeUsed: "manual_priority", label: "Costo manual priorizado", warnings: breakdown.warnings };
  }

  if (item.selectedCostMode === "optimistic") {
    return {
      costUnit: breakdown.minimum,
      modeUsed: "optimistic",
      label: "Costo minimo",
      warnings: [...breakdown.warnings, ...(breakdown.minimum === null ? ["No hay costo minimo disponible."] : [])],
    };
  }
  if (item.selectedCostMode === "moderate") {
    return {
      costUnit: breakdown.average,
      modeUsed: "moderate",
      label: "Costo promedio",
      warnings: [...breakdown.warnings, ...(breakdown.average === null ? ["No hay costo promedio disponible."] : [])],
    };
  }
  if (item.selectedCostMode === "manual") {
    return {
      costUnit: item.manualUnitCost,
      modeUsed: "manual",
      label: "Costo manual",
      warnings: [...breakdown.warnings, ...(item.manualUnitCost === null ? ["Seleccionaste costo manual, pero no hay valor manual."] : [])],
    };
  }

  return {
    costUnit: breakdown.moderate,
    modeUsed: "weighted",
    label: "Costo moderado",
    warnings: [...breakdown.warnings, ...(breakdown.moderate === null ? ["No hay costo moderado disponible."] : [])],
  };
}

export function selectedCostUnit(item: SimulationInputItem, context: Partial<CostCalculationSettings> | boolean = false): number | null {
  return selectedCostSource(item, context).costUnit;
}

export function buildInitialOfferControls(project: Pick<FinancialOfferProject, "items" | "settings">): Record<string, OfferControl> {
  return Object.fromEntries(
    project.items.map((item, index) => {
      const rowKey = buildRowKey(item, index);
      const vatRate = vatRateFor(item.vatMode, item.vatRate ?? project.settings.vatRate);
      const rawCostUnit = selectedCostUnit(item, project.settings);
      const costUnit = grossFromInput(rawCostUnit, item.vatMode, vatRate);
      const referenceUnit = grossFromInput(item.referenceUnit, item.vatMode, vatRate);
      return [
        rowKey,
        {
          mode: item.offerMode ?? (referenceUnit !== null ? "discount" : "profit"),
          discountPct: item.discountPct ?? 0,
          profitPct: item.profitPct ?? project.settings.defaultMargin,
          manualOfferUnit: item.manualOfferUnit ?? referenceUnit ?? (costUnit ? costUnit * (1 + project.settings.defaultMargin / 100) : null),
        },
      ];
    }),
  );
}

export function buildRowKey(item: FinancialOfferItem, index: number): string {
  return `${item.item || "item"}-${index}`;
}

function calculateOfferUnit(control: OfferControl, costUnit: number | null, referenceUnit: number | null): number | null {
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
}): string[] {
  const warnings: string[] = [...input.costWarnings];
  if (input.quantity === null) warnings.push("Cantidad no disponible.");
  if (input.costUnit === null) warnings.push("Costo unitario no disponible.");
  if (input.referenceUnit === null) warnings.push("Precio techo no disponible.");
  if (input.offerUnit === null) warnings.push("Oferta unitaria no disponible.");
  if (input.offerUnit !== null && input.referenceUnit !== null && input.offerUnit > input.referenceUnit) {
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
  if (input.quantity === null || input.costUnit === null || input.referenceUnit === null || input.offerUnit === null) {
    return "incomplete";
  }
  if (input.offerUnit > input.referenceUnit) return "over_ceiling";
  if (input.offerUnit < input.costUnit) return "loss";
  if (input.marginPctOnCost !== null && input.marginPctOnCost < 10) return "tight";
  return "viable";
}

export function buildSimulation(project: FinancialOfferProject, controls: Record<string, OfferControl>): SimulationResult {
  const rows = project.items.map((item, index): SimulationRow => {
    const rowKey = buildRowKey(item, index);
    const control = controls[rowKey] ?? buildInitialOfferControls(project)[rowKey]!;
    const vatRate = vatRateFor(item.vatMode, item.vatRate ?? project.settings.vatRate);
    const costBreakdown = buildCostBreakdown(item, project.settings);
    const costSelection = selectedCostSource(item, project.settings);
    const costUnit = grossFromInput(costSelection.costUnit, item.vatMode, vatRate);
    const referenceUnit = grossFromInput(item.referenceUnit, item.vatMode, vatRate);
    const quantity = item.quantity;
    const offerUnit = calculateOfferUnit(control, costUnit, referenceUnit);
    const referenceTotal = quantity !== null && referenceUnit !== null ? quantity * referenceUnit : null;
    const costTotal = quantity !== null && costUnit !== null ? quantity * costUnit : null;
    const offerTotal = quantity !== null && offerUnit !== null ? quantity * offerUnit : null;
    const marginUnit = offerUnit !== null && costUnit !== null ? offerUnit - costUnit : null;
    const utilityValue = offerTotal !== null && costTotal !== null ? offerTotal - costTotal : null;
    const marginPctOnCost = marginUnit !== null && costUnit ? (marginUnit / costUnit) * 100 : null;
    const maxProfitPctBeforeCeiling = referenceUnit !== null && costUnit ? (referenceUnit / costUnit - 1) * 100 : null;
    const offerVsReferencePct = offerUnit !== null && referenceUnit ? (offerUnit / referenceUnit) * 100 : null;
    const discountPctVsReference = offerVsReferencePct !== null ? 100 - offerVsReferencePct : null;
    const warnings = warningsFor({ quantity, costUnit, referenceUnit, offerUnit, marginPctOnCost, costWarnings: costSelection.warnings });
    const status = statusFor({ quantity, costUnit, referenceUnit, offerUnit, marginPctOnCost });
    const isFinanciallyEvaluable = quantity !== null && costUnit !== null && referenceUnit !== null && offerUnit !== null;

    return {
      rowKey,
      item: item.item,
      description: item.description,
      technicalDescription: item.technicalDescription,
      quantity,
      unit: item.unit,
      costUnit,
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
      vatMode: item.vatMode,
      vatRatePct: vatRate,
      isFinanciallyEvaluable,
    };
  });

  const partialRows = rows.filter((row) => row.isFinanciallyEvaluable);
  const totalIsComplete = rows.length > 0 && partialRows.length === rows.length;
  const partial = buildScope(partialRows, rows.length, totalIsComplete);
  const total = totalIsComplete ? buildScope(rows, rows.length, true) : incompleteScope(rows.length, partialRows.length);
  const referenceRows = rows.filter((row) => row.referenceTotal !== null);
  const referenceKnownTotal = referenceRows.length > 0 ? sum(referenceRows.map((row) => row.referenceTotal)) : null;
  const referenceIsComplete = rows.length > 0 && referenceRows.length === rows.length;

  return {
    rows,
    summary: {
      itemCount: rows.length,
      total,
      partial,
      referenceKnownTotal,
      referenceKnownCount: referenceRows.length,
      referenceIsComplete,
      missingQuantityCount: rows.filter((row) => row.quantity === null).length,
      missingCostCount: rows.filter((row) => row.costUnit === null).length,
      missingReferenceCount: rows.filter((row) => row.referenceUnit === null).length,
      missingOfferCount: rows.filter((row) => row.offerUnit === null).length,
      overCeilingCount: rows.filter((row) => row.status === "over_ceiling").length,
      lossCount: rows.filter((row) => row.status === "loss").length,
      incompleteCount: rows.filter((row) => row.status === "incomplete").length,
      totalReference: partial.totalReference ?? 0,
      totalCost: partial.totalCost ?? 0,
      totalOffer: partial.totalOffer ?? 0,
      totalMargin: partial.totalMargin ?? 0,
      marginPctOnCost: partial.marginPctOnCost,
      offerVsReferencePct: partial.offerVsReferencePct,
      discountPctVsReference: partial.discountPctVsReference,
    },
  };
}

function buildScope(rows: SimulationRow[], itemCount: number, isComplete: boolean): SimulationSummaryScope {
  const totalReference = sum(rows.map((row) => row.referenceTotal));
  const totalCost = sum(rows.map((row) => row.costTotal));
  const totalOffer = sum(rows.map((row) => row.offerTotal));
  const totalMargin = totalOffer - totalCost;
  return {
    isComplete,
    itemCount,
    evaluableCount: rows.length,
    totalReference,
    totalCost,
    totalOffer,
    totalMargin,
    marginPctOnCost: totalCost > 0 ? (totalMargin / totalCost) * 100 : null,
    offerVsReferencePct: totalReference > 0 ? (totalOffer / totalReference) * 100 : null,
    discountPctVsReference: totalReference > 0 ? 100 - (totalOffer / totalReference) * 100 : null,
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

export function buildOfferPresentation(simulation: SimulationResult, vatControls: Record<string, VatControl>): OfferPresentation {
  const rows = simulation.rows.map((row) => {
    const vat = vatControls[row.rowKey] ?? { mode: row.vatMode, ratePct: row.vatRatePct };
    const ratePct = vatRateFor(vat.mode, vat.ratePct);
    const offer = decomposeGross(row.offerUnit, vat.mode, ratePct);
    const total = decomposeGross(row.offerTotal, vat.mode, ratePct);
    const utilityValue = row.utilityValue;
    const status =
      row.referenceUnit === null ? "no_ceiling" : row.offerUnit !== null && row.offerUnit > row.referenceUnit ? "above_ceiling" : "within_ceiling";

    return {
      rowKey: row.rowKey,
      item: row.item,
      description: row.description,
      technicalDescription: row.technicalDescription,
      quantity: row.quantity,
      unitPriceWithoutVat: offer.net,
      vatRatePct: ratePct,
      vatMode: vat.mode,
      vatUnitValue: offer.vat,
      unitPriceWithVat: offer.gross,
      totalWithoutVat: total.net,
      totalVatValue: total.vat,
      totalWithVat: total.gross,
      referenceUnit: row.referenceUnit,
      costUnit: row.costUnit,
      utilityValue,
      status,
      warnings: status === "above_ceiling" ? ["La oferta supera el precio techo.", ...row.warnings] : row.warnings,
    } satisfies OfferPresentationRow;
  });

  const totalProjectCost = sum(rows.map((row) => (row.quantity !== null && row.costUnit !== null ? row.quantity * row.costUnit : null)));
  const totalOfferWithoutVat = sum(rows.map((row) => row.totalWithoutVat));
  const totalVat = sum(rows.map((row) => row.totalVatValue));
  const totalOfferWithVat = sum(rows.map((row) => row.totalWithVat));

  return {
    rows,
    summary: {
      totalProjectCost,
      totalOfferWithoutVat,
      totalVat,
      totalOfferWithVat,
      estimatedUtility: sum(rows.map((row) => row.utilityValue)),
      rowsAboveCeiling: rows.filter((row) => row.status === "above_ceiling").length,
    },
  };
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
