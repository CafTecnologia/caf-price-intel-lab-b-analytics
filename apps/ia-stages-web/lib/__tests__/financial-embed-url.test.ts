import { describe, expect, it } from "vitest";
import { buildFinancialEmbedSrc } from "@/lib/financial-embed-url";

describe("financial embed URL", () => {
  it("preserva prefijo /finanzas en produccion", () => {
    expect(buildFinancialEmbedSrc("http://odooerp.caftecnologia.com/finanzas", "abc-123")).toBe(
      "http://odooerp.caftecnologia.com/finanzas/calculations/abc-123"
    );
  });

  it("mantiene ruta raiz del simulador cuando no hay calculo", () => {
    expect(buildFinancialEmbedSrc("http://odooerp.caftecnologia.com/finanzas/", null)).toBe(
      "http://odooerp.caftecnologia.com/finanzas"
    );
  });

  it("mantiene modo dev sin prefijo", () => {
    expect(buildFinancialEmbedSrc("http://127.0.0.1:18030", "calc 1")).toBe(
      "http://127.0.0.1:18030/calculations/calc%201"
    );
  });
});
