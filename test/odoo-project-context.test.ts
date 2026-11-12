import { describe, expect, it } from "vitest";
import { mergeCalculationLinkFields, normalizeImportPayload, toCalculation } from "../lib/contract";

const item = { item: "1", name: "Resma", description: "Resma carta", quantity: 1, unit: "UND", ceiling_unit_price: 1000, price_sources: [{ name: "Tienda", unit_price: 800 }] };

describe("Datos del proyecto Odoo en la importación", () => {
  it("guarda nombre, proceso, entidad y enlace cuando Odoo los envía", () => {
    const parsed = normalizeImportPayload({
      version: 2,
      source: {
        system: "odoo_caf", odoo_project_id: "1928", run_id: "r1",
        odoo_project_name: "SASI 03-2026 - INPEC", odoo_process_number: "SASI 03-2026", odoo_entity_name: "INPEC",
        odoo_return_url: "https://erp.example/odoo/project.project/1928?db=CafTest", odoo_db: "CafTest",
      },
      items: [item],
    });
    const calc = toCalculation(parsed, "c1", "2026-09-29T00:00:00.000Z");
    expect(calc.odooProjectName).toBe("SASI 03-2026 - INPEC");
    expect(calc.odooProcessNumber).toBe("SASI 03-2026");
    expect(calc.odooEntityName).toBe("INPEC");
    expect(calc.odooReturnUrl).toBe("https://erp.example/odoo/project.project/1928?db=CafTest");
    expect(calc.odooDb).toBe("CafTest");
  });

  it("al reimportar sin esos datos conserva los que ya tenía el cálculo", () => {
    const parsed = normalizeImportPayload({ version: 2, source: { system: "odoo_caf", odoo_project_id: "1928", run_id: "r1" }, items: [item] });
    const merged = mergeCalculationLinkFields(parsed.calculation, {
      odooProjectId: "1928", iaRunId: "r1", sourceAnalysisId: null,
      odooCallbackUrl: "https://erp.example/cb", odooReturnUrl: "https://erp.example/ret", odooDb: "CafTest",
      odooProjectName: "Proyecto real", odooProcessNumber: "P-1", odooEntityName: "Entidad", odooUserId: "7", odooUserName: "Ana",
    });
    expect(merged).toMatchObject({ odooProjectName: "Proyecto real", odooProcessNumber: "P-1", odooEntityName: "Entidad", odooUserName: "Ana", odooCallbackUrl: "https://erp.example/cb" });
  });

  it("completa lo que falta sin pisar lo que abrió Odoo", () => {
    const parsed = normalizeImportPayload({ version: 2, source: { system: "odoo_caf", odoo_project_id: "1928", run_id: "r1", odoo_project_name: "Nombre nuevo", odoo_entity_name: "INPEC" }, items: [item] });
    const merged = mergeCalculationLinkFields(parsed.calculation, { odooProjectId: "1928", iaRunId: "r1", sourceAnalysisId: null, odooProjectName: "Nombre abierto", odooEntityName: null });
    expect(merged.odooProjectName).toBe("Nombre abierto");
    expect(merged.odooEntityName).toBe("INPEC");
  });
});
