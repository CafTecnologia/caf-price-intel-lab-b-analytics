import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { buildProjectExport, offerExportTable, offerTableCsv, toCsv } from "@offer/lib/export";
import { getProject } from "@offer/lib/store";

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "oferta-economica";
}

function buildClientOfferWorkbook(exported: ReturnType<typeof buildProjectExport>, projectName: string): Buffer {
  const workbook = XLSX.utils.book_new();
  const table = offerExportTable(exported);
  const sheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  sheet["!cols"] = table.headers.map(key => ({ wch: /descrip|nombre|caracter/i.test(key) ? 65 : key === "Lote" ? 26 : 18 }));
  if (table.headers.length) sheet["!autofilter"] = { ref: XLSX.utils.encode_range({s:{r:0,c:0},e:{r:table.rows.length,c:table.headers.length-1}}) };
  XLSX.utils.book_append_sheet(workbook, sheet, "Oferta económica");
  workbook.Props = { Title: projectName, Subject: "Oferta económica cliente" };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const project = await getProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  }

  const exported = buildProjectExport(project);
  if (format === "offer-xlsx") {
    const buffer = buildClientOfferWorkbook(exported, project.name);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Guia de precio a ofertar CAF - ${safeFileName(project.name)}.xlsx"`,
      },
    });
  }

  if (format === "offer-csv") {
    return new NextResponse(offerTableCsv(offerExportTable(exported)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFileName(project.name)}.oferta-economica.csv"`,
      },
    });
  }

  if (format === "csv") {
    const generalCostsText = project.generalCosts
      .map((cost) => `${cost.name}: ${cost.amount}`)
      .join(" | ");
    const generalCostsTotal = project.generalCosts.reduce((total, cost) => total + cost.amount, 0);
    const rows = exported.simulation.rows.map((row, index) => ({
      item: row.item,
      description: row.description,
      quantity: row.quantity,
      productCostTotal: row.productCostTotal,
      additionalUnitCost: row.additionalUnitCost,
      additionalFixedCost: row.additionalFixedCost,
      additionalCostTotal: row.additionalCostTotal,
      additionalCosts: (project.items[index]?.additionalCosts ?? [])
        .map((cost) => `${cost.name} (${cost.mode}): ${cost.amount}`)
        .join(" | "),
      projectGeneralCosts: index === 0 ? generalCostsText : "",
      projectGeneralCostsTotal: index === 0 ? generalCostsTotal : "",
      costUnit: row.costUnit,
      costTotal: row.costTotal,
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
