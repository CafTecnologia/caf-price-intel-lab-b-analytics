import { NextResponse } from "next/server";
import { PipelineFailure, failureToApiBody } from "@/lib/ai-failures";
import { runStage3ForJson } from "@/lib/ai-pipeline";
import { saveStageFailure, saveStageSuccess, type StageSuccessSaveOutcome } from "@/lib/run-history";

export const runtime = "nodejs";

const STAGE3_RESPONSE_RAW_LIMIT = 20000;
const inFlightStage3Runs = new Set<string>();

function rawPreviewForBrowser(raw: unknown) {
  if (typeof raw !== "string") {
    return raw;
  }

  if (raw.length <= STAGE3_RESPONSE_RAW_LIMIT) {
    return raw;
  }

  return raw.slice(0, STAGE3_RESPONSE_RAW_LIMIT) + "\n\n... [respuesta cruda recortada para proteger el navegador: " + (raw.length - STAGE3_RESPONSE_RAW_LIMIT) + " caracteres adicionales]";
}

function preservationPayload(outcome: StageSuccessSaveOutcome, attempted: { provider?: string; model?: string; usage?: unknown; cost?: unknown }) {
  if (!outcome.preservedPrevious) {
    return undefined;
  }
  return {
    preservedPrevious: true,
    reason: outcome.reason,
    attemptedItemCount: outcome.attemptedItemCount,
    activeItemCount: outcome.activeItemCount,
    attemptedCoverage: outcome.attemptedCoverage,
    activeCoverage: outcome.activeCoverage,
    activeRunId: outcome.activeStage?.runId ?? null,
    activeModel: outcome.activeStage?.model ?? null,
    activeProvider: outcome.activeStage?.provider ?? null,
    attemptedModel: attempted.model ?? null,
    attemptedProvider: attempted.provider ?? null
  };
}

function activeStageResponse(outcome: StageSuccessSaveOutcome, output: Awaited<ReturnType<typeof runStage3ForJson>>) {
  if (!outcome.preservedPrevious || !outcome.activeStage?.result) {
    return {
      runId: output.runId,
      result: output.result,
      raw: rawPreviewForBrowser(output.raw),
      model: output.model,
      provider: output.provider,
      groundingMetadata: output.groundingMetadata,
      usage: output.usage,
      cost: output.cost,
      preservation: undefined,
      usageAttempt: undefined
    };
  }

  return {
    runId: output.runId,
    result: outcome.activeStage.result,
    raw: rawPreviewForBrowser(outcome.activeStage.raw ?? output.raw),
    model: outcome.activeStage.model ?? output.model,
    provider: outcome.activeStage.provider ?? output.provider,
    groundingMetadata: output.groundingMetadata,
    usage: output.usage,
    cost: output.cost,
    preservation: preservationPayload(outcome, output),
    usageAttempt: {
      provider: output.provider,
      model: output.model,
      usage: output.usage,
      cost: output.cost,
      itemCount: outcome.attemptedItemCount
    }
  };
}

export async function POST(request: Request) {
  let runId: string | undefined;
  let inFlightKey: string | undefined;
  const startedAt = Date.now();

  try {
    const body = await request.json();

    if (!body?.stage2Json) {
      return NextResponse.json({ error: "Falta el JSON de Etapa 2." }, { status: 400 });
    }

    runId = typeof body?.runId === "string" ? body.runId : undefined;
    inFlightKey = runId ? "run:" + runId : undefined;
    if (inFlightKey && inFlightStage3Runs.has(inFlightKey)) {
      return NextResponse.json(
        {
          runId,
          error: "La Etapa 3 ya se esta procesando para esta corrida.",
          errorCode: "STAGE_ALREADY_RUNNING",
          errorTitle: "Etapa en proceso",
          errorAction: "Espera a que termine la solicitud actual antes de volver a procesar.",
          retryable: false
        },
        { status: 409 }
      );
    }
    if (inFlightKey) {
      inFlightStage3Runs.add(inFlightKey);
    }

    const modelRef = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const output = await runStage3ForJson(body.stage2Json, runId, modelRef ? { modelRef } : undefined);
    const saveOutcome = saveStageSuccess("stage3", output, Date.now() - startedAt);

    return NextResponse.json(activeStageResponse(saveOutcome, output));
  } catch (error) {
    if (error instanceof PipelineFailure) {
      if (runId) {
        saveStageFailure({
          runId,
          stage: "stage3",
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
          ...failureToApiBody(error),
          raw: rawPreviewForBrowser(error.raw)
        },
        { status: error.httpStatus }
      );
    }

    return NextResponse.json({ error: "Error inesperado en Etapa 3." }, { status: 500 });
  } finally {
    if (inFlightKey) {
      inFlightStage3Runs.delete(inFlightKey);
    }
  }
}
