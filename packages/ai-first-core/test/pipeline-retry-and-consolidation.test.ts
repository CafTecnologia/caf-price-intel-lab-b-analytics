import { beforeEach, describe, expect, it } from "vitest";

import {
  buildAuditProviderConfig,
  buildSyntheticDocumentSegments,
  buildSyntheticRows,
  cloneSyntheticRow,
} from "../src/audit/fixtures";
import { ScenarioProviderAdapter, SingleProviderRegistry } from "../src/audit/scenario-provider";
import { BasicDocumentOrchestrator } from "../src/orchestration/basic-document-orchestrator";
import { FinalResultConsolidator } from "../src/orchestration/batch-consolidator";
import { AiTaskOrchestrator } from "../src/services/ai-task-orchestrator";

describe("Phase 3 retry and consolidation behavior", () => {
  beforeEach(() => {
    process.env.AI_FIRST_FORCE_MOCK = "1";
  });

  it("retries a batch once and still completes with all items", async () => {
    const documentId = "test-retry-12";
    const provider = new ScenarioProviderAdapter("openai", {
      retryOnceBatchIds: [`${documentId}:batch-1`],
    });
    const tasks = new AiTaskOrchestrator(new SingleProviderRegistry(provider));
    const orchestrator = new BasicDocumentOrchestrator(tasks);

    const result = await orchestrator.run({
      document_id: documentId,
      file_name: "test-retry-12.pdf",
      file_type: "pdf",
      segments: buildSyntheticDocumentSegments({
        documentId,
        rows: buildSyntheticRows(12, { descriptionPrefix: "Item con retry sintetico" }),
        rowsPerSegment: 6,
        finalNote: "Nota: escenario de retry.",
      }),
      provider_config_used: buildAuditProviderConfig("openai"),
      processing_options: {
        batch_size: 6,
        batch_retry_limit: 1,
        export_formats: ["json"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
      },
    });

    expect(result.document.processing_status).toBe("completed");
    expect(result.trace.metrics.retried_batch_count).toBe(1);
    expect(result.document.batches[0]?.retry_count).toBe(1);
    expect(result.document.total_extracted_items).toBe(12);
    expect(result.document.total_validated_items).toBe(12);
    expect(result.document.items).toHaveLength(12);
  });

  it("resolves duplicates during final consolidation and keeps traceability", async () => {
    const documentId = "test-duplicate-5";
    const baseRows = buildSyntheticRows(4, { descriptionPrefix: "Item con duplicado" });
    const rows = [...baseRows, cloneSyntheticRow(baseRows[1])];
    const orchestrator = new BasicDocumentOrchestrator();

    const result = await orchestrator.run({
      document_id: documentId,
      file_name: "test-duplicate-5.pdf",
      file_type: "pdf",
      segments: buildSyntheticDocumentSegments({
        documentId,
        rows,
        rowsPerSegment: 2,
        finalNote: "Nota: escenario con duplicado.",
      }),
      provider_config_used: buildAuditProviderConfig("openai"),
      processing_options: {
        batch_size: 2,
        batch_retry_limit: 1,
        export_formats: ["json"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
      },
    });

    expect(result.document.processing_status).toBe("completed_with_warnings");
    expect(result.document.total_extracted_items).toBe(5);
    expect(result.document.total_validated_items).toBe(5);
    expect(result.document.items).toHaveLength(4);
    expect(result.trace.consolidation?.duplicate_resolutions).toHaveLength(1);
    expect(result.document.global_warnings.some((warning) => warning.includes("duplicate item groups"))).toBe(true);
  });

  it("keeps manual-review batch rows visible in the final review table", () => {
    const consolidator = new FinalResultConsolidator();
    const syntheticRows = buildSyntheticRows(2, { descriptionPrefix: "Item manual review" });
    const manualReviewBatch = {
      batch_id: "doc:batch-manual",
      document_id: "doc",
      batch_index: 0,
      source_range: {
        start_segment_id: "seg-1",
        end_segment_id: "seg-2",
        start_segment_index: 0,
        end_segment_index: 1,
        label: "segments 0-1",
      },
      provider: "gemini" as const,
      model: "gemini-2.5-flash",
      prompt_version: "2026-04-21.1",
      extraction_status: "completed" as const,
      validation_status: "manual_review" as const,
      output_json: syntheticRows.map((row, index) => ({
        item_uid: `manual:${index + 1}`,
        numero_item: row.numero_item,
        nombre_o_descripcion: row.nombre_o_descripcion,
        ficha_tecnica: null,
        cantidad: row.cantidad,
        unidad_medida: row.unidad_medida,
        precio_referencia_unit: row.precio_referencia_unit,
        precio_referencia_total: row.precio_referencia_total,
        moneda: row.moneda,
        raw_text_evidence: `${row.numero_item} | ${row.nombre_o_descripcion}`,
        source_location: {
          primary_locator: {
            page: 1,
            sheet: null,
            table: "tabla-1",
            row_start: index + 1,
            row_end: index + 1,
            cell_range: null,
            paragraph_index: null,
            char_start: null,
            char_end: null,
            note: "manual review",
          },
          source_range: {
            start_segment_id: "seg-1",
            end_segment_id: "seg-1",
            start_segment_index: index,
            end_segment_index: index,
            label: `segments ${index}-${index}`,
          },
          segment_ids: [`seg-${index + 1}`],
        },
        extraction_mode: "extracted_directly" as const,
        warnings: [],
        confidence: 0.81,
      })),
      validation_json: {
        validation_score: 0.35,
        completeness_score: 0.4,
        hallucination_risk_score: 0.65,
        structural_consistency_score: 0.4,
        warnings: ["AI batch validation failed: Provider request failed with status 400"],
        suspected_missing_items: [],
        suspected_duplicates: [],
        recommendation: "manual_review" as const,
        rationale: "Validation transport failed after extraction.",
      },
      confidence_score: 0.56,
      warnings: ["AI batch validation failed: Provider request failed with status 400"],
      retry_count: 0,
      candidate_item_count: 2,
      extracted_item_count: 2,
      validated_item_count: 0,
      started_at: "2026-04-22T00:00:00.000Z",
      finished_at: "2026-04-22T00:00:10.000Z",
    };

    const result = consolidator.consolidate([manualReviewBatch]);

    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.warnings.some((warning) => warning.includes("manual_review")))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("manual-review batch"))).toBe(true);
    expect(result.accepted_batches).toHaveLength(0);
  });
});
