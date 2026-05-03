import { NextResponse } from "next/server";

import { buildProjectExport, toCsv } from "@offer/lib/export";
import { getProject } from "@offer/lib/store";

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const project = await getProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  }

  const exported = buildProjectExport(project);
  if (format === "csv") {
    const rows = exported.simulation.rows.map((row) => ({
      item: row.item,
      description: row.description,
      quantity: row.quantity,
      costUnit: row.costUnit,
      costSource: row.costSourceLabel,
      costMinimum: row.costBreakdown.minimum,
      costAverage: row.costBreakdown.average,
      costModerate: row.costBreakdown.moderate,
      validSourceCount: row.costBreakdown.sourceCount,
      priceSources: row.costBreakdown.sources
        .map((source) => `${source.label}: ${source.currency} ${source.unitPrice ?? ""} -> COP ${source.normalizedUnit ?? ""}`)
        .join(" | "),
      vatMode: row.vatMode,
      vatRatePct: row.vatRatePct,
      referenceUnit: row.referenceUnit,
      offerUnit: row.offerUnit,
      offerTotal: row.offerTotal,
      utilityValue: row.utilityValue,
      status: row.status,
      warnings: row.warnings.join(" "),
    }));

    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.name}.financial-offer.csv"`,
      },
    });
  }

  return NextResponse.json(exported);
}
