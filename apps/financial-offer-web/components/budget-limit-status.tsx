import { assessBudgetLimits } from "../lib/budget-limits";
import type { FinancialOfferProject } from "../lib/contract";
import { formatCop, type SimulationResult } from "../lib/financial-engine";

export function BudgetLimitStatus({ project, simulation }: { project: FinancialOfferProject; simulation: SimulationResult }) {
  const limits = assessBudgetLimits(project, simulation);
  if (!limits.length) return null;
  return <details style={{ width: "100%", overflowWrap: "anywhere" }}>
    <summary>Máximos documentados · {limits.length}</summary>
    {limits.map(limit => <div key={limit.id} style={{ marginBlock: 10 }}>
      <strong>{limit.label} · {formatCop(limit.maximum)}</strong>
      <p>{limit.status === "exceeded" ? `Excede el máximo en ${formatCop(limit.excess!)}` : limit.status === "within_limit" ? "Dentro del máximo" : "Pendiente: oferta incompleta"}</p>
      <small>Oferta con impuestos: {limit.knownOfferTotal === null ? "Sin definir" : formatCop(limit.knownOfferTotal)} · {limit.document} · {limit.locator}</small>
    </div>)}
    <small>Las referencias unitarias oficiales se conservan separadas de estos máximos.</small>
  </details>;
}
