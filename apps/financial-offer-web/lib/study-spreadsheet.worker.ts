import * as XLSX from "xlsx";

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const workbook = XLSX.read(event.data, { type: "array", cellHTML: false, cellFormula: true, sheetStubs: true, bookVBA: false });
    if (!workbook.SheetNames.length) throw new Error("El Excel no contiene hojas legibles.");
    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
      if (range.e.r > 19999 || range.e.c > 199 || (range.e.r + 1) * (range.e.c + 1) > 200000) throw new Error("Esta hoja supera el tamaño de la vista previa (20.000 filas, 200 columnas o 200.000 celdas). No se mostrará recortada.");
      for (const key of Object.keys(sheet)) {
        const cell = sheet[key];
        if (!key.startsWith("!") && cell && typeof cell === "object" && cell.f && (cell.v === undefined || cell.t === "z")) { cell.t = "s"; cell.v = `=${cell.f}`; delete cell.w; }
      }
      return { name, rows: XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true }) };
    });
    self.postMessage({ sheets });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "No se pudo leer este Excel." }); }
};
