import { NextResponse } from "next/server";
import { PipelineFailure, failureToApiBody } from "@/lib/ai-failures";
import { runFullAiPipeline } from "@/lib/ai-pipeline";
import {
  computeBufferHash,
  createAnalysis,
  getAnalysisById,
  getRunAnalysisMeta,
  saveStageFailure,
  saveStageSuccess,
  upsertRun
} from "@/lib/run-history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Carga un archivo valido." }, { status: 400 });
    }

    const analysisIdParam = optionalFormString(formData.get("analysisId"));
    const odooProjectId = optionalFormString(formData.get("odooProjectId"));

    let analysisId: string;
    if (analysisIdParam) {
      const existing = getAnalysisById(analysisIdParam);
      if (!existing) {
        return NextResponse.json({ error: "analysisId no encontrado." }, { status: 400 });
      }
      analysisId = analysisIdParam;
    } else {
      analysisId = createAnalysis({ odooProjectId: odooProjectId ?? null, title: file.name }).id;
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const output = await runFullAiPipeline(file);
    upsertRun({
      runId: output.runId,
      analysisId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileHash: computeBufferHash(fileBuffer)
    });
    saveStageSuccess("stage1", output.stage1);
    saveStageSuccess("stage2", output.stage2, Date.now() - startedAt);

    const meta = getRunAnalysisMeta(output.runId);

    return NextResponse.json({
      status: "completed",
      runId: output.runId,
      analysisId: meta.analysisId,
      analysisCode: meta.analysisCode,
      stage1: output.stage1,
      stage2: output.stage2
    });
  } catch (error) {
    if (error instanceof PipelineFailure) {
      const extended = error as PipelineFailure & {
        runId?: string;
        partialStage1?: unknown;
      };
      if (extended.runId) {
        saveStageFailure({
          runId: extended.runId,
          stage: error.stage === "stage3" ? "stage3" : error.stage === "stage2" ? "stage2" : "stage1",
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
          status: "failed",
          runId: extended.runId,
          failedStage: error.stage,
          ...failureToApiBody(error),
          stage1: extended.partialStage1,
          raw: error.raw,
          result: error.result
        },
        { status: error.httpStatus }
      );
    }

    return NextResponse.json(
      {
        status: "failed",
        failedStage: "pipeline",
        errorCode: "UNEXPECTED_ERROR",
        error: "Ocurrio un error inesperado durante el procesamiento."
      },
      { status: 500 }
    );
  }
}

function optionalFormString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
