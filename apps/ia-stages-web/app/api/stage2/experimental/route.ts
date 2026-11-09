import { NextResponse } from "next/server";
import { normalizePipelineFailure } from "@/lib/ai-failures";
import { runStage2Experimental } from "@/lib/stage2-experimental";
import { saveStageFailure, saveStageSuccess } from "@/lib/run-history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { stage1Json?: unknown; model?: string; runId?: string } = {};
  const startedAt = Date.now();
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (!body.stage1Json) {
    return NextResponse.json({ error: "Falta stage1Json para Etapa 2 experimental." }, { status: 400 });
  }

  try {
    const result = await runStage2Experimental({
      stage1Json: body.stage1Json,
      model: typeof body.model === "string" ? body.model : undefined,
      runId: typeof body.runId === "string" ? body.runId : undefined
    });
    saveStageSuccess("stage2_experimental", result, Date.now() - startedAt);
    return NextResponse.json(result);
  } catch (error) {
    const pf = normalizePipelineFailure(error, "stage2");
    if (typeof body?.runId === "string") {
      saveStageFailure({
        runId: body.runId,
        stage: "stage2_experimental",
        durationMs: Date.now() - startedAt,
        errorCode: pf.code,
        errorMessage: pf.userMessage,
        details: pf.details,
        raw: pf.raw
      });
    }
    return NextResponse.json(
      {
        error: pf.userMessage,
        diagnostic: pf.technicalMessage,
        code: pf.code,
        userAction: pf.userAction,
        details: pf.details,
        raw: pf.raw
      },
      { status: pf.httpStatus >= 400 && pf.httpStatus < 600 ? pf.httpStatus : 502 }
    );
  }
}
