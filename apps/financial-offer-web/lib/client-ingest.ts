import * as XLSX from "xlsx";

export type ClientImportPayload = {
  version: 2;
  items: unknown[];
  general_costs?: Array<{ name: string; category: "service" | "logistics" | "other"; amount: number; notes: string }>;
};

export type SpreadsheetImportPreview = {
  payload: ClientImportPayload;
  sheetName: string;
  sourceRowCount: number;
  warnings: string[];
};

export type PastedUpdateField = "auto" | "referenceUnit" | "manualUnitCost" | "quantity" | "unit" | "notes";

export type PastedItemPatch = {
  item: string | null;
  rowNumber: number;
  description?: string;
  technicalDescription?: string;
  quantity?: string | number | null;
  unit?: string;
  referenceUnit?: string | number | null;
  manualUnitCost?: string | number | null;
  notes?: string;
};

const knownExcelHeaders = [
  "Item",
  "No. item",
  "Nombre",
  "Nombre o descripción",
  "Descripción",
  "Detalles o ficha técnica",
  "Und de medida",
  "Cant",
  "Precio techo unitario",
  "Precio techo encontrado",
  "Proveedor 1",
  "Precio proveedor 1",
  "Tiene costo asociado",
];

const orderedPasteHeaders = [
  "Item",
  "Nombre",
  "Descripción",
  "Und de medida",
  "Cant",
  "Precio techo unitario",
  "Notas del ítem",
  "Proveedor 1",
  "Precio proveedor 1",
  "Moneda proveedor 1",
  "URL proveedor 1",
  "Proveedor 2",
  "Precio proveedor 2",
  "Moneda proveedor 2",
  "URL proveedor 2",
  "Proveedor 3",
  "Precio proveedor 3",
  "Moneda proveedor 3",
  "URL proveedor 3",
  "Tiene costo asociado",
  "Servicio o costo asociado",
  "Valor costo asociado",
  "Tipo costo asociado",
  "Aplicación costo asociado",
];

export { spreadsheetAccept } from "./import-file-types";

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(row: Record<string, unknown>, header: string): string {
  const wanted = normalizeHeader(header);
  const key = Object.keys(row).find((item) => normalizeHeader(item) === wanted);
  const value = key ? row[key] : undefined;
  return value === null || value === undefined ? "" : String(value).trim();
}

function firstText(row: Record<string, unknown>, headers: string[]): string {
  for (const header of headers) {
    const value = text(row, header);
    if (value) return value;
  }
  return "";
}

function valueOrNull(value: string): string | number | null {
  return value ? value : null;
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/ /g, " ").trim();
}

function isCurrencyToken(value: unknown): boolean {
  return /^(\$|cop|col\$|usd)$/i.test(cellText(value));
}

function parseFlexibleNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const textValue = cellText(value)
    .replace(/COP|COL\$|\$|USD/gi, " ")
    .trim();
  if (!textValue || /^(n\/d|nd|na|null|sin dato|-+)$/i.test(textValue)) return null;
  const match = textValue.match(/-?\d[\d.,\s]*/);
  if (!match) return null;

  let numberText = match[0].replace(/\s/g, "");
  const commaIndex = numberText.lastIndexOf(",");
  const dotIndex = numberText.lastIndexOf(".");
  if (commaIndex >= 0 && dotIndex >= 0) {
    numberText = commaIndex > dotIndex ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    const decimals = numberText.length - commaIndex - 1;
    numberText = decimals > 0 && decimals <= 2 ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (dotIndex >= 0) {
    const decimals = numberText.length - dotIndex - 1;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(numberText) || decimals > 2) {
      numberText = numberText.replace(/\./g, "");
    }
  }
  const parsed = Number(numberText);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeCurrencyCells(row: unknown[]): unknown[] {
  const merged: unknown[] = [];
  for (let index = 0; index < row.length; index += 1) {
    const current = row[index];
    const next = row[index + 1];
    if (isCurrencyToken(current) && cellText(next)) {
      merged.push(`${cellText(current)} ${cellText(next)}`);
      index += 1;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function looksLikeItemPriceMatrix(matrix: unknown[][]): boolean {
  const rows = matrix.filter((row) => row.some((cell) => cellText(cell)));
  if (!rows.length) return false;
  return rows.every((row) => {
    const cells = mergeCurrencyCells(row).map(cellText).filter(Boolean);
    return cells.length >= 2 && parseFlexibleNumber(cells[0]) !== null && parseFlexibleNumber(cells[cells.length - 1]) !== null;
  });
}

function sourceFromRow(row: Record<string, unknown>, index: 1 | 2 | 3) {
  const name = text(row, `Proveedor ${index}`);
  const unitPrice = text(row, `Precio proveedor ${index}`);
  const currency = text(row, `Moneda proveedor ${index}`).toUpperCase();
  const url = text(row, `URL proveedor ${index}`);
  const notes = text(row, `Notas proveedor ${index}`);
  const trm = text(row, `TRM proveedor ${index}`);

  if (!name && !unitPrice && !url && !notes) {
    return null;
  }

  return {
    id: `source-${index}`,
    name: name || null,
    unit_price: valueOrNull(unitPrice),
    currency: currency === "USD" ? "USD" : "COP",
    url: url || undefined,
    notes: notes || undefined,
    trm: valueOrNull(trm),
  };
}

export function rowsToPayload(rows: Array<Record<string, unknown>>): ClientImportPayload {
  const items = rows
    .map((row) => {
      const name = firstText(row, ["Nombre", "Nombre o descripción", "Nombre o descripcion", "Descripción", "Descripcion"]);
      if (!name) return null;
      const priceSources = [sourceFromRow(row, 1), sourceFromRow(row, 2), sourceFromRow(row, 3)].filter((source): source is NonNullable<typeof source> => source !== null);
      const associatedFlag = firstText(row, ["Tiene costo asociado", "Servicio asociado", "Costo asociado"]);
      const associatedName = firstText(row, ["Servicio o costo asociado", "Nombre costo asociado"]);
      const associatedAmount = firstText(row, ["Valor costo asociado", "Monto costo asociado"]);
      const associatedCategory = normalizeHeader(firstText(row, ["Tipo costo asociado", "Categoría costo asociado"]));
      const associatedMode = normalizeHeader(firstText(row, ["Aplicación costo asociado", "Forma costo asociado"]));
      const hasAssociatedCost = /^(si|s|yes|true|1|x)$/.test(normalizeHeader(associatedFlag)) || Boolean(associatedName || associatedAmount);
      const additionalCosts = hasAssociatedCost ? [{
        name: associatedName || "Costo asociado pendiente",
        category: associatedCategory === "logistica" || associatedCategory === "logistics" ? "logistics" : associatedCategory === "otro" || associatedCategory === "other" ? "other" : "service",
        mode: associatedMode === "por unidad" || associatedMode === "per unit" || associatedMode === "per_unit" ? "per_unit" : "fixed",
        amount: valueOrNull(associatedAmount),
      }] : [];
      return {
        item: firstText(row, ["Item", "No. item", "No item", "Número item", "Numero item", "Consecutivo interno"]) || undefined,
        name,
        description: firstText(row, ["Descripción", "Descripcion", "Detalles o ficha técnica", "Detalles o ficha tecnica", "Ficha técnica", "Ficha tecnica"]) || undefined,
        unit: firstText(row, ["Und de medida", "Unidad de medida", "Unidad", "Und"]) || undefined,
        quantity: valueOrNull(firstText(row, ["Cant", "Cantidad"])),
        ceiling_unit_price: valueOrNull(firstText(row, ["Precio techo unitario", "Precio techo encontrado", "Precio referencia unitario", "Precio referencia techo unit"])),
        notes: firstText(row, ["Notas del ítem", "Notas del item", "Observaciones", "Observación", "Observacion"]) || undefined,
        price_sources: priceSources,
        has_associated_cost: hasAssociatedCost,
        additional_costs: additionalCosts,
      };
    })
    .filter((item) => item !== null);

  return { version: 2, items };
}

function headerScore(row: unknown[]): number {
  const normalizedCells = row.map((value) => normalizeHeader(String(value ?? "")));
  return knownExcelHeaders.reduce((score, header) => (normalizedCells.includes(normalizeHeader(header)) ? score + 1 : score), 0);
}

function recordsFromMatrix(matrix: unknown[][]): Array<Record<string, unknown>> {
  const headerIndex = matrix.reduce(
    (best, row, index) => {
      const score = headerScore(row);
      return score > best.score ? { index, score } : best;
    },
    { index: -1, score: 0 },
  );

  const hasHeader = headerIndex.index >= 0 && headerIndex.score >= 2;
  const normalizedMatrix = hasHeader ? matrix : matrix.map(mergeCurrencyCells);
  const headers = hasHeader
    ? normalizedMatrix[headerIndex.index].map((value) => String(value ?? "").trim())
    : looksLikeItemPriceMatrix(matrix)
      ? ["Item", "Precio techo unitario"]
      : orderedPasteHeaders;
  const dataRows = hasHeader ? normalizedMatrix.slice(headerIndex.index + 1) : normalizedMatrix;

  return dataRows
    .map((row) =>
      headers.reduce<Record<string, unknown>>((record, header, index) => {
        if (header) record[header] = row[index] ?? "";
        return record;
      }, {}),
    )
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}

export function sheetToRecords(sheet: XLSX.WorkSheet): Array<Record<string, unknown>> {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  const records = recordsFromMatrix(matrix);
  if (!records.length) {
    throw new Error("No encontré filas legibles en la hoja.");
  }
  return records;
}

export function previewSpreadsheetBuffer(buffer: ArrayBuffer | Uint8Array): SpreadsheetImportPreview {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames.includes("Carga de items") ? "Carga de items" : workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error("El archivo no tiene hojas legibles.");
  }
  const records = sheetToRecords(sheet);
  const payload = rowsToPayload(records);
  const generalSheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === "costos generales");
  if (generalSheetName) {
    const generalRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[generalSheetName]!, { defval: "" });
    payload.general_costs = generalRows.flatMap((row) => {
      const name = firstText(row, ["Nombre", "Costo general"]);
      const amountText = firstText(row, ["Valor", "Monto"]);
      const categoryText = normalizeHeader(firstText(row, ["Categoría", "Categoria", "Tipo"]));
      const notes = firstText(row, ["Nota", "Notas"]);
      if (!name && !amountText && !categoryText && !notes) return [];
      const amount = parseFlexibleNumber(amountText);
      if (!name || amount === null || amount < 0) {
        throw new Error(`El costo general ${name || "sin nombre"} necesita nombre y valor numérico no negativo.`);
      }
      if (categoryText && !["servicio", "service", "logistica", "logistics", "other", "otro"].includes(categoryText)) {
        throw new Error(`La categoría del costo general ${name} no es reconocida.`);
      }
      const category = categoryText === "servicio" || categoryText === "service" ? "service" : categoryText === "logistica" || categoryText === "logistics" ? "logistics" : "other";
      return [{ name, category, amount, notes }];
    });
  }
  if (!payload.items.length) {
    throw new Error("No encontré filas con una columna de nombre o descripción.");
  }
  const warnings: string[] = [];
  if (payload.items.length !== records.length) {
    warnings.push(`${records.length - payload.items.length} fila(s) no se importaran porque no tienen nombre o descripcion.`);
  }
  const missingQuantity = payload.items.filter((item) => !(item as { quantity?: unknown }).quantity).length;
  const missingCost = payload.items.filter((item) => {
    const sources = (item as { price_sources?: Array<{ unit_price?: unknown }> }).price_sources ?? [];
    return !sources.some((source) => parseFlexibleNumber(source.unit_price) !== null);
  }).length;
  if (missingQuantity) warnings.push(`${missingQuantity} item(s) no tienen cantidad reconocible.`);
  if (missingCost) warnings.push(`${missingCost} item(s) no tienen costo de proveedor reconocible.`);
  return { payload, sheetName: sheetName ?? "", sourceRowCount: records.length, warnings };
}

export async function inspectSpreadsheetFile(file: File): Promise<SpreadsheetImportPreview> {
  return previewSpreadsheetBuffer(await file.arrayBuffer());
}

export async function payloadFromSpreadsheetFile(file: File): Promise<ClientImportPayload> {
  return (await inspectSpreadsheetFile(file)).payload;
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parsePastedMatrix(value: string): unknown[][] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matrix = lines
    .filter((line) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .map((line) => {
      if (line.includes("|")) return splitMarkdownRow(line);
      if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
      return line.split(";").map((cell) => cell.trim());
    });
  if (!matrix.length) {
    throw new Error("Pega una tabla con encabezados o columnas en el orden de la plantilla.");
  }
  return matrix.map(mergeCurrencyCells);
}

export function payloadFromPastedText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Pega un JSON o una tabla para agregar items.");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return { version: 2, items: parsed };
    }
    return parsed;
  }
  const payload = rowsToPayload(recordsFromMatrix(parsePastedMatrix(trimmed)));
  if (!payload.items.length) {
    throw new Error("No encontré items válidos en el texto pegado.");
  }
  return payload;
}

function optionalText(row: Record<string, unknown>, headers: string[]): string | undefined {
  const value = firstText(row, headers);
  return value ? value : undefined;
}

function optionalValue(row: Record<string, unknown>, headers: string[]): string | number | null | undefined {
  const value = firstText(row, headers);
  return value ? value : undefined;
}

function isHeaderLikeRow(row: unknown[]): boolean {
  return headerScore(row) > 0 || row.some((cell) => ["campo", "valor", "precio", "costo", "cantidad", "unidad", "notas"].includes(normalizeHeader(cellText(cell))));
}

function patchValueForField(patch: PastedItemPatch, field: Exclude<PastedUpdateField, "auto">, value: string): void {
  if (field === "referenceUnit") patch.referenceUnit = value;
  if (field === "manualUnitCost") patch.manualUnitCost = value;
  if (field === "quantity") patch.quantity = value;
  if (field === "unit") patch.unit = value;
  if (field === "notes") patch.notes = value;
}

function valueCellForField(cells: string[], field: Exclude<PastedUpdateField, "auto">): { item: string | null; value: string } | null {
  const meaningful = cells.map((cell) => cell.trim()).filter(Boolean);
  if (!meaningful.length) return null;
  if (meaningful.length === 1) return { item: null, value: meaningful[0] };

  if (field === "unit" || field === "notes") {
    return { item: meaningful[0], value: meaningful.slice(1).join(" ") };
  }

  const lastNumericIndex = meaningful.reduce((last, cell, index) => (parseFlexibleNumber(cell) !== null ? index : last), -1);
  if (lastNumericIndex < 0) return null;
  const value = meaningful[lastNumericIndex];
  const first = meaningful[0];
  const firstIsNumeric = parseFlexibleNumber(first) !== null;
  const item = firstIsNumeric && lastNumericIndex > 0 ? first : null;
  return { item, value };
}

function singleFieldPatchesFromMatrix(matrix: unknown[][], field: Exclude<PastedUpdateField, "auto">): PastedItemPatch[] {
  const rows = isHeaderLikeRow(matrix[0] ?? []) ? matrix.slice(1) : matrix;
  const patches = rows
    .map((row, index): PastedItemPatch | null => {
      const result = valueCellForField(mergeCurrencyCells(row).map(cellText), field);
      if (!result) return null;
      const patch: PastedItemPatch = { item: result.item, rowNumber: index + 1 };
      patchValueForField(patch, field, result.value);
      return patch;
    })
    .filter((patch): patch is PastedItemPatch => patch !== null);

  if (!patches.length) {
    throw new Error("No encontre valores para actualizar en el texto pegado.");
  }
  return patches;
}

export function itemPatchesFromPastedText(value: string, targetField: PastedUpdateField = "auto"): PastedItemPatch[] {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Pega una tabla con encabezados para actualizar campos.");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    throw new Error("Para actualizar campos pega una tabla con encabezados, no JSON.");
  }

  const matrix = parsePastedMatrix(trimmed);
  if (targetField !== "auto") {
    return singleFieldPatchesFromMatrix(matrix, targetField);
  }

  const records = recordsFromMatrix(matrix);
  const patches = records
    .map((row, index): PastedItemPatch | null => {
      const item = firstText(row, ["Item", "No. item", "No item", "Número item", "Numero item", "Consecutivo interno"]) || null;
      const patch: PastedItemPatch = {
        item,
        rowNumber: index + 1,
      };
      const description = optionalText(row, ["Nombre", "Nombre o descripción", "Nombre o descripcion", "Descripción", "Descripcion"]);
      const technicalDescription = optionalText(row, ["Ficha técnica", "Ficha tecnica", "Detalles o ficha técnica", "Detalles o ficha tecnica"]);
      const quantity = optionalValue(row, ["Cant", "Cantidad"]);
      const unit = optionalText(row, ["Und de medida", "Unidad de medida", "Unidad", "Und"]);
      const referenceUnit = optionalValue(row, [
        "Precio techo unitario",
        "Precio techo unit.",
        "Precio techo unit",
        "Techo unitario",
        "Techo unit.",
        "Precio referencia unitario",
        "Precio referencia techo unit",
      ]);
      const manualUnitCost = optionalValue(row, [
        "Costo manual unitario",
        "Costo manual unit.",
        "Costo manual unit",
        "Costo manual",
        "Costo unitario manual",
      ]);
      const notes = optionalText(row, ["Notas del ítem", "Notas del item", "Notas", "Observaciones", "Observación", "Observacion"]);

      if (description !== undefined) patch.description = description;
      if (technicalDescription !== undefined) patch.technicalDescription = technicalDescription;
      if (quantity !== undefined) patch.quantity = quantity;
      if (unit !== undefined) patch.unit = unit;
      if (referenceUnit !== undefined) patch.referenceUnit = referenceUnit;
      if (manualUnitCost !== undefined) patch.manualUnitCost = manualUnitCost;
      if (notes !== undefined) patch.notes = notes;

      const hasChanges = Object.keys(patch).some((key) => key !== "item" && key !== "rowNumber");
      return hasChanges ? patch : null;
    })
    .filter((patch): patch is PastedItemPatch => patch !== null);

  if (!patches.length) {
    throw new Error("No encontré columnas actualizables en el texto pegado.");
  }
  return patches;
}
