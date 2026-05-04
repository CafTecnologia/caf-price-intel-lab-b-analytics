import { randomUUID } from "node:crypto";
import { PipelineFailure, normalizePipelineFailure } from "@/lib/ai-failures";
import { callGemini, callGeminiWithSearch } from "@/lib/gemini";
import { JsonParseError, parseJsonFromModelText } from "@/lib/json";
import { writePipelineLog } from "@/lib/pipeline-log";
import { validateStageResult } from "@/lib/stage-validation";
import { validateStage3PricingEvidence } from "@/lib/stage3-quality";
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
  provider?: "gemini" | "deepseek";
  model: string;
  groundingMetadata?: unknown;
  usage?: AiUsageSummary;
  cost?: AiCostSummary;
};

export type PipelineOutput = {
  runId: string;
  stage1: StageOutput;
  stage2: StageOutput;
};

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

export async function runStage1ForFile(file: File, runId: string = randomUUID()): Promise<StageOutput> {
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

    const prompt = buildStage1Prompt(documentText, file.name);
    await writePipelineLog({
      runId,
      stage: "stage1",
      event: "ai_request_sent",
      fileName: file.name,
      data: { promptLength: prompt.length }
    });

    const gemini = await callGemini({ prompt, stage: "stage1" });
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
        rawPreview: gemini.text,
        usage,
        cost
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

    return { runId, result, raw: gemini.text, provider, model: gemini.model, usage, cost };
  } catch (error) {
    const failure = normalizeStageError(error, "stage1");

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

export async function runStage2ForJson(stage1Json: unknown, runId: string = randomUUID()): Promise<StageOutput> {
  const startedAt = Date.now();

  await writePipelineLog({
    runId,
    stage: "stage2",
    event: "started",
    data: { inputItems: getItemsCount(stage1Json) }
  });

  try {
    const prompt = buildStage2Prompt(stage1Json);
    await writePipelineLog({
      runId,
      stage: "stage2",
      event: "ai_request_sent",
      data: { promptLength: prompt.length, inputItems: getItemsCount(stage1Json) }
    });

    const gemini = await callGemini({ prompt, stage: "stage2" });
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
        rawPreview: gemini.text,
        usage,
        cost
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

    return { runId, result, raw: gemini.text, provider, model: gemini.model, usage, cost };
  } catch (error) {
    const failure = normalizeStageError(error, "stage2");

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

export async function runStage3ForJson(stage2Json: unknown, runId: string = randomUUID()): Promise<StageOutput> {
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

    const gemini = await callGeminiWithSearch({ prompt, stage: "stage3" });
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
        rawPreview: gemini.text,
        groundingMetadata,
        usage,
        search,
        cost
      }
    });

    const result = normalizeInternalConsecutive(parseStageJson("stage3", gemini.text));
    validateStageResult("stage3", result);
    validateStage3PricingEvidence(result, gemini.text);

    await writePipelineLog({
      runId,
      stage: "stage3",
      event: "validated",
      provider,
      model: gemini.model,
      durationMs: Date.now() - startedAt,
      data: {
        items: getItemsCount(result),
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
      cost
    };
  } catch (error) {
    const failure = normalizeStageError(error, "stage3");

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

function normalizeStageError(error: unknown, stage: "stage1" | "stage2" | "stage3") {
  if (error instanceof PipelineFailure) {
    return error;
  }

  return normalizePipelineFailure(error, stage);
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
        "Consecutivo interno": index + 1,
        ...(item as Record<string, unknown>)
      };
      normalized["Consecutivo interno"] = index + 1;
      return normalized;
    })
  };
}

function extractUsage(provider: "gemini" | "deepseek", metadata: unknown) {
  return provider === "deepseek"
    ? extractDeepSeekUsageMetadata(metadata)
    : extractGeminiUsageMetadata(metadata);
}
