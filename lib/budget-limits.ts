import type { FinancialOfferProject } from "./contract";
import { buildOfferPresentation, type SimulationResult } from "./financial-engine";

/** Documentary caps use rounded gross offer totals, never costs or unit reference prices. */
export function assessBudgetLimits(project: FinancialOfferProject, simulation: SimulationResult) {
  const offer = buildOfferPresentation(simulation, {}, project.settings);
  return (project.settings.budgetLimits ?? []).map(limit => {
    const members = project.items.map((item, index) => ({ item, row: simulation.rows[index], offer: offer.rows[index] }))
      .filter(({ item }) => limit.procurementLotId === null || item.procurementLot?.id === limit.procurementLotId);
    const known = members.filter(({ row, offer }) => row?.includedInOffer && offer?.totalWithVat !== null && offer?.totalWithVat !== undefined);
    const knownOfferTotal = known.length ? Math.round(known.reduce((sum, { offer }) => sum + offer.totalWithVat!, 0) * 100) / 100 : null;
    const complete = members.length > 0 && members.every(({ row, offer }) => row?.includedInOffer && !row.quantityAssumed && row.quantity !== null && offer?.totalWithVat !== null && offer?.totalWithVat !== undefined);
    const excess = knownOfferTotal === null ? null : Math.round((knownOfferTotal - limit.maximum) * 100) / 100;
    return { ...limit, itemIds: members.map(({ item }) => item.id), knownOfferTotal,
      missingItemIds: members.filter(({ row, offer }) => !row?.includedInOffer || row.quantityAssumed || row.quantity === null || offer?.totalWithVat === null || offer?.totalWithVat === undefined).map(({ item }) => item.id),
      complete, status: excess !== null && excess > 0 ? "exceeded" as const : complete ? "within_limit" as const : "pending" as const,
      excess: excess !== null && excess > 0 ? excess : null };
  });
}
