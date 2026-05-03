import { buildInitialOfferControls, buildOfferPresentation, buildSimulation, buildVatControls } from "./financial-engine";
import type { FinancialOfferProject } from "./contract";

export function buildProjectExport(project: FinancialOfferProject) {
  const simulation = buildSimulation(project, buildInitialOfferControls(project));
  const offer = buildOfferPresentation(simulation, buildVatControls(project));

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
    },
    simulation,
    offer,
  };
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
