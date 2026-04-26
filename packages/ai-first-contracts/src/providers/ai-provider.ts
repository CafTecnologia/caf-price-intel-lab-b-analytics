import { z } from "zod";

import { AI_PROVIDERS } from "../enums";
import { BatchSchema } from "../schemas/batch";
import { DocumentResultSchema } from "../schemas/document";
import { NormalizedItemSchema } from "../schemas/item";
import { AiTaskExecutionConfigSchema } from "../schemas/provider-config";
import { DetectionSummarySchema, SourceSegmentSchema } from "../schemas/source";
import { BatchValidationResultSchema, GlobalValidationResultSchema } from "../schemas/validation";

export const PromptArtifactSchema = z
  .object({
    key: z.string().trim().min(1),
    version: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable().default(null),
    system_instructions: z.string().trim().min(1),
    user_template: z.string().trim().min(1),
    response_schema_name: z.string().trim().min(1),
  })
  .strict();

export const ProviderUsageMetadataSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1),
    input_tokens: z.number().int().min(0).nullable().default(null),
    output_tokens: z.number().int().min(0).nullable().default(null),
    latency_ms: z.number().int().min(0),
    finish_reason: z.string().trim().min(1).nullable().default(null),
  })
  .strict();

export const DetectOfficialBlockInputSchema = z
  .object({
    document_id: z.string().trim().min(1),
    file_name: z.string().trim().min(1),
    file_type: DocumentResultSchema.shape.file_type,
    segments: z.array(SourceSegmentSchema).min(1),
    task_config: AiTaskExecutionConfigSchema,
    prompt: PromptArtifactSchema,
  })
  .strict();

export const ExtractItemsBatchInputSchema = z
  .object({
    batch: BatchSchema.pick({
      batch_id: true,
      document_id: true,
      batch_index: true,
      source_range: true,
    }),
    segments: z.array(SourceSegmentSchema).min(1),
    task_config: AiTaskExecutionConfigSchema,
    prompt: PromptArtifactSchema,
    max_items_in_batch: z.number().int().min(1).max(20),
  })
  .strict();

export const ValidateBatchInputSchema = z
  .object({
    batch: BatchSchema.pick({
      batch_id: true,
      document_id: true,
      batch_index: true,
      source_range: true,
    }),
    segments: z.array(SourceSegmentSchema).min(1),
    extracted_items: z.array(NormalizedItemSchema).max(20),
    task_config: AiTaskExecutionConfigSchema,
    prompt: PromptArtifactSchema,
  })
  .strict();

export const ValidateGlobalInputSchema = z
  .object({
    document_id: z.string().trim().min(1),
    accepted_batches: z.array(BatchSchema),
    items: z.array(NormalizedItemSchema),
    detection_summary: DetectionSummarySchema,
    task_config: AiTaskExecutionConfigSchema,
    prompt: PromptArtifactSchema,
  })
  .strict();

export const DetectOfficialBlockOutputSchema = z
  .object({
    result: DetectionSummarySchema,
    usage: ProviderUsageMetadataSchema,
    raw_response: z.unknown(),
  })
  .strict();

export const ExtractItemsBatchOutputSchema = z
  .object({
    items: z.array(NormalizedItemSchema).max(20),
    usage: ProviderUsageMetadataSchema,
    raw_response: z.unknown(),
  })
  .strict();

export const ValidateBatchOutputSchema = z
  .object({
    result: BatchValidationResultSchema,
    usage: ProviderUsageMetadataSchema,
    raw_response: z.unknown(),
  })
  .strict();

export const ValidateGlobalOutputSchema = z
  .object({
    result: GlobalValidationResultSchema,
    usage: ProviderUsageMetadataSchema,
    raw_response: z.unknown(),
  })
  .strict();

export type PromptArtifact = z.infer<typeof PromptArtifactSchema>;
export type ProviderUsageMetadata = z.infer<typeof ProviderUsageMetadataSchema>;
export type DetectOfficialBlockInput = z.infer<typeof DetectOfficialBlockInputSchema>;
export type ExtractItemsBatchInput = z.infer<typeof ExtractItemsBatchInputSchema>;
export type ValidateBatchInput = z.infer<typeof ValidateBatchInputSchema>;
export type ValidateGlobalInput = z.infer<typeof ValidateGlobalInputSchema>;
export type DetectOfficialBlockOutput = z.infer<typeof DetectOfficialBlockOutputSchema>;
export type ExtractItemsBatchOutput = z.infer<typeof ExtractItemsBatchOutputSchema>;
export type ValidateBatchOutput = z.infer<typeof ValidateBatchOutputSchema>;
export type ValidateGlobalOutput = z.infer<typeof ValidateGlobalOutputSchema>;

export interface AiProviderAdapter {
  readonly provider: z.infer<typeof ProviderUsageMetadataSchema>["provider"];
  detectOfficialBlock(input: DetectOfficialBlockInput): Promise<DetectOfficialBlockOutput>;
  extractItemsBatch(input: ExtractItemsBatchInput): Promise<ExtractItemsBatchOutput>;
  validateBatch(input: ValidateBatchInput): Promise<ValidateBatchOutput>;
  validateGlobal(input: ValidateGlobalInput): Promise<ValidateGlobalOutput>;
}

export interface AiProviderRegistry {
  get(provider: z.infer<typeof ProviderUsageMetadataSchema>["provider"]): AiProviderAdapter;
  list(): AiProviderAdapter[];
}
