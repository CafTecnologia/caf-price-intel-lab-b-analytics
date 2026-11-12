import { describe, expect, it } from "vitest";
import { clearSheetRange, isOriginalGridField, moveSheetFocus, parseSheetTsv, pasteSheetRange, serializeSheetTsv } from "../lib/quick-edit-sheet";

const rows = [{ index: 42, description: "Original", quantity: "2", unit: "UN" }, { index: 7, description: "Otro", quantity: "3", unit: "M" }];
const columns = ["description", "quantity", "unit", "referenceUnit", "referenceTotal", "manualUnitCost", "offerUnit", "utility", "notes"];
const cell = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };

describe("bloques de la hoja de costos", () => {
  it("lee TSV de Excel con comillas, tabs, saltos, vacíos y CRLF sin mover columnas", () => {
    expect(parseSheetTsv('"Texto\tcon tab"\t"dos\r\nlíneas y ""comillas"""\t\r\n$\t100\t\r\n')).toEqual([
      ["Texto\tcon tab", 'dos\nlíneas y "comillas"', ""], ["$", "100", ""],
    ]);
    expect(parseSheetTsv("\t\n\n")).toEqual([["", ""], [""]]);
    expect(parseSheetTsv("")).toEqual([]);
  });
  it("copia y pega textos multilínea sin perder contenido", () => {
    const block = [['Nombre\tmodelo', 'Línea 1\nLínea 2', '"marca"', ""], ["", "2", "UN", ""]];
    expect(parseSheetTsv(serializeSheetTsv(block))).toEqual(block);
  });
  it("pega varias filas en su identidad real, aunque estén filtradas u ordenadas", () => {
    expect(pasteSheetRange(rows, columns, cell, parseSheetTsv("Motor\t4\tUN\nCable\t8\tM"))).toEqual([
      { index: 42, field: "description", value: "Motor" }, { index: 42, field: "quantity", value: "4" }, { index: 42, field: "unit", value: "UN" },
      { index: 7, field: "description", value: "Cable" }, { index: 7, field: "quantity", value: "8" }, { index: 7, field: "unit", value: "M" },
    ]);
  });
  it("consume las columnas calculadas sin escribirlas ni desplazar los siguientes datos", () => {
    expect(pasteSheetRange(rows, columns, { ...cell, startColumn: 3, endColumn: 3 }, [["500", "999", "300", "800", "100", "Nota"]])).toEqual([
      { index: 42, field: "referenceUnit", value: "500" }, { index: 42, field: "manualUnitCost", value: "300" }, { index: 42, field: "notes", value: "Nota" },
    ]);
    for (const field of ["referenceTotal", "costUnit", "costTotal", "offerUnit", "offerTotal", "utility", "margin", "status", "selectedPriceSourceId"]) expect(isOriginalGridField(field)).toBe(false);
  });
  it("no interpreta una descripción como cabecera ni fusiona celdas monetarias", () => {
    expect(pasteSheetRange(rows, columns, cell, [["Cantidad", "$", "100"]])).toEqual([
      { index: 42, field: "description", value: "Cantidad" }, { index: 42, field: "quantity", value: "$" }, { index: 42, field: "unit", value: "100" },
    ]);
  });
  it("borra un rango de filas y columnas, conservando calculados y lo que queda fuera", () => {
    const patches = clearSheetRange(rows, columns, { startRow: 0, endRow: 1, startColumn: 3, endColumn: 7 });
    expect(patches).toEqual([
      { index: 42, field: "referenceUnit", value: "" }, { index: 42, field: "manualUnitCost", value: "" },
      { index: 7, field: "referenceUnit", value: "" }, { index: 7, field: "manualUnitCost", value: "" },
    ]);
    expect(clearSheetRange(rows, columns, { ...cell, startColumn: 6, endColumn: 7 })).toEqual([]);
  });
  it("rellena el rango con un valor o un bloque que cabe exactamente", () => {
    expect(pasteSheetRange(rows, columns, { ...cell, endRow: 1, endColumn: 1 }, [["X"]])).toHaveLength(4);
    expect(pasteSheetRange(rows, columns, { ...cell, endRow: 1, endColumn: 1 }, [["A", "B"]]).map(p => p.value)).toEqual(["A", "B", "A", "B"]);
  });
  it("recorta al final de la tabla y conserva una celda vacía explícita", () => {
    expect(pasteSheetRange(rows, columns, { startRow: 1, endRow: 1, startColumn: 8, endColumn: 8 }, [["", "extra"], ["otro"]])).toEqual([{ index: 7, field: "notes", value: "" }]);
  });
});

describe("navegación de la hoja", () => {
  it("Enter baja y Shift+Enter sube sin salir de las filas", () => {
    expect(moveSheetFocus({ row: 1, column: 2 }, "enter", false, false, 4, 5)).toEqual({ row: 2, column: 2 });
    expect(moveSheetFocus({ row: 1, column: 2 }, "enter", true, false, 4, 5)).toEqual({ row: 0, column: 2 });
    expect(moveSheetFocus({ row: 0, column: 2 }, "arrowup", false, false, 4, 5)).toEqual({ row: 0, column: 2 });
  });
  it("Tab y Shift+Tab continúan en la fila vecina", () => {
    expect(moveSheetFocus({ row: 0, column: 4 }, "tab", false, false, 4, 5)).toEqual({ row: 1, column: 0 });
    expect(moveSheetFocus({ row: 2, column: 0 }, "tab", true, false, 4, 5)).toEqual({ row: 1, column: 4 });
  });
  it("Ctrl+flecha y Ctrl+Inicio/Fin llegan a los extremos", () => {
    expect(moveSheetFocus({ row: 1, column: 2 }, "arrowdown", false, true, 4, 5)).toEqual({ row: 3, column: 2 });
    expect(moveSheetFocus({ row: 1, column: 2 }, "home", false, true, 4, 5)).toEqual({ row: 0, column: 0 });
    expect(moveSheetFocus({ row: 1, column: 2 }, "end", false, true, 4, 5)).toEqual({ row: 3, column: 4 });
  });
});
