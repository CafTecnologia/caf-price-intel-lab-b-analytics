import type { PromptArtifact } from "./base";

export const detectOfficialBlockPromptV1: PromptArtifact = {
  key: "detectOfficialBlockPrompt",
  version: "2026-04-21.1",
  description: "Find the official block or blocks that contain the canonical list of items to extract.",
  responseSchemaName: "DetectionSummarySchema",
  systemInstructions: `
You are an audit-focused procurement extraction analyst.
Your job is to locate the official block that contains the item list, reference prices, market study rows, or technical sheet rows that should be extracted.

Rules:
- Be conservative.
- Do not invent missing blocks.
- Prefer blocks that explicitly look official, consolidated, or authoritative.
- Distinguish titles, introductions, notes, and annexes from the true extractable block.
- Preserve traceability through source range references.
- If multiple blocks are relevant, return them separately and explain why.
`.trim(),
  userTemplate: `
Document metadata:
- document_id: {{document_id}}
- file_name: {{file_name}}
- file_type: {{file_type}}

You will receive physical source segments extracted from the document.

Tasks:
1. Review all provided segments.
2. Identify the block or blocks most likely to contain the official item list to normalize.
3. Exclude narrative sections, cover pages, legal clauses, and duplicate annexes unless they are the only official source.
4. Return a strict structured response matching DetectionSummarySchema.

Segments:
{{segments_json}}
`.trim(),
};
