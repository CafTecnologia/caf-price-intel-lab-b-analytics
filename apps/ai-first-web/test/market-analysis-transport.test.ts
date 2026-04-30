import { describe, expect, it } from "vitest";

import {
  MARKET_ANALYSIS_COLUMNS,
  MarketAnalysisTransportResultSchema,
  normalizeMarketAnalysisTransportResult,
} from "../lib/market-analysis-schema";
import { buildMarketAnalysisPrompt } from "../lib/market-analysis-prompt";
import { isMarketSourcePrice, parseMarketSourceUnitPrice } from "../lib/market-source-pricing";

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
          reference_unit: "12000",
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
    expect(row?.[MARKET_ANALYSIS_COLUMNS[10]]).toBe("");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[12]]).toBe("12000");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[14]]).toBe("Sin alertas.");
  });

  it("keeps source-level country tags and lets the app price USD international sources", () => {
    const transport = MarketAnalysisTransportResultSchema.parse({
      rows: [
        {
          item: "1",
          description: "Toner HP CF237A",
          technical_description: "Toner laser HP CF237A original o equivalente certificado.",
          quantity: "2 UN",
          fit_analysis: "Ficha cerrada a referencia compatible.",
          source_1: "[COLOMBIA] Mercado Libre | COP 997.300 | mercadolibre.com.co",
          source_2: "[INTERNACIONAL] Amazon | USD 180.50 | USA | amazon.com",
          source_3: "Documento Base | COP 1.085.812",
          reference_unit: "1085812",
          notes: "Precio de referencia tomado del promedio unitario del documento.",
        },
      ],
      warnings: [],
      provider_notes: [],
    });

    const result = normalizeMarketAnalysisTransportResult(transport);
    const row = result.rows[0];
    const trm = 4000;

    expect(row?.[MARKET_ANALYSIS_COLUMNS[5]]).toContain("[COLOMBIA]");
    expect(row?.[MARKET_ANALYSIS_COLUMNS[6]]).toContain("[INTERNACIONAL]");
    expect(isMarketSourcePrice(row?.[MARKET_ANALYSIS_COLUMNS[5]] ?? "")).toBe(true);
    expect(isMarketSourcePrice(row?.[MARKET_ANALYSIS_COLUMNS[6]] ?? "")).toBe(true);
    expect(isMarketSourcePrice(row?.[MARKET_ANALYSIS_COLUMNS[7]] ?? "")).toBe(false);
    expect(parseMarketSourceUnitPrice(row?.[MARKET_ANALYSIS_COLUMNS[5]] ?? "", trm)?.priceCop).toBe(997300);
    expect(parseMarketSourceUnitPrice(row?.[MARKET_ANALYSIS_COLUMNS[6]] ?? "", trm)?.priceCop).toBe(938600);
  });

  it("parses line-broken prices as one unit value instead of truncating them", () => {
    const trm = 4000;

    expect(parseMarketSourceUnitPrice("Proveedor | COP 1080\n0000 | url", trm)?.priceCop).toBe(10800000);
    expect(parseMarketSourceUnitPrice("Proveedor | COP 4\n50000 | url", trm)?.priceCop).toBe(450000);
    expect(parseMarketSourceUnitPrice("Proveedor | 5355\n00 COP | url", trm)?.priceCop).toBe(535500);
    expect(parseMarketSourceUnitPrice("[INTERNACIONAL] Store | USD 2\n498 | USA | url", trm)?.priceCop).toBe(
      Math.round(2498 * trm * 1.3),
    );
  });

  it("builds a concise prompt that separates document reference from market sources", () => {
    const prompt = buildMarketAnalysisPrompt({
      fileName: "demo.xlsx",
      fileType: "xlsx",
      sourceSummary: "Segmentos extraidos localmente: 1",
      documentText: "Item 1: Toner. Cantidad 2. Promedio unitario COP 1.085.812.",
    });

    expect(prompt).toContain("source_1");
    expect(prompt).toContain("source_2");
    expect(prompt).toContain("source_3");
    expect(prompt).toContain("reference_unit debe venir del documento base");
    expect(prompt).toContain("La app calculara costos");
    expect(prompt).not.toContain("Pueden venir del documento o de busqueda web");
  });
});
