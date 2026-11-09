import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";

async function parse(workbook: XLSX.WorkBook, bookType: XLSX.BookType = "xlsx") {
  const postMessage = vi.fn();
  const worker = { postMessage, onmessage: null as unknown as (event: { data: ArrayBuffer }) => void };
  vi.stubGlobal("self", worker);
  await import("../lib/study-spreadsheet.worker");
  const bytes = XLSX.write(workbook, { type: "array", bookType });
  worker.onmessage({ data: bytes });
  vi.unstubAllGlobals();
  vi.resetModules();
  return postMessage.mock.calls[0][0];
}
describe("Spreadsheet preview worker", () => {
  it.each(["xlsx", "biff8"] as XLSX.BookType[])("preserves sheets and all rows for %s", async (bookType) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 126 }, (_, i) => [i, `Material ${i}`])), "Cotización");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Condición", "15 días"]]), "Condiciones");
    const result = await parse(book, bookType);
    expect(result.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["Cotización", "Condiciones"]);
    expect(result.sheets[0].rows).toHaveLength(126);
    expect(result.sheets[0].rows[125][1]).toBe("Material 125");
  });
  it("shows an uncached formula as text without evaluating it", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { A1: { t: "n", f: "SUM(1,2)" }, "!ref": "A1" }, "Fórmula");
    const result = await parse(book);
    expect(result.sheets[0].rows[0][0]).toBe("=SUM(1,2)");
  });
  it("rejects an oversized worksheet instead of silently truncating", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { A1: { t: "s", v: "Límite" }, "!ref": "A1:GR20001" }, "Grande");
    const result = await parse(book);
    expect(result.error).toContain("No se mostrará recortada");
  });
});
