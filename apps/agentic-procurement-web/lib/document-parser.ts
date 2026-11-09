import path from "node:path";
import * as XLSX from "@e965/xlsx";
import type { DocumentInventory, OriginalItem } from "./types";
import { fixMojibake } from "./utils";

export type ParsedDocument = { inventory: DocumentInventory; items: OriginalItem[] };

const SPREADSHEET_ERROR = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|ERROR!)$/i;

const FIELD_ALIASES = {
  id: ["item", "no. item", "no item", "numero", "consecutivo interno", "consecutivo"],
  name: ["nombre o descripcion", "nombre o descripción", "nombre", "detalle"],
  description: ["detalles o ficha tecnica", "detalles o ficha técnica", "ficha tecnica", "ficha técnica", "descripcion", "descripción", "especificaciones", "caracteristicas"],
  unit: ["und de medida", "unidad", "presentacion", "presentación", "und/med", "und", "u/m"],
  quantity: ["cant", "cantidad", "canti"],
  ceiling: ["precio techo encontrado", "precio techo unitario", "precio techo", "precio unitario estimado", "valor unitario", "precio de referencia unitario", "precio referencia"],
  lot: ["no. de lote", "no de lote", "numero de lote", "nro de lote", "lote", "grupo", "categoria"]
};

function normalized(value: unknown) {
  return fixMojibake(String(value ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function value(record: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const expected = normalized(alias);
    const exact = entries.find(([key]) => normalized(key) === expected);
    if (exact && exact[1] !== null && exact[1] !== undefined) {
      const result = fixMojibake(String(exact[1]));
      if (result.trim()) return result;
    }
  }
  for (const alias of aliases) {
    const expected = normalized(alias);
    const partial = entries.find(([key]) => normalized(key).includes(expected));
    if (partial && partial[1] !== null && partial[1] !== undefined) {
      const result = fixMojibake(String(partial[1]));
      if (result.trim()) return result;
    }
  }
  return "";
}

export function recordToItem(record: Record<string, unknown>, index: number, source: { file: string; sheet?: string; row?: number; page?: number; excerpt?: string }, identity: "lot_aware" | "source" = "lot_aware"): OriginalItem | null {
  const name = value(record, FIELD_ALIASES.name);
  const description = value(record, FIELD_ALIASES.description);
  const unit = value(record, FIELD_ALIASES.unit);
  const quantity = value(record, FIELD_ALIASES.quantity);
  const ceilingPrice = value(record, FIELD_ALIASES.ceiling);
  const lot = value(record, FIELD_ALIASES.lot) || undefined;
  const sourceId = value(record, FIELD_ALIASES.id) || String(index + 1);
  if (!name && !description) return null;
  const criticalValues = [name, description, unit, quantity, ceilingPrice].filter(Boolean);
  if (criticalValues.length && criticalValues.every((entry) => SPREADSHEET_ERROR.test(entry.trim()))) return null;
  return {
    id: identity === "source" ? sourceId : lotAwareItemId(sourceId, lot),
    name: name || description.slice(0, 120),
    description,
    unit,
    quantity,
    ceilingPrice,
    lot,
    source: { ...source, excerpt: source.excerpt || [name, description].filter(Boolean).join(" | ").slice(0, 500) },
    raw: record
  };
}

export function lotAwareItemId(sourceId: string, lot?: string) {
  const cleanSourceId = String(sourceId || "").trim();
  const lotCode = normalizedLotCode(lot);
  return lotCode && !cleanSourceId.toUpperCase().startsWith(`${lotCode}-`)
    ? `${lotCode}-${cleanSourceId}`
    : cleanSourceId;
}

function findItemArray(input: unknown): Record<string, unknown>[] {
  const seen = new Set<unknown>();
  const candidates: Record<string, unknown>[][] = [];
  function walk(node: unknown, depth: number) {
    if (depth > 8 || node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const records = node.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
      if (records.length && records.some((record) => value(record, FIELD_ALIASES.name) || value(record, FIELD_ALIASES.description))) candidates.push(records);
      node.forEach((item) => walk(item, depth + 1));
      return;
    }
    Object.values(node as Record<string, unknown>).forEach((child) => walk(child, depth + 1));
  }
  walk(input, 0);
  return candidates.sort((left, right) => right.length - left.length)[0] || [];
}

export function parseDocument(fileName: string, buffer: Buffer, identity: "lot_aware" | "source" = "lot_aware"): ParsedDocument {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".json") return parseJson(fileName, buffer, identity);
  if ([".xlsx", ".xls", ".csv"].includes(extension)) return parseWorkbook(fileName, buffer, extension, identity);
  throw new Error(`Formato ${extension || "sin extension"} no soportado en el piloto. Usa XLSX, XLS, CSV o JSON.`);
}

export function parseMarkdownDocument(fileName: string, markdown: string, size: number): ParsedDocument {
  const extension = path.extname(fileName).toLowerCase() || ".md";
  const tables = markdownTables(markdown);
  const items: OriginalItem[] = [];
  const sheets: DocumentInventory["sheets"] = [];
  const warnings: string[] = [];

  tables.forEach((table, tableIndex) => {
    const matrix = [table.headers, ...table.rows];
    const detection = detectHeaderRow(matrix);
    sheets.push({
      name: `Tabla ${tableIndex + 1}`,
      rows: table.rows.length,
      columns: table.headers.length
    });
    if (detection.index < 0) return;
    table.rows.forEach((cells, rowIndex) => {
      const record: Record<string, unknown> = {};
      table.headers.forEach((header, columnIndex) => {
        record[header || `col_${columnIndex + 1}`] = cells[columnIndex] ?? "";
      });
      if (table.lot) record.Lote = table.lot;
      const item = recordToItem(record, items.length, {
        file: fileName,
        row: rowIndex + 1,
        excerpt: [table.headers.join(" | "), cells.join(" | ")].join("\n").slice(0, 1000)
      });
      if (item) items.push(item);
    });
  });

  if (!tables.length) warnings.push("El documento no contiene tablas Markdown detectables.");
  else if (!items.length) warnings.push("Las tablas detectadas no contienen columnas suficientes para reconocer items.");

  return {
    inventory: {
      fileName,
      extension,
      size,
      sheets,
      parser: "Docling Markdown + AI-first source mapper",
      detectedRows: items.length,
      warnings
    },
    items
  };
}

function markdownTables(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const tables: Array<{ headers: string[]; rows: string[][]; lot?: string }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const tableStart = index;
    const header = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (
      header.length < 2
      || separator.length !== header.length
      || !separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
    ) continue;
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length) {
      const cells = splitMarkdownRow(lines[index]);
      if (cells.length < 2) break;
      while (cells.length < header.length) cells.push("");
      rows.push(cells.slice(0, header.length));
      index += 1;
    }
    tables.push({ headers: header, rows, lot: nearestLotHeading(lines, tableStart) });
  }
  return tables;
}

function nearestLotHeading(lines: string[], tableStart: number) {
  for (let index = tableStart; index >= Math.max(0, tableStart - 24); index -= 1) {
    const clean = fixMojibake(lines[index] || "").replace(/[*_#]/g, " ").replace(/\s+/g, " ").trim();
    const match = clean.match(/\blote\s*0*(\d{1,3})\b/i) || clean.match(/\bloteo\s*0*(\d{1,3})\b/i);
    if (match) return `LOTE ${match[1].padStart(2, "0")}`;
  }
  return undefined;
}

function normalizedLotCode(lot?: string) {
  const value = normalized(lot);
  const match = value.match(/^(?:0*)(\d{1,3})$/)
    || value.match(/\b(?:lote|loteo|grupo)\s*0*(\d{1,3})\b/);
  return match ? `L${match[1].padStart(2, "0")}` : "";
}

function splitMarkdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return body
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, " ").trim());
}

function parseJson(fileName: string, buffer: Buffer, identity: "lot_aware" | "source"): ParsedDocument {
  const input = JSON.parse(buffer.toString("utf8"));
  const records = findItemArray(input);
  const items = records.map((record, index) => recordToItem(record, index, { file: fileName, row: index + 1 }, identity)).filter(Boolean) as OriginalItem[];
  return {
    inventory: {
      fileName,
      extension: ".json",
      size: buffer.length,
      sheets: [{ name: "JSON", rows: records.length, columns: records[0] ? Object.keys(records[0]).length : 0 }],
      parser: "AI-first source mapper + JSON inventory",
      detectedRows: items.length,
      warnings: items.length ? [] : ["No se encontro un arreglo reconocible de items."]
    },
    items
  };
}

function parseWorkbook(fileName: string, buffer: Buffer, extension: string, identity: "lot_aware" | "source"): ParsedDocument {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const items: OriginalItem[] = [];
  const sheets: DocumentInventory["sheets"] = [];
  const candidates: Array<{
    sheetName: string;
    matrix: unknown[][];
    headerIndex: number;
    score: number;
    strong: boolean;
  }> = [];
  let skippedFormulaErrorRows = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    sheets.push({ name: sheetName, rows: matrix.length, columns: range.e.c + 1 });
    const detection = detectHeaderRow(matrix);
    if (detection.index >= 0) {
      candidates.push({
        sheetName,
        matrix,
        headerIndex: detection.index,
        score: detection.score,
        strong: detection.strong
      });
    }
  }

  const strongCandidates = candidates.filter((candidate) => candidate.strong);
  const selectedCandidates = strongCandidates.length ? strongCandidates : candidates;
  const warnings = strongCandidates.length
    ? candidates
      .filter((candidate) => !candidate.strong)
      .map((candidate) => `Se omitio la tabla debil de la hoja ${candidate.sheetName}: parecia contenido auxiliar y no tenia columnas comerciales suficientes.`)
    : selectedCandidates.length
      ? ["No se encontro una tabla comercial fuerte; se uso la mejor estructura disponible y conviene revisar el inventario."]
      : [];

  for (const candidate of selectedCandidates) {
    const { sheetName, matrix, headerIndex } = candidate;
    const headers = (matrix[headerIndex] || []).map((cell, index) => String(cell || `col_${index + 1}`));
    let activeLot = "";
    for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
      const cells = matrix[rowIndex] || [];
      const record: Record<string, unknown> = {};
      headers.forEach((header, columnIndex) => { record[header] = cells[columnIndex] ?? ""; });
      const rowLot = value(record, FIELD_ALIASES.lot).trim();
      if (rowLot) activeLot = rowLot;
      else if (activeLot) record.Lote = activeLot;
      const item = recordToItem(record, items.length, { file: fileName, sheet: sheetName, row: rowIndex + 1 }, identity);
      if (item) items.push(item);
      else {
        const meaningfulCells = cells.map((cell) => String(cell ?? "").trim()).filter(Boolean);
        if (meaningfulCells.length && meaningfulCells.every((cell) => SPREADSHEET_ERROR.test(cell))) {
          skippedFormulaErrorRows += 1;
        }
      }
    }
  }
  if (skippedFormulaErrorRows) {
    warnings.push(
      `Se omitieron ${skippedFormulaErrorRows} fila(s) compuestas solo por errores de formula de Excel; no se trataron como items.`
    );
  }
  return {
    inventory: {
      fileName,
      extension,
      size: buffer.length,
      sheets,
      parser: "AI-first source mapper + workbook inventory",
      detectedRows: items.length,
      warnings: items.length ? warnings : ["No se detecto una tabla con nombre o descripcion de items.", ...warnings]
    },
    items
  };
}

function detectHeaderRow(matrix: unknown[][]) {
  let best = { index: -1, score: 0, strong: false };
  for (let index = 0; index < Math.min(matrix.length, 80); index += 1) {
    const row = matrix[index] || [];
    const labels = row.map(normalized);
    const matchedFields = Object.entries(FIELD_ALIASES)
      .filter(([, aliases]) => aliases.some((alias) => labels.some((label) => label === normalized(alias) || label.includes(normalized(alias)))))
      .map(([field]) => field);
    const score = matchedFields.length;
    const hasDescription = matchedFields.includes("name") || matchedFields.includes("description");
    const hasCommercialAnchor = ["id", "unit", "quantity", "ceiling"].some((field) => matchedFields.includes(field));
    const strong = hasDescription && hasCommercialAnchor;
    if (
      score > best.score
      || (score === best.score && strong && !best.strong)
    ) {
      best = { index, score, strong };
    }
  }
  return best.score >= 2 ? best : { index: -1, score: 0, strong: false };
}
