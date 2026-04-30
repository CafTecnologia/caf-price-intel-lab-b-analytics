import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const runs = getMarketAnalysisService().listRuns(Number.isFinite(limit) ? limit : 20);

    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado listando analisis de mercado." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Debes cargar un archivo PDF, Excel o Word." }, { status: 400 });
    }

    const rawOdooProjectId = formData.get("odoo_project_id");
    const rawOdooProjectName = formData.get("odoo_project_name");
    const odooProjectId =
      typeof rawOdooProjectId === "string" && /^\d+$/.test(rawOdooProjectId) ? Number(rawOdooProjectId) : null;
    const odooProjectName =
      typeof rawOdooProjectName === "string" && rawOdooProjectName.trim() ? rawOdooProjectName.trim() : null;
    const bytes = Buffer.from(await file.arrayBuffer());
    const run = await getMarketAnalysisService().processUpload({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      odooProjectId,
      odooProjectName,
    });

    return NextResponse.json({ runId: run.runId });
  } catch (error) {
    const runId =
      error && typeof error === "object" && "runId" in error && typeof error.runId === "string" ? error.runId : null;

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error inesperado ejecutando el analisis de mercado.",
        runId,
      },
      { status: 500 },
    );
  }
}
