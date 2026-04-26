import type { MarketAnalysisRow } from "./market-analysis-schema";

export type OfferMode = "discount" | "profit" | "manual";
export type OfferStatus = "viable" | "tight" | "over_ceiling" | "loss" | "incomplete";

export type OfferControl = {
  mode: OfferMode;
  discountPct: number;
  profitPct: number;
  manualOfferUnit: number | null;
};

export type OfferSimulationRow = {
  rowKey: string;
  item: string;
  description: string;
  technicalDescription: string;
  quantity: number | null;
  unit: string;
  costUnit: number | null;
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
};

export type OfferSimulationSummary = {
  totalReference: number;
  totalCost: number;
  totalOffer: number;
  totalMargin: number;
  marginPctOnCost: number | null;
  offerVsReferencePct: number | null;
  discountPctVsReference: number | null;
  overCeilingCount: number;
  lossCount: number;
  incompleteCount: number;
};

export type OfferSimulation = {
  rows: OfferSimulationRow[];
  summary: OfferSimulationSummary;
};

export type OfferExportRow = {
  item: string;
  description: string;
  unit: string;
  quantity: number | null;
  costUnit: number | null;
  referenceUnit: number | null;
  referenceTotal: number | null;
  costTotal: number | null;
  costVsReferencePct: number | null;
  maxProfitPctBeforeCeiling: number | null;
  selectedProfitPct: number | null;
  offerUnit: number | null;
  offerTotal: number | null;
  utilityValue: number | null;
  ceilingOk: string;
  discountPctVsReference: number | null;
  status: OfferStatus;
  warnings: string;
  sourceNotes: string;
};

const DEFAULT_PROFIT_PCT = 25;

function cleanNumberishText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/COP|USD|COL\$|\$/gi, " ")
    .trim();
}

export function parseFlexibleNumber(value: unknown): number | null {
  const text = cleanNumberishText(value);
  if (!text || /^(n\/d|nd|na|null|sin dato|-+)$/i.test(text)) {
    return null;
  }

  const match = text.match(/-?\d[\d.,\s]*/);
  if (!match) {
    return null;
  }

  let numberText = match[0].replace(/\s/g, "");
  const commaIndex = numberText.lastIndexOf(",");
  const dotIndex = numberText.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      numberText = numberText.replace(/\./g, "").replace(",", ".");
    } else {
      numberText = numberText.replace(/,/g, "");
    }
  } else if (commaIndex >= 0) {
    const decimals = numberText.length - commaIndex - 1;
    numberText = decimals > 0 && decimals <= 2 ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (dotIndex >= 0) {
    const looksLikeThousands = /^-?\d{1,3}(\.\d{3})+$/.test(numberText);
    numberText = looksLikeThousands ? numberText.replace(/\./g, "") : numberText;
  }

  const parsed = Number(numberText);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseQuantity(value: unknown): number | null {
  const parsed = parseFlexibleNumber(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
}

export function formatCop(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/D";
  }

  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumberEs(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/D";
  }

  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/D";
  }

  return `${formatNumberEs(value, decimals)} %`;
}

export function buildInitialOfferControls(rows: MarketAnalysisRow[]): Record<string, OfferControl> {
  return Object.fromEntries(
    rows.map((row, index) => {
      const rowKey = buildRowKey(row, index);
      const costUnit = parseFlexibleNumber(row["COSTO PONDERADO UNIT"]);
      const referenceUnit = parseFlexibleNumber(row["PRECIO REFERENCIA (TECHO) UNIT"]);

      if (referenceUnit !== null) {
        return [
          rowKey,
          {
            mode: "discount",
            discountPct: 0,
            profitPct: costUnit ? ((referenceUnit / costUnit - 1) * 100) : DEFAULT_PROFIT_PCT,
            manualOfferUnit: referenceUnit,
          },
        ];
      }

      return [
        rowKey,
        {
          mode: "profit",
          discountPct: 0,
          profitPct: DEFAULT_PROFIT_PCT,
          manualOfferUnit: costUnit ? costUnit * (1 + DEFAULT_PROFIT_PCT / 100) : null,
        },
      ];
    }),
  );
}

export function buildRowKey(row: MarketAnalysisRow, index: number): string {
  return `${row["Ítem"] || "item"}-${index}`;
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

function buildWarnings(input: {
  quantity: number | null;
  costUnit: number | null;
  referenceUnit: number | null;
  offerUnit: number | null;
  marginPctOnCost: number | null;
}): string[] {
  const warnings: string[] = [];

  if (input.quantity === null) {
    warnings.push("Cantidad no disponible.");
  }
  if (input.costUnit === null) {
    warnings.push("Costo unitario no disponible.");
  }
  if (input.referenceUnit === null) {
    warnings.push("Precio techo no disponible.");
  }
  if (input.offerUnit !== null && input.referenceUnit !== null && input.offerUnit > input.referenceUnit) {
    warnings.push("La oferta supera el precio techo.");
  }
  if (input.offerUnit !== null && input.costUnit !== null && input.offerUnit < input.costUnit) {
    warnings.push("La oferta queda por debajo del costo.");
  }
  if (input.marginPctOnCost !== null && input.marginPctOnCost >= 0 && input.marginPctOnCost < 10) {
    warnings.push("Margen bajo frente al costo.");
  }

  return warnings;
}

function getStatus(input: {
  quantity: number | null;
  costUnit: number | null;
  referenceUnit: number | null;
  offerUnit: number | null;
  marginPctOnCost: number | null;
}): OfferStatus {
  if (input.quantity === null || input.costUnit === null || input.referenceUnit === null || input.offerUnit === null) {
    return "incomplete";
  }
  if (input.offerUnit > input.referenceUnit) {
    return "over_ceiling";
  }
  if (input.offerUnit < input.costUnit) {
    return "loss";
  }
  if (input.marginPctOnCost !== null && input.marginPctOnCost < 10) {
    return "tight";
  }
  return "viable";
}

export function buildOfferSimulation(rows: MarketAnalysisRow[], controls: Record<string, OfferControl>): OfferSimulation {
  const simulationRows = rows.map((row, index): OfferSimulationRow => {
    const rowKey = buildRowKey(row, index);
    const control =
      controls[rowKey] ??
      buildInitialOfferControls([row])[buildRowKey(row, 0)] ?? {
        mode: "profit" as const,
        discountPct: 0,
        profitPct: DEFAULT_PROFIT_PCT,
        manualOfferUnit: null,
      };

    const quantity = parseQuantity(row["Cant"]);
    const costUnit = parseFlexibleNumber(row["COSTO PONDERADO UNIT"]);
    const referenceUnit = parseFlexibleNumber(row["PRECIO REFERENCIA (TECHO) UNIT"]);
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
    const warnings = buildWarnings({ quantity, costUnit, referenceUnit, offerUnit, marginPctOnCost });
    const status = getStatus({ quantity, costUnit, referenceUnit, offerUnit, marginPctOnCost });

    return {
      rowKey,
      item: row["Ítem"],
      description: row["Nombre o descripción"],
      technicalDescription: row["Descripción o ficha técnica"],
      quantity,
      unit: "",
      costUnit,
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
      sourceNotes: row["Resumen de Fuentes y Observaciones"],
      control,
    };
  });

  const totalReference = sumKnown(simulationRows.map((row) => row.referenceTotal));
  const totalCost = sumKnown(simulationRows.map((row) => row.costTotal));
  const totalOffer = sumKnown(simulationRows.map((row) => row.offerTotal));
  const totalMargin = totalOffer - totalCost;
  const marginPctOnCost = totalCost > 0 ? (totalMargin / totalCost) * 100 : null;
  const offerVsReferencePct = totalReference > 0 ? (totalOffer / totalReference) * 100 : null;
  const discountPctVsReference = offerVsReferencePct !== null ? 100 - offerVsReferencePct : null;

  return {
    rows: simulationRows,
    summary: {
      totalReference,
      totalCost,
      totalOffer,
      totalMargin,
      marginPctOnCost,
      offerVsReferencePct,
      discountPctVsReference,
      overCeilingCount: simulationRows.filter((row) => row.status === "over_ceiling").length,
      lossCount: simulationRows.filter((row) => row.status === "loss").length,
      incompleteCount: simulationRows.filter((row) => row.status === "incomplete").length,
    },
  };
}

export function toOfferExportRows(simulation: OfferSimulation): OfferExportRow[] {
  return simulation.rows.map((row) => ({
    item: row.item,
    description: row.description,
    unit: row.unit,
    quantity: row.quantity,
    costUnit: row.costUnit,
    referenceUnit: row.referenceUnit,
    referenceTotal: row.referenceTotal,
    costTotal: row.costTotal,
    costVsReferencePct: row.costUnit !== null && row.referenceUnit ? (row.costUnit / row.referenceUnit) * 100 : null,
    maxProfitPctBeforeCeiling: row.maxProfitPctBeforeCeiling,
    selectedProfitPct: row.marginPctOnCost,
    offerUnit: row.offerUnit,
    offerTotal: row.offerTotal,
    utilityValue: row.utilityValue,
    ceilingOk: row.offerUnit !== null && row.referenceUnit !== null && row.offerUnit <= row.referenceUnit ? "OK" : "Revisar",
    discountPctVsReference: row.discountPctVsReference,
    status: row.status,
    warnings: row.warnings.join(" "),
    sourceNotes: row.sourceNotes,
  }));
}

function sumKnown(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
