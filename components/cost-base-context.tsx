import React from "react";

export type CostBaseIdentity = { id: string; sequence: number; active: boolean };

export function ReceiptCostBase({ id, versions, unavailable }: { id: string; versions?: CostBaseIdentity[]; unavailable?: boolean }) {
  const saved = unavailable ? undefined : versions?.find(version => version.id === id);
  return <span>Base guardada por esta solicitud: {saved ? `Base #${saved.sequence}` : id.slice(0, 8)}</span>;
}

export function CurrentCostBase({ versions }: { versions: CostBaseIdentity[] }) {
  const active = versions.filter(version => version.active);
  return <p>{active.length === 1 ? `En uso ahora: Base #${active[0].sequence}` : active.length > 1 ? "No se pudo identificar una única base en uso. Actualiza el historial." : "Los costos actuales todavía no tienen una base guardada."}</p>;
}
