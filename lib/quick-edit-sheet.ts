/** Spreadsheet operations use displayed coordinates; readonly columns still consume TSV cells. */
export const ORIGINAL_GRID_FIELDS = ["item", "description", "quantity", "unit", "referenceUnit", "manualUnitCost", "selectedCostMode", "notes"] as const;
export type OriginalGridField = typeof ORIGINAL_GRID_FIELDS[number];
export type SheetPatch = { index: number; field: OriginalGridField; value: string };
export type SheetRow = { index: number } & Partial<Record<OriginalGridField, string>>;
export type SheetRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };
export function isOriginalGridField(field: string): field is OriginalGridField {
  return (ORIGINAL_GRID_FIELDS as readonly string[]).includes(field);
}

/** Excel/Sheets TSV: quoted tabs, newlines, escaped quotes and empty cells are significant. */
export function parseSheetTsv(text: string): string[][] {
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === "") quoted = !quoted;
      else cell += ch;
    } else if (!quoted && (ch === "\t" || ch === "\n")) {
      row.push(cell); cell = "";
      if (ch === "\n") { rows.push(row); row = []; }
    } else cell += ch;
  }
  // A final record separator isn't an extra row; a final tab is an empty cell.
  if (!input.endsWith("\n") || quoted || row.length || cell) { row.push(cell); rows.push(row); }
  return rows;
}
export function serializeSheetTsv(matrix: string[][]): string {
  return matrix.map(row => row.map(cell => /["\t\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell).join("\t")).join("\n");
}
export function pasteSheetRange(rows: readonly SheetRow[], columns: readonly string[], range: SheetRange, matrix: string[][]): SheetPatch[] {
  const patches: SheetPatch[] = [];
  if (!matrix.length) return patches;
  const width = Math.max(...matrix.map(row => row.length));
  // A scalar fills the selection. A rectangular block repeats when it tiles the selection exactly.
  const height = range.endRow - range.startRow + 1;
  const selectedWidth = range.endColumn - range.startColumn + 1;
  const tile = height >= matrix.length && selectedWidth >= width && height % matrix.length === 0 && selectedWidth % width === 0;
  const targetHeight = tile ? height : matrix.length, targetWidth = tile ? selectedWidth : width;
  for (let r = 0; r < targetHeight; r++) {
    const row = rows[range.startRow + r];
    if (!row) continue;
    for (let c = 0; c < targetWidth; c++) {
      const field = columns[range.startColumn + c], value = matrix[r % matrix.length]?.[c % width];
      if (field && isOriginalGridField(field) && value !== undefined) patches.push({ index: row.index, field, value });
    }
  }
  return patches;
}
export function clearSheetRange(rows: readonly SheetRow[], columns: readonly string[], range: SheetRange): SheetPatch[] {
  return pasteSheetRange(rows, columns, range, [[""]]);
}

export type SheetAddress = { row: number; column: number };
export function moveSheetFocus(from: SheetAddress, key: string, shift: boolean, command: boolean, rowCount: number, columnCount: number): SheetAddress {
  let { row, column } = from;
  if (key === "arrowup") row--;
  if (key === "arrowdown") row++;
  if (key === "arrowleft") column--;
  if (key === "arrowright") column++;
  if (key === "enter") row += shift ? -1 : 1;
  if (key === "tab") { column += shift ? -1 : 1; if (column >= columnCount) { column = 0; row++; } else if (column < 0) { column = columnCount - 1; row--; } }
  if (key === "home") { column = 0; if (command) row = 0; }
  if (key === "end") { column = columnCount - 1; if (command) row = rowCount - 1; }
  if (command && key === "arrowup") row = 0;
  if (command && key === "arrowdown") row = rowCount - 1;
  if (command && key === "arrowleft") column = 0;
  if (command && key === "arrowright") column = columnCount - 1;
  return { row: Math.max(0, Math.min(rowCount - 1, row)), column: Math.max(0, Math.min(columnCount - 1, column)) };
}
