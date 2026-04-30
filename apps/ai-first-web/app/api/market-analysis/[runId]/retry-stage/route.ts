import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function POST(request: Request, props: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await props.params;
    const body = (await request.json().catch(() => ({}))) as { stage_name?: string; stageName?: string };
    const stageName = body.stage_name || body.stageName;

    if (!stageName) {
      return NextResponse.json({ error: "Falta stage_name." }, { status: 400 });
    }

    const result = await getMarketAnalysisService().retryRunStage(runId, stageName);

    return NextResponse.json({
      runId,
      stage_name: stageName,
      status: result.ok ? "completed" : "failed",
      parsed_json: result.value,
      error: result.error,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error inesperado reintentando etapa.",
      },
      { status: 500 },
    );
  }
}
