import type { FinancialOfferProject } from "./contract";

export type WorkspaceData = Pick<FinancialOfferProject, "name" | "settings" | "items" | "generalCosts">;
// JSON object key order can change after schema validation; it is not an edit.
export function workspaceDataKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}
const equal = (a: unknown, b: unknown): boolean => workspaceDataKey(a) === workspaceDataKey(b);

// Compare complete coherent groups, never acknowledge a remote revision with stale rows.
const itemGroups = [
  ["selectedCostMode", "selectedPriceSourceId", "analysisCostStatistic", "analysisExcludedPriceSourceIds", "priceSources", "costOptimistic", "costModerate", "costWeightedUnit", "costBasisStatus"],
  ["manualUnitCost", "manualCostAssumption", "manualCostReviewed"],
  ["offerMode", "discountPct", "profitPct", "manualOfferUnit", "offerAdjustment"],
  ["quantity", "unit", "referenceUnit", "vatMode", "vatRate"],
  ["procurementLot", "item"],
];

function mergeObject<T extends object>(base: T, local: T, remote: T, label: string, groups: string[][], conflicts: string[], preferLocal = false): T {
  const b = base as Record<string, unknown>, l = local as Record<string, unknown>, r = remote as Record<string, unknown>;
  const result = { ...r };
  const grouped = new Set(groups.flat());
  const all = [...groups, ...Object.keys({ ...b, ...l, ...r }).filter(key => !grouped.has(key)).map(key => [key])];
  for (const keys of all) {
    const values = (object: Record<string, unknown>) => keys.map(key => object[key]);
    const localChanged = !equal(values(l), values(b));
    if (!localChanged) continue;
    if (!equal(values(r), values(b)) && !equal(values(l), values(r))) { conflicts.push(`${label}: ${keys[0]}`); if (!preferLocal) continue; }
    for (const key of keys) { if (Object.hasOwn(l, key)) result[key] = l[key]; else delete result[key]; }
  }
  return result as T;
}

export function mergeWorkspace(base: WorkspaceData, local: WorkspaceData, remote: WorkspaceData, preferLocal = false): { value: WorkspaceData; conflicts: string[] } {
  const conflicts: string[] = [];
  const value = mergeObject(base, local, remote, "Cálculo", [["name"], ["generalCosts"]], conflicts, preferLocal);
  value.settings = mergeObject(base.settings, local.settings, remote.settings, "Configuración", [], conflicts, preferLocal);
  // Settings and items are merged below, not as atomic root fields.
  for (let i = conflicts.length - 1; i >= 0; i--) if (conflicts[i] === "Cálculo: settings" || conflicts[i] === "Cálculo: items") conflicts.splice(i, 1);
  const b = new Map(base.items.map(item => [item.id, item]));
  const l = new Map(local.items.map(item => [item.id, item]));
  const r = new Map(remote.items.map(item => [item.id, item]));
  value.items = [];
  const order = [...remote.items.map(item => item.id), ...local.items.filter(item => !r.has(item.id)).map(item => item.id)];
  for (const id of order) {
    const original = b.get(id), mine = l.get(id), theirs = r.get(id);
    if (!original) {
      if (mine && theirs && !equal(mine, theirs)) conflicts.push(`Ítem ${id}: alta incompatible`);
      if (theirs ?? mine) value.items.push((preferLocal ? mine ?? theirs : theirs ?? mine)!);
    } else if (!mine || !theirs) {
      const remaining = mine ?? theirs;
      if (remaining && !equal(original, remaining)) {
        conflicts.push(`Ítem ${original.item}: eliminación incompatible`);
        if (preferLocal && mine) value.items.push(mine);
      }
      // A deletion is safe only when the other side has not edited the row.
    } else value.items.push(mergeObject(original, mine, theirs, `Ítem ${original.item}`, itemGroups, conflicts, preferLocal));
  }
  return { value, conflicts };
}
