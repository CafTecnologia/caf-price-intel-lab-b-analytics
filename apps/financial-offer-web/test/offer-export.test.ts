import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { importProject, saveProject } from "../lib/store";
import { GET } from "../app/api/projects/[projectId]/export/route";

it("genera un Excel descargable con 14 columnas, filtro completo y solo lotes activos", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-export-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
  try {
    const p = await importProject({ version: 2, items: ["I", "II"].map(id => ({ item: "1", name: `Producto ${id}`, quantity: 2, unit: "UND", ceiling_unit_price: 50000, procurement_lot: { id, label: `Lote ${id}`, document: `${id}.xlsx`, locator: "Oferta" }, price_sources: [{ name: "Proveedor", unit_price: 20000, currency: "COP" }] })) });
    await saveProject(p.id, { settings: { excludedProcurementLotIds: ["II"] } });
    const response = await GET(new Request(`http://localhost/api/projects/${p.id}/export?format=offer-xlsx`), { params: Promise.resolve({ projectId: p.id }) });
    expect(response.status).toBe(200); expect(response.headers.get("content-disposition")).toContain("attachment;");
    const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: "array" });
    const sheet = workbook.Sheets["Oferta económica"]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows).toHaveLength(1); expect(rows[0]!["ID lote"]).toBe("I");
    expect(Object.keys(rows[0]!)).toHaveLength(14); expect(sheet["!autofilter"]?.ref).toBe("A1:N2");
  } finally { cwd.mockRestore(); await fs.rm(dir, { recursive: true, force: true }); }
});
