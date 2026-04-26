import { beforeEach, describe, expect, it } from "vitest";

import { BasicDocumentOrchestrator } from "../src/orchestration/basic-document-orchestrator";
import { resolvePrismaDatabaseUrl } from "../src/persistence/prisma-client";
import { buildPersistenceSnapshot } from "../src/persistence/write-model";
import { buildAuditProviderConfig, buildSyntheticDocumentSegments, buildSyntheticRows } from "../src/audit/fixtures";

describe("Phase 4 persistence write model", () => {
  beforeEach(() => {
    process.env.AI_FIRST_FORCE_MOCK = "1";
    delete process.env.PRISMA_DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  it("builds a complete persistence snapshot from an orchestrated run", async () => {
    const documentId = "test-persistence-4";
    const orchestrator = new BasicDocumentOrchestrator();
    const segments = buildSyntheticDocumentSegments({
      documentId,
      rows: buildSyntheticRows(4),
      rowsPerSegment: 2,
      finalNote: "Nota: persistencia sintetica.",
    });

    const output = await orchestrator.run({
      document_id: documentId,
      file_name: "test-persistence-4.pdf",
      file_type: "pdf",
      segments,
      provider_config_used: buildAuditProviderConfig("openai"),
      processing_options: {
        batch_size: 2,
        batch_retry_limit: 1,
        export_formats: ["json"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
      },
    });

    const snapshot = buildPersistenceSnapshot({
      uploadedFile: {
        fileName: "test-persistence-4.pdf",
        mimeType: "application/pdf",
        fileType: "pdf",
        checksumSha256: "test-persistence-upload-checksum-0001",
        storageKey: "synthetic/test-persistence-4.pdf",
        sizeBytes: 18_432,
      },
      segments,
      output,
    });

    expect(snapshot.document.id).toBe(documentId);
    expect(snapshot.sourceSegments).toHaveLength(segments.length);
    expect(snapshot.providerTaskConfigs).toHaveLength(4);
    expect(snapshot.promptTemplates).toHaveLength(4);
    expect(snapshot.batches).toHaveLength(2);
    expect(snapshot.batchSourceSegments).toHaveLength(4);
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.batchValidations).toHaveLength(2);
    expect(snapshot.documentValidations).toHaveLength(1);
    expect(snapshot.promptExecutions).toHaveLength(6);
    expect(snapshot.batchAttempts).toHaveLength(2);
    expect(snapshot.auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("normalizes DATABASE_URL fallback for Prisma when only SQLAlchemy style is present", () => {
    process.env.DATABASE_URL = "postgresql+psycopg://procurement:procurement@postgres:5432/procurement";

    expect(resolvePrismaDatabaseUrl()).toBe("postgresql://procurement:procurement@postgres:5432/procurement");
  });
});
