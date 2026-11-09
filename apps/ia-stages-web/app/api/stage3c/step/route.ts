import { NextResponse } from "next/server";
import { normalizePipelineFailure } from "@/lib/ai-failures";
import { saveStageFailure, saveStageSuccess } from "@/lib/run-history";
import { runStage3BStep } from "@/lib/stage3b-step";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: {
    action?: "quote" | "manual_quote" | "supervise" | "apply" | "discard_last_attempt";
    stage2Json?: unknown;
    currentStage3B?: unknown;
    runId?: string;
    provider?: "openai" | "google";
    model?: string;
    reasoningEffort?: string;
    supervisorModel?: string;
    maxAttempts?: number;
    batchSize?: number;
    searchContextSize?: "low" | "medium" | "high";
    urlContextModel?: string;
    promptInstruction?: string;
    manualRaw?: string;
    manualItemKeys?: unknown;
    manualPromptFinal?: string;
    autoSupervise?: boolean;
    selectedItemKeys?: unknown;
  } = {};

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (!body.stage2Json) {
    return NextResponse.json({ error: "Falta stage2Json para ejecutar Etapa 3-C." }, { status: 400 });
  }

  if (body.action !== "quote" && body.action !== "manual_quote" && body.action !== "supervise" && body.action !== "apply" && body.action !== "discard_last_attempt") {
    return NextResponse.json({ error: "Accion invalida para Etapa 3-C." }, { status: 400 });
  }

  try {
    const output = await runStage3BStep({
      action: body.action,
      stage2Json: body.stage2Json,
      currentStage3B: body.currentStage3B,
      runId: typeof body.runId === "string" ? body.runId : undefined,
      provider: body.action === "manual_quote" ? "manual" : body.provider === "google" ? "google" : "openai",
      model: typeof body.model === "string" ? body.model : undefined,
      reasoningEffort: typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined,
      supervisorModel: typeof body.supervisorModel === "string" ? body.supervisorModel : undefined,
      maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : undefined,
      batchSize: typeof body.batchSize === "number" ? body.batchSize : undefined,
      searchContextSize: body.searchContextSize,
      urlContextModel: typeof body.urlContextModel === "string" ? body.urlContextModel : undefined,
      promptInstruction: typeof body.promptInstruction === "string" ? body.promptInstruction : undefined,
      manualRaw: typeof body.manualRaw === "string" ? body.manualRaw : undefined,
      manualItemKeys: Array.isArray(body.manualItemKeys) ? body.manualItemKeys.filter((value): value is string => typeof value === "string") : undefined,
      manualPromptFinal: typeof body.manualPromptFinal === "string" ? body.manualPromptFinal : undefined,
      autoSupervise: body.autoSupervise === true,
      selectedItemKeys: Array.isArray(body.selectedItemKeys) ? body.selectedItemKeys.filter((value): value is string => typeof value === "string") : undefined
    });
    saveStageSuccess("stage3c", output, Date.now() - startedAt);
    return NextResponse.json(output);
  } catch (error) {
    const pf = normalizePipelineFailure(error, "stage3");
    if (typeof body.runId === "string") {
      saveStageFailure({
        runId: body.runId,
        stage: "stage3c",
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
