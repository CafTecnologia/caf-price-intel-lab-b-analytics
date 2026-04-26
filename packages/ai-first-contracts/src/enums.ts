export const AI_PROVIDERS = ["openai", "gemini", "anthropic", "deepseek"] as const;
export const AI_TASKS = [
  "detectOfficialBlock",
  "extractItemsBatch",
  "validateBatch",
  "validateGlobal",
] as const;
export const FILE_TYPES = ["pdf", "xlsx", "xls", "docx", "doc"] as const;
export const DOCUMENT_PROCESSING_STATUSES = [
  "uploaded",
  "segmenting",
  "detecting",
  "batching",
  "extracting",
  "validating",
  "consolidating",
  "completed",
  "completed_with_warnings",
  "manual_review",
  "failed",
] as const;
export const BATCH_EXECUTION_STATUSES = [
  "pending",
  "running",
  "completed",
  "completed_with_warnings",
  "retry",
  "manual_review",
  "failed",
] as const;
export const EXTRACTION_MODES = [
  "extracted_directly",
  "reconstructed_conservatively",
  "not_found",
] as const;
export const VALIDATION_RECOMMENDATIONS = [
  "accept",
  "accept_with_warning",
  "retry",
  "manual_review",
] as const;
export const SOURCE_UNIT_TYPES = [
  "page_block",
  "table_block",
  "table_row_range",
  "sheet_range",
  "paragraph_span",
  "mixed_span",
] as const;
export const EXPORT_FORMATS = ["json", "csv", "xlsx"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiTaskKind = (typeof AI_TASKS)[number];
export type FileType = (typeof FILE_TYPES)[number];
export type DocumentProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number];
export type BatchExecutionStatus = (typeof BATCH_EXECUTION_STATUSES)[number];
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];
export type ValidationRecommendation = (typeof VALIDATION_RECOMMENDATIONS)[number];
export type SourceUnitType = (typeof SOURCE_UNIT_TYPES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
