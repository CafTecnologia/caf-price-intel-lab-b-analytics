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
  const repairSplitWords = (value: string) => {
    const domainWords = [
      "mantenimiento",
      "preventivo",
      "correctivo",
      "servidores",
      "almacenamiento",
      "estaciones",
      "trabajo",
      "unidades",
      "pantallas",
      "interactivas",
      "proyectores",
      "impresoras",
      "scanner",
      "switch",
      "colombia",
      "alambre",
      "rigido",
      "plafon",
      "cinta",
      "ferreteria",
      "suministros",
    ];

    return domainWords.reduce(
      (text, word) =>
        text.replace(new RegExp(`\\b${word[0]}\\s+${word.slice(1)}\\b`, "gi"), (match) =>
          /^[A-ZÁÉÍÓÚÑ]/.test(match) ? `${word[0].toUpperCase()}${word.slice(1)}` : word,
        ),
      value,
    );
  };
  const cleanCellText = (value: unknown) => {
    if (value === null || value === undefined) {
      return "";
    }

    const normalized = String(value)
          .replace(/(\d)[\s\u00a0]+([.,])[\s\u00a0]*(?=\d)/g, "$1$2")
          .replace(/(\d[.,])[\s\u00a0]+(?=\d)/g, "$1")
          .replace(/(\d)[\s\u00a0]+(?=\d)/g, "$1")
          .replace(/\[\s*(COLOMBIA|INTERNACIONAL|USA|EEUU)\s*\]/gi, (_match, tag: string) => `[${tag.toUpperCase()}]`)
          .replace(/\[\s*COL\s+OMBIA\s*\]/gi, "[COLOMBIA]")
          .replace(/\[\s*COLOMB\s*IA\s*\]/gi, "[COLOMBIA]")
          .replace(/https?\s*:\s*\/\s*\//gi, (match) => match.toLowerCase().startsWith("https") ? "https://" : "http://")
          .replace(/(https?:\/\/www)\s+\./gi, "$1.")
          .replace(/(https?:\/\/[^\s|,;]+)\s+([a-z0-9-]+\.)/gi, "$1$2")
          .replace(/(https?:\/\/[^\s|,;]+)\s+([a-z0-9-]+\.)/gi, "$1$2")
          .replace(/([a-z0-9])\s+\.\s+(?=[a-z]{2,}\b)/gi, "$1.")
          .replace(/([a-z0-9])\.\s+(?=[a-z]{2,}\b)/gi, "$1.")
          .replace(/(https?:\/\/)\s+/gi, "$1")
          .replace(/\bN\s+°/gi, "N°")
          .replace(/_\s+/g, "_")
          .replace(/[ \t]*\r?\n[ \t]*/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();

    return repairSplitWords(normalized);
  };

  return Object.fromEntries(
    MARKET_ANALYSIS_COLUMNS.map((column) => {
      const value = input[column];
      return [column, cleanCellText(value)];
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
