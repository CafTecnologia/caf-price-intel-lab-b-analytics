import type {
  DetectOfficialBlockInput,
  ExtractItemsBatchInput,
  ValidateBatchInput,
  ValidateGlobalInput,
} from "../../../ai-first-contracts/src/providers/ai-provider";
import type { Batch } from "../../../ai-first-contracts/src/schemas/batch";
import type { NormalizedItem } from "../../../ai-first-contracts/src/schemas/item";
import type { DetectionSummary, SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

import { renderPromptTemplate, stableJson } from "./render-prompt";

function compactSegmentsForPrompt(segments: SourceSegment[]) {
  return segments.map((segment) => ({
    segment_id: segment.segment_id,
    segment_index: segment.segment_index,
    unit_type: segment.unit_type,
    locator: {
      page: segment.locator.page,
      sheet: segment.locator.sheet,
      table: segment.locator.table,
      row_start: segment.locator.row_start,
      row_end: segment.locator.row_end,
      note: segment.locator.note,
    },
    raw_text: segment.raw_text,
  }));
}

function compactItemsForPrompt(items: NormalizedItem[]) {
  return items.map((item) => ({
    item_uid: item.item_uid,
    numero_item: item.numero_item,
    nombre_o_descripcion: item.nombre_o_descripcion,
    cantidad: item.cantidad,
    unidad_medida: item.unidad_medida,
    precio_referencia_unit: item.precio_referencia_unit,
    precio_referencia_total: item.precio_referencia_total,
    moneda: item.moneda,
    raw_text_evidence: item.raw_text_evidence,
    evidence_segment_ids: item.source_location.segment_ids,
    warnings: item.warnings,
    confidence: item.confidence,
  }));
}

function compactBatchesForPrompt(batches: Batch[]) {
  return batches.map((batch) => ({
    batch_id: batch.batch_id,
    batch_index: batch.batch_index,
    source_range: batch.source_range,
    extraction_status: batch.extraction_status,
    validation_status: batch.validation_status,
    extracted_item_count: batch.extracted_item_count,
    validated_item_count: batch.validated_item_count,
    confidence_score: batch.confidence_score,
    warnings: batch.warnings,
  }));
}

function compactDetectionSummaryForPrompt(summary: DetectionSummary) {
  return {
    total_segments_reviewed: summary.total_segments_reviewed,
    selected_blocks: summary.selected_blocks.map((block) => ({
      candidate_id: block.candidate_id,
      title: block.title,
      source_range: block.source_range,
      confidence: block.confidence,
    })),
    warnings: summary.warnings,
    overall_confidence: summary.overall_confidence,
  };
}

export function renderDetectOfficialBlockPrompt(input: DetectOfficialBlockInput): string {
  return renderPromptTemplate(input.prompt.user_template, {
    document_id: input.document_id,
    file_name: input.file_name,
    file_type: input.file_type,
    segments_json: stableJson(compactSegmentsForPrompt(input.segments)),
  });
}

export function renderExtractItemsBatchPrompt(input: ExtractItemsBatchInput): string {
  return renderPromptTemplate(input.prompt.user_template, {
    document_id: input.batch.document_id,
    batch_id: input.batch.batch_id,
    batch_index: String(input.batch.batch_index),
    max_items_in_batch: String(input.max_items_in_batch),
    source_range_json: stableJson(input.batch.source_range),
    segments_json: stableJson(compactSegmentsForPrompt(input.segments)),
  });
}

export function renderValidateBatchPrompt(input: ValidateBatchInput): string {
  return renderPromptTemplate(input.prompt.user_template, {
    document_id: input.batch.document_id,
    batch_id: input.batch.batch_id,
    batch_index: String(input.batch.batch_index),
    segments_json: stableJson(compactSegmentsForPrompt(input.segments)),
    items_json: stableJson(compactItemsForPrompt(input.extracted_items)),
  });
}

export function renderValidateGlobalPrompt(input: ValidateGlobalInput): string {
  return renderPromptTemplate(input.prompt.user_template, {
    document_id: input.document_id,
    detection_summary_json: stableJson(compactDetectionSummaryForPrompt(input.detection_summary)),
    batches_json: stableJson(compactBatchesForPrompt(input.accepted_batches)),
    items_json: stableJson(compactItemsForPrompt(input.items)),
  });
}
