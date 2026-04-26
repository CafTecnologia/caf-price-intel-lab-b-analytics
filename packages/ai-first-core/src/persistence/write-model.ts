import type { AiTaskKind, ProviderConfigByTask } from "../../../ai-first-contracts/src";
import type { DocumentResult } from "../../../ai-first-contracts/src/schemas/document";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";
import type { PromptArtifact } from "../../../ai-first-contracts/src/providers/ai-provider";

import type { BasicDocumentOrchestratorOutput, BatchAuditTrace, PromptExecutionTrace } from "../orchestration/basic-document-orchestrator";

import { PromptCatalog } from "../prompts/prompt-catalog";
import { buildPromptChecksum } from "./prompt-checksum";

export interface UploadedFileInput {
  fileName: string;
  mimeType: string;
  fileType: DocumentResult["file_type"];
  checksumSha256: string;
  storageKey: string;
  sizeBytes: number;
}

export interface PersistenceSnapshot {
  uploadedFile: UploadedFileInput;
  document: {
    id: string;
    fileName: string;
    fileType: DocumentResult["file_type"];
    processingStatus: DocumentResult["processing_status"];
    processingOptions: DocumentResult["processing_options"];
    detectionSummary: DocumentResult["detection_summary"];
    providerConfigUsed: DocumentResult["provider_config_used"];
    globalValidationJson: DocumentResult["global_validation"];
    totalCandidateItems: number;
    totalExtractedItems: number;
    totalValidatedItems: number;
    finalConfidenceScore: number | null;
    globalWarnings: string[];
    consolidatedJson: DocumentResult;
  };
  sourceSegments: Array<{
    id: string;
    documentId: string;
    segmentIndex: number;
    unitType: SourceSegment["unit_type"];
    locatorJson: SourceSegment["locator"];
    rawText: string;
    normalizedText: string | null;
    checksumSha256: string;
    metadataJson: SourceSegment["metadata"];
  }>;
  providerTaskConfigs: Array<{
    documentId: string;
    taskKind: AiTaskKind;
    provider: ProviderConfigByTask[AiTaskKind]["provider"];
    model: string;
    temperature: number;
    timeoutMs: number;
    maxRetries: number;
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
    topP: number | null;
    seed: number | null;
    promptVersion: string;
    extraConfigJson: Record<string, unknown>;
  }>;
  promptTemplates: Array<{
    promptKey: string;
    version: string;
    description: string | null;
    systemInstructions: string;
    userTemplate: string;
    responseSchemaName: string;
    checksumSha256: string;
  }>;
  batches: Array<{
    id: string;
    documentId: string;
    batchIndex: number;
    sourceRangeJson: DocumentResult["batches"][number]["source_range"];
    provider: DocumentResult["batches"][number]["provider"];
    model: string;
    promptVersion: string;
    extractionStatus: DocumentResult["batches"][number]["extraction_status"];
    validationStatus: DocumentResult["batches"][number]["validation_status"];
    outputJson: DocumentResult["batches"][number]["output_json"];
    validationJson: DocumentResult["batches"][number]["validation_json"];
    confidenceScore: number | null;
    warnings: string[];
    retryCount: number;
    candidateItemCount: number | null;
    extractedItemCount: number | null;
    validatedItemCount: number | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  batchSourceSegments: Array<{
    batchId: string;
    sourceSegmentId: string;
  }>;
  items: Array<{
    documentId: string;
    batchId: string | null;
    itemUid: string;
    numeroItem: string | null;
    nombreODescripcion: string | null;
    fichaTecnica: string | null;
    cantidad: number | null;
    unidadMedida: string | null;
    precioReferenciaUnit: number | null;
    precioReferenciaTotal: number | null;
    moneda: string | null;
    rawTextEvidence: string | null;
    sourceLocationJson: unknown;
    extractionMode: DocumentResult["items"][number]["extraction_mode"];
    warnings: string[];
    confidence: number;
  }>;
  batchValidations: Array<{
    batchId: string;
    validationScore: number;
    completenessScore: number;
    hallucinationRiskScore: number;
    structuralConsistencyScore: number;
    warnings: string[];
    suspectedMissingItems: unknown[];
    suspectedDuplicates: unknown[];
    recommendation: NonNullable<DocumentResult["batches"][number]["validation_json"]>["recommendation"];
    rationale: string;
    rawResponseJson: unknown;
  }>;
  documentValidations: Array<{
    documentId: string;
    validationScore: number;
    completenessScore: number;
    hallucinationRiskScore: number;
    structuralConsistencyScore: number;
    warnings: string[];
    suspectedMissingItems: unknown[];
    suspectedDuplicates: unknown[];
    recommendation: NonNullable<DocumentResult["global_validation"]>["recommendation"];
    rationale: string;
    documentLevelNotes: string[];
    rawResponseJson: unknown;
  }>;
  promptExecutions: Array<{
    documentId: string;
    batchId: string | null;
    promptKey: string;
    promptVersion: string;
    taskKind: AiTaskKind;
    attemptNumber: number | null;
    provider: PromptExecutionTrace["provider"];
    model: string;
    status: string;
    requestContextJson: unknown;
    responseJson: unknown;
    usageJson: PromptExecutionTrace["usage"];
    parsedJson: unknown;
    startedAt: string;
    finishedAt: string | null;
  }>;
  batchAttempts: Array<{
    batchId: string;
    attemptNumber: number;
    extractedItemCount: number;
    validationRecommendation: string;
    warnings: string[];
    extractionUsageJson: unknown;
    validationUsageJson: unknown;
    startedAt: string;
    finishedAt: string;
  }>;
  auditLogs: Array<{
    documentId: string;
    batchId: string | null;
    level: "info" | "warning" | "error" | "debug";
    stage: string | null;
    code: string | null;
    message: string;
    contextJson: unknown;
  }>;
}

function taskKinds(): AiTaskKind[] {
  return ["detectOfficialBlock", "extractItemsBatch", "validateBatch", "validateGlobal"];
}

function mapTaskConfig(taskKind: AiTaskKind, providerConfigUsed: ProviderConfigByTask) {
  const config = providerConfigUsed[taskKind];
  return {
    documentId: "" as string,
    taskKind,
    provider: config.provider,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeout_ms,
    maxRetries: config.max_retries,
    maxInputTokens: config.max_input_tokens,
    maxOutputTokens: config.max_output_tokens,
    topP: config.top_p,
    seed: config.seed,
    promptVersion: config.prompt_version,
    extraConfigJson: config.extra,
  };
}

function mapPromptArtifact(artifact: PromptArtifact) {
  return {
    promptKey: artifact.key,
    version: artifact.version,
    description: artifact.description,
    systemInstructions: artifact.system_instructions,
    userTemplate: artifact.user_template,
    responseSchemaName: artifact.response_schema_name,
    checksumSha256: buildPromptChecksum({
      key: artifact.key,
      version: artifact.version,
      systemInstructions: artifact.system_instructions,
      userTemplate: artifact.user_template,
      responseSchemaName: artifact.response_schema_name,
    }),
  };
}

function buildPromptKeyForTask(trace: PromptExecutionTrace, promptCatalog: PromptCatalog): string {
  return promptCatalog.resolve(trace.task, trace.prompt_version).key;
}

function buildRequestContext(trace: PromptExecutionTrace, batchTracesById: Map<string, BatchAuditTrace>) {
  if (!trace.batch_id) {
    return {
      document_id: null,
      batch_id: null,
      attempt_number: trace.attempt_number,
      task: trace.task,
    };
  }

  const batchTrace = batchTracesById.get(trace.batch_id);
  return {
    document_id: null,
    batch_id: trace.batch_id,
    attempt_number: trace.attempt_number,
    task: trace.task,
    source_segment_ids: batchTrace?.source_segment_ids ?? [],
  };
}

export function buildPersistenceSnapshot(input: {
  uploadedFile: UploadedFileInput;
  segments: SourceSegment[];
  output: BasicDocumentOrchestratorOutput;
  promptCatalog?: PromptCatalog;
}): PersistenceSnapshot {
  const promptCatalog = input.promptCatalog ?? new PromptCatalog();
  const document = input.output.document;
  const batchTracesById = new Map(input.output.trace.batch_traces.map((trace) => [trace.batch_id, trace]));

  const providerTaskConfigs = taskKinds().map((taskKind) => ({
    ...mapTaskConfig(taskKind, document.provider_config_used),
    documentId: document.document_id,
  }));

  const promptTemplates = Array.from(
    new Map(
      taskKinds()
        .map((taskKind) => promptCatalog.resolve(taskKind, document.provider_config_used[taskKind].prompt_version))
        .map((artifact) => {
          const mapped = mapPromptArtifact(artifact);
          return [`${mapped.promptKey}:${mapped.version}`, mapped] as const;
        }),
    ).values(),
  );

  const batches = document.batches.map((batch) => ({
    id: batch.batch_id,
    documentId: batch.document_id,
    batchIndex: batch.batch_index,
    sourceRangeJson: batch.source_range,
    provider: batch.provider,
    model: batch.model,
    promptVersion: batch.prompt_version,
    extractionStatus: batch.extraction_status,
    validationStatus: batch.validation_status,
    outputJson: batch.output_json,
    validationJson: batch.validation_json,
    confidenceScore: batch.confidence_score,
    warnings: batch.warnings,
    retryCount: batch.retry_count,
    candidateItemCount: batch.candidate_item_count,
    extractedItemCount: batch.extracted_item_count,
    validatedItemCount: batch.validated_item_count,
    startedAt: batch.started_at,
    finishedAt: batch.finished_at,
  }));

  const batchSourceSegments = input.output.trace.batch_traces.flatMap((batchTrace) =>
    batchTrace.source_segment_ids.map((sourceSegmentId) => ({
      batchId: batchTrace.batch_id,
      sourceSegmentId,
    })),
  );

  const items = document.items.map((item) => ({
    documentId: document.document_id,
    batchId:
      document.batches.find((batch) => batch.output_json.some((batchItem) => batchItem.item_uid === item.item_uid))?.batch_id ?? null,
    itemUid: item.item_uid,
    numeroItem: item.numero_item,
    nombreODescripcion: item.nombre_o_descripcion,
    fichaTecnica: item.ficha_tecnica,
    cantidad: item.cantidad,
    unidadMedida: item.unidad_medida,
    precioReferenciaUnit: item.precio_referencia_unit,
    precioReferenciaTotal: item.precio_referencia_total,
    moneda: item.moneda,
    rawTextEvidence: item.raw_text_evidence,
    sourceLocationJson: item.source_location,
    extractionMode: item.extraction_mode,
    warnings: item.warnings,
    confidence: item.confidence,
  }));

  const batchValidations = document.batches
    .filter((batch) => batch.validation_json !== null)
    .map((batch) => ({
      batchId: batch.batch_id,
      validationScore: batch.validation_json!.validation_score,
      completenessScore: batch.validation_json!.completeness_score,
      hallucinationRiskScore: batch.validation_json!.hallucination_risk_score,
      structuralConsistencyScore: batch.validation_json!.structural_consistency_score,
      warnings: batch.validation_json!.warnings,
      suspectedMissingItems: batch.validation_json!.suspected_missing_items,
      suspectedDuplicates: batch.validation_json!.suspected_duplicates,
      recommendation: batch.validation_json!.recommendation,
      rationale: batch.validation_json!.rationale,
      rawResponseJson: batch.validation_json,
    }));

  const documentValidations = document.global_validation
    ? [
        {
          documentId: document.document_id,
          validationScore: document.global_validation.validation_score,
          completenessScore: document.global_validation.completeness_score,
          hallucinationRiskScore: document.global_validation.hallucination_risk_score,
          structuralConsistencyScore: document.global_validation.structural_consistency_score,
          warnings: document.global_validation.warnings,
          suspectedMissingItems: document.global_validation.suspected_missing_items,
          suspectedDuplicates: document.global_validation.suspected_duplicates,
          recommendation: document.global_validation.recommendation,
          rationale: document.global_validation.rationale,
          documentLevelNotes: document.global_validation.document_level_notes,
          rawResponseJson: document.global_validation,
        },
      ]
    : [];

  const promptExecutions = input.output.trace.executions.map((execution) => ({
    documentId: document.document_id,
    batchId: execution.batch_id,
    promptKey: buildPromptKeyForTask(execution, promptCatalog),
    promptVersion: execution.prompt_version,
    taskKind: execution.task,
    attemptNumber: execution.attempt_number,
    provider: execution.provider,
    model: execution.model,
    status: "completed",
    requestContextJson: buildRequestContext(execution, batchTracesById),
    responseJson: execution.raw_response,
    usageJson: execution.usage,
    parsedJson: execution.raw_response,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  }));

  const batchAttempts = input.output.trace.batch_traces.flatMap((batchTrace) =>
    batchTrace.attempts.map((attempt) => ({
      batchId: batchTrace.batch_id,
      attemptNumber: attempt.attempt_number,
      extractedItemCount: attempt.extracted_item_count,
      validationRecommendation: attempt.validation_recommendation,
      warnings: attempt.warnings,
      extractionUsageJson: attempt.extraction_usage,
      validationUsageJson: attempt.validation_usage,
      startedAt: attempt.started_at,
      finishedAt: attempt.finished_at,
    })),
  );

  const auditLogs: PersistenceSnapshot["auditLogs"] = [
    {
      documentId: document.document_id,
      batchId: null,
      level: "info",
      stage: "orchestration",
      code: "document_run_completed",
      message: `Document run completed with status ${document.processing_status}.`,
      contextJson: input.output.trace.metrics,
    },
    ...document.global_warnings.map((warning) => ({
      documentId: document.document_id,
      batchId: null,
      level: "warning" as const,
      stage: "validation",
      code: "global_warning",
      message: warning,
      contextJson: {
        document_id: document.document_id,
      },
    })),
    ...input.output.trace.batch_traces
      .filter((batchTrace) => batchTrace.retry_count > 0)
      .map((batchTrace) => ({
        documentId: document.document_id,
        batchId: batchTrace.batch_id,
        level: "info" as const,
        stage: "validate_batches",
        code: "batch_retried",
        message: `Batch ${batchTrace.batch_id} required ${batchTrace.retry_count} retry cycles before completion.`,
        contextJson: {
          batch_id: batchTrace.batch_id,
          attempt_count: batchTrace.attempt_count,
          final_recommendation: batchTrace.final_recommendation,
        },
      })),
  ];

  return {
    uploadedFile: input.uploadedFile,
    document: {
      id: document.document_id,
      fileName: document.file_name,
      fileType: document.file_type,
      processingStatus: document.processing_status,
      processingOptions: document.processing_options,
      detectionSummary: document.detection_summary,
      providerConfigUsed: document.provider_config_used,
      globalValidationJson: document.global_validation,
      totalCandidateItems: document.total_candidate_items,
      totalExtractedItems: document.total_extracted_items,
      totalValidatedItems: document.total_validated_items,
      finalConfidenceScore: document.final_confidence_score,
      globalWarnings: document.global_warnings,
      consolidatedJson: document,
    },
    sourceSegments: input.segments.map((segment) => ({
      id: segment.segment_id,
      documentId: segment.document_id,
      segmentIndex: segment.segment_index,
      unitType: segment.unit_type,
      locatorJson: segment.locator,
      rawText: segment.raw_text,
      normalizedText: segment.normalized_text,
      checksumSha256: segment.checksum_sha256,
      metadataJson: segment.metadata,
    })),
    providerTaskConfigs,
    promptTemplates,
    batches,
    batchSourceSegments,
    items,
    batchValidations,
    documentValidations,
    promptExecutions,
    batchAttempts,
    auditLogs,
  };
}
