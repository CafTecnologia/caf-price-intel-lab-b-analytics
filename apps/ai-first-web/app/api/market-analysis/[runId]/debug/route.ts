import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function GET(_request: Request, props: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await props.params;
    const report = getMarketAnalysisService().buildDebugReport(runId);

    return new NextResponse(report, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado generando reporte debug." },
      { status: 500 },
    );
  }
}
