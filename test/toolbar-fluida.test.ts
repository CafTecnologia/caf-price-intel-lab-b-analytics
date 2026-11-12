import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tsx = readFileSync("components/project-workspace.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const bloque = css.slice(css.indexOf("/* === Bloque 2 barra fluida (27/10) === */"));

describe("barra de herramientas fluida en PC", () => {
  it("la cinta no se monta ni desmonta al cruzar el umbral y la altura no pasa por estado de React", () => {
    expect(tsx).toContain("is-ribbon-hidden");
    expect(tsx).not.toContain("setTableCockpitHeight");
    expect(tsx).toContain('style.setProperty("--table-cockpit-height"');
  });
  it("la clase del body no se retira en cada cambio de desplazamiento", () => {
    expect(tsx).not.toMatch(/return \(\) => \{\s*document\.body\.classList\.remove\("table-focus-mode"\);\s*\};\s*\}, \[compactHeaderActive/);
  });
  it("los chips quedan fijos bajo la barra solo en PC y se respeta reduced-motion", () => {
    expect(bloque).toMatch(/@media \(min-width: 641px\)[\s\S]*\.decision-filters \{\s*position: sticky;/);
    expect(bloque).toContain("@media (prefers-reduced-motion: reduce)");
    expect(bloque).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.summary-section\.is-ribbon-hidden \{ display: none !important;/);
  });
});
