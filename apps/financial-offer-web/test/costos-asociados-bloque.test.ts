import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tsx = readFileSync("components/project-workspace.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("chip Costos asociados: acciones en bloque", () => {
  it("actúa sobre los seleccionados entre los visibles o, si no hay selección, sobre todos los visibles", () => {
    expect(tsx).toMatch(/function associatedBulkIndexes\(\)[\s\S]*?filteredIndexes\.filter\([\s\S]*?selectedRowKeys\.has[\s\S]*?return selected\.length \? selected : filteredIndexes;/);
  });
  it("incluir o excluir todos cambia el estado de cada costo con un solo punto de deshacer", () => {
    const fn = tsx.slice(tsx.indexOf("function setAssociatedCostsStatus"), tsx.indexOf("function selectIndexes"));
    expect(fn.match(/pushUndoSnapshot\(\)/g)).toHaveLength(1);
    expect(fn).toContain("reviewStatus: status");
    expect(fn).toContain('setSaveStatus("idle")');
  });
  it("la barra solo aparece con el chip activo y dice el alcance y cuántos costos están incluidos", () => {
    expect(tsx).toMatch(/rowFilter === "associated" \? \(\(\) => \{[\s\S]*?decision-associated-bulk/);
    expect(tsx).toContain("ítems seleccionados");
    expect(tsx).toContain("ítems visibles");
    expect(tsx).toContain("1 ítem seleccionado");
    expect(tsx).toMatch(/onClick=\{\(\) => setAssociatedCostsStatus\("included"\)\}[^>]*>Incluir todos</);
    expect(tsx).toMatch(/onClick=\{\(\) => setAssociatedCostsStatus\("excluded"\)\}[^>]*>Excluir todos</);
  });
  it("en celular la barra queda oculta y solo se muestra en PC", () => {
    expect(css).toMatch(/^\.decision-associated-bulk \{ display: none; \}/m);
    expect(css).toMatch(/@media \(min-width: 641px\)[\s\S]*body \.decision-associated-bulk \{ display: inline-flex;/);
  });
});
