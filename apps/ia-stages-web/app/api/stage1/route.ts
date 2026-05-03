import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PipelineFailure, failureToApiBody } from "@/lib/ai-failures";
import { runStage1ForFile } from "@/lib/ai-pipeline";
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
  const runId = randomUUID();
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
    upsertRun({
      runId,
      analysisId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileHash: computeBufferHash(fileBuffer)
    });

    const output = await runStage1ForFile(file, runId);
    saveStageSuccess("stage1", output, Date.now() - startedAt);

    const meta = getRunAnalysisMeta(output.runId);

    return NextResponse.json({
      runId: output.runId,
      analysisId: meta.analysisId,
      analysisCode: meta.analysisCode,
      result: output.result,
      raw: output.raw,
      model: output.model,
      usage: output.usage,
      cost: output.cost
    });
  } catch (error) {
    if (error instanceof PipelineFailure) {
      saveStageFailure({
        runId,
        stage: "stage1",
        durationMs: Date.now() - startedAt,
        errorCode: error.code,
        errorTitle: error.title,
        errorMessage: error.userMessage,
        details: error.details,
        raw: error.raw,
        result: error.result
      });

      return NextResponse.json(
        {
          runId,
          ...failureToApiBody(error)
        },
        { status: error.httpStatus }
      );
    }

    return NextResponse.json({ error: "Error inesperado en Etapa 1." }, { status: 500 });
  }
}

function optionalFormString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
