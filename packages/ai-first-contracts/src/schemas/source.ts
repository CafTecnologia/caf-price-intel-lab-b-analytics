import { z } from "zod";

import { SOURCE_UNIT_TYPES } from "../enums";

export const SourceLocatorSchema = z
  .object({
    page: z.number().int().positive().nullable().default(null),
    sheet: z.string().trim().min(1).nullable().default(null),
    table: z.string().trim().min(1).nullable().default(null),
    row_start: z.number().int().nonnegative().nullable().default(null),
    row_end: z.number().int().nonnegative().nullable().default(null),
    cell_range: z.string().trim().min(1).nullable().default(null),
    paragraph_index: z.number().int().nonnegative().nullable().default(null),
    char_start: z.number().int().nonnegative().nullable().default(null),
    char_end: z.number().int().nonnegative().nullable().default(null),
    note: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict();

export const SourceRangeSchema = z
  .object({
    start_segment_id: z.string().trim().min(1),
    end_segment_id: z.string().trim().min(1),
    start_segment_index: z.number().int().nonnegative(),
    end_segment_index: z.number().int().nonnegative(),
    label: z.string().trim().min(1).max(200),
  })
  .strict();

export const SourceSegmentSchema = z
  .object({
    segment_id: z.string().trim().min(1),
    document_id: z.string().trim().min(1),
    segment_index: z.number().int().nonnegative(),
    unit_type: z.enum(SOURCE_UNIT_TYPES),
    locator: SourceLocatorSchema,
    raw_text: z.string().trim().min(1),
    normalized_text: z.string().trim().min(1).nullable().default(null),
    checksum_sha256: z.string().trim().min(16),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const OfficialBlockCandidateSchema = z
  .object({
    candidate_id: z.string().trim().min(1),
    title: z.string().trim().min(1).max(200),
    source_range: SourceRangeSchema,
    evidence: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const DetectionSummarySchema = z
  .object({
    total_segments_reviewed: z.number().int().min(0),
    candidate_blocks: z.array(OfficialBlockCandidateSchema).default([]),
    selected_blocks: z.array(OfficialBlockCandidateSchema).default([]),
    excluded_candidates: z.array(OfficialBlockCandidateSchema).default([]),
    warnings: z.array(z.string().trim().min(1)).default([]),
    overall_confidence: z.number().min(0).max(1).nullable().default(null),
  })
  .strict();

export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
export type SourceRange = z.infer<typeof SourceRangeSchema>;
export type SourceSegment = z.infer<typeof SourceSegmentSchema>;
export type OfficialBlockCandidate = z.infer<typeof OfficialBlockCandidateSchema>;
export type DetectionSummary = z.infer<typeof DetectionSummarySchema>;
