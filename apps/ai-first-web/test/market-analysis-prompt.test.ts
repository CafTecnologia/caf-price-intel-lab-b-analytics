import { describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_MASTER_PROMPT, MARKET_ANALYSIS_PROMPT_VERSION } from "../lib/market-analysis-prompt";

describe("market analysis prompt contract", () => {
  it("keeps IA-first reasoning while asking for traceable and distinct market sources", () => {
    expect(MARKET_ANALYSIS_PROMPT_VERSION).toContain("direct-file");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("Primero entiende que esta pidiendo realmente la entidad");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("Las 3 fuentes deben ser fuentes distintas");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("trazabilidad minima");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("FUENTE_SIN_URL_EXACTA");
    expect(MARKET_ANALYSIS_MASTER_PROMPT).toContain("No repitas el mismo proveedor");
  });
});
