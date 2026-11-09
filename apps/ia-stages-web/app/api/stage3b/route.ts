import { NextResponse } from "next/server";
import { normalizePipelineFailure } from "@/lib/ai-failures";
import { saveStageFailure, saveStageSuccess } from "@/lib/run-history";
import { runStage3BAssisted } from "@/lib/stage3b-assisted";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: {
    stage2Json?: unknown;
    runId?: string;
    provider?: "openai" | "google";
    model?: string;
    reasoningEffort?: string;
    supervisorModel?: string;
    maxAttempts?: number;
    batchSize?: number;
    searchContextSize?: "low" | "medium" | "high";
    urlContextModel?: string;
  } = {};

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (!body.stage2Json) {
    return NextResponse.json({ error: "Falta stage2Json para ejecutar Etapa 3-B." }, { status: 400 });
  }

  try {
    const output = await runStage3BAssisted({
      stage2Json: body.stage2Json,
      runId: typeof body.runId === "string" ? body.runId : undefined,
      provider: body.provider === "google" ? "google" : "openai",
      model: typeof body.model === "string" ? body.model : undefined,
      reasoningEffort: typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined,
      supervisorModel: typeof body.supervisorModel === "string" ? body.supervisorModel : undefined,
      maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : undefined,
      batchSize: typeof body.batchSize === "number" ? body.batchSize : undefined,
      searchContextSize: body.searchContextSize,
      urlContextModel: typeof body.urlContextModel === "string" ? body.urlContextModel : undefined
    });
    saveStageSuccess("stage3b", output, Date.now() - startedAt);
    return NextResponse.json(output);
  } catch (error) {
    const pf = normalizePipelineFailure(error, "stage3");
    if (typeof body.runId === "string") {
      saveStageFailure({
        runId: body.runId,
        stage: "stage3b",
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
