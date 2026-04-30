import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_MASTER_PROMPT, MARKET_ANALYSIS_PROMPT_VERSION } from "../lib/market-analysis-prompt";

describe("market analysis prompt contract", () => {
  it("requires traceable and distinct market sources without weakening the IA-first prompt", () => {
    expect(MARKET_ANALYSIS_PROMPT_VERSION).toContain("traceable-sources");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("Primero entiende que esta pidiendo realmente la entidad");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("Las 3 fuentes deben ser fuentes distintas");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("URL http(s) o dominio verificable");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("FUENTE_SIN_TRAZABILIDAD");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("No repitas el mismo proveedor");
  });
});
