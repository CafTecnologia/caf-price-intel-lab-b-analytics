import type { Batch } from "../../../ai-first-contracts/src/schemas/batch";
import type { NormalizedItem } from "../../../ai-first-contracts/src/schemas/item";
import type { ProcessingOptions, ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";
import type { ProviderUsageMetadata } from "../../../ai-first-contracts/src/providers/ai-provider";

import { normalizeSequentialItemNumbers } from "../document/item-label-utils";
import { AiTaskOrchestrator } from "../services/ai-task-orchestrator";

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function mapRecommendationToStatus(recommendation: string): Batch["validation_status"] {
  switch (recommendation) {
    case "accept":
      return "completed";
    case "accept_with_warning":
      return "completed_with_warnings";
    case "manual_review":
      return "manual_review";
    case "retry":
    default:
      return "retry";
  }
}

function calculateBatchConfidence(items: NormalizedItem[], validationScore: number | null, retryCount: number): number | null {
  const itemConfidence = average(items.map((item) => item.confidence));
  const baseScore = average([itemConfidence, validationScore].filter((value): value is number => value !== null));

  if (baseScore === null) {
    return null;
  }

  return Number(Math.max(0, Math.min(1, baseScore - retryCount * 0.03)).toFixed(4));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildProviderErrorUsage(task: ProviderConfigByTask["extractItemsBatch"]): ProviderUsageMetadata {
  return {
    provider: task.provider,
    model: task.model,
    input_tokens: null,
    output_tokens: null,
    latency_ms: 0,
    finish_reason: "provider_error",
  };
}

function buildFailedBatchValidation(error: unknown, extractedItemCount: number) {
  const message = getErrorMessage(error);

  return {
    validation_score: extractedItemCount > 0 ? 0.35 : 0.15,
    completeness_score: extractedItemCount > 0 ? 0.4 : 0.1,
    hallucination_risk_score: 0.65,
    structural_consistency_score: extractedItemCount > 0 ? 0.4 : 0.2,
    warnings: [`AI batch validation failed: ${message}`],
    suspected_missing_items: [],
    suspected_duplicates: [],
    recommendation: "manual_review" as const,
    rationale: "The AI extraction or validation step failed for this batch, so it must be reviewed manually or reprocessed.",
  };
}

export interface BatchAttemptTrace {
  attempt_number: number;
  started_at: string;
  finished_at: string;
  extracted_item_count: number;
  validation_recommendation: string;
  extraction_usage: ProviderUsageMetadata;
  validation_usage: ProviderUsageMetadata;
  warnings: string[];
}

export interface ProcessedBatchResult {
  batch: Batch;
  accepted_items: NormalizedItem[];
  attempts: BatchAttemptTrace[];
}

export class BatchProcessor {
  constructor(private readonly tasks: AiTaskOrchestrator) {}

  async processBatch(args: {
    plannedBatch: { batch: Batch; segments: SourceSegment[] };
    providerConfig: ProviderConfigByTask;
    processingOptions: ProcessingOptions;
  }): Promise<ProcessedBatchResult> {
    const attempts: BatchAttemptTrace[] = [];
    const maxAttempts = 1 + args.processingOptions.batch_retry_limit;

    let finalItems: NormalizedItem[] = [];
    let finalValidation: Batch["validation_json"] = null;
    let finalStartedAt: string | null = null;
    let finalFinishedAt: string | null = null;

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const startedAt = toIsoNow();
      if (finalStartedAt === null) {
        finalStartedAt = startedAt;
      }

      let extractedItems: NormalizedItem[] = [];
      let extractionUsage = buildProviderErrorUsage(args.providerConfig.extractItemsBatch);

      try {
        const extraction = await this.tasks.extractItemsBatch({
          batch: args.plannedBatch.batch,
          segments: args.plannedBatch.segments,
          task_config: args.providerConfig.extractItemsBatch,
          max_items_in_batch: 20,
        });
        extractedItems = normalizeSequentialItemNumbers(extraction.items);
        extractionUsage = extraction.usage;
        finalItems = extractedItems;
      } catch (error) {
        const finishedAt = toIsoNow();
        finalFinishedAt = finishedAt;
        finalItems = [];
        finalValidation = buildFailedBatchValidation(error, 0);

        attempts.push({
          attempt_number: attemptNumber,
          started_at: startedAt,
          finished_at: finishedAt,
          extracted_item_count: 0,
          validation_recommendation: finalValidation.recommendation,
          extraction_usage: buildProviderErrorUsage(args.providerConfig.extractItemsBatch),
          validation_usage: buildProviderErrorUsage(args.providerConfig.validateBatch),
          warnings: finalValidation.warnings,
        });

        break;
      }

      try {
        const validation = await this.tasks.validateBatch({
          batch: args.plannedBatch.batch,
          segments: args.plannedBatch.segments,
          extracted_items: extractedItems,
          task_config: args.providerConfig.validateBatch,
        });

        const finishedAt = toIsoNow();
        finalFinishedAt = finishedAt;
        finalValidation = validation.result;

        attempts.push({
          attempt_number: attemptNumber,
          started_at: startedAt,
          finished_at: finishedAt,
          extracted_item_count: extractedItems.length,
          validation_recommendation: validation.result.recommendation,
          extraction_usage: extractionUsage,
          validation_usage: validation.usage,
          warnings: Array.from(new Set([...extractedItems.flatMap((item) => item.warnings), ...validation.result.warnings])),
        });

        if (validation.result.recommendation !== "retry") {
          break;
        }
      } catch (error) {
        const finishedAt = toIsoNow();
        finalFinishedAt = finishedAt;
        finalItems = extractedItems;
        finalValidation = buildFailedBatchValidation(error, extractedItems.length);

        attempts.push({
          attempt_number: attemptNumber,
          started_at: startedAt,
          finished_at: finishedAt,
          extracted_item_count: extractedItems.length,
          validation_recommendation: finalValidation.recommendation,
          extraction_usage: extractionUsage,
          validation_usage: buildProviderErrorUsage(args.providerConfig.validateBatch),
          warnings: Array.from(new Set([...extractedItems.flatMap((item) => item.warnings), ...finalValidation.warnings])),
        });

        break;
      }
    }

    const retryCount = Math.max(0, attempts.length - 1);
    const acceptedItems =
      finalValidation?.recommendation === "accept" || finalValidation?.recommendation === "accept_with_warning" ? finalItems : [];

    const batch: Batch = {
      ...args.plannedBatch.batch,
      extraction_status:
        finalValidation?.recommendation === "manual_review" && finalItems.length === 0
          ? "failed"
          : finalItems.length > 0
            ? "completed"
            : "completed_with_warnings",
      validation_status: mapRecommendationToStatus(finalValidation?.recommendation ?? "retry"),
      output_json: finalItems,
      validation_json: finalValidation,
      confidence_score: calculateBatchConfidence(finalItems, finalValidation?.validation_score ?? null, retryCount),
      warnings: Array.from(new Set(attempts.flatMap((attempt) => attempt.warnings))),
      retry_count: retryCount,
      candidate_item_count: args.plannedBatch.segments.length,
      extracted_item_count: finalItems.length,
      validated_item_count: acceptedItems.length,
      started_at: finalStartedAt,
      finished_at: finalFinishedAt,
    };

    if (finalValidation?.recommendation === "retry" && retryCount >= args.processingOptions.batch_retry_limit) {
      batch.warnings = Array.from(
        new Set([...batch.warnings, "Batch retry limit exhausted before reaching an acceptable validation result."]),
      );
    }

    return {
      batch,
      accepted_items: acceptedItems,
      attempts,
    };
  }
}
