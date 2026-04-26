import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Debes cargar un archivo PDF, Excel o Word." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const run = await getMarketAnalysisService().processUpload({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
    });

    return NextResponse.json({ runId: run.runId });
  } catch (error) {
    const runId =
      error && typeof error === "object" && "runId" in error && typeof error.runId === "string" ? error.runId : null;

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error inesperado ejecutando el análisis de mercado.",
        runId,
      },
      { status: 500 },
    );
  }
}
