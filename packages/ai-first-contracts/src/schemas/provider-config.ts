import { z } from "zod";

import { AI_PROVIDERS, AI_TASKS, EXPORT_FORMATS } from "../enums";

export const AiTaskExecutionConfigSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1),
    temperature: z.number().min(0).max(2).default(0),
    timeout_ms: z.number().int().min(1_000).max(300_000).default(60_000),
    max_retries: z.number().int().min(0).max(5).default(2),
    max_input_tokens: z.number().int().min(128).max(200_000).nullable().default(null),
    max_output_tokens: z.number().int().min(128).max(200_000).nullable().default(null),
    top_p: z.number().min(0).max(1).nullable().default(null),
    seed: z.number().int().nullable().default(null),
    prompt_version: z.string().trim().min(1),
    extra: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const ProviderConfigByTaskSchema = z
  .object({
    detectOfficialBlock: AiTaskExecutionConfigSchema,
    extractItemsBatch: AiTaskExecutionConfigSchema,
    validateBatch: AiTaskExecutionConfigSchema,
    validateGlobal: AiTaskExecutionConfigSchema,
  })
  .strict();

export const ProviderTaskOverrideSchema = z
  .object({
    task: z.enum(AI_TASKS),
    override: AiTaskExecutionConfigSchema,
  })
  .strict();

export const ProcessingOptionsSchema = z
  .object({
    batch_size: z.number().int().min(1).max(20).default(10),
    batch_retry_limit: z.number().int().min(0).max(3).default(1),
    export_formats: z.array(z.enum(EXPORT_FORMATS)).default(["json"]),
    enable_ocr_fallback: z.boolean().default(false),
    allow_batch_reprocess: z.boolean().default(true),
  })
  .strict();

export type AiTaskExecutionConfig = z.infer<typeof AiTaskExecutionConfigSchema>;
export type ProviderConfigByTask = z.infer<typeof ProviderConfigByTaskSchema>;
export type ProviderTaskOverride = z.infer<typeof ProviderTaskOverrideSchema>;
export type ProcessingOptions = z.infer<typeof ProcessingOptionsSchema>;
