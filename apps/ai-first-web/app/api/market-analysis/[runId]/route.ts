import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function GET(_request: Request, props: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await props.params;
    const service = getMarketAnalysisService();
    const run = service.getRun(runId);

    if (!run) {
      return NextResponse.json({ error: `No existe el análisis: ${runId}` }, { status: 404 });
    }

    return NextResponse.json({
      run,
      stages: service.getRunStages(runId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado consultando análisis." },
      { status: 500 },
    );
  }
}
