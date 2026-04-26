import type {
  DetectOfficialBlockInput,
  DetectOfficialBlockOutput,
  ExtractItemsBatchInput,
  ExtractItemsBatchOutput,
  ValidateBatchInput,
  ValidateBatchOutput,
  ValidateGlobalInput,
  ValidateGlobalOutput,
} from "../../../../ai-first-contracts/src/providers/ai-provider";
import type { AiProvider } from "../../../../ai-first-contracts/src/enums";
import type { NormalizedItem } from "../../../../ai-first-contracts/src/schemas/item";
import type { DetectionSummary } from "../../../../ai-first-contracts/src/schemas/source";
import type {
  BatchValidationResult,
  GlobalValidationResult,
} from "../../../../ai-first-contracts/src/schemas/validation";

import {
  extractLeadingItemLabelToken,
  extractTableCells,
  looksLikeStructuredItemStart,
  normalizeSequentialItemNumbers,
} from "../../document/item-label-utils";

const BLOCK_KEYWORDS = /item|descripc|precio|cantidad|unidad|ficha|referencia|mercado/i;
const HEADER_KEYWORDS = /descripcion|descripc|cantidad|unidad|precio|valor|ficha/i;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createUsage(provider: AiProvider, model: string, inputText: string, outputText: string) {
  return {
    provider,
    model,
    input_tokens: Math.ceil(inputText.length / 4),
    output_tokens: Math.ceil(outputText.length / 4),
    latency_ms: 5,
    finish_reason: "mock",
  } as const;
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function collectLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseLooseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }

  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function createItemUid(batchId: string, itemNumber: string | null, index: number): string {
  return `${batchId}:${itemNumber ?? `row-${index + 1}`}`;
}

function scoreSegment(rawText: string): number {
  const lines = collectLines(rawText);
  const candidateStartLines = lines.filter((line) => looksLikeStructuredItemStart(line)).length;

  return (
    (BLOCK_KEYWORDS.test(rawText) ? 1 : 0) +
    (rawText.includes("|") ? 2 : 0) +
    (/^\s*item\b/im.test(rawText) ? 2 : 0) +
    Math.min(candidateStartLines, 3) +
    (lines.length > 2 ? 0.5 : 0)
  );
}

function parseCandidateLine(
  batchId: string,
  line: string,
  index: number,
  sourceLocation: NormalizedItem["source_location"],
): NormalizedItem | null {
  const hasTableDelimiters = line.includes("|") || line.includes("\t") || / {2,}/.test(line);
  if (HEADER_KEYWORDS.test(line) && !/^\d/.test(line)) {
    return null;
  }

  const leadingLabel = extractLeadingItemLabelToken(line);
  if (!hasTableDelimiters && !leadingLabel) {
    return null;
  }

  const parts = extractTableCells(line);

  const numberedMatch = line.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  const itemNumber = numberedMatch?.[1] ?? leadingLabel;
  const description =
    (itemNumber && parts.length > 1 ? parts[1] : null) ??
    numberedMatch?.[2] ??
    parts.find(
      (part) =>
        part !== itemNumber &&
        !/^(und|unidad|unid|kg|mt|m2|m3|lt|caja|paq|hora|mes|dia|cop|usd|eur)$/i.test(part),
    ) ??
    null;

  const valueParts = itemNumber && parts[0] === itemNumber ? parts.slice(1) : parts;
  const numericParts = valueParts.map((part) => parseLooseNumber(part)).filter((value): value is number => value !== null);
  const quantity =
    itemNumber && parts.length >= 3
      ? parseLooseNumber(parts[2])
      : numericParts.length >= 3
        ? numericParts[0]
        : numericParts.length === 2
          ? numericParts[0]
          : null;
  const unitPrice =
    itemNumber && parts.length >= 5
      ? parseLooseNumber(parts[4])
      : numericParts.length >= 2
        ? numericParts[numericParts.length - 2]
        : null;
  const totalPrice =
    itemNumber && parts.length >= 6
      ? parseLooseNumber(parts[5])
      : numericParts.length >= 1
        ? numericParts[numericParts.length - 1]
        : null;
  const unit =
    (itemNumber && parts.length >= 4 ? parts[3] : null) ??
    valueParts.find((part) => /^(und|unidad|unid|kg|mt|m2|m3|lt|caja|paq|hora|mes|dia)$/i.test(part)) ??
    null;
  const currency =
    (itemNumber && parts.length >= 7 ? parts[6] : null) ??
    (/usd/i.test(line) ? "USD" : /eur/i.test(line) ? "EUR" : /cop|\$/i.test(line) ? "COP" : null);

  if (!description) {
    return null;
  }

  const confidence = Math.max(
    0.45,
    Math.min(
      0.9,
      0.45 +
        (itemNumber ? 0.15 : 0) +
        (quantity !== null ? 0.1 : 0) +
        (unitPrice !== null ? 0.1 : 0) +
        (totalPrice !== null ? 0.1 : 0),
    ),
  );

  return {
    item_uid: createItemUid(batchId, itemNumber, index),
    numero_item: itemNumber,
    nombre_o_descripcion: truncate(description, 500),
    ficha_tecnica: null,
    cantidad: quantity,
    unidad_medida: unit,
    precio_referencia_unit: unitPrice,
    precio_referencia_total: totalPrice,
    moneda: currency,
    raw_text_evidence: truncate(line, 400),
    source_location: sourceLocation,
    extraction_mode: itemNumber || quantity !== null ? "extracted_directly" : "reconstructed_conservatively",
    warnings: [],
    confidence,
  };
}

export class MockInferenceEngine {
  constructor(private readonly provider: AiProvider) {}

  async detectOfficialBlock(input: DetectOfficialBlockInput): Promise<DetectOfficialBlockOutput> {
    const relevantSegments = input.segments.filter((segment) => scoreSegment(segment.raw_text) >= 3);
    const selectedSegments = relevantSegments.length > 0 ? relevantSegments : input.segments.slice(0, 1);
    const first = selectedSegments[0];
    const last = selectedSegments[selectedSegments.length - 1];
    const candidateBlock = {
      candidate_id: `${input.document_id}:candidate-1`,
      title: "Mock detected official block",
      source_range: {
        start_segment_id: first.segment_id,
        end_segment_id: last.segment_id,
        start_segment_index: first.segment_index,
        end_segment_index: last.segment_index,
        label: `segments ${first.segment_index}-${last.segment_index}`,
      },
      evidence: truncate(selectedSegments.map((segment) => segment.raw_text).join("\n"), 800),
      rationale: "Mock fallback selected the most table-like segments with item-oriented cues.",
      confidence: selectedSegments.length > 1 ? 0.82 : 0.7,
    };

    const summary: DetectionSummary = {
      total_segments_reviewed: input.segments.length,
      candidate_blocks: [candidateBlock],
      selected_blocks: [candidateBlock],
      excluded_candidates: [],
      warnings:
        relevantSegments.length > 0
          ? ["Mock fallback was used because no provider key was available."]
          : ["Mock fallback selected the first segment due to low structural cues."],
      overall_confidence: relevantSegments.length > 0 ? 0.82 : 0.64,
    };

    const payloadText = JSON.stringify({ segments: input.segments });
    const responseText = JSON.stringify(summary);

    return {
      result: summary,
      usage: createUsage(this.provider, input.task_config.model, payloadText, responseText),
      raw_response: {
        mode: "mock",
        summary,
      },
    };
  }

  async extractItemsBatch(input: ExtractItemsBatchInput): Promise<ExtractItemsBatchOutput> {
    const items = input.segments
      .map((segment, index) =>
        parseCandidateLine(
          input.batch.batch_id,
          collectLines(segment.raw_text).join(" "),
          index,
          {
            primary_locator: segment.locator,
            source_range: {
              start_segment_id: segment.segment_id,
              end_segment_id: segment.segment_id,
              start_segment_index: segment.segment_index,
              end_segment_index: segment.segment_index,
              label: `segments ${segment.segment_index}-${segment.segment_index}`,
            },
            segment_ids: [segment.segment_id],
          },
        ),
      )
      .filter((item): item is NormalizedItem => item !== null)
      .slice(0, input.max_items_in_batch);
    const normalizedItems = normalizeSequentialItemNumbers(items);

    const payloadText = JSON.stringify({ segments: input.segments });
    const responseText = JSON.stringify(normalizedItems);

    return {
      items: normalizedItems,
      usage: createUsage(this.provider, input.task_config.model, payloadText, responseText),
      raw_response: {
        mode: "mock",
        items: normalizedItems,
      },
    };
  }

  async validateBatch(input: ValidateBatchInput): Promise<ValidateBatchOutput> {
    const duplicateBuckets = new Map<string, string[]>();
    for (const item of input.extracted_items) {
      const key = item.numero_item ?? item.nombre_o_descripcion ?? item.item_uid;
      const bucket = duplicateBuckets.get(key) ?? [];
      bucket.push(item.item_uid);
      duplicateBuckets.set(key, bucket);
    }

    const suspectedDuplicates = Array.from(duplicateBuckets.values())
      .filter((bucket) => bucket.length > 1)
      .map((bucket) => ({
        item_uids: bucket,
        reason: "Mock validation detected repeated identifiers inside the batch.",
      }));

    const nullHeavyItems = input.extracted_items.filter(
      (item) =>
        item.nombre_o_descripcion !== null &&
        item.cantidad === null &&
        item.unidad_medida === null &&
        item.precio_referencia_unit === null &&
        item.precio_referencia_total === null,
    );

    const completeness =
      input.extracted_items.length === 0 ? 0.1 : Math.max(0.45, 1 - nullHeavyItems.length / input.extracted_items.length);
    const structuralConsistency = suspectedDuplicates.length > 0 ? 0.55 : 0.88;
    const hallucinationRisk = input.extracted_items.every((item) => item.raw_text_evidence) ? 0.12 : 0.38;
    const validationScore = average([completeness, structuralConsistency, 1 - hallucinationRisk]);

    const recommendation =
      input.extracted_items.length === 0
        ? "retry"
        : suspectedDuplicates.length > 0
          ? "manual_review"
          : nullHeavyItems.length > 0
            ? "accept_with_warning"
            : "accept";

    const result: BatchValidationResult = {
      validation_score: Number(validationScore.toFixed(4)),
      completeness_score: Number(completeness.toFixed(4)),
      hallucination_risk_score: Number(hallucinationRisk.toFixed(4)),
      structural_consistency_score: Number(structuralConsistency.toFixed(4)),
      warnings: [
        "Mock validation was used because no provider key was available.",
        ...(nullHeavyItems.length > 0 ? ["Some extracted rows have very sparse structured fields."] : []),
      ],
      suspected_missing_items:
        input.extracted_items.length === 0
          ? [
              {
                reference: input.batch.batch_id,
                reason: "No extractable items were produced from the provided evidence.",
                source_range: input.batch.source_range,
              },
            ]
          : [],
      suspected_duplicates: suspectedDuplicates,
      recommendation,
      rationale:
        recommendation === "accept"
          ? "Mock validation found no major structural issues."
          : recommendation === "accept_with_warning"
            ? "Mock validation found sparse rows but acceptable evidence."
            : recommendation === "manual_review"
              ? "Mock validation found duplicated identifiers that need review."
              : "Mock validation suggests a retry because the batch appears empty.",
    };

    return {
      result,
      usage: createUsage(
        this.provider,
        input.task_config.model,
        JSON.stringify({ items: input.extracted_items }),
        JSON.stringify(result),
      ),
      raw_response: {
        mode: "mock",
        result,
      },
    };
  }

  async validateGlobal(input: ValidateGlobalInput): Promise<ValidateGlobalOutput> {
    const numberBuckets = new Map<string, string[]>();
    for (const item of input.items) {
      const key = item.numero_item ?? item.item_uid;
      const bucket = numberBuckets.get(key) ?? [];
      bucket.push(item.item_uid);
      numberBuckets.set(key, bucket);
    }

    const suspectedDuplicates = Array.from(numberBuckets.values())
      .filter((bucket) => bucket.length > 1)
      .map((bucket) => ({
        item_uids: bucket,
        reason: "Mock global validation found repeated item numbers across batches.",
      }));

    const acceptedBatchCount = input.accepted_batches.length;
    const completeness = input.items.length === 0 ? 0.1 : Math.min(0.95, 0.55 + acceptedBatchCount * 0.1);
    const structuralConsistency = suspectedDuplicates.length > 0 ? 0.58 : 0.9;
    const hallucinationRisk = input.items.every((item) => item.raw_text_evidence) ? 0.1 : 0.3;
    const validationScore = average([completeness, structuralConsistency, 1 - hallucinationRisk]);

    const missingItems =
      input.items.length === 0
        ? [
            {
              reference: input.document_id,
              reason: "No consolidated items are available after batch processing.",
              source_range: input.detection_summary.selected_blocks[0]?.source_range ?? null,
            },
          ]
        : [];

    const recommendation =
      input.items.length === 0
        ? "retry"
        : suspectedDuplicates.length > 0
          ? "manual_review"
          : input.detection_summary.selected_blocks.length > acceptedBatchCount
            ? "accept_with_warning"
            : "accept";

    const result: GlobalValidationResult = {
      validation_score: Number(validationScore.toFixed(4)),
      completeness_score: Number(completeness.toFixed(4)),
      hallucination_risk_score: Number(hallucinationRisk.toFixed(4)),
      structural_consistency_score: Number(structuralConsistency.toFixed(4)),
      warnings: [
        "Mock global validation was used because no provider key was available.",
        ...(input.detection_summary.selected_blocks.length > acceptedBatchCount
          ? ["Detected blocks outnumber accepted batches; review continuity in a later phase."]
          : []),
      ],
      suspected_missing_items: missingItems,
      suspected_duplicates: suspectedDuplicates,
      recommendation,
      rationale:
        recommendation === "accept"
          ? "Mock global validation found a coherent consolidated result."
          : recommendation === "accept_with_warning"
            ? "Mock global validation detected a possible gap between detected blocks and accepted batches."
            : recommendation === "manual_review"
              ? "Mock global validation found duplicated identifiers across the final result."
              : "Mock global validation suggests a retry because the final result is empty.",
      document_level_notes: [
        `Accepted batches reviewed: ${acceptedBatchCount}`,
        `Consolidated items reviewed: ${input.items.length}`,
      ],
    };

    return {
      result,
      usage: createUsage(
        this.provider,
        input.task_config.model,
        JSON.stringify({ items: input.items, batches: input.accepted_batches }),
        JSON.stringify(result),
      ),
      raw_response: {
        mode: "mock",
        result,
      },
    };
  }
}
