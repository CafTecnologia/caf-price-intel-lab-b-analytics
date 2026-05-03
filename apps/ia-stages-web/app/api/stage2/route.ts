import { NextResponse } from "next/server";
import { PipelineFailure, failureToApiBody } from "@/lib/ai-failures";
import { runStage2ForJson } from "@/lib/ai-pipeline";
import { saveStageFailure, saveStageSuccess } from "@/lib/run-history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let runId: string | undefined;
  const startedAt = Date.now();

  try {
    const body = await request.json();

    if (!body?.stage1Json) {
      return NextResponse.json({ error: "Falta el JSON de Etapa 1." }, { status: 400 });
    }

    runId = typeof body?.runId === "string" ? body.runId : undefined;
    const output = await runStage2ForJson(body.stage1Json, runId);
    saveStageSuccess("stage2", output, Date.now() - startedAt);

    return NextResponse.json({
      runId: output.runId,
      result: output.result,
      raw: output.raw,
      model: output.model,
      usage: output.usage,
      cost: output.cost
    });
  } catch (error) {
    if (error instanceof PipelineFailure) {
      if (runId) {
        saveStageFailure({
          runId,
          stage: "stage2",
          durationMs: Date.now() - startedAt,
          errorCode: error.code,
          errorTitle: error.title,
          errorMessage: error.userMessage,
          details: error.details,
          raw: error.raw,
          result: error.result
        });
      }

      return NextResponse.json(
        {
          runId,
          ...failureToApiBody(error)
        },
        { status: error.httpStatus }
      );
    }

    return NextResponse.json({ error: "Error inesperado en Etapa 2." }, { status: 500 });
  }
}
