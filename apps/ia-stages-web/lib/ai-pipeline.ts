import { randomUUID } from "node:crypto";
import { PipelineFailure, normalizePipelineFailure } from "@/lib/ai-failures";
import { callGemini, callGeminiWithSearch } from "@/lib/gemini";
import { JsonParseError, parseJsonFromModelText } from "@/lib/json";
import { writePipelineLog } from "@/lib/pipeline-log";
import { annotateStage3Coverage } from "@/lib/stage3Review";
import { validateStageResult } from "@/lib/stage-validation";
import { extractTextFromFile } from "@/lib/text-extract";
import {
  estimateAiCost,
  extractDeepSeekUsageMetadata,
  extractGeminiUsageMetadata,
  summarizeSearchUsage,
  type AiCostSummary,
  type AiUsageSummary
} from "@/lib/usage-cost";
import { buildStage1Prompt } from "@/prompts/stage1-extraction";
import { buildStage2Prompt } from "@/prompts/stage2-technical";
import { buildStage3Prompt } from "@/prompts/stage3-pricing";

export type StageOutput = {
  runId: string;
  result: Record<string, unknown>;
  raw: string;
  provider?: "gemini" | "deepseek" | "openai" | "vps";
  model: string;
  groundingMetadata?: unknown;
  usage?: AiUsageSummary;
  cost?: AiCostSummary;
  /** Trazabilidad opcional (p. ej. reintentos por congestión del proveedor). */
  callTrace?: { status?: string; congestionRetries?: number };
};

/** Override puntual del modelo (`gemini:...` / `deepseek:...`) para una sola ejecución. */
export type StageRunOptions = {
  modelRef?: string;
};

export type PipelineOutput = {
  runId: string;
  stage1: StageOutput;
  stage2: StageOutput;
};

const STAGE2_CHUNK_THRESHOLD = 120;
const STAGE2_CHUNK_SIZE = 60;
const STAGE1_CHUNK_LINE_THRESHOLD = 120;
const STAGE1_CHUNK_CHAR_THRESHOLD = 36000;
const STAGE1_CHUNK_LINE_SIZE = 55;

export async function runFullAiPipeline(file: File): Promise<PipelineOutput> {
  const runId = randomUUID();
  let stage1: StageOutput | null = null;

  await writePipelineLog({
    runId,
    stage: "pipeline",
    event: "started",
    fileName: file.name,
    data: { fileSize: file.size, fileType: file.type }
  });

  try {
    stage1 = await runStage1ForFile(file, runId);
    const stage2 = await runStage2ForJson(stage1.result, runId);

    await writePipelineLog({
      runId,
      stage: "pipeline",
      event: "completed",
      fileName: file.name,
      data: {
        stage1Items: getItemsCount(stage1.result),
        stage2Items: getItemsCount(stage2.result)
      }
    });

    return { runId, stage1, stage2 };
  } catch (error) {
    const failure = normalizePipelineFailure(error, "pipeline");

    await writePipelineLog({
      runId,
      stage: failure.stage,
      event: "failed",
      fileName: file.name,
      data: {
        code: failure.code,
        title: failure.title,
        userMessage: failure.userMessage,
        technicalMessage: failure.technicalMessage,
        details: failure.details,
        partialStage1Items: stage1 ? getItemsCount(stage1.result) : 0
      },
      error
    });

    throw Object.assign(failure, {
      runId,
      partialStage1: stage1
    });
  }
}

export async function runStage1ForFile(
  file: File,
  runId: string = randomUUID(),
  options?: StageRunOptions
): Promise<StageOutput> {
  const startedAt = Date.now();

  await writePipelineLog({
    runId,
    stage: "stage1",
    event: "started",
    fileName: file.name,
    data: { fileSize: file.size, fileType: file.type }
  });

  try {
    const documentText = (await extractTextFromFile(file)).trim();

    if (!documentText) {
      throw new PipelineFailure({
        code: "FILE_TEXT_EXTRACTION_FAILED",
        stage: "stage1",
        technicalMessage: "El extractor devolvio texto vacio."
      });
    }

    await writePipelineLog({
      runId,
      stage: "stage1",
      event: "text_extracted",
      fileName: file.name,
      data: { textLength: documentText.length, textPreview: documentText.slice(0, 2000) }
    });

    const stage1Chunks = buildStage1TextChunks(documentText);
    if (stage1Chunks.length > 1) {
      return await runStage1ForFileChunked({
        fileName: file.name,
        documentText,
        chunks: stage1Chunks,
        runId,
        options,
        startedAt
      });
    }

    const prompt = buildStage1Prompt(documentText, file.name);
    await writePipelineLog({
      runId,
      stage: "stage1",
      event: "ai_request_sent",
      fileName: file.name,
      data: { promptLength: prompt.length }
    });

    const gemini = await callGemini({ prompt, stage: "stage1", model: options?.modelRef });
    const provider = gemini.provider ?? "gemini";
    const usage = extractUsage(provider, gemini.usageMetadata);
    const cost = estimateAiCost({ provider, model: gemini.model, usage });

    await writePipelineLog({
      runId,
      stage: "stage1",
      event: "ai_response",
      provider,
      model: gemini.model,
      fileName: file.name,
      durationMs: Date.now() - startedAt,
      data: {
        rawLength: gemini.text.length,
        rawPreview: gemini.text.slice(0, 4000),
        usage,
        cost,
        congestionRetries: gemini.congestionRetries ?? 0
      }
    });

    const result = normalizeInternalConsecutive(parseStageJson("stage1", gemini.text));
    validateStageResult("stage1", result);

    await writePipelineLog({
      runId,
      stage: "stage1",
      event: "validated",
      provider,
      model: gemini.model,
      fileName: file.name,
      durationMs: Date.now() - startedAt,
      data: { items: getItemsCount(result), usage, cost }
    });

    return {
      runId,
      result,
      raw: gemini.text,
      provider,
      model: gemini.model,
      usage,
      cost,
      callTrace: { status: "ok", congestionRetries: gemini.congestionRetries ?? 0 }
    };
  } catch (error) {
    const failure = normalizeStageError(error, "stage1", Date.now() - startedAt);

    await writePipelineLog({
      runId,
      stage: "stage1",
      event: "failed",
      fileName: file.name,
      durationMs: Date.now() - startedAt,
      data: {
        code: failure.code,
        title: failure.title,
        userMessage: failure.userMessage,
        userAction: failure.userAction,
        category: failure.category,
        retryable: failure.retryable,
        technicalMessage: failure.technicalMessage,
        details: failure.details,
        raw: failure.raw,
        result: failure.result
      },
      error
    });

    throw failure;
  }
}

export async function runStage2ForJson(
  stage1Json: unknown,
  runId: string = randomUUID(),
  options?: StageRunOptions
): Promise<StageOutput> {
  const startedAt = Date.now();
  const inputItems = getItemsArray(stage1Json);

  await writePipelineLog({
    runId,
    stage: "stage2",
    event: "started",
    data: { inputItems: inputItems.length }
  });

  try {
    if (inputItems.length > STAGE2_CHUNK_THRESHOLD) {
      return await runStage2ForJsonChunked({
        stage1Json,
        inputItems,
        runId,
        options,
        startedAt
      });
    }

    const prompt = buildStage2Prompt(stage1Json);
    await writePipelineLog({
      runId,
      stage: "stage2",
      event: "ai_request_sent",
      data: { promptLength: prompt.length, inputItems: getItemsCount(stage1Json) }
    });

    const gemini = await callGemini({ prompt, stage: "stage2", model: options?.modelRef });
    const provider = gemini.provider ?? "gemini";
    const usage = extractUsage(provider, gemini.usageMetadata);
    const cost = estimateAiCost({ provider, model: gemini.model, usage });

    await writePipelineLog({
      runId,
      stage: "stage2",
      event: "ai_response",
      provider,
      model: gemini.model,
      durationMs: Date.now() - startedAt,
      data: {
        rawLength: gemini.text.length,
        rawPreview: gemini.text.slice(0, 4000),
        usage,
        cost,
        congestionRetries: gemini.congestionRetries ?? 0
      }
    });

    const result = normalizeInternalConsecutive(parseStageJson("stage2", gemini.text));
    validateStageResult("stage2", result);

    await writePipelineLog({
      runId,
      stage: "stage2",
      event: "validated",
      provider,
      model: gemini.model,
      durationMs: Date.now() - startedAt,
      data: { items: getItemsCount(result), usage, cost }
    });

    return {
      runId,
      result,
      raw: gemini.text,
      provider,
      model: gemini.model,
      usage,
      cost,
      callTrace: { status: "ok", congestionRetries: gemini.congestionRetries ?? 0 }
    };
  } catch (error) {
    const failure = normalizeStageError(error, "stage2", Date.now() - startedAt);

    await writePipelineLog({
      runId,
      stage: "stage2",
      event: "failed",
      durationMs: Date.now() - startedAt,
      data: {
        code: failure.code,
        title: failure.title,
        userMessage: failure.userMessage,
        userAction: failure.userAction,
        category: failure.category,
        retryable: failure.retryable,
        technicalMessage: failure.technicalMessage,
        details: failure.details,
        raw: failure.raw,
        result: failure.result
      },
      error
    });

    throw failure;
  }
}

async function runStage1ForFileChunked(input: {
  fileName: string;
  documentText: string;
  chunks: Stage1TextChunk[];
  runId: string;
  options?: StageRunOptions;
  startedAt: number;
}): Promise<StageOutput> {
  const mergedItems: Record<string, unknown>[] = [];
  const rawChunks: Array<{
    chunk: number;
    totalChunks: number;
    inputLines: number;
    outputItems: number;
    model: string;
    provider: string;
    lineStart: number;
    lineEnd: number;
    rawPreview: string;
    notes: string[];
  }> = [];
  const usages: AiUsageSummary[] = [];
  const costs: AiCostSummary[] = [];
  let provider: "gemini" | "deepseek" | "openai" | "vps" = "gemini";
  let model = input.options?.modelRef ?? "gemini";
  let congestionRetries = 0;

  await writePipelineLog({
    runId: input.runId,
    stage: "stage1",
    event: "chunked_started",
    fileName: input.fileName,
    durationMs: Date.now() - input.startedAt,
    data: {
      textLength: input.documentText.length,
      chunks: input.chunks.length,
      chunkLineSize: STAGE1_CHUNK_LINE_SIZE
    }
  });

  for (let index = 0; index < input.chunks.length; index += 1) {
    const chunk = input.chunks[index];
    const chunkStartedAt = Date.now();
    const chunkFileName = `${input.fileName} [bloque ${chunk.chunk}/${chunk.totalChunks}, lineas ${chunk.lineStart}-${chunk.lineEnd}]`;
    const prompt = buildStage1Prompt(buildStage1ChunkDocumentText(chunk), chunkFileName);

    await writePipelineLog({
      runId: input.runId,
      stage: "stage1",
      event: "chunk_ai_request_sent",
      fileName: input.fileName,
      durationMs: Date.now() - input.startedAt,
      data: {
        chunk: chunk.chunk,
        chunks: chunk.totalChunks,
        inputLines: chunk.inputLines,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        promptLength: prompt.length
      }
    });

    const ai = await callGemini({ prompt, stage: "stage1", model: input.options?.modelRef });
    provider = ai.provider ?? "gemini";
    model = ai.model;
    congestionRetries += ai.congestionRetries ?? 0;

    const usage = extractUsage(provider, ai.usageMetadata);
    const cost = estimateAiCost({ provider, model, usage });
    if (usage) usages.push(usage);
    if (cost) costs.push(cost);

    const parsedChunk = parseStage1ChunkTolerant(ai.text);
    const anchoredChunk = applyStage1ChunkSoftAnchors(parsedChunk.items, chunk.sourceItemIds);
    mergedItems.push(...anchoredChunk.items);
    rawChunks.push({
      chunk: chunk.chunk,
      totalChunks: chunk.totalChunks,
      inputLines: chunk.inputLines,
      outputItems: anchoredChunk.items.length,
      model,
      provider,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      rawPreview: ai.text.slice(0, 16000),
      notes: [...parsedChunk.notes, ...anchoredChunk.notes]
    });

    await writePipelineLog({
      runId: input.runId,
      stage: "stage1",
      event: "chunk_ai_response",
      provider,
      model,
      fileName: input.fileName,
      durationMs: Date.now() - chunkStartedAt,
      data: {
        chunk: chunk.chunk,
        chunks: chunk.totalChunks,
        rawLength: ai.text.length,
        recoveredItems: anchoredChunk.items.length,
        notes: [...parsedChunk.notes, ...anchoredChunk.notes],
        usage,
        cost,
        congestionRetries: ai.congestionRetries ?? 0
      }
    });
  }

  const usage = aggregateUsage(usages);
  const cost = aggregateCost(costs, provider, model, "Costos acumulados por fragmentos de Etapa 1.");
  const result = normalizeInternalConsecutive({
    metadata: {
      total_items_detectados: mergedItems.length,
      observaciones_generales: [
        `Etapa 1 procesada por fragmentos: ${input.chunks.length} bloque(s) de hasta ${STAGE1_CHUNK_LINE_SIZE} linea(s) de documento.`
      ],
      app_stage1_policy: "chunked_large_input",
      app_stage1_chunks: input.chunks.length,
      app_stage1_chunk_line_size: STAGE1_CHUNK_LINE_SIZE
    },
    items: mergedItems.map((item, index) => ({
      ...item,
      "Consecutivo interno": index + 1
    }))
  });
  validateStageResult("stage1", result);

  await writePipelineLog({
    runId: input.runId,
    stage: "stage1",
    event: "validated",
    provider,
    model,
    fileName: input.fileName,
    durationMs: Date.now() - input.startedAt,
    data: {
      items: getItemsCount(result),
      chunked: true,
      chunks: input.chunks.length,
      usage,
      cost,
      congestionRetries
    }
  });

  return {
    runId: input.runId,
    result,
    raw: JSON.stringify(
      {
        app_stage1_policy: "chunked_large_input",
        chunks: rawChunks
      },
      null,
      2
    ),
    provider,
    model,
    usage,
    cost,
    callTrace: { status: "ok", congestionRetries }
  };
}

async function runStage2ForJsonChunked(input: {
  stage1Json: unknown;
  inputItems: Record<string, unknown>[];
  runId: string;
  options?: StageRunOptions;
  startedAt: number;
}): Promise<StageOutput> {
  const chunks = chunkArray(input.inputItems, STAGE2_CHUNK_SIZE);
  const mergedItems: Record<string, unknown>[] = [];
  const rawChunks: Array<{
    chunk: number;
    totalChunks: number;
    inputItems: number;
    outputItems: number;
    model: string;
    provider: string;
    rawPreview: string;
    notes: string[];
  }> = [];
  const usages: AiUsageSummary[] = [];
  const costs: AiCostSummary[] = [];
  let provider: "gemini" | "deepseek" | "openai" | "vps" = "gemini";
  let model = input.options?.modelRef ?? "gemini";
  let congestionRetries = 0;

  await writePipelineLog({
    runId: input.runId,
    stage: "stage2",
    event: "chunked_started",
    durationMs: Date.now() - input.startedAt,
    data: {
      inputItems: input.inputItems.length,
      chunkSize: STAGE2_CHUNK_SIZE,
      chunks: chunks.length
    }
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkStartedAt = Date.now();
    const chunkNumber = index + 1;
    const subset = buildStage2ChunkInput(input.stage1Json, chunk, chunkNumber, chunks.length);
    const prompt = buildStage2Prompt(subset);

    await writePipelineLog({
      runId: input.runId,
      stage: "stage2",
      event: "chunk_ai_request_sent",
      durationMs: Date.now() - input.startedAt,
      data: {
        chunk: chunkNumber,
        chunks: chunks.length,
        chunkItems: chunk.length,
        promptLength: prompt.length
      }
    });

    const ai = await callGemini({ prompt, stage: "stage2", model: input.options?.modelRef });
    provider = ai.provider ?? "gemini";
    model = ai.model;
    congestionRetries += ai.congestionRetries ?? 0;

    const usage = extractUsage(provider, ai.usageMetadata);
    const cost = estimateAiCost({ provider, model, usage });
    if (usage) usages.push(usage);
    if (cost) costs.push(cost);

    const parsedChunk = parseStage2ChunkTolerant(ai.text, chunk);
    mergedItems.push(...parsedChunk.items);
    rawChunks.push({
      chunk: chunkNumber,
      totalChunks: chunks.length,
      inputItems: chunk.length,
      outputItems: parsedChunk.items.length,
      model,
      provider,
      rawPreview: ai.text.slice(0, 16000),
      notes: parsedChunk.notes
    });

    await writePipelineLog({
      runId: input.runId,
      stage: "stage2",
      event: "chunk_ai_response",
      provider,
      model,
      durationMs: Date.now() - chunkStartedAt,
      data: {
        chunk: chunkNumber,
        chunks: chunks.length,
        rawLength: ai.text.length,
        recoveredItems: parsedChunk.items.length,
        notes: parsedChunk.notes,
        usage,
        cost,
        congestionRetries: ai.congestionRetries ?? 0
      }
    });
  }

  const usage = aggregateUsage(usages);
  const cost = aggregateCost(costs, provider, model, "Costos acumulados por fragmentos de Etapa 2.");
  const result = normalizeInternalConsecutive({
    metadata: {
      ...(isRecord(input.stage1Json) && isRecord(input.stage1Json.metadata) ? input.stage1Json.metadata : {}),
      total_items_detectados: mergedItems.length,
      total_items_analizados: mergedItems.length,
      observaciones_generales: [
        `Etapa 2 procesada por fragmentos: ${chunks.length} bloque(s) de hasta ${STAGE2_CHUNK_SIZE} item(s).`
      ],
      app_stage2_policy: "chunked_large_input",
      app_stage2_chunks: chunks.length,
      app_stage2_chunk_size: STAGE2_CHUNK_SIZE
    },
    items: mergedItems,
    control_calidad: {
      resumen_general: `Procesamiento técnico fragmentado completado para ${mergedItems.length} item(s).`,
      app_stage2_policy: "chunked_large_input",
      chunks: rawChunks.map((chunk) => ({
        chunk: chunk.chunk,
        inputItems: chunk.inputItems,
        outputItems: chunk.outputItems,
        notes: chunk.notes
      }))
    }
  });
  validateStageResult("stage2", result);

  await writePipelineLog({
    runId: input.runId,
    stage: "stage2",
    event: "validated",
    provider,
    model,
    durationMs: Date.now() - input.startedAt,
    data: {
      items: getItemsCount(result),
      chunked: true,
      chunks: chunks.length,
      usage,
      cost,
      congestionRetries
    }
  });

  return {
    runId: input.runId,
    result,
    raw: JSON.stringify(
      {
        app_stage2_policy: "chunked_large_input",
        inputItems: input.inputItems.length,
        chunks: rawChunks
      },
      null,
      2
    ),
    provider,
    model,
    usage,
    cost,
    callTrace: { status: "ok", congestionRetries }
  };
}

export async function runStage3ForJson(
  stage2Json: unknown,
  runId: string = randomUUID(),
  options?: StageRunOptions
): Promise<StageOutput> {
  const startedAt = Date.now();

  await writePipelineLog({
    runId,
    stage: "stage3",
    event: "started",
    data: { inputItems: getItemsCount(stage2Json) }
  });

  try {
    const prompt = buildStage3Prompt(stage2Json);
    await writePipelineLog({
      runId,
      stage: "stage3",
      event: "ai_search_request_sent",
      data: { promptLength: prompt.length, inputItems: getItemsCount(stage2Json) }
    });

    const gemini = await callGeminiWithSearch({ prompt, stage: "stage3", model: options?.modelRef });
    const groundingMetadata = summarizeGroundingMetadata(gemini.groundingMetadata);
    const provider = gemini.provider ?? "gemini";
    const usage = extractUsage(provider, gemini.usageMetadata);
    const search = summarizeSearchUsage(groundingMetadata);
    const cost = estimateAiCost({
      provider,
      model: gemini.model,
      usage,
      search
    });

    await writePipelineLog({
      runId,
      stage: "stage3",
      event: "ai_search_response",
      provider,
      model: gemini.model,
      durationMs: Date.now() - startedAt,
      data: {
        rawLength: gemini.text.length,
        rawPreview: gemini.text.slice(0, 4000),
        groundingMetadata,
        usage,
        search,
        cost,
        congestionRetries: gemini.congestionRetries ?? 0
      }
    });

    const parsedStage3 = parseStage3JsonTolerant(gemini.text);
    const result = annotateStage3Coverage(stage2Json, parsedStage3.result);
    const notes = parsedStage3.notes;

    await writePipelineLog({
      runId,
      stage: "stage3",
      event: "organized",
      provider,
      model: gemini.model,
      durationMs: Date.now() - startedAt,
      data: {
        items: getItemsCount(result),
        notes,
        groundingMetadata,
        usage,
        search,
        cost
      }
    });

    return {
      runId,
      result,
      raw: gemini.text,
      provider,
      model: gemini.model,
      groundingMetadata,
      usage,
      cost,
      callTrace: { status: "ok", congestionRetries: gemini.congestionRetries ?? 0 }
    };
  } catch (error) {
    const failure = normalizeStageError(error, "stage3", Date.now() - startedAt);

    await writePipelineLog({
      runId,
      stage: "stage3",
      event: "failed",
      durationMs: Date.now() - startedAt,
      data: {
        code: failure.code,
        title: failure.title,
        userMessage: failure.userMessage,
        userAction: failure.userAction,
        category: failure.category,
        retryable: failure.retryable,
        technicalMessage: failure.technicalMessage,
        details: failure.details,
        raw: failure.raw,
        result: failure.result
      },
      error
    });

    throw failure;
  }
}

function parseStageJson(stage: "stage1" | "stage2" | "stage3", raw: string) {
  try {
    return parseJsonFromModelText<Record<string, unknown>>(raw);
  } catch (error) {
    if (error instanceof JsonParseError) {
      throw new PipelineFailure({
        code: "AI_JSON_INVALID",
        stage,
        technicalMessage: error.message,
        raw: error.raw,
        details: { cleaned: error.cleaned }
      });
    }

    throw error;
  }
}

function parseStage3JsonTolerant(raw: string): { result: Record<string, unknown>; notes: string[] } {
  const notes: string[] = [];
  let parsed: unknown;

  try {
    parsed = parseJsonFromModelText<unknown>(raw);
  } catch (error) {
    if (error instanceof JsonParseError) {
      notes.push("La IA devolvio texto, pero no se pudo convertir automaticamente a JSON completo.");
      const recoveredItems = salvageStage3ItemsFromRaw(error.raw, error.cleaned);
      if (recoveredItems.length) {
        notes.push(`La app recupero ${recoveredItems.length} item(s) completos desde la respuesta parcial del modelo.`);
        return {
          result: {
            metadata: {
              app_stage3_policy: "tolerant_receive_and_organize",
              estado_parseo: "json_parcial_recuperado"
            },
            items: recoveredItems,
            control_calidad: {
              estado_app: "json_parcial_recuperado",
              notas_app: notes,
              cleaned_preview: error.cleaned.slice(0, 4000)
            }
          },
          notes
        };
      }
      return {
        result: buildStage3FallbackResult({
          status: "texto_crudo_recibido",
          notes,
          cleanedPreview: error.cleaned.slice(0, 4000)
        }),
        notes
      };
    }
    throw error;
  }

  let result: Record<string, unknown>;
  if (Array.isArray(parsed)) {
    notes.push("La IA devolvio un arreglo directamente; la app lo organizo dentro de items[].");
    result = { items: parsed };
  } else if (isRecord(parsed)) {
    result = { ...parsed };
  } else {
    notes.push("La IA devolvio JSON, pero no como objeto de Etapa 3; se conserva como valor recibido.");
    result = buildStage3FallbackResult({ status: "json_no_estandar", notes, received: parsed });
  }

  if (!Array.isArray(result.items)) {
    const recoveredItems = findFirstArrayValue(result);
    if (recoveredItems) {
      notes.push("No venia items[] con ese nombre; la app uso el primer arreglo encontrado como items[].");
      result.items = recoveredItems;
    } else {
      notes.push("No se encontro items[] en el JSON; se conserva el objeto recibido para revision.");
      result.items = [];
    }
  }

  if (!isRecord(result.metadata)) {
    notes.push("Faltaba metadata; la app agrego metadata basica.");
    result.metadata = {};
  }

  result.metadata = {
    ...(result.metadata as Record<string, unknown>),
    app_stage3_policy: "tolerant_receive_and_organize"
  };

  if (!isRecord(result.control_calidad)) {
    result.control_calidad = {};
  }

  result.control_calidad = {
    ...(result.control_calidad as Record<string, unknown>),
    estado_app: notes.length ? "recibido_con_notas" : "recibido",
    notas_app: notes
  };

  return { result: normalizeInternalConsecutive(result), notes };
}

function buildStage3FallbackResult(input: {
  status: string;
  notes: string[];
  cleanedPreview?: string;
  received?: unknown;
}): Record<string, unknown> {
  return {
    metadata: {
      app_stage3_policy: "tolerant_receive_and_organize",
      estado_parseo: input.status
    },
    items: [],
    control_calidad: {
      estado_app: input.status,
      notas_app: input.notes,
      cleaned_preview: input.cleanedPreview,
      valor_recibido: input.received
    }
  };
}

function findFirstArrayValue(value: Record<string, unknown>): unknown[] | null {
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      return entry;
    }
  }
  return null;
}

function salvageStage3ItemsFromRaw(raw: string, cleaned: string): Record<string, unknown>[] {
  const candidates = [cleaned, raw].filter((item, index, arr) => item && arr.indexOf(item) === index);
  for (const candidate of candidates) {
    const items = salvageItemsArrayObjects(candidate);
    if (items.length) {
      return items;
    }
  }
  return [];
}

function salvageItemsArrayObjects(textInput: string): Record<string, unknown>[] {
  const text = stripMarkdownFence(textInput);
  const itemsMatch = /"items"\s*:/i.exec(text);
  if (!itemsMatch) {
    return [];
  }
  const arrayStart = text.indexOf("[", itemsMatch.index + itemsMatch[0].length);
  if (arrayStart < 0) {
    return [];
  }

  const items: Record<string, unknown>[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaping = false;

  for (let i = arrayStart + 1; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        objectStart = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && objectStart >= 0) {
        const slice = text.slice(objectStart, i + 1);
        try {
          const parsedItem = JSON.parse(slice) as unknown;
          if (isRecord(parsedItem)) {
            items.push(parsedItem);
          }
        } catch {
          // Si un item puntual viene roto, seguimos buscando otros objetos completos.
        }
        objectStart = -1;
      }
    }
  }

  return items;
}

function stripMarkdownFence(raw: string) {
  let text = raw.trim().replace(/^﻿/, "");
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)(?:\s*```)?$/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStageError(error: unknown, stage: "stage1" | "stage2" | "stage3", durationMs: number) {
  const failure = error instanceof PipelineFailure ? error : normalizePipelineFailure(error, stage);

  if (failure.code === "API_CONNECTION_FAILED" && durationMs >= 120000) {
    return new PipelineFailure({
      code: "API_TIMEOUT",
      stage,
      technicalMessage: `La llamada al proveedor termino sin respuesta util despues de ${Math.round(durationMs / 1000)}s. Mensaje original: ${failure.technicalMessage}`,
      details: {
        ...(failure.details ?? {}),
        elapsedMs: durationMs,
        originalCode: failure.code,
        originalTechnicalMessage: failure.technicalMessage
      },
      raw: failure.raw,
      result: failure.result
    });
  }

  return failure;
}

function summarizeGroundingMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const value = metadata as {
    webSearchQueries?: unknown;
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };

  return {
    webSearchQueries: value.webSearchQueries,
    groundingSources: Array.isArray(value.groundingChunks)
      ? value.groundingChunks.map((chunk) => ({
          title: chunk.web?.title,
          uri: chunk.web?.uri
        }))
      : undefined
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type Stage1TextChunk = {
  chunk: number;
  totalChunks: number;
  text: string;
  lineStart: number;
  lineEnd: number;
  inputLines: number;
  sourceItemIds: Array<string | null>;
};

const STAGE1_REQUIRED_ITEM_FIELDS = [
  "Consecutivo interno",
  "Lote",
  "No. item",
  "Nombre o descripción",
  "Detalles o ficha técnica",
  "Und de medida",
  "Cant",
  "Precio techo encontrado"
];

function buildStage1TextChunks(documentText: string): Stage1TextChunk[] {
  const lines = documentText.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length <= STAGE1_CHUNK_LINE_THRESHOLD && documentText.length <= STAGE1_CHUNK_CHAR_THRESHOLD) {
    return [
      {
        chunk: 1,
        totalChunks: 1,
        text: documentText,
        lineStart: 1,
        lineEnd: lines.length,
        inputLines: lines.length,
        sourceItemIds: []
      }
    ];
  }

  const draftChunks: Array<Omit<Stage1TextChunk, "chunk" | "totalChunks">> = [];
  const sections = splitStage1Sections(lines);

  for (const section of sections) {
    for (let index = 0; index < section.dataLines.length; index += STAGE1_CHUNK_LINE_SIZE) {
      const dataSlice = section.dataLines.slice(index, index + STAGE1_CHUNK_LINE_SIZE);
      if (!dataSlice.length) {
        continue;
      }
      draftChunks.push({
        text: [...section.contextLines, ...dataSlice].join("\n"),
        lineStart: section.dataLineStart + index,
        lineEnd: section.dataLineStart + index + dataSlice.length - 1,
        inputLines: dataSlice.length,
        sourceItemIds: dataSlice.map(extractStage1SourceItemId)
      });
    }
  }

  if (draftChunks.length <= 1) {
    return [
      {
        chunk: 1,
        totalChunks: 1,
        text: documentText,
        lineStart: 1,
        lineEnd: lines.length,
        inputLines: lines.length,
        sourceItemIds: []
      }
    ];
  }

  return draftChunks.map((chunk, index) => ({
    ...chunk,
    chunk: index + 1,
    totalChunks: draftChunks.length
  }));
}

function splitStage1Sections(lines: string[]) {
  const starts = lines
    .map((line, index) => (/^Hoja:\s*/i.test(line.trim()) ? index : -1))
    .filter((index) => index >= 0);

  const sectionStarts = starts.length ? starts : [0];

  return sectionStarts.map((start, index) => {
    const end = sectionStarts[index + 1] ?? lines.length;
    const sectionLines = lines.slice(start, end);
    const hasSheetHeader = /^Hoja:\s*/i.test(sectionLines[0]?.trim() ?? "");
    const contextCount = Math.min(sectionLines.length, hasSheetHeader ? 2 : 0);
    const contextLines = sectionLines.slice(0, contextCount);
    const dataLines = sectionLines.slice(contextCount);

    return {
      contextLines,
      dataLines: dataLines.length ? dataLines : sectionLines,
      dataLineStart: start + contextCount + 1
    };
  });
}

function buildStage1ChunkDocumentText(chunk: Stage1TextChunk) {
  return [
    `Fragmento ${chunk.chunk} de ${chunk.totalChunks}.`,
    `Lineas del documento original: ${chunk.lineStart}-${chunk.lineEnd}.`,
    "Si el fragmento tiene una columna Item, conserva ese valor en \"No. item\".",
    "Extrae únicamente los ítems visibles en este fragmento. No incluyas ítems de otros fragmentos.",
    chunk.text
  ].join("\n");
}

function extractStage1SourceItemId(line: string): string | null {
  const firstCell = readFirstDelimitedCell(line).trim();
  if (!firstCell || firstCell.length > 40) {
    return null;
  }

  if (!/^[\wÁÉÍÓÚÜÑáéíóúüñ .#/-]+$/u.test(firstCell)) {
    return null;
  }

  return firstCell;
}

function readFirstDelimitedCell(line: string) {
  const text = line.trim();
  if (!text) {
    return "";
  }

  if (text.startsWith('"')) {
    let value = "";
    for (let index = 1; index < text.length; index += 1) {
      const ch = text[index];
      const next = text[index + 1];
      if (ch === '"' && next === '"') {
        value += '"';
        index += 1;
        continue;
      }
      if (ch === '"') {
        return value;
      }
      value += ch;
    }
    return value;
  }

  const comma = text.indexOf(",");
  return comma >= 0 ? text.slice(0, comma) : text;
}

function applyStage1ChunkSoftAnchors(items: Record<string, unknown>[], sourceItemIds: Array<string | null>) {
  let applied = 0;
  const anchored = items.map((item, index) => {
    const current = item["No. item"];
    const sourceId = sourceItemIds[index];
    if ((current === undefined || current === null || current === "") && sourceId) {
      applied += 1;
      return {
        ...item,
        "No. item": sourceId
      };
    }
    return item;
  });

  return {
    items: anchored,
    notes: applied ? [`Ancla estructural aplicada a No. item en ${applied} fila(s).`] : []
  };
}

function parseStage1ChunkTolerant(raw: string): { items: Record<string, unknown>[]; notes: string[] } {
  const notes: string[] = [];
  let parsed: unknown;

  try {
    parsed = parseJsonFromModelText<unknown>(raw);
  } catch (error) {
    if (error instanceof JsonParseError) {
      const recovered = salvageItemsArrayObjects(error.cleaned).length
        ? salvageItemsArrayObjects(error.cleaned)
        : salvageItemsArrayObjects(error.raw);
      if (recovered.length) {
        notes.push(`JSON parcial recuperado: ${recovered.length} item(s).`);
        return { items: normalizeStage1ExtractedItems(recovered), notes };
      }
      throw new PipelineFailure({
        code: "AI_JSON_INVALID",
        stage: "stage1",
        technicalMessage: error.message,
        raw: error.raw,
        details: { cleaned: error.cleaned }
      });
    }
    throw error;
  }

  let parsedItems: unknown[] = [];
  if (Array.isArray(parsed)) {
    notes.push("La respuesta vino como arreglo; se uso como items[].");
    parsedItems = parsed;
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.items)) {
      parsedItems = parsed.items;
    } else {
      const firstArray = findFirstArrayValue(parsed);
      if (firstArray) {
        notes.push("No venia items[]; se uso el primer arreglo encontrado.");
        parsedItems = firstArray;
      }
    }
  }

  return {
    items: normalizeStage1ExtractedItems(parsedItems.filter(isRecord)),
    notes
  };
}

function normalizeStage1ExtractedItems(items: Record<string, unknown>[]) {
  return items.map((item) => {
    const normalized = { ...item };
    for (const field of STAGE1_REQUIRED_ITEM_FIELDS) {
      if (!(field in normalized)) {
        normalized[field] = null;
      }
    }
    return normalized;
  });
}

function getItemsArray(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return [];
  }

  return value.items.filter(isRecord);
}

function buildStage2ChunkInput(
  stage1Json: unknown,
  items: Record<string, unknown>[],
  chunk: number,
  totalChunks: number
) {
  return {
    ...(isRecord(stage1Json) ? stage1Json : {}),
    metadata: {
      ...(isRecord(stage1Json) && isRecord(stage1Json.metadata) ? stage1Json.metadata : {}),
      app_stage2_chunk: chunk,
      app_stage2_total_chunks: totalChunks,
      app_stage2_chunk_items: items.length
    },
    items
  };
}

function parseStage2ChunkTolerant(
  raw: string,
  originalItems: Record<string, unknown>[]
): { items: Record<string, unknown>[]; notes: string[] } {
  const notes: string[] = [];
  let parsed: unknown;

  try {
    parsed = parseJsonFromModelText<unknown>(raw);
  } catch (error) {
    if (error instanceof JsonParseError) {
      const recovered = salvageItemsArrayObjects(error.cleaned).length
        ? salvageItemsArrayObjects(error.cleaned)
        : salvageItemsArrayObjects(error.raw);
      notes.push(`JSON parcial recuperado: ${recovered.length}/${originalItems.length} item(s).`);
      return {
        items: mergeStage2TechnicalRows(originalItems, recovered),
        notes
      };
    }
    throw error;
  }

  let parsedItems: unknown[] = [];
  if (Array.isArray(parsed)) {
    notes.push("La respuesta vino como arreglo; se uso como items[].");
    parsedItems = parsed;
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.items)) {
      parsedItems = parsed.items;
    } else {
      const firstArray = findFirstArrayValue(parsed);
      if (firstArray) {
        notes.push("No venia items[]; se uso el primer arreglo encontrado.");
        parsedItems = firstArray;
      }
    }
  }

  if (parsedItems.length !== originalItems.length) {
    notes.push(`Conteo de items ajustado por la app: ${parsedItems.length}/${originalItems.length}.`);
  }

  return {
    items: mergeStage2TechnicalRows(originalItems, parsedItems.filter(isRecord)),
    notes
  };
}

function mergeStage2TechnicalRows(
  originalItems: Record<string, unknown>[],
  parsedItems: Record<string, unknown>[]
) {
  return originalItems.map((original, index) => {
    const parsed = parsedItems[index] ?? {};
    return {
      ...original,
      "Tipo de ficha": normalizeStage2FichaType(pickStage2Field(parsed, ["Tipo de ficha", "Tipo de ficha tecnica"])),
      "Unidad técnica de referencia":
        normalizeNullableString(pickStage2Field(parsed, ["Unidad técnica de referencia", "Unidad tecnica de referencia"])) ??
        inferTechnicalUnit(original["Und de medida"]),
      "Nota técnica para cotización": normalizeNullableString(
        pickStage2Field(parsed, ["Nota técnica para cotización", "Nota tecnica para cotizacion"])
      ),
      "Confianza": normalizeStage2Confidence(pickStage2Field(parsed, ["Confianza"]))
    };
  });
}

function pickStage2Field(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in item) {
      return item[key];
    }
  }
  return undefined;
}

function normalizeStage2FichaType(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (
    text === "cerrada_referencia" ||
    text === "cerrada_compatibilidad" ||
    text === "cerrada_norma" ||
    text === "gama_definida" ||
    text === "abierta" ||
    text === "insuficiente"
  ) {
    return text;
  }
  return "insuficiente";
}

function normalizeStage2Confidence(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "alta" || text === "media" || text === "baja") {
    return text;
  }
  return "baja";
}

function normalizeNullableString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text || text.toLowerCase() === "null") {
    return null;
  }
  return text;
}

function inferTechnicalUnit(value: unknown) {
  const unit = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!unit) {
    return null;
  }
  const normalized = unit
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

  const labels: Record<string, string> = {
    UN: "Cotización por unidad",
    UND: "Cotización por unidad",
    UNIDAD: "Cotización por unidad",
    KG: "Cotización por kilogramo",
    KILO: "Cotización por kilogramo",
    CAJA: "Cotización por caja",
    CX: "Cotización por caja",
    BULTO: "Cotización por bulto",
    GALON: "Cotización por galón",
    M: "Cotización por metro",
    ML: "Cotización por metro lineal",
    ROLLO: "Cotización por rollo",
    PAQ: "Cotización por paquete",
    PAC: "Cotización por paquete",
    PAQUETE: "Cotización por paquete",
    JUEGO: "Cotización por juego",
    KIT: "Cotización por kit",
    LT: "Cotización por litro",
    L: "Cotización por litro"
  };

  return labels[normalized] ?? `Cotización por ${unit.toLowerCase()}`;
}

function aggregateUsage(usages: AiUsageSummary[]) {
  if (!usages.length) {
    return undefined;
  }

  return usages.reduce<AiUsageSummary>(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + usage.cachedInputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      thinkingTokens: acc.thinkingTokens + usage.thinkingTokens,
      totalTokens: acc.totalTokens + usage.totalTokens,
      ...((acc.accountingSource || usage.accountingSource) === "central_ledger" ? { accountingSource: "central_ledger" as const } : {})
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0
    }
  );
}

function aggregateCost(costs: AiCostSummary[], provider: AiCostSummary["provider"], model: string, note: string) {
  if (!costs.length) {
    return undefined;
  }

  const first = costs[0];
  const totals = costs.reduce(
    (acc, cost) => ({
      inputUsd: acc.inputUsd + cost.inputUsd,
      cachedInputUsd: acc.cachedInputUsd + cost.cachedInputUsd,
      outputUsd: acc.outputUsd + cost.outputUsd,
      searchUsd: acc.searchUsd + cost.searchUsd,
      totalUsd: acc.totalUsd + cost.totalUsd
    }),
    { inputUsd: 0, cachedInputUsd: 0, outputUsd: 0, searchUsd: 0, totalUsd: 0 }
  );

  return {
    ...first,
    provider,
    model,
    inputUsd: roundStageCost(totals.inputUsd),
    cachedInputUsd: roundStageCost(totals.cachedInputUsd),
    outputUsd: roundStageCost(totals.outputUsd),
    searchUsd: roundStageCost(totals.searchUsd),
    totalUsd: roundStageCost(totals.totalUsd),
    note: first.note ? `${first.note} ${note}` : note
  };
}

function roundStageCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function getItemsCount(value: unknown) {
  if (value && typeof value === "object" && "items" in value) {
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) ? items.length : 0;
  }

  return 0;
}

function normalizeInternalConsecutive(result: Record<string, unknown>) {
  if (!Array.isArray(result.items)) {
    return result;
  }

  return {
    ...result,
    items: result.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }

      const normalized = {
        ...(item as Record<string, unknown>)
      };
      if (normalized["Consecutivo interno"] === undefined || normalized["Consecutivo interno"] === null || normalized["Consecutivo interno"] === "") {
        normalized["Consecutivo interno"] = index + 1;
      }
      return normalized;
    })
  };
}

function extractUsage(provider: "gemini" | "deepseek" | "openai" | "vps", metadata: unknown) {
  return provider === "deepseek"
    ? extractDeepSeekUsageMetadata(metadata)
    : extractGeminiUsageMetadata(metadata);
}
