import { randomUUID } from "node:crypto";
import { PipelineFailure } from "@/lib/ai-failures";
import { callGemini } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import { getStageItems, isJsonRecord } from "@/lib/stage-field-access";
import { extractDeepSeekUsageMetadata, extractGeminiUsageMetadata, estimateAiCost } from "@/lib/usage-cost";
import { buildStage2ExperimentalPrompt } from "@/prompts/stage2-experimental";

export async function runStage2Experimental(input: { stage1Json: unknown; model?: string; runId?: string }) {
  const prompt = buildStage2ExperimentalPrompt(input.stage1Json);
  const ai = await callGemini({ prompt, stage: "stage2", model: input.model });
  let result: Record<string, unknown>;
  try {
    result = parseJsonFromModelText<Record<string, unknown>>(ai.text);
  } catch (error) {
    throw new PipelineFailure({
      code: "AI_JSON_INVALID",
      stage: "stage2",
      technicalMessage: error instanceof Error ? error.message : String(error),
      raw: ai.text
    });
  }

  const provider = ai.provider ?? "gemini";
  const usage = provider === "deepseek"
    ? extractDeepSeekUsageMetadata(ai.usageMetadata)
    : extractGeminiUsageMetadata(ai.usageMetadata);
  const cost = estimateAiCost({ provider, model: ai.model, usage });

  return {
    runId: input.runId || randomUUID(),
    provider,
    model: ai.model,
    result: normalizeStage2ExperimentalResult(result),
    raw: ai.text,
    usage,
    cost,
    details: { experimentalStage2: true, promptLength: prompt.length }
  };
}

function normalizeStage2ExperimentalResult(result: Record<string, unknown>) {
  const items = getStageItems(result).map((item) => {
    const identification = isJsonRecord(item.Identificacion) ? item.Identificacion : {};
    return {
      "Consecutivo interno": item["Consecutivo interno"] ?? identification["Consecutivo interno"] ?? null,
      "Lote": item.Lote ?? identification.Lote ?? null,
      "No. item": item["No. item"] ?? identification["No. item"] ?? null,
      "Nombre o descripcion": item["Nombre o descripcion"] ?? item["Nombre o descripci?n"] ?? identification["Nombre o descripcion"] ?? identification["Nombre o descripci?n"] ?? null,
      "Detalles o ficha tecnica": item["Detalles o ficha tecnica"] ?? item["Detalles o ficha t?cnica"] ?? identification["Detalles o ficha tecnica"] ?? identification["Detalles o ficha t?cnica"] ?? null,
      "Und de medida": item["Und de medida"] ?? identification["Und de medida"] ?? null,
      "Cant": item.Cant ?? identification.Cant ?? null,
      "Precio techo encontrado": item["Precio techo encontrado"] ?? identification["Precio techo encontrado"] ?? null,
      "Lectura tecnica": isJsonRecord(item["Lectura tecnica"]) ? item["Lectura tecnica"] : isJsonRecord(item["Lectura t?cnica"]) ? item["Lectura t?cnica"] : {},
      "Guia para cotizacion": isJsonRecord(item["Guia para cotizacion"]) ? item["Guia para cotizacion"] : isJsonRecord(item["Gu?a para cotizaci?n"]) ? item["Gu?a para cotizaci?n"] : {}
    };
  });

  return {
    ...result,
    metadata: {
      ...((result.metadata && typeof result.metadata === "object" && !Array.isArray(result.metadata)) ? result.metadata : {}),
      experimental: true,
      app_experiment: "stage2_compact_technical_brief"
    },
    items
  };
}
