import { buildOfferDisplay } from "./offer-presentation";
import { buildInitialOfferControls, buildOfferPresentation, buildSimulation, buildVatControls } from "./financial-engine";
import { groupedProcurementIndexes } from "./procurement-lots";
import type { FinancialOfferProject } from "./contract";

export function buildProjectExport(project: FinancialOfferProject) {
  const simulation = buildSimulation(project, buildInitialOfferControls(project));
  const offer = buildOfferPresentation(simulation, buildVatControls(project), project.settings);

  return {
    calculation: {
      id: project.id,
      externalId: project.externalId,
      sourceSystem: project.sourceSystem,
      odooProjectId: project.odooProjectId,
      iaRunId: project.iaRunId,
      sourceAnalysisId: project.sourceAnalysisId,
      name: project.name,
      entity: project.entity,
      currency: project.currency,
      updatedAt: project.updatedAt,
      settings: project.settings,
      items: project.items,
      generalCosts: project.generalCosts,
    },
    project: {
      id: project.id,
      externalId: project.externalId,
      sourceSystem: project.sourceSystem,
      odooProjectId: project.odooProjectId,
      iaRunId: project.iaRunId,
      sourceAnalysisId: project.sourceAnalysisId,
      name: project.name,
      entity: project.entity,
      currency: project.currency,
      updatedAt: project.updatedAt,
      settings: project.settings,
      items: project.items,
      generalCosts: project.generalCosts,
    },
    simulation,
    offer,
  };
}

export function clientOfferRows(exported: ReturnType<typeof buildProjectExport>) {
  return groupedProcurementIndexes(exported.project.items).filter(index => exported.simulation.rows[index]?.includedInOffer !== false).map((index) => { const row = exported.offer.rows[index]!; return ({
    Lote: exported.project.items[index]?.procurementLot?.label ?? "Sin lote asignado",
    "ID lote": exported.project.items[index]?.procurementLot?.id ?? "",
    Item: row.item,
    Descripcion: row.description,
    Cantidad: row.quantity ?? "",
    "Cantidad asumida": exported.simulation.rows[index]?.quantityAssumed ? "Sí, confirmar con pliego" : "",
    "Und de medida": row.unit,
    "Unitario sin IVA": row.unitPriceWithoutVat ?? "",
    "Total sin IVA": row.totalWithoutVat ?? "",
    "IVA %": row.vatRatePct,
    "IVA unitario": row.vatUnitValue ?? "",
    "IVA total": row.totalVatValue ?? "",
    "Unitario con IVA": row.unitPriceWithVat ?? "",
    "Total con IVA": row.totalWithVat ?? "",
  }); });
}

export function offerExportTable(exported: ReturnType<typeof buildProjectExport>) {
  const display = buildOfferDisplay(exported.project, exported.offer);
  if (!display.original && !exported.project.settings.offerDisplay) {
    const legacy = clientOfferRows(exported);
    const headers = Object.keys(legacy[0] ?? {});
    return { headers, rows: legacy.map(row => headers.map(h => (row as Record<string, unknown>)[h])) };
  }
  const indexes = groupedProcurementIndexes(exported.project.items).filter(i => exported.simulation.rows[i]?.includedInOffer !== false);
  const lots = indexes.some(i => exported.project.items[i]?.procurementLot);
  const assumed = indexes.some(i => exported.simulation.rows[i]?.quantityAssumed);
  const warnings = indexes.some(i => display.rows[i]?.warnings.length);
  const headers = [ ...(lots ? ["Lote", "ID lote"] : []), ...display.columns.map(c => c.header), ...(assumed ? ["Cantidad asumida"] : []), ...(warnings ? ["Verificación"] : []) ];
  const rows = indexes.map(i => [
    ...(lots ? [exported.project.items[i]?.procurementLot?.label ?? "Sin lote asignado", exported.project.items[i]?.procurementLot?.id ?? ""] : []),
    ...display.columns.map(c => display.rows[i]!.values[c.key] ?? ""),
    ...(assumed ? [exported.simulation.rows[i]?.quantityAssumed ? "Sí, confirmar con pliego" : ""] : []),
    ...(warnings ? [display.rows[i]!.warnings.join(" ")] : []),
  ]);
  return { headers, rows };
}
export function offerTableCsv(table: ReturnType<typeof offerExportTable>) {
  return [table.headers, ...table.rows].map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '\"\"')}"`).join(",")).join("\n");
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          const text = value === null || value === undefined ? "" : String(value);
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(","),
    ),
  ].join("\n");
}
