import { NextResponse } from "next/server";
import { normalizePipelineFailure } from "@/lib/ai-failures";
import { runOpenAiStage3Lab } from "@/lib/stage3-openai-lab";
import { saveStageFailure, saveStageSuccess } from "@/lib/run-history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    stage2Json?: unknown;
    model?: string;
    reasoningEffort?: string;
    searchContextSize?: "low" | "medium" | "high";
    maxOutputTokens?: number;
    runId?: string;
  } = {};
  const startedAt = Date.now();

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (!body.stage2Json) {
    return NextResponse.json({ error: "Falta stage2Json para cotizar con OpenAI." }, { status: 400 });
  }

  try {
    const result = await runOpenAiStage3Lab({
      stage2Json: body.stage2Json,
      model: typeof body.model === "string" ? body.model : undefined,
      reasoningEffort: typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined,
      searchContextSize: body.searchContextSize,
      maxOutputTokens: typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : undefined,
      runId: typeof body.runId === "string" ? body.runId : undefined
    });
    saveStageSuccess("stage3_openai_lab", result, Date.now() - startedAt);
    return NextResponse.json(result);
  } catch (error) {
    const pf = normalizePipelineFailure(error, "stage3");
    if (typeof body?.runId === "string") {
      saveStageFailure({
        runId: body.runId,
        stage: "stage3_openai_lab",
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
