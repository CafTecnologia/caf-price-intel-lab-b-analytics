import type { DocumentResult } from "../../../ai-first-contracts/src/schemas/document";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";
import type { ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";

import { BasicDocumentOrchestrator, type BasicDocumentOrchestratorOutput } from "../orchestration/basic-document-orchestrator";
import { PrismaProcessingRepository } from "./prisma-processing-repository";
import type { UploadedFileInput } from "./write-model";

export interface PersistedDocumentRunInput {
  documentId: string;
  fileName: string;
  fileType: DocumentResult["file_type"];
  segments: SourceSegment[];
  providerConfigUsed: ProviderConfigByTask;
  processingOptions: DocumentResult["processing_options"];
  uploadedFile: UploadedFileInput;
}

export interface PersistedDocumentRunOutput {
  output: BasicDocumentOrchestratorOutput;
}

export class PersistedDocumentRunner {
  constructor(
    private readonly orchestrator: BasicDocumentOrchestrator = new BasicDocumentOrchestrator(),
    private readonly repository: PrismaProcessingRepository = new PrismaProcessingRepository(),
  ) {}

  async run(input: PersistedDocumentRunInput): Promise<PersistedDocumentRunOutput> {
    await this.repository.registerUploadAndDocument({
      documentId: input.documentId,
      uploadedFile: input.uploadedFile,
      processingOptions: input.processingOptions,
    });
    await this.repository.saveSourceSegments(input.documentId, input.segments);
    await this.repository.markStage(input.documentId, "segment_document", "segmenting");

    const output = await this.orchestrator.run({
      document_id: input.documentId,
      file_name: input.fileName,
      file_type: input.fileType,
      segments: input.segments,
      provider_config_used: input.providerConfigUsed,
      processing_options: input.processingOptions,
    });

    await this.repository.persistCompletedRun({
      uploadedFile: input.uploadedFile,
      segments: input.segments,
      output,
    });

    return {
      output,
    };
  }
}
