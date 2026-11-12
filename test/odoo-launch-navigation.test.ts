import { describe, expect, it } from "vitest";
import { existingLaunchPath, hasImportedItems } from "../lib/odoo-launch-navigation";

const imported = {
  id: "calc-27",
  name: "Estudio IA",
  odooProjectId: "1930",
  items: [{ description: "Kit", notes: "Cotizado" }],
};

const placeholder = {
  id: "empty-158",
  name: "Borrador manual",
  odooProjectId: "1930",
  items: [{ description: "Item pendiente", notes: "Cálculo creado para carga manual posterior." }],
};

describe("apertura desde Odoo", () => {
  it("abre el mismo cálculo con datos sin crear una ruta de importación", () => {
    expect(existingLaunchPath({ calculationId: imported.id, odooProjectId: "1930" }, imported))
      .toBe("/calculations/calc-27");
    expect(hasImportedItems(imported)).toBe(true);
  });

  it("mantiene un borrador realmente vacío en la carga, con su mismo ID", () => {
    const path = existingLaunchPath({ calculationId: placeholder.id, odooProjectId: "1930" }, placeholder);
    expect(path).toContain("preparedCalculationId=empty-158");
    expect(hasImportedItems(placeholder)).toBe(false);
  });

  it("rechaza referencias ausentes y otros proyectos antes de alterar el vínculo", () => {
    expect(() => existingLaunchPath({ calculationId: "missing" }, null)).toThrow(/verificar/);
    expect(() => existingLaunchPath({ calculationId: imported.id, odooProjectId: "999" }, imported))
      .toThrow(/otro proyecto/);
  });
});
