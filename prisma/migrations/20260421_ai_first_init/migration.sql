-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('pdf', 'xlsx', 'xls', 'docx', 'doc');

-- CreateEnum
CREATE TYPE "SourceUnitType" AS ENUM ('page_block', 'table_block', 'table_row_range', 'sheet_range', 'paragraph_span', 'mixed_span');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('uploaded', 'segmenting', 'detecting', 'batching', 'extracting', 'validating', 'consolidating', 'completed', 'completed_with_warnings', 'manual_review', 'failed');

-- CreateEnum
CREATE TYPE "BatchExecutionStatus" AS ENUM ('pending', 'running', 'completed', 'completed_with_warnings', 'retry', 'manual_review', 'failed');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('openai', 'gemini', 'anthropic', 'deepseek');

-- CreateEnum
CREATE TYPE "AiTaskKind" AS ENUM ('detectOfficialBlock', 'extractItemsBatch', 'validateBatch', 'validateGlobal');

-- CreateEnum
CREATE TYPE "ExtractionMode" AS ENUM ('extracted_directly', 'reconstructed_conservatively', 'not_found');

-- CreateEnum
CREATE TYPE "ValidationRecommendation" AS ENUM ('accept', 'accept_with_warning', 'retry', 'manual_review');

-- CreateEnum
CREATE TYPE "AuditLevel" AS ENUM ('debug', 'info', 'warning', 'error');

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileType" "FileType" NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "uploadedFileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" "FileType" NOT NULL,
    "processingStatus" "ProcessingStatus" NOT NULL,
    "processingOptions" JSONB,
    "detectionSummary" JSONB,
    "providerConfigUsed" JSONB,
    "globalValidationJson" JSONB,
    "totalCandidateItems" INTEGER NOT NULL DEFAULT 0,
    "totalExtractedItems" INTEGER NOT NULL DEFAULT 0,
    "totalValidatedItems" INTEGER NOT NULL DEFAULT 0,
    "finalConfidenceScore" DECIMAL(5,4),
    "globalWarnings" JSONB,
    "consolidatedJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSegment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "unitType" "SourceUnitType" NOT NULL,
    "locatorJson" JSONB NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT,
    "checksumSha256" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "batchIndex" INTEGER NOT NULL,
    "sourceRangeJson" JSONB NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "extractionStatus" "BatchExecutionStatus" NOT NULL,
    "validationStatus" "BatchExecutionStatus" NOT NULL,
    "outputJson" JSONB,
    "validationJson" JSONB,
    "confidenceScore" DECIMAL(5,4),
    "warnings" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "candidateItemCount" INTEGER,
    "extractedItemCount" INTEGER,
    "validatedItemCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchSourceSegment" (
    "batchId" TEXT NOT NULL,
    "sourceSegmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchSourceSegment_pkey" PRIMARY KEY ("batchId","sourceSegmentId")
);

-- CreateTable
CREATE TABLE "NormalizedItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "batchId" TEXT,
    "itemUid" TEXT NOT NULL,
    "numeroItem" TEXT,
    "nombreODescripcion" TEXT,
    "fichaTecnica" TEXT,
    "cantidad" DECIMAL(18,4),
    "unidadMedida" TEXT,
    "precioReferenciaUnit" DECIMAL(18,4),
    "precioReferenciaTotal" DECIMAL(18,4),
    "moneda" TEXT,
    "rawTextEvidence" TEXT,
    "sourceLocationJson" JSONB NOT NULL,
    "extractionMode" "ExtractionMode" NOT NULL,
    "warnings" JSONB,
    "confidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormalizedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchValidation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "validationScore" DECIMAL(5,4),
    "completenessScore" DECIMAL(5,4),
    "hallucinationRiskScore" DECIMAL(5,4),
    "structuralConsistencyScore" DECIMAL(5,4),
    "warnings" JSONB,
    "suspectedMissingItems" JSONB,
    "suspectedDuplicates" JSONB,
    "recommendation" "ValidationRecommendation" NOT NULL,
    "rationale" TEXT NOT NULL,
    "rawResponseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentValidation" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "validationScore" DECIMAL(5,4),
    "completenessScore" DECIMAL(5,4),
    "hallucinationRiskScore" DECIMAL(5,4),
    "structuralConsistencyScore" DECIMAL(5,4),
    "warnings" JSONB,
    "suspectedMissingItems" JSONB,
    "suspectedDuplicates" JSONB,
    "recommendation" "ValidationRecommendation" NOT NULL,
    "rationale" TEXT NOT NULL,
    "documentLevelNotes" JSONB,
    "rawResponseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderTaskConfigSnapshot" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "taskKind" "AiTaskKind" NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DECIMAL(3,2),
    "timeoutMs" INTEGER NOT NULL,
    "maxRetries" INTEGER NOT NULL,
    "maxInputTokens" INTEGER,
    "maxOutputTokens" INTEGER,
    "topP" DECIMAL(3,2),
    "seed" INTEGER,
    "promptVersion" TEXT NOT NULL,
    "extraConfigJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderTaskConfigSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "systemInstructions" TEXT NOT NULL,
    "userTemplate" TEXT NOT NULL,
    "responseSchemaName" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptExecution" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "batchId" TEXT,
    "promptTemplateId" TEXT NOT NULL,
    "taskKind" "AiTaskKind" NOT NULL,
    "attemptNumber" INTEGER,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestContextJson" JSONB,
    "responseJson" JSONB,
    "usageJson" JSONB,
    "parsedJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchAttemptAudit" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "extractedItemCount" INTEGER NOT NULL,
    "validationRecommendation" "ValidationRecommendation",
    "warnings" JSONB,
    "extractionUsageJson" JSONB,
    "validationUsageJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchAttemptAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "batchId" TEXT,
    "level" "AuditLevel" NOT NULL,
    "stage" TEXT,
    "code" TEXT,
    "message" TEXT NOT NULL,
    "contextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_checksumSha256_key" ON "UploadedFile"("checksumSha256");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSegment_documentId_segmentIndex_key" ON "SourceSegment"("documentId", "segmentIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_documentId_batchIndex_key" ON "Batch"("documentId", "batchIndex");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedItem_documentId_itemUid_key" ON "NormalizedItem"("documentId", "itemUid");

-- CreateIndex
CREATE UNIQUE INDEX "BatchValidation_batchId_key" ON "BatchValidation"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderTaskConfigSnapshot_documentId_taskKind_key" ON "ProviderTaskConfigSnapshot"("documentId", "taskKind");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_promptKey_version_key" ON "PromptTemplate"("promptKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BatchAttemptAudit_batchId_attemptNumber_key" ON "BatchAttemptAudit"("batchId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedFileId_fkey" FOREIGN KEY ("uploadedFileId") REFERENCES "UploadedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSegment" ADD CONSTRAINT "SourceSegment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSourceSegment" ADD CONSTRAINT "BatchSourceSegment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSourceSegment" ADD CONSTRAINT "BatchSourceSegment_sourceSegmentId_fkey" FOREIGN KEY ("sourceSegmentId") REFERENCES "SourceSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedItem" ADD CONSTRAINT "NormalizedItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedItem" ADD CONSTRAINT "NormalizedItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchValidation" ADD CONSTRAINT "BatchValidation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentValidation" ADD CONSTRAINT "DocumentValidation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderTaskConfigSnapshot" ADD CONSTRAINT "ProviderTaskConfigSnapshot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExecution" ADD CONSTRAINT "PromptExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExecution" ADD CONSTRAINT "PromptExecution_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExecution" ADD CONSTRAINT "PromptExecution_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "PromptTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchAttemptAudit" ADD CONSTRAINT "BatchAttemptAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

