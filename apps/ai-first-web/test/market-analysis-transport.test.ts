import { describe, expect, it } from "vitest";

import {
  MARKET_ANALYSIS_COLUMNS,
  MarketAnalysisTransportResultSchema,
  normalizeMarketAnalysisTransportResult,
} from "../lib/market-analysis-schema";
import { buildMarketAnalysisPrompt } from "../lib/market-analysis-prompt";
import { buildGeminiModelFallbackOrder } from "../lib/market-analysis-provider";
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
    expect(parseMarketSourceUnitPrice("Proveedor | COP 2. 150 | url", trm)?.priceCop).toBe(2150);
    expect(parseMarketSourceUnitPrice("Proveedor | COP 29 .450 | url", trm)?.priceCop).toBe(29450);
    expect(parseMarketSourceUnitPrice("[INTERNACIONAL] Store | USD 2\n498 | USA | url", trm)?.priceCop).toBe(
      Math.round(2498 * trm * 1.3),
    );
  });

  it("normalizes line breaks in provider output before UI and export", () => {
    const transport = MarketAnalysisTransportResultSchema.parse({
      rows: [
        {
          item: "1",
          description: "M antenimiento preventivo",
          technical_description: "Mantenimiento preventivo\nservidores",
          quantity: "6 UND",
          fit_analysis: "Ficha abierta",
          source_1: "[COLOMBIA] ORT Computadores | COP 9\n00000 | https://ortcomputadores.com.co",
          source_2: "[COLOMBIA] SALES CLOUD S.A.S | COP 450000 | https://\nsalescloud.com.co",
          source_3: "N/D",
          reference_unit: "690000",
          notes: "DOCUMENTO_BASE_\nCON_PRECIO_TECHO",
        },
      ],
      warnings: [],
      provider_notes: [],
    });

    const row = normalizeMarketAnalysisTransportResult(transport).rows[0];

    expect(row?.["Nombre o descripción"]).toBe("Mantenimiento preventivo");
    expect(row?.["Descripción o ficha técnica"]).toBe("Mantenimiento preventivo servidores");
    expect(row?.["Fuente 1 (Precio)"]).toContain("COP 900000");
    expect(row?.["Fuente 2 (Precio)"]).toContain("https://salescloud.com.co");
    expect(row?.["Resumen de Fuentes y Observaciones"]).toContain("DOCUMENTO_BASE_CON_PRECIO_TECHO");
  });

  it("repairs transport spaces in urls, country tags, and thousands punctuation", () => {
    const transport = MarketAnalysisTransportResultSchema.parse({
      rows: [
        {
          item: "1",
          description: "Cable",
          technical_description: "Cable eléctrico",
          quantity: "1 UN",
          fit_analysis: "Ficha abierta",
          source_1: "[COL OMBIA] Tienda | COP 2. 150 | https ://www .homecenter.com. co",
          source_2: "[COLOMB IA] Tienda B | COP 29 .450 | https://el clavo.com. co",
          source_3: "[INTERNACIONAL] Amazon | USD 48.00 | USA | https ://amazon.com",
          reference_unit: "4 .200",
          notes: "OK",
        },
      ],
      warnings: [],
      provider_notes: [],
    });

    const row = normalizeMarketAnalysisTransportResult(transport).rows[0];

    expect(row?.["Fuente 1 (Precio)"]).toContain("[COLOMBIA]");
    expect(row?.["Fuente 1 (Precio)"]).toContain("COP 2.150");
    expect(row?.["Fuente 1 (Precio)"]).toContain("https://www.homecenter.com.co");
    expect(row?.["Fuente 2 (Precio)"]).toContain("COP 29.450");
    expect(row?.["Fuente 2 (Precio)"]).toContain("https://elclavo.com.co");
    expect(row?.["PRECIO REFERENCIA (TECHO) UNIT"]).toBe("4.200");
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

  it("keeps the preferred Gemini fallback order before falling back to cheaper flash models", () => {
    expect(buildGeminiModelFallbackOrder("gemini-3.1-pro-preview")).toEqual([
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
    ]);
  });
});
