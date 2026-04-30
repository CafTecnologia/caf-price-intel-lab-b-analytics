import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function POST(_request: Request, props: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await props.params;
    const run = await getMarketAnalysisService().retryRun(runId);

    return NextResponse.json({ runId: run.runId, status: run.status });
  } catch (error) {
    const retryRunId =
      error && typeof error === "object" && "runId" in error && typeof error.runId === "string" ? error.runId : null;

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error inesperado reintentando análisis.",
        runId: retryRunId,
      },
      { status: 500 },
    );
  }
}
