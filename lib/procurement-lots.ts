import type { FinancialOfferItem } from "./contract";
import type { SimulationRow, OfferPresentationRow } from "./financial-engine";

export type ProcurementLotGroup = { key: string; id: string | null; label: string; indexes: number[] };
export function groupProcurementLots(items: FinancialOfferItem[], indexes = items.map((_, index) => index)): ProcurementLotGroup[] {
  const groups = new Map<string, ProcurementLotGroup>();
  for (const index of indexes) {
    const item = items[index];
    if (!item) continue;
    const lot = item.procurementLot;
    const key = lot ? `lot:${lot.id}` : "unassigned";
    const group = groups.get(key) ?? { key, id: lot?.id ?? null, label: lot?.label ?? "Sin lote asignado", indexes: [] };
    group.indexes.push(index); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.id === null ? 1 : b.id === null ? -1 : a.label.localeCompare(b.label, "es", { numeric: true }));
}
export function groupedProcurementIndexes(items: FinancialOfferItem[], indexes?: number[]): number[] {
  return groupProcurementLots(items, indexes).flatMap((group) => group.indexes);
}
export function procurementLotTotals(group: ProcurementLotGroup, rows: SimulationRow[], offers: OfferPresentationRow[]) {
  const sum = (values: (number | null | undefined)[]) => values.some((value) => value != null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : null;
  return {
    count: group.indexes.length,
    withCost: group.indexes.filter((index) => (rows[index]?.costUnit ?? 0) > 0).length,
    pendingCost: group.indexes.filter((index) => (rows[index]?.costUnit ?? 0) <= 0).length,
    pendingOffer: group.indexes.filter((index) => offers[index]?.totalWithVat == null).length,
    pendingCeiling: group.indexes.filter((index) => rows[index]?.referenceTotal == null).length,
    ceiling: sum(group.indexes.map((index) => rows[index]?.referenceTotal)),
    knownCost: sum(group.indexes.map((index) => rows[index]?.costTotal)),
    offerWithoutVat: sum(group.indexes.map((index) => offers[index]?.totalWithoutVat)),
    offerVat: sum(group.indexes.map((index) => offers[index]?.totalVatValue)),
    offerWithVat: sum(group.indexes.map((index) => offers[index]?.totalWithVat)),
  };
}
