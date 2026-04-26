import { describe, expect, it } from "vitest";

import {
  MARKET_ANALYSIS_COLUMNS,
  MarketAnalysisTransportResultSchema,
  normalizeMarketAnalysisTransportResult,
} from "../lib/market-analysis-schema";

describe("market analysis transport mapping", () => {
  it("maps compact transport keys into the visible matrix columns", () => {
    const transport = MarketAnalysisTransportResultSchema.parse({
      rows: [
        {
          item: "1",
          description: "Tijeras",
          technical_description: "Tijeras de oficina",
          quantity: "2",
          fit_analysis: "Ficha abierta",
          source_1: "Proveedor A - $ 10.000",
          source_2: "Proveedor B - $ 11.000",
          source_3: "N/D",
          cost_optimistic: "10000",
          cost_moderate: "11000",
          weighted_unit: "10500",
          weighted_total: "21000",
          reference_unit: "12000",
          viability: "Viable / 12%",
          notes: "Sin alertas.",
        },
      ],
      warnings: [],
      provider_notes: [],
    });

    const result = normalizeMarketAnalysisTransportResult(transport);
    const row = result.rows[0];

    expect(row?.[MARKET_ANALYSIS_COLUMNS[0]]).toBe("1");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[1]]).toBe("Tijeras");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[2]]).toBe("Tijeras de oficina");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[3]]).toBe("2");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[5]]).toContain("Proveedor A");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[10]]).toBe("10500");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[12]]).toBe("12000");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[14]]).toBe("Sin alertas.");
  });
});
