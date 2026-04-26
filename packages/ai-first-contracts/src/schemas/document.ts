import { z } from "zod";

import { DOCUMENT_PROCESSING_STATUSES, FILE_TYPES } from "../enums";
import { BatchSchema } from "./batch";
import { NormalizedItemSchema } from "./item";
import { ProviderConfigByTaskSchema, ProcessingOptionsSchema } from "./provider-config";
import { DetectionSummarySchema } from "./source";
import { GlobalValidationResultSchema } from "./validation";

export const DocumentResultSchema = z
  .object({
    document_id: z.string().trim().min(1),
    file_name: z.string().trim().min(1),
    file_type: z.enum(FILE_TYPES),
    processing_status: z.enum(DOCUMENT_PROCESSING_STATUSES),
    detection_summary: DetectionSummarySchema,
    provider_config_used: ProviderConfigByTaskSchema,
    processing_options: ProcessingOptionsSchema,
    total_candidate_items: z.number().int().min(0),
    total_extracted_items: z.number().int().min(0),
    total_validated_items: z.number().int().min(0),
    final_confidence_score: z.number().min(0).max(1).nullable().default(null),
    global_warnings: z.array(z.string().trim().min(1)).default([]),
    global_validation: GlobalValidationResultSchema.nullable().default(null),
    batches: z.array(BatchSchema).default([]),
    items: z.array(NormalizedItemSchema).default([]),
  })
  .strict();

export const CreateProcessingRequestSchema = z
  .object({
    file_name: z.string().trim().min(1),
    file_type: z.enum(FILE_TYPES),
    provider_config_used: ProviderConfigByTaskSchema,
    processing_options: ProcessingOptionsSchema,
  })
  .strict();

export type DocumentResult = z.infer<typeof DocumentResultSchema>;
export type CreateProcessingRequest = z.infer<typeof CreateProcessingRequestSchema>;
