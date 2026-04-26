import { beforeEach, describe, expect, it } from "vitest";

import { buildAuditProviderConfig, buildSyntheticDocumentSegments, buildSyntheticRows, cloneSyntheticRow } from "../src/audit/fixtures";
import { BasicBatchPlanner } from "../src/orchestration/basic-batch-planner";
import { BasicDocumentOrchestrator } from "../src/orchestration/basic-document-orchestrator";

describe("AI-first batching pipeline", () => {
  beforeEach(() => {
    process.env.AI_FIRST_FORCE_MOCK = "1";
  });

  it("extracts all four items when batch_size is two", async () => {
    const orchestrator = new BasicDocumentOrchestrator();
    const documentId = "test-baseline-4";

    const result = await orchestrator.run({
      document_id: documentId,
      file_name: "test-baseline-4.pdf",
      file_type: "pdf",
      segments: buildSyntheticDocumentSegments({
        documentId,
        rows: buildSyntheticRows(4),
        rowsPerSegment: 2,
        finalNote: "Nota: cierre sintetico.",
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

    expect(result.document.processing_status).toBe("completed");
    expect(result.document.total_candidate_items).toBe(4);
    expect(result.document.total_extracted_items).toBe(4);
    expect(result.document.total_validated_items).toBe(4);
    expect(result.document.items).toHaveLength(4);
    expect(result.trace.metrics.planned_batch_count).toBe(2);
    expect(result.trace.metrics.accepted_batch_count).toBe(2);
    expect(result.trace.metrics.consolidated_item_count).toBe(4);
    expect(result.document.items.map((item) => item.numero_item)).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps full extraction coverage across 23 rows and 3 batches", async () => {
    const orchestrator = new BasicDocumentOrchestrator();
    const documentId = "test-batching-23";

    const result = await orchestrator.run({
      document_id: documentId,
      file_name: "test-batching-23.pdf",
      file_type: "pdf",
      segments: buildSyntheticDocumentSegments({
        documentId,
        rows: buildSyntheticRows(23),
        rowsPerSegment: 8,
        finalNote: "Nota: cierre sintetico de 23 items.",
      }),
      provider_config_used: buildAuditProviderConfig("openai"),
      processing_options: {
        batch_size: 10,
        batch_retry_limit: 1,
        export_formats: ["json"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
      },
    });

    expect(result.document.processing_status).toBe("completed");
    expect(result.document.total_candidate_items).toBe(23);
    expect(result.document.total_extracted_items).toBe(23);
    expect(result.document.total_validated_items).toBe(23);
    expect(result.document.items).toHaveLength(23);
    expect(result.trace.metrics.planned_batch_count).toBe(3);
    expect(result.trace.metrics.accepted_batch_count).toBe(3);
    expect(result.trace.metrics.retried_batch_count).toBe(0);
  });

  it("caps Gemini extraction batches to four candidate rows per call", () => {
    const documentId = "test-gemini-batch-cap";
    const planner = new BasicBatchPlanner();
    const segments = buildSyntheticDocumentSegments({
      documentId,
      rows: buildSyntheticRows(10),
      rowsPerSegment: 1,
    });
    const batches = planner.buildBatches({
      documentId,
      segments,
      providerConfig: buildAuditProviderConfig("gemini"),
      batchSize: 10,
    });

    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.segments.length)).toEqual([4, 4, 3]);
  });

  it("splits Gemini batches earlier when one segment is structurally heavy", () => {
    const documentId = "test-gemini-heavy-segment";
    const planner = new BasicBatchPlanner();
    const baseRows = buildSyntheticRows(6, { descriptionPrefix: "Item gemini denso" });
    const rows = baseRows.map((row, index) =>
      index === 2
        ? cloneSyntheticRow(row, {
            nombre_o_descripcion: `${row.nombre_o_descripcion} ${"detalle extendido ".repeat(40)}`.trim(),
          })
        : row,
    );
    const segments = buildSyntheticDocumentSegments({
      documentId,
      rows,
      rowsPerSegment: 1,
      includeCover: false,
    });

    const batches = planner.buildBatches({
      documentId,
      segments,
      providerConfig: buildAuditProviderConfig("gemini"),
      batchSize: 10,
    });

    expect(batches.map((batch) => batch.segments.length)).toEqual([2, 1, 3]);
  });
});
