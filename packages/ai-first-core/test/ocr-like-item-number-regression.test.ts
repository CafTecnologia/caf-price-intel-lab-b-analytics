import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { AiProvider } from "../../ai-first-contracts/src/enums";

import { LocalProcessingService } from "../src/local-dev/local-processing-service";
import { LocalRunStore } from "../src/local-dev/local-run-store";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

function buildWorkbookBytes(): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows: Array<Array<string | number>> = [
    ["ITEM", "DESCRIPCION", "CANTIDAD", "UNIDAD", "PRECIO UNITARIO", "PRECIO TOTAL", "MONEDA"],
  ];

  for (let itemNumber = 1; itemNumber <= 30; itemNumber += 1) {
    const rawLabel = itemNumber === 9 ? "G" : itemNumber === 19 ? "1G" : itemNumber === 29 ? "2G" : String(itemNumber);

    rows.push([
      rawLabel,
      `Elemento oficial ${itemNumber}`,
      itemNumber,
      itemNumber === 22 ? "null" : "UND",
      1000 + itemNumber,
      (1000 + itemNumber) * itemNumber,
      "COP",
    ]);
  }

  rows.push(["", "VALOR TOTAL CON IVA", "", "", "", 999999, "COP"]);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Table 1");

  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}

async function runSyntheticWorkbook(provider: AiProvider) {
  process.env.AI_FIRST_FORCE_MOCK = "1";

  const workspace = mkdtempSync(resolve(tmpdir(), `ai-first-ocr-${provider}-`));
  const service = new LocalProcessingService(
    undefined,
    new LocalRunStore(resolve(workspace, "local.db")),
    resolve(workspace, "uploads"),
  );

  return service.processUpload({
    fileName: `ocr-like-${provider}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: buildWorkbookBytes(),
    providerConfig: LocalProcessingService.defaultProviderConfig({
      detectOfficialBlock: { provider },
      extractItemsBatch: { provider },
      validateBatch: { provider },
      validateGlobal: { provider },
    }),
    processingOptions: {
      batch_size: 10,
      batch_retry_limit: 1,
      export_formats: ["json"],
      enable_ocr_fallback: false,
      allow_batch_reprocess: true,
    },
  });
}

describe("OCR-like item-number regression", () => {
  it.each(["openai", "gemini"] as const)(
    "keeps full coverage and canonical numbering for spreadsheet rows with OCR-like labels using %s",
    async (provider) => {
      const record = await runSyntheticWorkbook(provider);

      expect(record.document.total_candidate_items).toBe(30);
      expect(record.document.total_extracted_items).toBe(30);
      expect(record.document.total_validated_items).toBe(30);
      expect(record.document.items).toHaveLength(30);
      expect(record.document.items.map((item) => item.numero_item)).toEqual(
        Array.from({ length: 30 }, (_, index) => String(index + 1)),
      );
      expect(record.document.items.some((item) => item.numero_item === "G" || item.numero_item === "1G" || item.numero_item === "2G")).toBe(false);
      expect(record.document.items.find((item) => item.numero_item === "22")?.unidad_medida).toBeNull();
      expect(record.document.global_warnings.some((warning) => /missing item 9/i.test(warning))).toBe(false);
    },
  );
});
