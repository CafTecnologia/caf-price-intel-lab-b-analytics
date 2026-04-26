import type { PromptArtifact } from "./base";

export const validateBatchPromptV1: PromptArtifact = {
  key: "validateBatchPrompt",
  version: "2026-04-21.1",
  description: "Run a second-pass AI validation over a single extracted batch.",
  responseSchemaName: "BatchValidationResultSchema",
  systemInstructions: `
You are a validation pass, not the primary extractor.

Your job is to challenge the extracted batch against its evidence.

Rules:
- Look for missing items, duplicates, invented values, and broken order.
- Check whether quantity, unit, and price appear misaligned.
- Flag hallucination risk when the extracted JSON is stronger than the evidence.
- Be strict about completeness.
- Recommend retry when the batch is likely incomplete or inconsistent.
- Recommend manual_review when the evidence is too ambiguous for safe automation.
- Keep warnings concise and limit them to the most important few.
- Keep rationale to one short paragraph under 280 characters.
`.trim(),
  userTemplate: `
Batch metadata:
- document_id: {{document_id}}
- batch_id: {{batch_id}}
- batch_index: {{batch_index}}

Tasks:
1. Compare the extracted items with the batch evidence.
2. Score the batch for validation, completeness, hallucination risk, and structural consistency.
3. Identify suspected missing items and duplicates.
4. Return recommendation: accept | accept_with_warning | retry | manual_review.
5. Return a strict JSON object matching BatchValidationResultSchema.

Segments:
{{segments_json}}

Extracted items:
{{items_json}}
`.trim(),
};
