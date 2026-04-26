import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";

import { Parser as Json2CsvParser } from "json2csv";

import type { AiProvider, FileType } from "../../../ai-first-contracts/src/enums";
import type { BatchExecutionStatus, ProviderConfigByTask } from "../../../ai-first-contracts/src";
import type { DocumentResult } from "../../../ai-first-contracts/src/schemas/document";

import { mapDocumentToOdooPreview } from "../../../../integrations/odoo/src/mappers";
import { segmentDocumentFromFile } from "../document/document-segmenter";
import { buildProviderConfigByTask } from "../document/provider-defaults";
import { BasicDocumentOrchestrator } from "../orchestration/basic-document-orchestrator";
import { BasicBatchPlanner } from "../orchestration/basic-batch-planner";
import { BatchProcessor } from "../orchestration/batch-processor";
import { FinalResultConsolidator } from "../orchestration/batch-consolidator";
import { PhysicalSegmentFragmenter } from "../orchestration/segment-fragmenter";
import { AiTaskOrchestrator } from "../services/ai-task-orchestrator";
import { LocalRunStore, type LocalRunRecord } from "./local-run-store";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function uploadsRoot(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "uploads");
}

function normalizeFileType(fileName: string, mimeType: string): FileType {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (extension === ".xlsx" || mimeType.includes("spreadsheetml")) {
    return "xlsx";
  }
  if (extension === ".xls" || mimeType.includes("ms-excel")) {
    return "xls";
  }
  if (extension === ".docx" || mimeType.includes("wordprocessingml")) {
    return "docx";
  }
  if (extension === ".doc" || mimeType.includes("msword")) {
    return "doc";
  }

  throw new Error(`Unsupported file type: ${fileName}`);
}

function buildChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function computeProcessingStatus(args: {
  batchStatuses: BatchExecutionStatus[];
  globalRecommendation: NonNullable<DocumentResult["global_validation"]>["recommendation"];
  consolidationWarnings: string[];
}): DocumentResult["processing_status"] {
  if (args.globalRecommendation === "manual_review" || args.batchStatuses.includes("manual_review")) {
    return "manual_review";
  }

  if (args.globalRecommendation === "retry" || args.batchStatuses.includes("retry")) {
    return "completed_with_warnings";
  }

  if (
    args.globalRecommendation === "accept_with_warning" ||
    args.batchStatuses.includes("completed_with_warnings") ||
    args.consolidationWarnings.length > 0
  ) {
    return "completed_with_warnings";
  }

  return "completed";
}

function buildGlobalWarnings(args: {
  detectionWarnings: string[];
  validationWarnings: string[];
  batchWarnings: string[][];
  consolidationWarnings: string[];
}): string[] {
  return Array.from(
    new Set([
      ...args.detectionWarnings,
      ...args.validationWarnings,
      ...args.batchWarnings.flat(),
      ...args.consolidationWarnings,
    ]),
  );
}

export interface LocalProcessRequest {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  providerConfig: ProviderConfigByTask;
  processingOptions: DocumentResult["processing_options"];
}

export class LocalProcessingService {
  constructor(
    private readonly orchestrator: BasicDocumentOrchestrator = new BasicDocumentOrchestrator(),
    private readonly store: LocalRunStore = new LocalRunStore(),
    private readonly uploadsDirectory: string = uploadsRoot(),
  ) {}

  static defaultProviderConfig(input?: Partial<Record<keyof ProviderConfigByTask, { provider: AiProvider; model?: string }>>) {
    return buildProviderConfigByTask({
      detectOfficialBlock: input?.detectOfficialBlock ?? { provider: "openai" },
      extractItemsBatch: input?.extractItemsBatch ?? { provider: "openai" },
      validateBatch: input?.validateBatch ?? { provider: "openai" },
      validateGlobal: input?.validateGlobal ?? { provider: "openai" },
    });
  }

  private async persistUploadedFile(documentId: string, fileName: string, bytes: Buffer): Promise<string> {
    const targetDirectory = resolve(this.uploadsDirectory, documentId);
    await mkdir(targetDirectory, { recursive: true });
    const targetPath = resolve(targetDirectory, fileName);
    await writeFile(targetPath, bytes);
    return targetPath;
  }

  async processUpload(request: LocalProcessRequest): Promise<LocalRunRecord> {
    const documentId = randomUUID();
    const fileType = normalizeFileType(request.fileName, request.mimeType);
    const checksumSha256 = buildChecksum(request.bytes);
    const savedFilePath = await this.persistUploadedFile(documentId, request.fileName, request.bytes);
    const sourceSegments = await segmentDocumentFromFile({
      documentId,
      filePath: savedFilePath,
      fileType,
    });

    const output = await this.orchestrator.run({
      document_id: documentId,
      file_name: request.fileName,
      file_type: fileType,
      segments: sourceSegments,
      provider_config_used: request.providerConfig,
      processing_options: request.processingOptions,
    });

    const record: LocalRunRecord = {
      documentId,
      fileName: request.fileName,
      fileType,
      processingStatus: output.document.processing_status,
      createdAt: toIsoNow(),
      updatedAt: toIsoNow(),
      uploadedFile: {
        fileName: request.fileName,
        mimeType: request.mimeType,
        fileType,
        checksumSha256,
        storageKey: savedFilePath,
        sizeBytes: request.bytes.byteLength,
      },
      sourceSegments,
      document: output.document,
      trace: output.trace,
      odooPreview: mapDocumentToOdooPreview(output.document),
    };

    this.store.save(record);
    return this.store.get(documentId) ?? record;
  }

  getDocument(documentId: string): LocalRunRecord | null {
    return this.store.get(documentId);
  }

  listDocuments(limit = 20): LocalRunRecord[] {
    return this.store.list(limit);
  }

  async reprocessBatch(input: {
    documentId: string;
    batchId: string;
    override?: Partial<Record<"extractItemsBatch" | "validateBatch", { provider: AiProvider; model?: string }>>;
  }): Promise<LocalRunRecord> {
    const existing = this.store.get(input.documentId);
    if (!existing) {
      throw new Error(`Document not found: ${input.documentId}`);
    }

    const providerConfig: ProviderConfigByTask = {
      ...existing.document.provider_config_used,
      extractItemsBatch: input.override?.extractItemsBatch
        ? {
            ...existing.document.provider_config_used.extractItemsBatch,
            provider: input.override.extractItemsBatch.provider,
            model:
              input.override.extractItemsBatch.model?.trim() ||
              existing.document.provider_config_used.extractItemsBatch.model,
          }
        : existing.document.provider_config_used.extractItemsBatch,
      validateBatch: input.override?.validateBatch
        ? {
            ...existing.document.provider_config_used.validateBatch,
            provider: input.override.validateBatch.provider,
            model:
              input.override.validateBatch.model?.trim() ||
              existing.document.provider_config_used.validateBatch.model,
          }
        : existing.document.provider_config_used.validateBatch,
    };

    const tasks = new AiTaskOrchestrator();
    const batchPlanner = new BasicBatchPlanner();
    const fragmenter = new PhysicalSegmentFragmenter();
    const batchProcessor = new BatchProcessor(tasks);
    const consolidator = new FinalResultConsolidator();

    const selectedSegments = batchPlanner.selectSegments(existing.sourceSegments, existing.document.detection_summary);
    const fragmentation = fragmenter.fragment(selectedSegments);
    const candidateSegments =
      fragmentation.candidateSegments.length > 0 ? fragmentation.candidateSegments : selectedSegments;
    const plannedBatches = batchPlanner.buildBatches({
      documentId: existing.document.document_id,
      segments: candidateSegments,
      providerConfig,
      batchSize: existing.document.processing_options.batch_size,
    });

    const targetPlannedBatch = plannedBatches.find((batch) => batch.batch.batch_id === input.batchId);
    if (!targetPlannedBatch) {
      throw new Error(`Batch not found for reprocess: ${input.batchId}`);
    }

    const processedBatch = await batchProcessor.processBatch({
      plannedBatch: targetPlannedBatch,
      providerConfig,
      processingOptions: existing.document.processing_options,
    });

    const updatedBatches = existing.document.batches.map((batch) =>
      batch.batch_id === input.batchId ? processedBatch.batch : batch,
    );
    const consolidation = consolidator.consolidate(updatedBatches);
    const globalValidation = await tasks.validateGlobal({
      document_id: existing.document.document_id,
      accepted_batches: consolidation.accepted_batches,
      items: consolidation.items,
      detection_summary: existing.document.detection_summary,
      task_config: existing.document.provider_config_used.validateGlobal,
    });

    const batchScores = updatedBatches
      .map((batch) => batch.confidence_score)
      .filter((score): score is number => score !== null);
    const finalConfidenceScore = average(
      [globalValidation.result.validation_score, globalValidation.result.completeness_score, ...batchScores].filter(
        (score): score is number => score !== null,
      ),
    );

    const updatedDocument: DocumentResult = {
      ...existing.document,
      provider_config_used: providerConfig,
      processing_status: computeProcessingStatus({
        batchStatuses: updatedBatches.map((batch) => batch.validation_status),
        globalRecommendation: globalValidation.result.recommendation,
        consolidationWarnings: consolidation.warnings,
      }),
      total_extracted_items: updatedBatches.reduce((sum, batch) => sum + (batch.extracted_item_count ?? 0), 0),
      total_validated_items: updatedBatches.reduce((sum, batch) => sum + (batch.validated_item_count ?? 0), 0),
      final_confidence_score: finalConfidenceScore !== null ? Number(finalConfidenceScore.toFixed(4)) : null,
      global_warnings: buildGlobalWarnings({
        detectionWarnings: existing.document.detection_summary.warnings,
        validationWarnings: globalValidation.result.warnings,
        batchWarnings: updatedBatches.map((batch) => batch.warnings),
        consolidationWarnings: consolidation.warnings,
      }),
      global_validation: globalValidation.result,
      batches: updatedBatches,
      items: consolidation.items,
    };

    const updatedTrace = {
      ...existing.trace,
      batch_traces: existing.trace.batch_traces.map((batchTrace) =>
        batchTrace.batch_id === input.batchId
          ? {
              ...batchTrace,
              attempt_count: processedBatch.attempts.length,
              retry_count: processedBatch.batch.retry_count,
              final_recommendation: processedBatch.batch.validation_json?.recommendation ?? null,
              attempts: processedBatch.attempts,
            }
          : batchTrace,
      ),
      metrics: {
        ...existing.trace.metrics,
        accepted_batch_count: consolidation.accepted_batches.length,
        retried_batch_count: existing.trace.batch_traces.filter((batchTrace) =>
          batchTrace.batch_id === input.batchId ? processedBatch.batch.retry_count > 0 : batchTrace.retry_count > 0,
        ).length,
        consolidated_item_count: consolidation.items.length,
      },
    };

    const updatedRecord: LocalRunRecord = {
      ...existing,
      updatedAt: toIsoNow(),
      processingStatus: updatedDocument.processing_status,
      document: updatedDocument,
      trace: updatedTrace,
      odooPreview: mapDocumentToOdooPreview(updatedDocument),
    };

    this.store.save(updatedRecord);
    return this.store.get(existing.documentId) ?? updatedRecord;
  }

  exportDocument(documentId: string, format: "json" | "csv" | "xlsx"): { fileName: string; mimeType: string; body: Buffer } {
    const record = this.store.get(documentId);
    if (!record) {
      throw new Error(`Document not found: ${documentId}`);
    }

    if (format === "json") {
      return {
        fileName: `${record.document.file_name.replace(/\.[^.]+$/, "")}.json`,
        mimeType: "application/json",
        body: Buffer.from(JSON.stringify(record.document, null, 2), "utf8"),
      };
    }

    const rows = record.document.items.map((item) => ({
      item_uid: item.item_uid,
      numero_item: item.numero_item,
      nombre_o_descripcion: item.nombre_o_descripcion,
      ficha_tecnica: item.ficha_tecnica,
      cantidad: item.cantidad,
      unidad_medida: item.unidad_medida,
      precio_referencia_unit: item.precio_referencia_unit,
      precio_referencia_total: item.precio_referencia_total,
      moneda: item.moneda,
      extraction_mode: item.extraction_mode,
      confidence: item.confidence,
      source_location: item.source_location.source_range.label,
      warnings: item.warnings.join(" | "),
    }));

    if (format === "csv") {
      const parser = new Json2CsvParser();
      return {
        fileName: `${record.document.file_name.replace(/\.[^.]+$/, "")}.csv`,
        mimeType: "text/csv; charset=utf-8",
        body: Buffer.from(parser.parse(rows), "utf8"),
      };
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "items");
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    return {
      fileName: `${record.document.file_name.replace(/\.[^.]+$/, "")}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buffer,
    };
  }
}
