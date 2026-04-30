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

    const stages = service.getRunStages(runId);
    const latestStage = stages.at(-1) ?? null;
    const failedStages = stages.filter((stage) => stage.status === "failed");

    return NextResponse.json({
      run,
      stages,
      summary: {
        status: run.status,
        latestStage: latestStage
          ? {
              stageName: latestStage.stage_name,
              status: latestStage.status,
              model: latestStage.model,
              errorMessage: latestStage.error_message,
              startedAt: latestStage.started_at,
              finishedAt: latestStage.finished_at,
              durationMs: latestStage.duration_ms,
            }
          : null,
        failedStageCount: failedStages.length,
        lastUpdatedAt: run.updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado consultando análisis." },
      { status: 500 },
    );
  }
}
