import { z } from "zod";

import { VALIDATION_RECOMMENDATIONS } from "../../../ai-first-contracts/src/enums";
import type { ExtractItemsBatchInput } from "../../../ai-first-contracts/src/providers/ai-provider";
import type { NormalizedItem } from "../../../ai-first-contracts/src/schemas/item";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";
import type { BatchValidationResult, GlobalValidationResult } from "../../../ai-first-contracts/src/schemas/validation";

import { parseJsonFromText } from "./shared/json";
import { ProviderHttpError, postJson } from "./shared/http";
import { BaseAiProviderAdapter } from "./shared/provider-base";
import { getGeminiCompatibleResponseJsonSchema } from "./shared/schema-registry";

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

const GeminiCompactExtractItemSchema = z
  .object({
    item_uid: z.string().trim().min(1),
    numero_item: z.string().trim().min(1).nullable().optional().default(null),
    nombre_o_descripcion: z.string().trim().min(1).nullable().optional().default(null),
    unidad_medida: z.string().trim().min(1).nullable().optional().default(null),
    precio_referencia_unit: z.number().nullable().optional().default(null),
    evidence_segment_ids: z.array(z.string().trim().min(1)).min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const GeminiCompactExtractItemArraySchema = z.array(GeminiCompactExtractItemSchema).max(20);

const GeminiCompactExtractResponseSchema = {
  type: "array",
  maxItems: 20,
  items: {
    type: "object",
    properties: {
      item_uid: { type: "string" },
      numero_item: { type: "string" },
      nombre_o_descripcion: { type: "string" },
      unidad_medida: { type: "string" },
      precio_referencia_unit: { type: "number" },
      evidence_segment_ids: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
    required: ["item_uid", "evidence_segment_ids", "confidence"],
    additionalProperties: false,
  },
} as const;

const GeminiCompactMissingItemSchema = z
  .object({
    reference: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    source_range: z.null().optional().default(null),
  })
  .strict();

const GeminiCompactDuplicateSchema = z
  .object({
    item_uids: z.array(z.string().trim().min(1)).min(2),
    reason: z.string().trim().min(1),
  })
  .strict();

const GeminiCompactBatchValidationSchema = z
  .object({
    validation_score: z.number().min(0).max(1),
    completeness_score: z.number().min(0).max(1),
    hallucination_risk_score: z.number().min(0).max(1),
    structural_consistency_score: z.number().min(0).max(1),
    warnings: z.array(z.string().trim().min(1)).max(8).default([]),
    suspected_missing_items: z.array(GeminiCompactMissingItemSchema).max(8).default([]),
    suspected_duplicates: z.array(GeminiCompactDuplicateSchema).max(8).default([]),
    recommendation: z.enum(VALIDATION_RECOMMENDATIONS),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

const GeminiCompactGlobalValidationSchema = GeminiCompactBatchValidationSchema.extend({
  document_level_notes: z.array(z.string().trim().min(1)).max(8).default([]),
}).strict();

const GeminiCompactMissingItemResponseSchema = {
  type: "object",
  properties: {
    reference: { type: "string" },
    reason: { type: "string" },
    source_range: { type: "null" },
  },
  required: ["reference", "reason"],
  additionalProperties: false,
} as const;

const GeminiCompactDuplicateResponseSchema = {
  type: "object",
  properties: {
    item_uids: { type: "array", items: { type: "string" }, minItems: 2 },
    reason: { type: "string" },
  },
  required: ["item_uids", "reason"],
  additionalProperties: false,
} as const;

const GeminiCompactBatchValidationResponseSchema = {
  type: "object",
  properties: {
    validation_score: { type: "number" },
    completeness_score: { type: "number" },
    hallucination_risk_score: { type: "number" },
    structural_consistency_score: { type: "number" },
    warnings: { type: "array", items: { type: "string" }, maxItems: 8 },
    suspected_missing_items: { type: "array", items: GeminiCompactMissingItemResponseSchema, maxItems: 8 },
    suspected_duplicates: { type: "array", items: GeminiCompactDuplicateResponseSchema, maxItems: 8 },
    recommendation: { type: "string", enum: [...VALIDATION_RECOMMENDATIONS] },
    rationale: { type: "string" },
  },
  required: [
    "validation_score",
    "completeness_score",
    "hallucination_risk_score",
    "structural_consistency_score",
    "recommendation",
    "rationale",
  ],
  additionalProperties: false,
} as const;

const GeminiCompactGlobalValidationResponseSchema = {
  ...GeminiCompactBatchValidationResponseSchema,
  properties: {
    ...GeminiCompactBatchValidationResponseSchema.properties,
    document_level_notes: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
} as const;

function extractResponseText(response: GeminiResponse): string {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function buildUsage(args: {
  provider: GeminiAdapter["provider"];
  model: string;
  response: GeminiResponse;
  startedAt: number;
}) {
  return {
    provider: args.provider,
    model: args.model,
    input_tokens: args.response.usageMetadata?.promptTokenCount ?? null,
    output_tokens: args.response.usageMetadata?.candidatesTokenCount ?? null,
    latency_ms: Date.now() - args.startedAt,
    finish_reason: args.response.candidates?.[0]?.finishReason ?? null,
  };
}

function buildCompactExtractPrompt(userPrompt: string): string {
  return `${userPrompt}

Gemini compact transport instructions:
- Return each item using exactly these fields: item_uid, numero_item, nombre_o_descripcion, unidad_medida, precio_referencia_unit, evidence_segment_ids, confidence.
- Keep evidence_segment_ids limited to the supporting batch segment ids from this batch.
- Omit rows that are clearly headers, notes, subtotals, or non-item text.
- Collapse internal line breaks in nombre_o_descripcion to single spaces.
- Keep nombre_o_descripcion concise and faithful; the full audit evidence will be reconstructed from the source segments.
- Escape any remaining control characters inside string values as \\n.`;
}

function buildCompactValidationPrompt(userPrompt: string, isGlobal: boolean): string {
  return `${userPrompt}

Gemini compact transport instructions:
- Return one compact JSON object only.
- Keep warnings, missing-item notes, and duplicate notes concise.
- For suspected_missing_items, use source_range: null when you cannot point to a precise range.
- Do not include markdown fences or commentary.
- Escape control characters inside string values as \\n.
- ${isGlobal ? "Include document_level_notes when helpful." : "Do not include document_level_notes."}`;
}

function resolveGeminiFallbackModel(model: string): string | null {
  return model.includes("preview") ? "gemini-2.5-flash" : null;
}

function buildSourceRange(segments: SourceSegment[]) {
  const first = segments[0];
  const last = segments[segments.length - 1];

  return {
    start_segment_id: first.segment_id,
    end_segment_id: last.segment_id,
    start_segment_index: first.segment_index,
    end_segment_index: last.segment_index,
    label: `segments ${first.segment_index}-${last.segment_index}`,
  };
}

function buildRawTextEvidence(segments: SourceSegment[]): string | null {
  const text = segments
    .map((segment) => segment.raw_text.trim())
    .filter((value) => value.length > 0)
    .join(" | ")
    .slice(0, 2_000)
    .trim();

  return text.length > 0 ? text : null;
}

function mapCompactExtractedItem(args: {
  item: z.infer<typeof GeminiCompactExtractItemSchema>;
  batchSegments: SourceSegment[];
}): NormalizedItem {
  const segmentsById = new Map(args.batchSegments.map((segment) => [segment.segment_id, segment] as const));
  const matchedSegments = args.item.evidence_segment_ids
    .map((segmentId) => segmentsById.get(segmentId) ?? null)
    .filter((segment): segment is SourceSegment => segment !== null);
  const fallbackSegment = args.batchSegments[0];
  const effectiveSegments = matchedSegments.length > 0 ? matchedSegments : [fallbackSegment];
  const primarySegment = effectiveSegments[0];

  return {
    item_uid: args.item.item_uid,
    numero_item: args.item.numero_item ?? null,
    nombre_o_descripcion: args.item.nombre_o_descripcion ?? null,
    ficha_tecnica: null,
    cantidad: null,
    unidad_medida: args.item.unidad_medida ?? null,
    precio_referencia_unit: args.item.precio_referencia_unit ?? null,
    precio_referencia_total: null,
    moneda: null,
    raw_text_evidence: buildRawTextEvidence(effectiveSegments),
    source_location: {
      primary_locator: primarySegment.locator,
      source_range: buildSourceRange(effectiveSegments),
      segment_ids: effectiveSegments.map((segment) => segment.segment_id),
    },
    extraction_mode: effectiveSegments.length > 1 ? "reconstructed_conservatively" : "extracted_directly",
    warnings:
      matchedSegments.length === args.item.evidence_segment_ids.length
        ? []
        : ["Gemini returned evidence_segment_ids outside the current batch; fallback evidence was used."],
    confidence: Number(args.item.confidence.toFixed(4)),
  };
}

function isExtractItemsBatchInput(value: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]["input"]): value is ExtractItemsBatchInput {
  return "batch" in value && "segments" in value && "max_items_in_batch" in value;
}

export class GeminiAdapter extends BaseAiProviderAdapter {
  private isCompactExtractRequest(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]): boolean {
    return request.prompt.response_schema_name === "NormalizedItemSchema[]";
  }

  private isCompactBatchValidationRequest(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]): boolean {
    return request.prompt.response_schema_name === "BatchValidationResultSchema";
  }

  private isCompactGlobalValidationRequest(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]): boolean {
    return request.prompt.response_schema_name === "GlobalValidationResultSchema";
  }

  private async postStructuredRequest(
    args: {
      taskConfig: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]["taskConfig"];
      systemInstructions: string;
      userPrompt: string;
      responseSchema?: unknown;
    },
  ) {
    const postForModel = (model: string) =>
      postJson<GeminiResponse>({
        url: `${this.runtime.baseUrl.replace(/\/$/, "")}/v1beta/models/${model}:generateContent`,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.runtime.apiKey ?? "",
        },
        timeoutMs: args.taskConfig.timeout_ms,
        body: {
          systemInstruction: {
            parts: [{ text: args.systemInstructions }],
          },
          contents: [
            {
              parts: [{ text: args.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: args.taskConfig.temperature,
            maxOutputTokens: args.taskConfig.max_output_tokens ?? undefined,
            responseMimeType: "application/json",
            ...(args.responseSchema ? { responseJsonSchema: args.responseSchema } : {}),
          },
        },
      });

    try {
      return {
        modelUsed: args.taskConfig.model,
        response: await postForModel(args.taskConfig.model),
      };
    } catch (error) {
      const fallbackModel = resolveGeminiFallbackModel(args.taskConfig.model);
      if (!(error instanceof ProviderHttpError) || error.status !== 503 || !fallbackModel) {
        throw error;
      }

      return {
        modelUsed: fallbackModel,
        response: await postForModel(fallbackModel),
      };
    }
  }

  protected async invokeStructured(request: Parameters<BaseAiProviderAdapter["invokeStructured"]>[0]) {
    const startedAt = Date.now();
    if (this.isCompactExtractRequest(request)) {
      if (!isExtractItemsBatchInput(request.input) || request.input.segments.length === 0) {
        throw new Error("Gemini compact extraction requires batch segments.");
      }
      const batchSegments = request.input.segments;

      const execution = await this.postStructuredRequest({
        taskConfig: request.taskConfig,
        systemInstructions: `${request.prompt.system_instructions}
Return the exact compact transport fields and no other keys.`,
        userPrompt: buildCompactExtractPrompt(request.userPrompt),
        responseSchema: GeminiCompactExtractResponseSchema,
      });
      const compactItems = GeminiCompactExtractItemArraySchema.parse(parseJsonFromText(extractResponseText(execution.response)));

      return {
        output: compactItems.map((item) =>
          mapCompactExtractedItem({
            item,
            batchSegments,
          }),
        ),
        rawResponse: execution.response,
        usage: buildUsage({
          provider: this.provider,
          model: execution.modelUsed,
          response: execution.response,
          startedAt,
        }),
      };
    }

    if (this.isCompactBatchValidationRequest(request)) {
      const execution = await this.postStructuredRequest({
        taskConfig: request.taskConfig,
        systemInstructions: `${request.prompt.system_instructions}
Return the exact compact validation fields and no other keys.`,
        userPrompt: buildCompactValidationPrompt(request.userPrompt, false),
        responseSchema: GeminiCompactBatchValidationResponseSchema,
      });
      const parsed = GeminiCompactBatchValidationSchema.parse(parseJsonFromText(extractResponseText(execution.response)));

      return {
        output: parsed satisfies BatchValidationResult,
        rawResponse: execution.response,
        usage: buildUsage({
          provider: this.provider,
          model: execution.modelUsed,
          response: execution.response,
          startedAt,
        }),
      };
    }

    if (this.isCompactGlobalValidationRequest(request)) {
      const execution = await this.postStructuredRequest({
        taskConfig: request.taskConfig,
        systemInstructions: `${request.prompt.system_instructions}
Return the exact compact validation fields and no other keys.`,
        userPrompt: buildCompactValidationPrompt(request.userPrompt, true),
        responseSchema: GeminiCompactGlobalValidationResponseSchema,
      });
      const parsed = GeminiCompactGlobalValidationSchema.parse(parseJsonFromText(extractResponseText(execution.response)));

      return {
        output: parsed satisfies GlobalValidationResult,
        rawResponse: execution.response,
        usage: buildUsage({
          provider: this.provider,
          model: execution.modelUsed,
          response: execution.response,
          startedAt,
        }),
      };
    }

    const execution = await this.postStructuredRequest({
      taskConfig: request.taskConfig,
      systemInstructions: request.prompt.system_instructions,
      userPrompt: request.userPrompt,
      responseSchema: getGeminiCompatibleResponseJsonSchema(request.prompt.response_schema_name),
    });

    return {
      output: parseJsonFromText(extractResponseText(execution.response)),
      rawResponse: execution.response,
      usage: buildUsage({
        provider: this.provider,
        model: execution.modelUsed,
        response: execution.response,
        startedAt,
      }),
    };
  }
}
