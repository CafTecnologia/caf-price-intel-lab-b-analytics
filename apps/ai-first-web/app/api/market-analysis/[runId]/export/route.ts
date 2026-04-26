import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "xlsx") as "json" | "csv" | "xlsx";
    const view = (url.searchParams.get("view") ?? "market") as "market" | "financial";
    const exportResult = getMarketAnalysisService().exportRun(runId, format, view);

    return new NextResponse(new Uint8Array(exportResult.body), {
      headers: {
        "content-type": exportResult.mimeType,
        "content-disposition": `attachment; filename="${exportResult.fileName}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado exportando la matriz." },
      { status: 500 },
    );
  }
}
