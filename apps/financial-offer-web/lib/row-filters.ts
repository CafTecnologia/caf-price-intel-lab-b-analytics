import type { SimulationRow } from "./financial-engine";

export type RowFilterKey = "all" | "missing_cost" | "incomplete" | "loss" | "tight" | "associated" | "group";
// «group» = último grupo trabajado en bloque; se resuelve en el espacio de trabajo, no por estado de fila (Carlos, 29/10).
export const rowFilters: Array<{ key: RowFilterKey; label: string; test: (row: SimulationRow) => boolean }> = [
  { key: "all", label: "Todos", test: () => true },
  { key: "missing_cost", label: "Sin costo", test: row => row.costUnit === null },
  { key: "incomplete", label: "Incompletos", test: row => row.status === "incomplete" },
  { key: "loss", label: "Pérdida", test: row => row.status === "loss" || row.status === "over_ceiling" },
  { key: "tight", label: "Margen estrecho", test: row => row.status === "tight" },
  // Todo ítem con costos asociados: valorados, sin valorar o sugeridos (Carlos, 27/10).
  { key: "associated", label: "Costos asociados", test: row => Boolean((row.associatedCostCount ?? 0) > 0 || (row.additionalCostTotal ?? 0) > 0 || row.hasPendingAssociatedCosts || row.hasSuggestedAssociatedCosts) },
];
