import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { LocalProcessingService } from "../src/local-dev/local-processing-service";
import { LocalRunStore } from "../src/local-dev/local-run-store";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

describe("LocalProcessingService", () => {
  it("processes an xlsx upload locally and exposes exports", async () => {
    process.env.AI_FIRST_FORCE_MOCK = "1";

    const workspace = mkdtempSync(resolve(tmpdir(), "ai-first-local-"));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["ITEM", "DESCRIPCION", "CANTIDAD", "UNIDAD", "PRECIO UNITARIO", "PRECIO TOTAL", "MONEDA"],
      ["1", "Portatil de prueba", 2, "UND", 3500000, 7000000, "COP"],
      ["2", "Monitor de prueba", 2, "UND", 850000, 1700000, "COP"],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Items");
    const bytes = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    const service = new LocalProcessingService(
      undefined,
      new LocalRunStore(resolve(workspace, "local.db")),
      resolve(workspace, "uploads"),
    );

    const record = await service.processUpload({
      fileName: "demo.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
      providerConfig: LocalProcessingService.defaultProviderConfig(),
      processingOptions: {
        batch_size: 2,
        batch_retry_limit: 1,
        export_formats: ["json", "csv", "xlsx"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: true,
      },
    });

    expect(record.document.items.length).toBe(2);
    expect(record.document.total_validated_items).toBe(2);
    expect(record.odooPreview.lines.length).toBe(2);

    const csvExport = service.exportDocument(record.documentId, "csv");
    const jsonExport = service.exportDocument(record.documentId, "json");

    expect(csvExport.fileName.endsWith(".csv")).toBe(true);
    expect(csvExport.body.toString("utf8")).toContain("Portatil de prueba");
    expect(jsonExport.body.toString("utf8")).toContain("\"total_validated_items\": 2");
  });
});
