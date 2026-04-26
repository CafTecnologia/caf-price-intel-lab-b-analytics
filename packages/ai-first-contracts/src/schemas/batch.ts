import { z } from "zod";

import { AI_PROVIDERS, BATCH_EXECUTION_STATUSES } from "../enums";
import { NormalizedItemSchema } from "./item";
import { SourceRangeSchema } from "./source";
import { BatchValidationResultSchema } from "./validation";

export const BatchSchema = z
  .object({
    batch_id: z.string().trim().min(1),
    document_id: z.string().trim().min(1),
    batch_index: z.number().int().nonnegative(),
    source_range: SourceRangeSchema,
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1),
    prompt_version: z.string().trim().min(1),
    extraction_status: z.enum(BATCH_EXECUTION_STATUSES),
    validation_status: z.enum(BATCH_EXECUTION_STATUSES),
    output_json: z.array(NormalizedItemSchema).default([]),
    validation_json: BatchValidationResultSchema.nullable().default(null),
    confidence_score: z.number().min(0).max(1).nullable().default(null),
    warnings: z.array(z.string().trim().min(1)).default([]),
    retry_count: z.number().int().min(0).default(0),
    candidate_item_count: z.number().int().min(0).nullable().default(null),
    extracted_item_count: z.number().int().min(0).nullable().default(null),
    validated_item_count: z.number().int().min(0).nullable().default(null),
    started_at: z.string().datetime().nullable().default(null),
    finished_at: z.string().datetime().nullable().default(null),
  })
  .strict();

export type Batch = z.infer<typeof BatchSchema>;
