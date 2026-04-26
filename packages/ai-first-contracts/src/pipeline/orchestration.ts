import { z } from "zod";

import { BatchSchema } from "../schemas/batch";
import { DocumentResultSchema } from "../schemas/document";
import { NormalizedItemSchema } from "../schemas/item";
import { ProviderConfigByTaskSchema, ProviderTaskOverrideSchema } from "../schemas/provider-config";
import { DetectionSummarySchema, SourceSegmentSchema } from "../schemas/source";
import { BatchValidationResultSchema, GlobalValidationResultSchema } from "../schemas/validation";

export const PIPELINE_STAGES = [
  "intake",
  "segment_document",
  "detect_official_block",
  "plan_batches",
  "extract_batches",
  "validate_batches",
  "validate_global",
  "consolidate",
  "export",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type SourceSegment = z.infer<typeof SourceSegmentSchema>;
export type Batch = z.infer<typeof BatchSchema>;
export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;
export type DocumentResult = z.infer<typeof DocumentResultSchema>;
export type DetectionSummary = z.infer<typeof DetectionSummarySchema>;
export type BatchValidationResult = z.infer<typeof BatchValidationResultSchema>;
export type GlobalValidationResult = z.infer<typeof GlobalValidationResultSchema>;
export type ProviderConfigByTask = z.infer<typeof ProviderConfigByTaskSchema>;
export type ProviderTaskOverride = z.infer<typeof ProviderTaskOverrideSchema>;

export interface FileIntakePort {
  registerUpload(input: {
    fileName: string;
    mimeType: string;
    fileType: DocumentResult["file_type"];
    checksumSha256: string;
    byteSize: number;
  }): Promise<{ documentId: string; storageKey: string }>;
}

export interface SourceSegmentationPort {
  segmentDocument(input: {
    documentId: string;
    fileType: DocumentResult["file_type"];
    storageKey: string;
  }): Promise<SourceSegment[]>;
}

export interface BatchPlanningPort {
  planBatches(input: {
    documentId: string;
    selectedSegments: SourceSegment[];
    batchSize: number;
    providerConfig: ProviderConfigByTask;
  }): Promise<Batch[]>;
}

export interface ProcessingRepositoryPort {
  saveDetectionSummary(documentId: string, summary: DetectionSummary): Promise<void>;
  saveBatches(documentId: string, batches: Batch[]): Promise<void>;
  saveBatchExtraction(batchId: string, items: NormalizedItem[]): Promise<void>;
  saveBatchValidation(batchId: string, result: BatchValidationResult): Promise<void>;
  saveGlobalValidation(documentId: string, result: GlobalValidationResult): Promise<void>;
  saveConsolidatedResult(documentId: string, result: DocumentResult): Promise<void>;
  markStage(documentId: string, stage: PipelineStage, status: string): Promise<void>;
}

export interface BatchReprocessingPort {
  reprocessBatch(input: {
    batchId: string;
    override?: ProviderTaskOverride;
  }): Promise<void>;
}

export interface ConsolidationPort {
  consolidate(input: {
    documentId: string;
    acceptedBatches: Batch[];
    items: NormalizedItem[];
    globalValidation: GlobalValidationResult;
  }): Promise<DocumentResult>;
}
