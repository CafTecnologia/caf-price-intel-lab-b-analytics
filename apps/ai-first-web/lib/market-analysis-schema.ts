import { z } from "zod";

export const MARKET_ANALYSIS_COLUMNS = [
  "Ítem",
  "Nombre o descripción",
  "Descripción o ficha técnica",
  "Cant",
  "Análisis de Ficha",
  "Fuente 1 (Precio)",
  "Fuente 2 (Precio)",
  "Fuente 3 (Precio)",
  "Costo Optimista",
  "Costo Moderado",
  "COSTO PONDERADO UNIT",
  "COSTO PONDERADO TOTAL",
  "PRECIO REFERENCIA (TECHO) UNIT",
  "Viabilidad / Margen",
  "Resumen de Fuentes y Observaciones",
] as const;

export type MarketAnalysisColumn = (typeof MARKET_ANALYSIS_COLUMNS)[number];
export type MarketAnalysisRow = Record<MarketAnalysisColumn, string>;
export const MARKET_ANALYSIS_TRANSPORT_KEYS = [
  "item",
  "description",
  "technical_description",
  "quantity",
  "fit_analysis",
  "source_1",
  "source_2",
  "source_3",
  "reference_unit",
  "notes",
] as const;

export type MarketAnalysisTransportKey = (typeof MARKET_ANALYSIS_TRANSPORT_KEYS)[number];
export type MarketAnalysisTransportRow = Record<MarketAnalysisTransportKey, string>;

export const MarketAnalysisRowSchema = z
  .object(
    Object.fromEntries(MARKET_ANALYSIS_COLUMNS.map((column) => [column, z.string().default("")])) as Record<
      MarketAnalysisColumn,
      z.ZodDefault<z.ZodString>
    >,
  )
  .strict();

export const MarketAnalysisResultSchema = z
  .object({
    rows: z.array(MarketAnalysisRowSchema),
    warnings: z.array(z.string().trim().min(1)).default([]),
    provider_notes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const MarketAnalysisTransportRowSchema = z
  .object(
    Object.fromEntries(MARKET_ANALYSIS_TRANSPORT_KEYS.map((column) => [column, z.string().default("")])) as Record<
      MarketAnalysisTransportKey,
      z.ZodDefault<z.ZodString>
    >,
  )
  .strict();

export const MarketAnalysisTransportResultSchema = z
  .object({
    rows: z.array(MarketAnalysisTransportRowSchema),
    warnings: z.array(z.string().trim().min(1)).default([]),
    provider_notes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type MarketAnalysisResult = z.infer<typeof MarketAnalysisResultSchema>;
export type MarketAnalysisTransportResult = z.infer<typeof MarketAnalysisTransportResultSchema>;

function normalizeObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeObjectKeys(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key.replace(/\s+/g, "").trim(),
      normalizeObjectKeys(entryValue),
    ]),
  );
}

export function normalizeMarketAnalysisTransportPayload(input: unknown): unknown {
  return normalizeObjectKeys(input);
}

export function normalizeMarketAnalysisRow(input: Partial<Record<MarketAnalysisColumn, unknown>>): MarketAnalysisRow {
  return Object.fromEntries(
    MARKET_ANALYSIS_COLUMNS.map((column) => {
      const value = input[column];
      return [column, value === null || value === undefined ? "" : String(value).trim()];
    }),
  ) as MarketAnalysisRow;
}

export function normalizeMarketAnalysisTransportResult(input: MarketAnalysisTransportResult): MarketAnalysisResult {
  return {
    rows: input.rows.map((row) =>
      normalizeMarketAnalysisRow({
        [MARKET_ANALYSIS_COLUMNS[0]]: row.item,
        [MARKET_ANALYSIS_COLUMNS[1]]: row.description,
        [MARKET_ANALYSIS_COLUMNS[2]]: row.technical_description,
        [MARKET_ANALYSIS_COLUMNS[3]]: row.quantity,
        [MARKET_ANALYSIS_COLUMNS[4]]: row.fit_analysis,
        [MARKET_ANALYSIS_COLUMNS[5]]: row.source_1,
        [MARKET_ANALYSIS_COLUMNS[6]]: row.source_2,
        [MARKET_ANALYSIS_COLUMNS[7]]: row.source_3,
        [MARKET_ANALYSIS_COLUMNS[8]]: "",
        [MARKET_ANALYSIS_COLUMNS[9]]: "",
        [MARKET_ANALYSIS_COLUMNS[10]]: "",
        [MARKET_ANALYSIS_COLUMNS[11]]: "",
        [MARKET_ANALYSIS_COLUMNS[12]]: row.reference_unit,
        [MARKET_ANALYSIS_COLUMNS[13]]: "",
        [MARKET_ANALYSIS_COLUMNS[14]]: row.notes,
      }),
    ),
    warnings: input.warnings,
    provider_notes: input.provider_notes,
  };
}
