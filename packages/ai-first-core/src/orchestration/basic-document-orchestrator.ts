import type { AiTaskKind } from "../../../ai-first-contracts/src/enums";
import type { ProviderUsageMetadata } from "../../../ai-first-contracts/src/providers/ai-provider";
import type { Batch } from "../../../ai-first-contracts/src/schemas/batch";
import type { DocumentResult } from "../../../ai-first-contracts/src/schemas/document";
import type { ProcessingOptions, ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

import { normalizeSequentialItemNumbers } from "../document/item-label-utils";
import { AiTaskOrchestrator } from "../services/ai-task-orchestrator";
import { BatchProcessor, type BatchAttemptTrace } from "./batch-processor";
import { FinalResultConsolidator, type ConsolidationTrace } from "./batch-consolidator";
import { BasicBatchPlanner } from "./basic-batch-planner";
import { PhysicalSegmentFragmenter } from "./segment-fragmenter";

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildProviderErrorUsage(task: ProviderConfigByTask["validateGlobal"]): ProviderUsageMetadata {
  return {
    provider: task.provider,
    model: task.model,
    input_tokens: null,
    output_tokens: null,
    latency_ms: 0,
    finish_reason: "provider_error",
  };
}

export interface PromptExecutionTrace {
  task: AiTaskKind;
  batch_id: string | null;
  attempt_number: number | null;
  provider: ProviderUsageMetadata["provider"];
  model: string;
  prompt_version: string;
  usage: ProviderUsageMetadata;
  raw_response: unknown;
}

export interface BatchAuditTrace {
  batch_id: string;
  source_segment_ids: string[];
  attempt_count: number;
  retry_count: number;
  final_recommendation: string | null;
  attempts: BatchAttemptTrace[];
}

export interface BasicDocumentRunTrace {
  executions: PromptExecutionTrace[];
  selected_segment_ids: string[];
  candidate_fragment_ids: string[];
  discarded_lines: Array<{
    parent_segment_id: string;
    line_index: number;
    line: string;
    reason: "header" | "note" | "unclassified";
  }>;
  batch_traces: BatchAuditTrace[];
  consolidation: ConsolidationTrace | null;
  metrics: {
    selected_segment_count: number;
    candidate_fragment_count: number;
    planned_batch_count: number;
    accepted_batch_count: number;
    retried_batch_count: number;
    consolidated_item_count: number;
  };
}

export interface BasicDocumentOrchestratorInput {
  document_id: string;
  file_name: string;
  file_type: DocumentResult["file_type"];
  segments: SourceSegment[];
  provider_config_used: ProviderConfigByTask;
  processing_options: ProcessingOptions;
}

export interface BasicDocumentOrchestratorOutput {
  document: DocumentResult;
  trace: BasicDocumentRunTrace;
}

export class BasicDocumentOrchestrator {
  constructor(
    private readonly tasks = new AiTaskOrchestrator(),
    private readonly batchPlanner = new BasicBatchPlanner(),
    private readonly fragmenter = new PhysicalSegmentFragmenter(),
    private readonly consolidator = new FinalResultConsolidator(),
  ) {}

  async run(input: BasicDocumentOrchestratorInput): Promise<BasicDocumentOrchestratorOutput> {
    const batchProcessor = new BatchProcessor(this.tasks);
    const trace: BasicDocumentRunTrace = {
      executions: [],
      selected_segment_ids: [],
      candidate_fragment_ids: [],
      discarded_lines: [],
      batch_traces: [],
      consolidation: null,
      metrics: {
        selected_segment_count: 0,
        candidate_fragment_count: 0,
        planned_batch_count: 0,
        accepted_batch_count: 0,
        retried_batch_count: 0,
        consolidated_item_count: 0,
      },
    };

    const detection = await this.tasks.detectOfficialBlock({
      document_id: input.document_id,
      file_name: input.file_name,
      file_type: input.file_type,
      segments: input.segments,
      task_config: input.provider_config_used.detectOfficialBlock,
    });

    trace.executions.push({
      task: "detectOfficialBlock",
      batch_id: null,
      attempt_number: null,
      provider: detection.usage.provider,
      model: detection.usage.model,
      prompt_version: input.provider_config_used.detectOfficialBlock.prompt_version,
      usage: detection.usage,
      raw_response: detection.raw_response,
    });

    const selectedSegments = this.batchPlanner.selectSegments(input.segments, detection.result);
    trace.selected_segment_ids = selectedSegments.map((segment) => segment.segment_id);
    trace.metrics.selected_segment_count = selectedSegments.length;

    const fragmentation = this.fragmenter.fragment(selectedSegments);
    const candidateSegments = fragmentation.candidateSegments.length > 0 ? fragmentation.candidateSegments : selectedSegments;
    trace.candidate_fragment_ids = candidateSegments.map((segment) => segment.segment_id);
    trace.discarded_lines = fragmentation.discardedLines;
    trace.metrics.candidate_fragment_count = candidateSegments.length;

    const plannedBatches = this.batchPlanner.buildBatches({
      documentId: input.document_id,
      segments: candidateSegments,
      providerConfig: input.provider_config_used,
      batchSize: input.processing_options.batch_size,
    });
    trace.metrics.planned_batch_count = plannedBatches.length;

    const finalBatches: Batch[] = [];

    for (const planned of plannedBatches) {
      const processed = await batchProcessor.processBatch({
        plannedBatch: planned,
        providerConfig: input.provider_config_used,
        processingOptions: input.processing_options,
      });

      finalBatches.push(processed.batch);
      trace.batch_traces.push({
        batch_id: processed.batch.batch_id,
        source_segment_ids: planned.segments.map((segment) => segment.segment_id),
        attempt_count: processed.attempts.length,
        retry_count: processed.batch.retry_count,
        final_recommendation: processed.batch.validation_json?.recommendation ?? null,
        attempts: processed.attempts,
      });

      for (const attempt of processed.attempts) {
        trace.executions.push({
          task: "extractItemsBatch",
          batch_id: processed.batch.batch_id,
          attempt_number: attempt.attempt_number,
          provider: attempt.extraction_usage.provider,
          model: attempt.extraction_usage.model,
          prompt_version: input.provider_config_used.extractItemsBatch.prompt_version,
          usage: attempt.extraction_usage,
          raw_response: { warnings: attempt.warnings, extracted_item_count: attempt.extracted_item_count },
        });
        trace.executions.push({
          task: "validateBatch",
          batch_id: processed.batch.batch_id,
          attempt_number: attempt.attempt_number,
          provider: attempt.validation_usage.provider,
          model: attempt.validation_usage.model,
          prompt_version: input.provider_config_used.validateBatch.prompt_version,
          usage: attempt.validation_usage,
          raw_response: { recommendation: attempt.validation_recommendation, warnings: attempt.warnings },
        });
      }
    }

    trace.metrics.retried_batch_count = trace.batch_traces.filter((batchTrace) => batchTrace.retry_count > 0).length;

    const consolidation = this.consolidator.consolidate(finalBatches);
    const normalizedConsolidatedItems = normalizeSequentialItemNumbers(consolidation.items);
    trace.consolidation = consolidation.trace;
    trace.metrics.accepted_batch_count = consolidation.accepted_batches.length;
    trace.metrics.consolidated_item_count = normalizedConsolidatedItems.length;

    const globalValidation = await (async () => {
      try {
        return await this.tasks.validateGlobal({
          document_id: input.document_id,
          accepted_batches: consolidation.accepted_batches,
          items: normalizedConsolidatedItems,
          detection_summary: detection.result,
          task_config: input.provider_config_used.validateGlobal,
        });
      } catch (error) {
        return {
          result: {
            validation_score: 0.3,
            completeness_score: normalizedConsolidatedItems.length > 0 ? 0.45 : 0.15,
            hallucination_risk_score: 0.6,
            structural_consistency_score: 0.35,
            warnings: [`AI global validation failed: ${getErrorMessage(error)}`],
            suspected_missing_items: [],
            suspected_duplicates: [],
            recommendation: "manual_review" as const,
            rationale: "The document-level AI validation step failed, so the consolidated result requires manual review.",
            document_level_notes: [],
          },
          usage: buildProviderErrorUsage(input.provider_config_used.validateGlobal),
          raw_response: {
            error: getErrorMessage(error),
          },
        };
      }
    })();

    trace.executions.push({
      task: "validateGlobal",
      batch_id: null,
      attempt_number: null,
      provider: globalValidation.usage.provider,
      model: globalValidation.usage.model,
      prompt_version: input.provider_config_used.validateGlobal.prompt_version,
      usage: globalValidation.usage,
      raw_response: globalValidation.raw_response,
    });

    const batchScores = finalBatches
      .map((batch) => batch.confidence_score)
      .filter((score): score is number => score !== null);
    const finalConfidenceScore = average(
      [globalValidation.result.validation_score, globalValidation.result.completeness_score, ...batchScores].filter(
        (score): score is number => score !== null,
      ),
    );

    const processingStatus =
      globalValidation.result.recommendation === "manual_review" ||
      finalBatches.some((batch) => batch.validation_status === "manual_review")
        ? "manual_review"
        : globalValidation.result.recommendation === "retry" ||
            finalBatches.some((batch) => batch.validation_status === "retry")
          ? "completed_with_warnings"
          : globalValidation.result.recommendation === "accept_with_warning" ||
              finalBatches.some((batch) => batch.validation_status === "completed_with_warnings") ||
              consolidation.warnings.length > 0
            ? "completed_with_warnings"
            : "completed";

    const globalWarnings = Array.from(
      new Set([
        ...detection.result.warnings,
        ...globalValidation.result.warnings,
        ...finalBatches.flatMap((batch) => batch.warnings),
        ...consolidation.warnings,
      ]),
    );

    return {
      document: {
        document_id: input.document_id,
        file_name: input.file_name,
        file_type: input.file_type,
        processing_status: processingStatus,
        detection_summary: detection.result,
        provider_config_used: input.provider_config_used,
        processing_options: input.processing_options,
        total_candidate_items: candidateSegments.length,
        total_extracted_items: finalBatches.reduce((sum, batch) => sum + (batch.extracted_item_count ?? 0), 0),
        total_validated_items: finalBatches.reduce((sum, batch) => sum + (batch.validated_item_count ?? 0), 0),
        final_confidence_score: finalConfidenceScore !== null ? Number(finalConfidenceScore.toFixed(4)) : null,
        global_warnings: globalWarnings,
        global_validation: globalValidation.result,
        batches: finalBatches,
        items: normalizedConsolidatedItems,
      },
      trace,
    };
  }
}
