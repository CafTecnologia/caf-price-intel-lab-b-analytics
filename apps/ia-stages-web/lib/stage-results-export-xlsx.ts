import * as XLSX from "xlsx";
import { formatScalarForUi } from "@/lib/display-format-es-co";
import { financialIngestToTableRows } from "@/lib/financial-ingest-preview-rows";
import type { FinancialIngestPayload } from "@/lib/stage3-to-financial-ingest";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Texto legible para celdas Excel (objetos y arrays aplanados). */
export function flattenCellValueForExport(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (depth > 6) {
    return "…";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return formatScalarForUi(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => flattenCellValueForExport(entry, depth + 1)).join(" · ");
  }
  if (isPlainRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${flattenCellValueForExport(entry, depth + 1)}`)
      .join(" | ");
  }
  return String(value);
}

function collectColumnOrder(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order;
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "-").trim() || "Hoja";
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
}

function objectToKeyValueSheetData(value: unknown): string[][] {
  if (value === null || value === undefined) {
    return [["(vacío)", ""]];
  }
  if (!isPlainRecord(value)) {
    return [["valor", flattenCellValueForExport(value)]];
  }
  const rows: [string, string][] = [];

  function walk(obj: Record<string, unknown>, prefix: string) {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v !== null && isPlainRecord(v)) {
        walk(v, path);
      } else if (Array.isArray(v)) {
        rows.push([path, flattenCellValueForExport(v)]);
      } else {
        rows.push([path, flattenCellValueForExport(v)]);
      }
    }
  }

  walk(value, "");
  if (!rows.length) {
    return [["(sin claves)", ""]];
  }
  return [["Campo", "Valor"], ...rows.map(([a, b]) => [a, b])];
}

export type StageExcelExportOptions = {
  /** Sin extensión .xlsx; se añade timestamp. */
  filenamePrefix: string;
  mainSheetName: string;
  items: Record<string, unknown>[];
  metadata?: unknown;
  controlCalidad?: unknown;
};

/**
 * Genera un .xlsx con hoja principal en formato tabla y hojas opcionales
 * para metadata y control de calidad (clave / valor).
 */
export function downloadStageItemsExcel(opts: StageExcelExportOptions): void {
  const { items, metadata, controlCalidad } = opts;
  if (!items.length) {
    return;
  }

  const columns = collectColumnOrder(items);
  const tableRows = items.map((row) => {
    const line: Record<string, string> = {};
    for (const col of columns) {
      line[col] = flattenCellValueForExport(row[col]);
    }
    return line;
  });

  const workbook = XLSX.utils.book_new();
  const mainSheet = XLSX.utils.json_to_sheet(tableRows);
  mainSheet["!cols"] = columns.map((col) => {
    const sample = tableRows.map((row) => (row[col] ?? "").length);
    const maxContent = sample.length ? Math.max(...sample) : 0;
    const wch = Math.max(col.length, maxContent, 10);
    return { wch: Math.min(56, wch + 2) };
  });
  XLSX.utils.book_append_sheet(workbook, mainSheet, sanitizeSheetName(opts.mainSheetName));

  if (metadata !== null && metadata !== undefined) {
    const metaData = objectToKeyValueSheetData(metadata);
    const metaSheet = XLSX.utils.aoa_to_sheet(metaData);
    metaSheet["!cols"] = [{ wch: 36 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(workbook, metaSheet, sanitizeSheetName("Metadata"));
  }

  if (controlCalidad !== null && controlCalidad !== undefined) {
    const cqData = objectToKeyValueSheetData(controlCalidad);
    const cqSheet = XLSX.utils.aoa_to_sheet(cqData);
    cqSheet["!cols"] = [{ wch: 36 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(workbook, cqSheet, sanitizeSheetName("Control calidad"));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${opts.filenamePrefix}-${stamp}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

export function downloadFinancialIngestPreviewExcel(ingest: FinancialIngestPayload): void {
  const items = financialIngestToTableRows(ingest);
  downloadStageItemsExcel({
    filenamePrefix: "etapa-4-vista-previa-ingesta",
    mainSheetName: "Carga de items",
    items,
    metadata: {
      version: ingest.version,
      source: ingest.source,
      settings: ingest.settings,
      items_count: ingest.items.length
    }
  });
}
