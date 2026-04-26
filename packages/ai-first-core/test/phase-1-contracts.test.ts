import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DocumentResultSchema } from "../../ai-first-contracts/src/schemas/document";
import { ProcessingOptionsSchema } from "../../ai-first-contracts/src/schemas/provider-config";
import { buildAuditProviderConfig } from "../src/audit/fixtures";
import { PromptCatalog } from "../src/prompts/prompt-catalog";

describe("Phase 1 architecture and contracts", () => {
  it("keeps the mandatory Phase 1 artifacts in place", () => {
    const requiredPaths = [
      "docs/ai-first-phase-1-architecture.md",
      "packages/ai-first-contracts/src/index.ts",
      "packages/ai-first-prompts/src/index.ts",
      "integrations/odoo/src/dtos.ts",
      "integrations/odoo/src/mappers.ts",
    ];

    for (const relativePath of requiredPaths) {
      expect(existsSync(resolve(process.cwd(), relativePath))).toBe(true);
    }
  });

  it("keeps prompt resolution versioned and strict", () => {
    const catalog = new PromptCatalog();

    expect(catalog.resolve("detectOfficialBlock", "2026-04-21.1").version).toBe("2026-04-21.1");
    expect(() => catalog.resolve("validateGlobal", "mismatch-version")).toThrow(/Prompt version mismatch/);
  });

  it("rejects unexpected keys in strict schemas", () => {
    expect(
      ProcessingOptionsSchema.safeParse({
        batch_size: 10,
        batch_retry_limit: 1,
        export_formats: ["json"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
        extra_property: true,
      }).success,
    ).toBe(false);

    const validDocument = {
      document_id: "doc-phase1",
      file_name: "doc-phase1.pdf",
      file_type: "pdf",
      processing_status: "completed",
      detection_summary: {
        total_segments_reviewed: 1,
        candidate_blocks: [],
        selected_blocks: [],
        excluded_candidates: [],
        warnings: [],
        overall_confidence: 0.8,
      },
      provider_config_used: buildAuditProviderConfig("openai"),
      processing_options: {
        batch_size: 10,
        batch_retry_limit: 1,
        export_formats: ["json"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
      },
      total_candidate_items: 0,
      total_extracted_items: 0,
      total_validated_items: 0,
      final_confidence_score: 0.75,
      global_warnings: [],
      global_validation: null,
      batches: [],
      items: [],
      unexpected: true,
    };

    expect(DocumentResultSchema.safeParse(validDocument).success).toBe(false);
  });
});
