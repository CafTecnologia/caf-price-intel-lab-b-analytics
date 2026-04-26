import { z } from "zod";

import { VALIDATION_RECOMMENDATIONS } from "../enums";
import { SourceRangeSchema } from "./source";

const ScoreSchema = z.number().min(0).max(1);

export const SuspectedMissingItemSchema = z
  .object({
    reference: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(1_000),
    source_range: SourceRangeSchema.nullable().default(null),
  })
  .strict();

export const SuspectedDuplicateSchema = z
  .object({
    item_uids: z.array(z.string().trim().min(1)).min(2),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const ValidationScoreBundleSchema = z
  .object({
    validation_score: ScoreSchema,
    completeness_score: ScoreSchema,
    hallucination_risk_score: ScoreSchema,
    structural_consistency_score: ScoreSchema,
  })
  .strict();

export const BatchValidationResultSchema = z
  .object({
    validation_score: ScoreSchema,
    completeness_score: ScoreSchema,
    hallucination_risk_score: ScoreSchema,
    structural_consistency_score: ScoreSchema,
    warnings: z.array(z.string().trim().min(1)).default([]),
    suspected_missing_items: z.array(SuspectedMissingItemSchema).default([]),
    suspected_duplicates: z.array(SuspectedDuplicateSchema).default([]),
    recommendation: z.enum(VALIDATION_RECOMMENDATIONS),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const GlobalValidationResultSchema = z
  .object({
    validation_score: ScoreSchema,
    completeness_score: ScoreSchema,
    hallucination_risk_score: ScoreSchema,
    structural_consistency_score: ScoreSchema,
    warnings: z.array(z.string().trim().min(1)).default([]),
    suspected_missing_items: z.array(SuspectedMissingItemSchema).default([]),
    suspected_duplicates: z.array(SuspectedDuplicateSchema).default([]),
    recommendation: z.enum(VALIDATION_RECOMMENDATIONS),
    rationale: z.string().trim().min(1).max(2_000),
    document_level_notes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type ValidationScoreBundle = z.infer<typeof ValidationScoreBundleSchema>;
export type SuspectedMissingItem = z.infer<typeof SuspectedMissingItemSchema>;
export type SuspectedDuplicate = z.infer<typeof SuspectedDuplicateSchema>;
export type BatchValidationResult = z.infer<typeof BatchValidationResultSchema>;
export type GlobalValidationResult = z.infer<typeof GlobalValidationResultSchema>;
