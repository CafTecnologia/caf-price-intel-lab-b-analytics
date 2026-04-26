import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import mammoth from "mammoth";
import pdfParse from "pdf-parse";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

import type { FileType } from "../../../ai-first-contracts/src/enums";
import type { SourceLocator, SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

function buildChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function createSegment(args: {
  documentId: string;
  segmentIndex: number;
  unitType: SourceSegment["unit_type"];
  locator: SourceLocator;
  rawText: string;
  metadata?: Record<string, unknown>;
}): SourceSegment {
  return {
    segment_id: `${args.documentId}:seg-${args.segmentIndex + 1}`,
    document_id: args.documentId,
    segment_index: args.segmentIndex,
    unit_type: args.unitType,
    locator: args.locator,
    raw_text: args.rawText,
    normalized_text: compactWhitespace(args.rawText),
    checksum_sha256: buildChecksum(`${args.documentId}:${args.segmentIndex}:${args.rawText}`),
    metadata: args.metadata ?? {},
  };
}

async function segmentPdf(documentId: string, filePath: string): Promise<SourceSegment[]> {
  const buffer = await readFile(filePath);
  const parsed = await pdfParse(buffer);
  const pages = parsed.text
    .split(/\f+/)
    .map((page: string) => page.trim())
    .filter(Boolean);
  const fallbackBlocks =
    pages.length > 0
      ? pages
      : chunk<string>(parsed.text.split(/\n{2,}/).filter(Boolean), 6).map((parts) => parts.join("\n\n"));

  return fallbackBlocks.map((pageText: string, index: number) =>
    createSegment({
      documentId,
      segmentIndex: index,
      unitType: "page_block",
      locator: {
        page: index + 1,
        sheet: null,
        table: null,
        row_start: null,
        row_end: null,
        cell_range: null,
        paragraph_index: null,
        char_start: null,
        char_end: null,
        note: "PDF page/block extraction",
      },
      rawText: pageText,
      metadata: {
        extractor: "pdf-parse",
      },
    }),
  );
}

async function segmentWord(documentId: string, filePath: string): Promise<SourceSegment[]> {
  const extracted = await mammoth.extractRawText({ path: filePath });
  const paragraphs = extracted.value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const groups = chunk(paragraphs, 6);

  return groups.map((paragraphGroup, index) =>
    createSegment({
      documentId,
      segmentIndex: index,
      unitType: "paragraph_span",
      locator: {
        page: null,
        sheet: null,
        table: null,
        row_start: null,
        row_end: null,
        cell_range: null,
        paragraph_index: index * 6,
        char_start: null,
        char_end: null,
        note: "DOCX paragraph group",
      },
      rawText: paragraphGroup.join("\n\n"),
      metadata: {
        extractor: "mammoth",
      },
    }),
  );
}

async function segmentSpreadsheet(documentId: string, filePath: string): Promise<SourceSegment[]> {
  const workbook = XLSX.read(await readFile(filePath), {
    type: "buffer",
    cellDates: false,
  });

  const segments: SourceSegment[] = [];
  let segmentIndex = 0;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(worksheet, {
      header: 1,
      blankrows: false,
      defval: null,
    });

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const cells = row
        .map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()))
        .filter((cell) => cell.length > 0);

      if (cells.length === 0) {
        continue;
      }

      segments.push(
        createSegment({
          documentId,
          segmentIndex,
          unitType: "table_row_range",
          locator: {
            page: null,
            sheet: sheetName,
            table: sheetName,
            row_start: rowIndex + 1,
            row_end: rowIndex + 1,
            cell_range: null,
            paragraph_index: null,
            char_start: null,
            char_end: null,
            note: "Spreadsheet row extraction",
          },
          rawText: cells.join(" | "),
          metadata: {
            extractor: "xlsx",
            column_count: cells.length,
          },
        }),
      );
      segmentIndex += 1;
    }
  }

  return segments;
}

export async function segmentDocumentFromFile(input: {
  documentId: string;
  filePath: string;
  fileType: FileType;
}): Promise<SourceSegment[]> {
  switch (input.fileType) {
    case "pdf":
      return segmentPdf(input.documentId, input.filePath);
    case "doc":
    case "docx":
      return segmentWord(input.documentId, input.filePath);
    case "xls":
    case "xlsx":
      return segmentSpreadsheet(input.documentId, input.filePath);
    default:
      throw new Error(`Unsupported file type for segmentation: ${input.fileType satisfies never}`);
  }
}
