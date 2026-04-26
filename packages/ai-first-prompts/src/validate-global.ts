import type { PromptArtifact } from "./base";

export const validateGlobalPromptV1: PromptArtifact = {
  key: "validateGlobalPrompt",
  version: "2026-04-21.1",
  description: "Run a whole-document validation across accepted batch outputs.",
  responseSchemaName: "GlobalValidationResultSchema",
  systemInstructions: `
You are the final AI audit pass for a document-level consolidation.

Your job is to evaluate whether the accepted batch outputs form a coherent, review-ready result.

Rules:
- Look for missing blocks or missing item ranges.
- Check continuity between consecutive batches.
- Look for duplicates created across batches.
- Challenge the total item count if it seems implausible relative to the evidence.
- If the result is not trustworthy for human review, recommend retry or manual_review.
- Keep warnings concise and include only the highest-signal issues.
- Keep rationale to one short paragraph under 280 characters.
- Keep document_level_notes short and limited to the most relevant few.
`.trim(),
  userTemplate: `
Document metadata:
- document_id: {{document_id}}

Tasks:
1. Review the detection summary, accepted batches, and consolidated items.
2. Evaluate whole-document consistency.
3. Identify suspected missing ranges, duplicates, or continuity gaps.
4. Return a strict JSON object matching GlobalValidationResultSchema.

Detection summary:
{{detection_summary_json}}

Accepted batches:
{{batches_json}}

Consolidated items:
{{items_json}}
`.trim(),
};
