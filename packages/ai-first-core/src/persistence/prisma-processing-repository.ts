import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { DetectionSummary, DocumentResult, GlobalValidationResult, NormalizedItem, BatchValidationResult, Batch } from "../../../ai-first-contracts/src";
import type { ProcessingRepositoryPort } from "../../../ai-first-contracts/src/pipeline/orchestration";

import { PromptCatalog } from "../prompts/prompt-catalog";
import { getPrismaClient } from "./prisma-client";
import { toJsonArray, toJsonValue } from "./json";
import { buildPersistenceSnapshot, type UploadedFileInput } from "./write-model";
import type { BasicDocumentOrchestratorOutput } from "../orchestration/basic-document-orchestrator";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

function toDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }

  return new Prisma.Decimal(value);
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

export class PrismaProcessingRepository implements ProcessingRepositoryPort {
  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly promptCatalog: PromptCatalog = new PromptCatalog(),
  ) {}

  async registerUploadAndDocument(input: {
    documentId: string;
    uploadedFile: UploadedFileInput;
    processingOptions: DocumentResult["processing_options"];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const uploadedFile = await tx.uploadedFile.upsert({
        where: {
          checksumSha256: input.uploadedFile.checksumSha256,
        },
        update: {
          fileName: input.uploadedFile.fileName,
          mimeType: input.uploadedFile.mimeType,
          fileType: input.uploadedFile.fileType,
          storageKey: input.uploadedFile.storageKey,
          sizeBytes: input.uploadedFile.sizeBytes,
        },
        create: {
          fileName: input.uploadedFile.fileName,
          mimeType: input.uploadedFile.mimeType,
          fileType: input.uploadedFile.fileType,
          checksumSha256: input.uploadedFile.checksumSha256,
          storageKey: input.uploadedFile.storageKey,
          sizeBytes: input.uploadedFile.sizeBytes,
        },
      });

      await tx.document.upsert({
        where: {
          id: input.documentId,
        },
        update: {
          uploadedFileId: uploadedFile.id,
          fileName: input.uploadedFile.fileName,
          fileType: input.uploadedFile.fileType,
          processingStatus: "uploaded",
          processingOptions: toJsonValue(input.processingOptions),
        },
        create: {
          id: input.documentId,
          uploadedFileId: uploadedFile.id,
          fileName: input.uploadedFile.fileName,
          fileType: input.uploadedFile.fileType,
          processingStatus: "uploaded",
          processingOptions: toJsonValue(input.processingOptions),
        },
      });
    });
  }

  async saveSourceSegments(documentId: string, segments: SourceSegment[]): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.batchSourceSegment.deleteMany({
        where: {
          batch: {
            documentId,
          },
        },
      });
      await tx.sourceSegment.deleteMany({
        where: {
          documentId,
        },
      });
      await tx.sourceSegment.createMany({
        data: segments.map((segment) => ({
          id: segment.segment_id,
          documentId,
          segmentIndex: segment.segment_index,
          unitType: segment.unit_type,
          locatorJson: toJsonValue(segment.locator),
          rawText: segment.raw_text,
          normalizedText: segment.normalized_text,
          checksumSha256: segment.checksum_sha256,
          metadataJson: toJsonValue(segment.metadata),
        })),
      });
    });
  }

  async saveDetectionSummary(documentId: string, summary: DetectionSummary): Promise<void> {
    await this.prisma.document.update({
      where: {
        id: documentId,
      },
      data: {
        detectionSummary: toJsonValue(summary),
      },
    });
  }

  async saveBatches(documentId: string, batches: Batch[]): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.batch.deleteMany({
        where: {
          documentId,
        },
      });
      for (const batch of batches) {
        await tx.batch.create({
          data: {
            id: batch.batch_id,
            documentId,
            batchIndex: batch.batch_index,
            sourceRangeJson: toJsonValue(batch.source_range),
            provider: batch.provider,
            model: batch.model,
            promptVersion: batch.prompt_version,
            extractionStatus: batch.extraction_status,
            validationStatus: batch.validation_status,
            outputJson: toJsonValue(batch.output_json),
            validationJson: toJsonValue(batch.validation_json),
            confidenceScore: toDecimal(batch.confidence_score),
            warnings: toJsonArray(batch.warnings),
            retryCount: batch.retry_count,
            candidateItemCount: batch.candidate_item_count,
            extractedItemCount: batch.extracted_item_count,
            validatedItemCount: batch.validated_item_count,
            startedAt: toDate(batch.started_at),
            finishedAt: toDate(batch.finished_at),
          },
        });
      }
    });
  }

  async saveBatchExtraction(batchId: string, items: NormalizedItem[]): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const batch = await tx.batch.findUniqueOrThrow({
        where: {
          id: batchId,
        },
        select: {
          documentId: true,
        },
      });

      await tx.normalizedItem.deleteMany({
        where: {
          batchId,
        },
      });

      if (items.length === 0) {
        return;
      }

      await tx.normalizedItem.createMany({
        data: items.map((item) => ({
          documentId: batch.documentId,
          batchId,
          itemUid: item.item_uid,
          numeroItem: item.numero_item,
          nombreODescripcion: item.nombre_o_descripcion,
          fichaTecnica: item.ficha_tecnica,
          cantidad: toDecimal(item.cantidad),
          unidadMedida: item.unidad_medida,
          precioReferenciaUnit: toDecimal(item.precio_referencia_unit),
          precioReferenciaTotal: toDecimal(item.precio_referencia_total),
          moneda: item.moneda,
          rawTextEvidence: item.raw_text_evidence,
          sourceLocationJson: toJsonValue(item.source_location),
          extractionMode: item.extraction_mode,
          warnings: toJsonArray(item.warnings),
          confidence: toDecimal(item.confidence),
        })),
      });
    });
  }

  async saveBatchValidation(batchId: string, result: BatchValidationResult): Promise<void> {
    await this.prisma.batchValidation.upsert({
      where: {
        batchId,
      },
      update: {
        validationScore: toDecimal(result.validation_score),
        completenessScore: toDecimal(result.completeness_score),
        hallucinationRiskScore: toDecimal(result.hallucination_risk_score),
        structuralConsistencyScore: toDecimal(result.structural_consistency_score),
        warnings: toJsonArray(result.warnings),
        suspectedMissingItems: toJsonValue(result.suspected_missing_items),
        suspectedDuplicates: toJsonValue(result.suspected_duplicates),
        recommendation: result.recommendation,
        rationale: result.rationale,
        rawResponseJson: toJsonValue(result),
      },
      create: {
        batchId,
        validationScore: toDecimal(result.validation_score),
        completenessScore: toDecimal(result.completeness_score),
        hallucinationRiskScore: toDecimal(result.hallucination_risk_score),
        structuralConsistencyScore: toDecimal(result.structural_consistency_score),
        warnings: toJsonArray(result.warnings),
        suspectedMissingItems: toJsonValue(result.suspected_missing_items),
        suspectedDuplicates: toJsonValue(result.suspected_duplicates),
        recommendation: result.recommendation,
        rationale: result.rationale,
        rawResponseJson: toJsonValue(result),
      },
    });
  }

  async saveGlobalValidation(documentId: string, result: GlobalValidationResult): Promise<void> {
    await this.prisma.documentValidation.create({
      data: {
        documentId,
        validationScore: toDecimal(result.validation_score),
        completenessScore: toDecimal(result.completeness_score),
        hallucinationRiskScore: toDecimal(result.hallucination_risk_score),
        structuralConsistencyScore: toDecimal(result.structural_consistency_score),
        warnings: toJsonArray(result.warnings),
        suspectedMissingItems: toJsonValue(result.suspected_missing_items),
        suspectedDuplicates: toJsonValue(result.suspected_duplicates),
        recommendation: result.recommendation,
        rationale: result.rationale,
        documentLevelNotes: toJsonArray(result.document_level_notes),
        rawResponseJson: toJsonValue(result),
      },
    });
  }

  async saveConsolidatedResult(documentId: string, result: DocumentResult): Promise<void> {
    await this.prisma.document.update({
      where: {
        id: documentId,
      },
      data: {
        processingStatus: result.processing_status,
        detectionSummary: toJsonValue(result.detection_summary),
        providerConfigUsed: toJsonValue(result.provider_config_used),
        processingOptions: toJsonValue(result.processing_options),
        globalValidationJson: toJsonValue(result.global_validation),
        totalCandidateItems: result.total_candidate_items,
        totalExtractedItems: result.total_extracted_items,
        totalValidatedItems: result.total_validated_items,
        finalConfidenceScore: toDecimal(result.final_confidence_score),
        globalWarnings: toJsonArray(result.global_warnings),
        consolidatedJson: toJsonValue(result),
      },
    });
  }

  async markStage(documentId: string, _stage: string, status: string): Promise<void> {
    await this.prisma.document.update({
      where: {
        id: documentId,
      },
      data: {
        processingStatus: status as DocumentResult["processing_status"],
      },
    });
  }

  async persistCompletedRun(input: {
    uploadedFile: UploadedFileInput;
    segments: SourceSegment[];
    output: BasicDocumentOrchestratorOutput;
  }): Promise<void> {
    const snapshot = buildPersistenceSnapshot({
      uploadedFile: input.uploadedFile,
      segments: input.segments,
      output: input.output,
      promptCatalog: this.promptCatalog,
    });

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const uploadedFile = await tx.uploadedFile.upsert({
        where: {
          checksumSha256: snapshot.uploadedFile.checksumSha256,
        },
        update: {
          fileName: snapshot.uploadedFile.fileName,
          mimeType: snapshot.uploadedFile.mimeType,
          fileType: snapshot.uploadedFile.fileType,
          storageKey: snapshot.uploadedFile.storageKey,
          sizeBytes: snapshot.uploadedFile.sizeBytes,
        },
        create: {
          fileName: snapshot.uploadedFile.fileName,
          mimeType: snapshot.uploadedFile.mimeType,
          fileType: snapshot.uploadedFile.fileType,
          checksumSha256: snapshot.uploadedFile.checksumSha256,
          storageKey: snapshot.uploadedFile.storageKey,
          sizeBytes: snapshot.uploadedFile.sizeBytes,
        },
      });

      await tx.document.upsert({
        where: {
          id: snapshot.document.id,
        },
        update: {
          uploadedFileId: uploadedFile.id,
          fileName: snapshot.document.fileName,
          fileType: snapshot.document.fileType,
          processingStatus: snapshot.document.processingStatus,
          processingOptions: toJsonValue(snapshot.document.processingOptions),
          detectionSummary: toJsonValue(snapshot.document.detectionSummary),
          providerConfigUsed: toJsonValue(snapshot.document.providerConfigUsed),
          globalValidationJson: toJsonValue(snapshot.document.globalValidationJson),
          totalCandidateItems: snapshot.document.totalCandidateItems,
          totalExtractedItems: snapshot.document.totalExtractedItems,
          totalValidatedItems: snapshot.document.totalValidatedItems,
          finalConfidenceScore: toDecimal(snapshot.document.finalConfidenceScore),
          globalWarnings: toJsonArray(snapshot.document.globalWarnings),
          consolidatedJson: toJsonValue(snapshot.document.consolidatedJson),
        },
        create: {
          id: snapshot.document.id,
          uploadedFileId: uploadedFile.id,
          fileName: snapshot.document.fileName,
          fileType: snapshot.document.fileType,
          processingStatus: snapshot.document.processingStatus,
          processingOptions: toJsonValue(snapshot.document.processingOptions),
          detectionSummary: toJsonValue(snapshot.document.detectionSummary),
          providerConfigUsed: toJsonValue(snapshot.document.providerConfigUsed),
          globalValidationJson: toJsonValue(snapshot.document.globalValidationJson),
          totalCandidateItems: snapshot.document.totalCandidateItems,
          totalExtractedItems: snapshot.document.totalExtractedItems,
          totalValidatedItems: snapshot.document.totalValidatedItems,
          finalConfidenceScore: toDecimal(snapshot.document.finalConfidenceScore),
          globalWarnings: toJsonArray(snapshot.document.globalWarnings),
          consolidatedJson: toJsonValue(snapshot.document.consolidatedJson),
        },
      });

      await tx.batchSourceSegment.deleteMany({
        where: {
          batch: {
            documentId: snapshot.document.id,
          },
        },
      });
      await tx.batchAttemptAudit.deleteMany({
        where: {
          batch: {
            documentId: snapshot.document.id,
          },
        },
      });
      await tx.promptExecution.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });
      await tx.batchValidation.deleteMany({
        where: {
          batch: {
            documentId: snapshot.document.id,
          },
        },
      });
      await tx.documentValidation.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });
      await tx.auditLog.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });
      await tx.normalizedItem.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });
      await tx.batch.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });
      await tx.sourceSegment.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });
      await tx.providerTaskConfigSnapshot.deleteMany({
        where: {
          documentId: snapshot.document.id,
        },
      });

      if (snapshot.sourceSegments.length > 0) {
        await tx.sourceSegment.createMany({
          data: snapshot.sourceSegments.map((segment) => ({
            id: segment.id,
            documentId: segment.documentId,
            segmentIndex: segment.segmentIndex,
            unitType: segment.unitType,
            locatorJson: toJsonValue(segment.locatorJson),
            rawText: segment.rawText,
            normalizedText: segment.normalizedText,
            checksumSha256: segment.checksumSha256,
            metadataJson: toJsonValue(segment.metadataJson),
          })),
        });
      }

      if (snapshot.providerTaskConfigs.length > 0) {
        await tx.providerTaskConfigSnapshot.createMany({
          data: snapshot.providerTaskConfigs.map((config) => ({
            documentId: config.documentId,
            taskKind: config.taskKind,
            provider: config.provider,
            model: config.model,
            temperature: toDecimal(config.temperature),
            timeoutMs: config.timeoutMs,
            maxRetries: config.maxRetries,
            maxInputTokens: config.maxInputTokens,
            maxOutputTokens: config.maxOutputTokens,
            topP: toDecimal(config.topP),
            seed: config.seed,
            promptVersion: config.promptVersion,
            extraConfigJson: toJsonValue(config.extraConfigJson),
          })),
        });
      }

      for (const template of snapshot.promptTemplates) {
        await tx.promptTemplate.upsert({
          where: {
            promptKey_version: {
              promptKey: template.promptKey,
              version: template.version,
            },
          },
          update: {
            description: template.description,
            systemInstructions: template.systemInstructions,
            userTemplate: template.userTemplate,
            responseSchemaName: template.responseSchemaName,
            checksumSha256: template.checksumSha256,
            isActive: true,
          },
          create: {
            promptKey: template.promptKey,
            version: template.version,
            description: template.description,
            systemInstructions: template.systemInstructions,
            userTemplate: template.userTemplate,
            responseSchemaName: template.responseSchemaName,
            checksumSha256: template.checksumSha256,
            isActive: true,
          },
        });
      }

      if (snapshot.batches.length > 0) {
        await tx.batch.createMany({
          data: snapshot.batches.map((batch) => ({
            id: batch.id,
            documentId: batch.documentId,
            batchIndex: batch.batchIndex,
            sourceRangeJson: toJsonValue(batch.sourceRangeJson),
            provider: batch.provider,
            model: batch.model,
            promptVersion: batch.promptVersion,
            extractionStatus: batch.extractionStatus,
            validationStatus: batch.validationStatus,
            outputJson: toJsonValue(batch.outputJson),
            validationJson: toJsonValue(batch.validationJson),
            confidenceScore: toDecimal(batch.confidenceScore),
            warnings: toJsonArray(batch.warnings),
            retryCount: batch.retryCount,
            candidateItemCount: batch.candidateItemCount,
            extractedItemCount: batch.extractedItemCount,
            validatedItemCount: batch.validatedItemCount,
            startedAt: toDate(batch.startedAt),
            finishedAt: toDate(batch.finishedAt),
          })),
        });
      }

      if (snapshot.batchSourceSegments.length > 0) {
        await tx.batchSourceSegment.createMany({
          data: snapshot.batchSourceSegments,
        });
      }

      if (snapshot.items.length > 0) {
        await tx.normalizedItem.createMany({
          data: snapshot.items.map((item) => ({
            documentId: item.documentId,
            batchId: item.batchId,
            itemUid: item.itemUid,
            numeroItem: item.numeroItem,
            nombreODescripcion: item.nombreODescripcion,
            fichaTecnica: item.fichaTecnica,
            cantidad: toDecimal(item.cantidad),
            unidadMedida: item.unidadMedida,
            precioReferenciaUnit: toDecimal(item.precioReferenciaUnit),
            precioReferenciaTotal: toDecimal(item.precioReferenciaTotal),
            moneda: item.moneda,
            rawTextEvidence: item.rawTextEvidence,
            sourceLocationJson: toJsonValue(item.sourceLocationJson),
            extractionMode: item.extractionMode,
            warnings: toJsonArray(item.warnings),
            confidence: toDecimal(item.confidence),
          })),
        });
      }

      if (snapshot.batchValidations.length > 0) {
        await tx.batchValidation.createMany({
          data: snapshot.batchValidations.map((validation) => ({
            batchId: validation.batchId,
            validationScore: toDecimal(validation.validationScore),
            completenessScore: toDecimal(validation.completenessScore),
            hallucinationRiskScore: toDecimal(validation.hallucinationRiskScore),
            structuralConsistencyScore: toDecimal(validation.structuralConsistencyScore),
            warnings: toJsonArray(validation.warnings),
            suspectedMissingItems: toJsonValue(validation.suspectedMissingItems),
            suspectedDuplicates: toJsonValue(validation.suspectedDuplicates),
            recommendation: validation.recommendation,
            rationale: validation.rationale,
            rawResponseJson: toJsonValue(validation.rawResponseJson),
          })),
        });
      }

      if (snapshot.documentValidations.length > 0) {
        await tx.documentValidation.createMany({
          data: snapshot.documentValidations.map((validation) => ({
            documentId: validation.documentId,
            validationScore: toDecimal(validation.validationScore),
            completenessScore: toDecimal(validation.completenessScore),
            hallucinationRiskScore: toDecimal(validation.hallucinationRiskScore),
            structuralConsistencyScore: toDecimal(validation.structuralConsistencyScore),
            warnings: toJsonArray(validation.warnings),
            suspectedMissingItems: toJsonValue(validation.suspectedMissingItems),
            suspectedDuplicates: toJsonValue(validation.suspectedDuplicates),
            recommendation: validation.recommendation,
            rationale: validation.rationale,
            documentLevelNotes: toJsonArray(validation.documentLevelNotes),
            rawResponseJson: toJsonValue(validation.rawResponseJson),
          })),
        });
      }

      if (snapshot.batchAttempts.length > 0) {
        await tx.batchAttemptAudit.createMany({
          data: snapshot.batchAttempts.map((attempt) => ({
            batchId: attempt.batchId,
            attemptNumber: attempt.attemptNumber,
            extractedItemCount: attempt.extractedItemCount,
            validationRecommendation: attempt.validationRecommendation as Prisma.BatchAttemptAuditCreateManyInput["validationRecommendation"],
            warnings: toJsonArray(attempt.warnings),
            extractionUsageJson: toJsonValue(attempt.extractionUsageJson),
            validationUsageJson: toJsonValue(attempt.validationUsageJson),
            startedAt: new Date(attempt.startedAt),
            finishedAt: new Date(attempt.finishedAt),
          })),
        });
      }

      for (const execution of snapshot.promptExecutions) {
        const template = await tx.promptTemplate.findUniqueOrThrow({
          where: {
            promptKey_version: {
              promptKey: execution.promptKey,
              version: execution.promptVersion,
            },
          },
        });

        await tx.promptExecution.create({
          data: {
            documentId: execution.documentId,
            batchId: execution.batchId,
            promptTemplateId: template.id,
            taskKind: execution.taskKind,
            attemptNumber: execution.attemptNumber,
            provider: execution.provider,
            model: execution.model,
            status: execution.status,
            requestContextJson: toJsonValue(execution.requestContextJson),
            responseJson: toJsonValue(execution.responseJson),
            usageJson: toJsonValue(execution.usageJson),
            parsedJson: toJsonValue(execution.parsedJson),
            startedAt: new Date(execution.startedAt),
            finishedAt: toDate(execution.finishedAt),
          },
        });
      }

      if (snapshot.auditLogs.length > 0) {
        await tx.auditLog.createMany({
          data: snapshot.auditLogs.map((log) => ({
            documentId: log.documentId,
            batchId: log.batchId,
            level: log.level,
            stage: log.stage,
            code: log.code,
            message: log.message,
            contextJson: toJsonValue(log.contextJson),
          })),
        });
      }
    });
  }
}
