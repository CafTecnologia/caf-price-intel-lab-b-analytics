import type { OfferSimulation } from "./financial-simulation";
import type { VatControl } from "./offer-controls-storage";

export type OfferPresentationRow = {
  rowKey: string;
  item: string;
  description: string;
  technicalDescription: string;
  quantity: number | null;
  unitPriceWithoutVat: number | null;
  vatRatePct: number;
  vatApplies: boolean;
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

export type OfferPresentationSummary = {
  totalProjectCost: number;
  totalOfferWithoutVat: number;
  totalVat: number;
  totalOfferWithVat: number;
  estimatedUtility: number;
  rowsAboveCeiling: number;
};

export type OfferPresentation = {
  rows: OfferPresentationRow[];
  summary: OfferPresentationSummary;
};

export function buildInitialVatControls(simulation: OfferSimulation): Record<string, VatControl> {
  return Object.fromEntries(
    simulation.rows.map((row) => [
      row.rowKey,
      {
        applies: true,
        ratePct: 19,
      },
    ]),
  );
}

export function buildOfferPresentation(
  simulation: OfferSimulation,
  vatControls: Record<string, VatControl>,
): OfferPresentation {
  const rows = simulation.rows.map((row) => {
    const vatControl = vatControls[row.rowKey] ?? { applies: true, ratePct: 19 };
    const vatRate = vatControl.applies ? Math.max(0, vatControl.ratePct) / 100 : 0;
    const unitPriceWithVat = row.offerUnit;
    const unitPriceWithoutVat =
      row.offerUnit !== null ? (vatRate > 0 ? row.offerUnit / (1 + vatRate) : row.offerUnit) : null;
    const vatUnitValue =
      row.offerUnit !== null && unitPriceWithoutVat !== null ? row.offerUnit - unitPriceWithoutVat : null;
    const totalWithVat = row.offerTotal;
    const totalWithoutVat =
      row.offerTotal !== null ? (vatRate > 0 ? row.offerTotal / (1 + vatRate) : row.offerTotal) : null;
    const totalVatValue =
      totalWithVat !== null && totalWithoutVat !== null ? totalWithVat - totalWithoutVat : null;
    const utilityValue =
      totalWithVat !== null && row.costTotal !== null ? totalWithVat - row.costTotal : null;
    const status =
      row.referenceUnit === null
        ? "no_ceiling"
        : unitPriceWithVat !== null && unitPriceWithVat > row.referenceUnit
          ? "above_ceiling"
          : "within_ceiling";
    const warnings = [...row.warnings];
    if (status === "above_ceiling") {
      warnings.unshift("La oferta supera el precio techo.");
    }

    return {
      rowKey: row.rowKey,
      item: row.item,
      description: row.description,
      technicalDescription: row.technicalDescription,
      quantity: row.quantity,
      unitPriceWithoutVat,
      vatRatePct: vatControl.applies ? vatControl.ratePct : 0,
      vatApplies: vatControl.applies,
      vatUnitValue,
      unitPriceWithVat,
      totalWithoutVat,
      totalVatValue,
      totalWithVat,
      referenceUnit: row.referenceUnit,
      costUnit: row.costUnit,
      utilityValue,
      status,
      warnings,
    } satisfies OfferPresentationRow;
  });

  const totalProjectCost = sumKnown(rows.map((row) => (row.quantity !== null && row.costUnit !== null ? row.quantity * row.costUnit : null)));
  const totalOfferWithoutVat = sumKnown(rows.map((row) => row.totalWithoutVat));
  const totalVat = sumKnown(rows.map((row) => row.totalVatValue));
  const totalOfferWithVat = sumKnown(rows.map((row) => row.totalWithVat));
  const estimatedUtility = totalOfferWithVat - totalProjectCost;

  return {
    rows,
    summary: {
      totalProjectCost,
      totalOfferWithoutVat,
      totalVat,
      totalOfferWithVat,
      estimatedUtility,
      rowsAboveCeiling: rows.filter((row) => row.status === "above_ceiling").length,
    },
  };
}

function sumKnown(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
