import "server-only";

import { z } from "zod";

import type { FileType } from "@ai-first-contracts/enums";
import { parseJsonFromText } from "@ai-first-core/providers/shared/json";
import { ProviderHttpError } from "@ai-first-core/providers/shared/http";

import {
  MarketAnalysisTransportResultSchema,
  normalizeMarketAnalysisTransportPayload,
  normalizeMarketAnalysisTransportResult,
  type MarketAnalysisResult,
  type MarketAnalysisTransportResult,
  type MarketAnalysisTransportRow,
} from "./market-analysis-schema";
import { getActiveProviderConnectionForServer } from "./provider-settings";
import { finishMarketAnalysisStage, startMarketAnalysisStage } from "./market-analysis-trace";
import { isMarketSourcePrice } from "./market-source-pricing";

type ProviderConnection = ReturnType<typeof getActiveProviderConnectionForServer>;

type StageContext = {
  runId: string;
  fileName: string;
  fileType: FileType;
  sourceSummary: string;
  documentText: string;
  providerConnection: ProviderConnection;
  expectedItemCount: number | null;
};

export type StageOutput<T = unknown> = {
  ok: boolean;
  value: T;
  error: string | null;
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    finishReason: string | null;
    groundingSources: Array<{ title: string | null; uri: string | null }>;
  };
};

type StagedPipelineOutput = {
  result: MarketAnalysisResult;
  usage: {
    provider: ProviderConnection["provider"];
    model: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    finishReason: string | null;
    grounded: boolean;
    groundingSources: Array<{ title: string | null; uri: string | null }>;
  };
};

type StageDefinition<T = unknown> = {
  schema: z.ZodType<T>;
  schemaDescription: string;
  fallbackValue: T;
};

const DocumentMapSchema = z
  .object({
    sections: z
      .array(
        z.object({
          section_id: z.string().default(""),
          title: z.string().default(""),
          section_type: z.string().default(""),
          evidence: z.string().default(""),
        }),
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

const ExtractionPlanSchema = z
  .object({
    batches: z
      .array(
        z.object({
          batch_id: z.string().default(""),
          section_ids: z.array(z.string()).default([]),
          item_hint: z.string().default(""),
          goal: z.string().default(""),
        }),
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

const OfficialPriceTableSchema = z
  .object({
    price_rows: z
      .array(
        z.object({
          item: z.string().default(""),
          description: z.string().default(""),
          quantity: z.string().default(""),
          reference_unit: z.string().default(""),
          currency: z.string().default(""),
          source_location: z.string().default(""),
        }),
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

const TechnicalSpecsBatchSchema = z
  .object({
    batch_id: z.string().default(""),
    items: z
      .array(
        z.object({
          item: z.string().default(""),
          technical_description: z.string().default(""),
          fit_analysis: z.string().default(""),
          notes: z.string().default(""),
        }),
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

const AuditPassSchema = z
  .object({
    coverage_ok: z.boolean().default(false),
    needs_repair: z.boolean().default(false),
    issues: z
      .array(
        z.object({
          item: z.string().default(""),
          issue_type: z.string().default(""),
          message: z.string().default(""),
        }),
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

const RepairPassSchema = z
  .object({
    rows: MarketAnalysisTransportResultSchema.shape.rows.default([]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

const FinalResultSchema = MarketAnalysisTransportResultSchema;
const EMPTY_TRANSPORT_RESULT: MarketAnalysisTransportResult = { rows: [], warnings: [], provider_notes: [] };

const STAGE_NAMES = [
  "document_map",
  "extraction_plan",
  "official_price_table_extraction",
  "technical_specs_extraction_batches",
  "normalized_items_generation",
  "audit_pass",
  "repair_pass",
  "final_result",
] as const;

type StageName = (typeof STAGE_NAMES)[number] | "repair_json";

const STAGE_SCHEMA_BY_NAME: Record<string, StageDefinition> = {
  document_map: {
    schema: DocumentMapSchema,
    schemaDescription: "document_map: sections[] con section_id,title,section_type,evidence y warnings[]",
    fallbackValue: safeDefault(DocumentMapSchema),
  },
  extraction_plan: {
    schema: ExtractionPlanSchema,
    schemaDescription: "extraction_plan: batches[] con batch_id, section_ids, item_hint, goal y warnings[]",
    fallbackValue: safeDefault(ExtractionPlanSchema),
  },
  official_price_table_extraction: {
    schema: OfficialPriceTableSchema,
    schemaDescription: "official_price_table_extraction: price_rows[] y warnings[]",
    fallbackValue: safeDefault(OfficialPriceTableSchema),
  },
  technical_specs_extraction_batches: {
    schema: TechnicalSpecsBatchSchema,
    schemaDescription: "technical_specs_extraction_batches: batch_id, items[] con item, technical_description, fit_analysis, notes y warnings[]",
    fallbackValue: safeDefault(TechnicalSpecsBatchSchema),
  },
  normalized_items_generation: {
    schema: FinalResultSchema,
    schemaDescription: "normalized_items_generation: rows[] con 10 claves compactas, warnings[], provider_notes[]",
    fallbackValue: EMPTY_TRANSPORT_RESULT,
  },
  audit_pass: {
    schema: AuditPassSchema,
    schemaDescription: "audit_pass: coverage_ok, needs_repair, issues[], warnings[]",
    fallbackValue: safeDefault(AuditPassSchema),
  },
  repair_pass: {
    schema: RepairPassSchema,
    schemaDescription: "repair_pass: rows[] reparadas con 10 claves compactas y warnings[]",
    fallbackValue: safeDefault(RepairPassSchema),
  },
  final_result: {
    schema: FinalResultSchema,
    schemaDescription: "final_result: rows[] con 10 claves compactas, warnings[], provider_notes[]",
    fallbackValue: EMPTY_TRANSPORT_RESULT,
  },
};

function geminiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function timeoutMsForStage(stageName: StageName): number {
  if (stageName === "final_result" || stageName === "normalized_items_generation" || stageName === "repair_pass") {
    return 6 * 60_000;
  }
  return 2 * 60_000;
}

function baseStageName(stageName: string): StageName {
  const baseName = stageName.split(":")[0];
  if (baseName === "repair_json") {
    return "repair_json";
  }
  if (STAGE_NAMES.includes(baseName as (typeof STAGE_NAMES)[number])) {
    return baseName as StageName;
  }
  throw new Error(`Etapa IA-first no reconocida: ${stageName}`);
}

function extractGeminiText(response: unknown): string {
  const candidate = (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0];
  return candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

function extractGeminiSources(response: unknown): Array<{ title: string | null; uri: string | null }> {
  const candidate = (
    response as {
      candidates?: Array<{
        groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }> };
      }>;
    }
  ).candidates?.[0];

  return (
    candidate?.groundingMetadata?.groundingChunks
      ?.map((chunk) => ({
        title: chunk.web?.title ?? null,
        uri: chunk.web?.uri ?? null,
      }))
      .filter((source) => source.title || source.uri) ?? []
  );
}

async function callGeminiStage(input: {
  providerConnection: ProviderConnection;
  prompt: string;
  stageName: StageName;
  retryCount: number;
  allowGrounding?: boolean;
}): Promise<{
  rawText: string;
  rawResponse: unknown;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  groundingSources: Array<{ title: string | null; uri: string | null }>;
}> {
  if (!input.providerConnection.apiKey) {
    throw new Error("No hay API key configurada para Gemini.");
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMsForStage(input.stageName));

  try {
    const response = await fetch(
      `${geminiBaseUrl(input.providerConnection.baseUrl)}/v1beta/models/${input.providerConnection.model}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.providerConnection.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
          ...(input.allowGrounding ? { tools: [{ googleSearch: {} }] } : {}),
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ProviderHttpError(`Gemini no acepto etapa ${input.stageName} (${response.status}).`, response.status, body);
    }

    const rawResponse = await response.json();
    const rawText = extractGeminiText(rawResponse);
    const groundingSources = extractGeminiSources(rawResponse);
    const usage = (rawResponse as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    const finishReason = (rawResponse as { candidates?: Array<{ finishReason?: string }> }).candidates?.[0]?.finishReason ?? null;

    return {
      rawText,
      rawResponse,
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens: usage?.candidatesTokenCount ?? null,
      finishReason,
      groundingSources,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeDefault<T>(schema: z.ZodType<T>): T {
  return schema.parse({});
}

function parseStagePayload<T>(rawText: string, schema: z.ZodType<T>, stageName: StageName): T {
  const parsed = normalizeMarketAnalysisTransportPayload(parseJsonFromText(rawText));
  const baseName = baseStageName(stageName);
  const candidates: unknown[] = [normalizeStageWarnings(parsed)];

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const key of [stageName, baseName, "result", "data", "output"]) {
      if (record[key] !== undefined) {
        candidates.push(normalizeStageWarnings(normalizeMarketAnalysisTransportPayload(record[key])));
      }
    }
  }

  if (Array.isArray(parsed)) {
    if (baseName === "technical_specs_extraction_batches") {
      candidates.push({ batch_id: "batch_1", items: parsed, warnings: [] });
    } else if (baseName === "official_price_table_extraction") {
      candidates.push({ price_rows: parsed, warnings: [] });
    } else if (baseName === "audit_pass") {
      candidates.push({ coverage_ok: false, needs_repair: parsed.length > 0, issues: parsed, warnings: [] });
    } else if (baseName === "normalized_items_generation" || baseName === "final_result") {
      candidates.push({ rows: parsed, warnings: [], provider_notes: [] });
    } else if (baseName === "repair_pass") {
      candidates.push({ rows: parsed, warnings: [] });
    }
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return schema.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function normalizeStageWarnings(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  if (Array.isArray(record.warnings)) {
    record.warnings = record.warnings.map((warning) => {
      if (typeof warning === "string") return warning;
      if (warning && typeof warning === "object") {
        const maybeMessage = (warning as { message?: unknown; issue?: unknown; reason?: unknown }).message ??
          (warning as { message?: unknown; issue?: unknown; reason?: unknown }).issue ??
          (warning as { message?: unknown; issue?: unknown; reason?: unknown }).reason;
        if (typeof maybeMessage === "string") return maybeMessage;
      }
      return JSON.stringify(warning);
    });
  }
  return record;
}

async function repairJsonStage<T>(context: StageContext, input: {
  failedStageName: StageName;
  rawText: string;
  schemaDescription: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const prompt = `
Repara una respuesta JSON invalida de una etapa IA-first.

No agregues informacion nueva.
No interpretes el documento.
Solo corrige formato JSON, nombres de claves, comillas, escapes y estructura para cumplir el schema.

Etapa original: ${input.failedStageName}
Schema esperado:
${input.schemaDescription}

Respuesta cruda:
${input.rawText}

Devuelve solo JSON valido.
`.trim();

  const startedAt = startMarketAnalysisStage({
    runId: context.runId,
    documentName: context.fileName,
    stageName: `repair_json:${input.failedStageName}`,
    prompt,
    retryCount: 0,
    model: context.providerConnection.model,
  });

  try {
    const output = await callGeminiStage({
      providerConnection: context.providerConnection,
      prompt,
      stageName: "repair_json",
      retryCount: 0,
    });
    const parsed = parseStagePayload(output.rawText, input.schema, input.failedStageName);
    finishMarketAnalysisStage({
      runId: context.runId,
      documentName: context.fileName,
      stageName: `repair_json:${input.failedStageName}`,
      startedAt,
      prompt,
      rawResponse: output.rawResponse,
      parsedJson: parsed,
      status: "completed",
      retryCount: 0,
      model: context.providerConnection.model,
    });
    return parsed;
  } catch (error) {
    finishMarketAnalysisStage({
      runId: context.runId,
      documentName: context.fileName,
      stageName: `repair_json:${input.failedStageName}`,
      startedAt,
      prompt,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Error reparando JSON.",
      retryCount: 0,
      model: context.providerConnection.model,
    });
    throw error;
  }
}

async function runJsonStage<T>(context: StageContext, input: {
  stageName: StageName;
  traceStageName?: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaDescription: string;
  fallbackValue: T;
  allowGrounding?: boolean;
  retries?: number;
}): Promise<StageOutput<T>> {
  let lastError: unknown = null;
  const retries = input.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const traceStageName = input.traceStageName ?? input.stageName;
    const startedAt = startMarketAnalysisStage({
      runId: context.runId,
      documentName: context.fileName,
      stageName: traceStageName,
      prompt: input.prompt,
      retryCount: attempt,
      model: context.providerConnection.model,
    });

    try {
      const output = await callGeminiStage({
        providerConnection: context.providerConnection,
        prompt: input.prompt,
        stageName: input.stageName,
        retryCount: attempt,
        allowGrounding: input.allowGrounding,
      });

      let parsed: T;
      try {
        parsed = parseStagePayload(output.rawText, input.schema, input.stageName);
      } catch {
        parsed = await repairJsonStage(context, {
          failedStageName: input.stageName,
          rawText: output.rawText,
          schemaDescription: input.schemaDescription,
          schema: input.schema,
        });
      }

      finishMarketAnalysisStage({
        runId: context.runId,
        documentName: context.fileName,
        stageName: traceStageName,
        startedAt,
        prompt: input.prompt,
        rawResponse: output.rawResponse,
        parsedJson: parsed,
        status: "completed",
        retryCount: attempt,
        model: context.providerConnection.model,
      });

      return {
        ok: true,
        value: parsed,
        error: null,
        usage: {
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          finishReason: output.finishReason,
          groundingSources: output.groundingSources,
        },
      };
    } catch (error) {
      lastError = error;
      finishMarketAnalysisStage({
        runId: context.runId,
        documentName: context.fileName,
        stageName: traceStageName,
        startedAt,
        prompt: input.prompt,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Error en etapa IA.",
        retryCount: attempt,
        model: context.providerConnection.model,
      });
    }
  }

  return {
    ok: false,
    value: input.fallbackValue,
    error: lastError instanceof Error ? lastError.message : "Etapa fallida.",
  };
}

function accumulateStageUsage(
  totals: { inputTokens: number; outputTokens: number; groundingSources: Array<{ title: string | null; uri: string | null }> },
  stage: StageOutput<unknown>,
) {
  totals.inputTokens += stage.usage?.inputTokens ?? 0;
  totals.outputTokens += stage.usage?.outputTokens ?? 0;
  totals.groundingSources.push(...(stage.usage?.groundingSources ?? []));
}

function uniqueSources(sources: Array<{ title: string | null; uri: string | null }>) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.title ?? ""}|${source.uri ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function baseDocumentBlock(context: StageContext): string {
  return `
Archivo: ${context.fileName}
Tipo: ${context.fileType}
Resumen local:
${context.sourceSummary}
Items esperados aproximados: ${context.expectedItemCount ?? "N/D"}

Contenido extraido:
${context.documentText}
`.trim();
}

function compactContextBlock(context: StageContext): string {
  return `
Archivo: ${context.fileName}
Tipo: ${context.fileType}
Resumen local:
${context.sourceSummary}
Items esperados aproximados: ${context.expectedItemCount ?? "N/D"}
`.trim();
}

function runConfiguredStage<T>(
  context: StageContext,
  input: {
    stageName: StageName;
    traceStageName?: string;
    prompt: string;
    definition: StageDefinition<T>;
    allowGrounding?: boolean;
    retries?: number;
  },
) {
  return runJsonStage(context, {
    stageName: input.stageName,
    traceStageName: input.traceStageName,
    prompt: input.prompt,
    schema: input.definition.schema,
    schemaDescription: input.definition.schemaDescription,
    fallbackValue: input.definition.fallbackValue,
    allowGrounding: input.allowGrounding,
    retries: input.retries,
  });
}

function stageDefinition<T>(stageName: Exclude<StageName, "repair_json">): StageDefinition<T> {
  return STAGE_SCHEMA_BY_NAME[stageName] as StageDefinition<T>;
}

function sourceCount(row: Pick<MarketAnalysisTransportRow, "source_1" | "source_2" | "source_3">): number {
  return [row.source_1, row.source_2, row.source_3].filter(isMarketSourcePrice).length;
}

function needsRowQualityRepair(row: MarketAnalysisTransportRow): boolean {
  return (
    sourceCount(row) < 3 ||
    !row.technical_description.trim() ||
    !row.fit_analysis.trim() ||
    !row.notes.trim()
  );
}

function mergeTransportRows(
  baseRows: MarketAnalysisTransportRow[],
  repairedRows: MarketAnalysisTransportRow[],
): MarketAnalysisTransportRow[] {
  const repairedByKey = new Map(
    repairedRows.map((row) => [String(row.item || row.description).trim().toLowerCase(), row]),
  );

  return baseRows.map((row) => {
    const key = String(row.item || row.description).trim().toLowerCase();
    const repaired = repairedByKey.get(key);
    if (!repaired) {
      return row;
    }

    return {
      ...row,
      technical_description: repaired.technical_description || row.technical_description,
      fit_analysis: repaired.fit_analysis || row.fit_analysis,
      source_1: isMarketSourcePrice(repaired.source_1) ? repaired.source_1 : row.source_1,
      source_2: isMarketSourcePrice(repaired.source_2) ? repaired.source_2 : row.source_2,
      source_3: isMarketSourcePrice(repaired.source_3) ? repaired.source_3 : row.source_3,
      notes: [row.notes, repaired.notes].filter(Boolean).join(" | "),
    };
  });
}

function normalizeMatchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function hydrateReferenceUnitsFromPriceTable(
  rows: MarketAnalysisTransportRow[],
  priceRows: Array<{ item?: string; description?: string; quantity?: string; reference_unit?: string }> | undefined,
): MarketAnalysisTransportRow[] {
  const candidates = (priceRows ?? []).filter((priceRow) => String(priceRow.reference_unit || "").trim());
  if (candidates.length === 0) return rows;

  return rows.map((row) => {
    if (row.reference_unit.trim()) return row;
    const itemKey = normalizeMatchKey(row.item);
    const descriptionKey = normalizeMatchKey(row.description);
    const match = candidates.find((priceRow) => {
      const candidateItem = normalizeMatchKey(String(priceRow.item || ""));
      const candidateDescription = normalizeMatchKey(String(priceRow.description || ""));
      return (
        (itemKey && candidateItem && itemKey === candidateItem) ||
        (descriptionKey && candidateDescription && descriptionKey === candidateDescription) ||
        (descriptionKey && candidateDescription && descriptionKey.includes(candidateDescription)) ||
        (descriptionKey && candidateDescription && candidateDescription.includes(descriptionKey))
      );
    });
    if (!match?.reference_unit) return row;
    return {
      ...row,
      reference_unit: match.reference_unit,
      quantity: row.quantity || match.quantity || "",
    };
  });
}

function promptDocumentMap(context: StageContext): string {
  return `
Etapa document_map.
Mapea el documento para orientar el analisis posterior.
No extraigas la matriz final.
Devuelve JSON con secciones detectadas y evidencia.

Schema:
{"sections":[{"section_id":"","title":"","section_type":"","evidence":""}],"warnings":[]}

${baseDocumentBlock(context)}
`.trim();
}

function promptExtractionPlan(context: StageContext, documentMap: unknown): string {
  return `
Etapa extraction_plan.
Crea un plan de extraccion IA-first por lotes o secciones.
No extraigas la matriz final.

Schema:
{"batches":[{"batch_id":"","section_ids":[],"item_hint":"","goal":""}],"warnings":[]}

document_map:
${JSON.stringify(documentMap, null, 2)}

${baseDocumentBlock(context)}
`.trim();
}

function promptOfficialPriceTable(context: StageContext, plan: unknown): string {
  return `
Etapa official_price_table_extraction.
Extrae unicamente tabla oficial/precio techo/referencia del documento.
No busques fuentes externas.
No calcules ponderados.

Schema:
{"price_rows":[{"item":"","description":"","quantity":"","reference_unit":"","currency":"","source_location":""}],"warnings":[]}

extraction_plan:
${JSON.stringify(plan, null, 2)}

${baseDocumentBlock(context)}
`.trim();
}

function promptTechnicalBatch(context: StageContext, batch: unknown, batchIndex: number): string {
  return `
Etapa technical_specs_extraction_batches.
Extrae fichas tecnicas y lectura comercial para este lote.
No busques precios externos.
No calcules costos.

Schema:
{"batch_id":"","items":[{"item":"","technical_description":"","fit_analysis":"","notes":""}],"warnings":[]}

batch_index: ${batchIndex + 1}
batch:
${JSON.stringify(batch, null, 2)}

${baseDocumentBlock(context)}
`.trim();
}

function promptNormalizedItems(context: StageContext, data: {
  priceTable: unknown;
  technicalBatches: unknown[];
}): string {
  return `
Etapa normalized_items_generation.
Genera una fila normalizada por cada item visible.
Tambien busca hasta 3 fuentes externas de mercado comparables por item.
No calcules costo optimista, moderado, ponderado, total ni margen.
Usa Google Search de forma activa para las fuentes externas si la herramienta esta disponible.
Cada source_1, source_2 y source_3 debe incluir nombre de fuente/proveedor, precio unitario, moneda y URL http(s) o dominio verificable.
Las tres fuentes deben ser distintas; no repitas proveedor, dominio, fabricante ni publicacion.
Si es Colombia usa COP. Si es internacional usa etiqueta [INTERNACIONAL] y precio USD cuando aplique.
No uses el precio techo ni promedios del documento como fuente externa; esos van solo en reference_unit.
Si encuentras precio pero no URL/dominio verificable, deja esa fuente en "N/D" y explica en notes: FUENTE_SIN_TRAZABILIDAD.

Schema:
{"rows":[{"item":"","description":"","technical_description":"","quantity":"","fit_analysis":"","source_1":"","source_2":"","source_3":"","reference_unit":"","notes":""}],"warnings":[],"provider_notes":[]}

official_price_table_extraction:
${JSON.stringify(data.priceTable, null, 2)}

technical_specs_extraction_batches:
${JSON.stringify(data.technicalBatches, null, 2)}

${baseDocumentBlock(context)}
`.trim();
}

function promptAudit(context: StageContext, normalized: unknown): string {
  return `
Etapa audit_pass.
Audita cobertura, campos vacios, fuentes internas usadas como mercado, reference_unit dudoso, fuentes repetidas, fuentes sin URL/dominio y filas omitidas.
No cambies los datos. Solo reporta issues y si requiere reparacion.
La etapa normalized_items_generation puede usar fuentes externas de mercado que no aparecen en el documento.
No marques una fuente externa como alucinada solo porque no esta en el documento base.
Marca fuente como problema solo si:
- usa precio techo, presupuesto, promedio o cotizacion interna como mercado externo;
- no tiene proveedor/tienda y precio unitario;
- no tiene URL http(s) o dominio verificable;
- repite la misma fuente, proveedor, dominio, fabricante o publicacion en source_1/source_2/source_3;
- es tecnicamente incompatible con el item;
- parece inventada, imposible o sin trazabilidad minima.
Si hay fuentes externas con proveedor y precio, preservalas salvo problema claro.

Schema:
{"coverage_ok":false,"needs_repair":false,"issues":[{"item":"","issue_type":"","message":""}],"warnings":[]}

normalized_items_generation:
${JSON.stringify(normalized, null, 2)}

${compactContextBlock(context)}
`.trim();
}

function promptRepair(context: StageContext, normalized: unknown, audit: unknown): string {
  return `
Etapa repair_pass.
Repara solo los problemas indicados por audit_pass.
No cambies items correctos.
No inventes datos.
Si audit_pass marca fuentes alucinadas o no verificadas, reemplaza source_1/source_2/source_3 con fuentes externas verificables de mercado.
Usa Google Search de forma activa si la herramienta esta disponible.
Cada fuente debe tener proveedor o tienda, precio unitario, moneda y URL http(s) o dominio verificable. Usa COP para Colombia y [INTERNACIONAL] + USD si es fuente internacional.
Las fuentes deben ser distintas; no repitas proveedor, dominio, fabricante ni publicacion.
Si no logras una fuente defendible para un item, deja esa fuente en "N/D" y explica la razon en notes.
No uses cotizaciones internas del documento como fuentes externas; esas sirven como contexto documental, no como mercado.
Devuelve filas con las mismas 10 claves compactas.

Schema:
{"rows":[{"item":"","description":"","technical_description":"","quantity":"","fit_analysis":"","source_1":"","source_2":"","source_3":"","reference_unit":"","notes":""}],"warnings":[]}

normalized_items_generation:
${JSON.stringify(normalized, null, 2)}

audit_pass:
${JSON.stringify(audit, null, 2)}

Contexto documental:
${baseDocumentBlock(context)}
`.trim();
}

function promptSourceGapRepair(context: StageContext, rows: MarketAnalysisTransportRow[], audit: unknown): string {
  return `
Etapa repair_pass:quality_gap.
Completa campos faltantes o debiles para los items indicados.
No rehagas toda la matriz.
No calcules costos financieros.
No cambies item, description, quantity ni reference_unit.
Preserva fuentes validas existentes.
Busca fuentes externas comparables hasta llegar a 3 por item cuando sea posible.
Completa technical_description con la ficha reconstruida o una descripcion tecnica breve basada en el documento.
Completa fit_analysis con una lectura comercial breve y util del item.
Completa notes con observaciones de fuente, dudas o razon por la cual no fue posible completar algun dato.
Usa Google Search de forma activa si la herramienta esta disponible.
Cada source debe tener proveedor o tienda, precio unitario, moneda y URL http(s) o dominio verificable.
Las fuentes deben ser distintas; no repitas proveedor, dominio, fabricante ni publicacion.
Formatos aceptados:
- Proveedor | 103966 COP | https://proveedor.com/producto
- Proveedor | 103966 | COP | proveedor.com
- [INTERNACIONAL] Proveedor | 35 USD | Pais | https://proveedor.com/producto
Si no consigues una fuente defendible con URL/dominio, deja el campo en "N/D" y explica en notes por que falta.
No uses precio techo, presupuesto, promedio o cotizaciones internas del documento como fuente externa.

Schema:
{"rows":[{"item":"","description":"","technical_description":"","quantity":"","fit_analysis":"","source_1":"","source_2":"","source_3":"","reference_unit":"","notes":""}],"warnings":[]}

items_a_reparar:
${JSON.stringify({ rows }, null, 2)}

audit_pass:
${JSON.stringify(audit, null, 2)}

${baseDocumentBlock(context)}
`.trim();
}

function promptFinal(context: StageContext, normalized: unknown, audit: unknown, repair: unknown): string {
  return `
Etapa final_result.
Construye el resultado final JSON estricto.
Usa repair_pass solo si contiene rows con datos reales.
Si repair_pass.rows esta vacio, usa normalized_items_generation como fuente principal.
No devuelvas rows vacias si normalized_items_generation trae filas.
No calcules costos financieros.
No agregues claves extra.

Schema:
{"rows":[{"item":"","description":"","technical_description":"","quantity":"","fit_analysis":"","source_1":"","source_2":"","source_3":"","reference_unit":"","notes":""}],"warnings":[],"provider_notes":[]}

normalized_items_generation:
${JSON.stringify(normalized, null, 2)}

audit_pass:
${JSON.stringify(audit, null, 2)}

repair_pass:
${JSON.stringify(repair, null, 2)}

${compactContextBlock(context)}
`.trim();
}

export async function runStagedMarketAnalysisPipeline(context: StageContext): Promise<StagedPipelineOutput> {
  const startedAt = Date.now();
  const usageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    groundingSources: [] as Array<{ title: string | null; uri: string | null }>,
  };
  const stageErrors: string[] = [];

  const map = await runConfiguredStage(context, {
    stageName: "document_map",
    prompt: promptDocumentMap(context),
    definition: stageDefinition<z.infer<typeof DocumentMapSchema>>("document_map"),
    retries: 0,
  });
  accumulateStageUsage(usageTotals, map);
  if (!map.ok) stageErrors.push(`document_map: ${map.error}`);
  if (!map.ok) {
    throw new Error(`STAGED_PIPELINE_REQUIRED_STAGE_FAILED: document_map: ${map.error}`);
  }

  const plan = await runConfiguredStage(context, {
    stageName: "extraction_plan",
    prompt: promptExtractionPlan(context, map.value),
    definition: stageDefinition<z.infer<typeof ExtractionPlanSchema>>("extraction_plan"),
    retries: 0,
  });
  accumulateStageUsage(usageTotals, plan);
  if (!plan.ok) stageErrors.push(`extraction_plan: ${plan.error}`);
  if (!plan.ok) {
    throw new Error(`STAGED_PIPELINE_REQUIRED_STAGE_FAILED: extraction_plan: ${plan.error}`);
  }

  const priceTable = await runConfiguredStage(context, {
    stageName: "official_price_table_extraction",
    prompt: promptOfficialPriceTable(context, plan.value),
    definition: stageDefinition<z.infer<typeof OfficialPriceTableSchema>>("official_price_table_extraction"),
    retries: 0,
  });
  accumulateStageUsage(usageTotals, priceTable);
  if (!priceTable.ok) stageErrors.push(`official_price_table_extraction: ${priceTable.error}`);
  if (!priceTable.ok) {
    throw new Error(`STAGED_PIPELINE_REQUIRED_STAGE_FAILED: official_price_table_extraction: ${priceTable.error}`);
  }

  const planValue = plan.value as { batches?: Array<{ batch_id?: string; section_ids?: string[]; item_hint?: string; goal?: string }> };
  const planBatches = Array.isArray(planValue.batches) ? planValue.batches : [];
  const batches = planBatches.length > 0
    ? planBatches.slice(0, 12)
    : [{ batch_id: "batch_1", section_ids: [], item_hint: "documento completo", goal: "extraer fichas tecnicas" }];
  const technicalBatches: unknown[] = [];
  for (const [index, batch] of batches.entries()) {
    const batchId = String(batch.batch_id || `batch_${index + 1}`).replace(/[^A-Za-z0-9_-]/g, "_");
    const technical = await runConfiguredStage(context, {
      stageName: "technical_specs_extraction_batches",
      traceStageName: `technical_specs_extraction_batches:${batchId}`,
      prompt: promptTechnicalBatch(context, batch, index),
      definition: {
        ...stageDefinition<z.infer<typeof TechnicalSpecsBatchSchema>>("technical_specs_extraction_batches"),
        fallbackValue: { batch_id: batchId, items: [], warnings: [] },
      },
    });
    accumulateStageUsage(usageTotals, technical);
    technicalBatches.push(technical.value);
    if (!technical.ok) stageErrors.push(`technical_specs_extraction_batches:${index + 1}: ${technical.error}`);
  }

  const normalized = await runConfiguredStage(context, {
    stageName: "normalized_items_generation",
    prompt: promptNormalizedItems(context, { priceTable: priceTable.value, technicalBatches }),
    definition: stageDefinition<MarketAnalysisTransportResult>("normalized_items_generation"),
    allowGrounding: true,
    retries: 0,
  });
  accumulateStageUsage(usageTotals, normalized);
  if (!normalized.ok) stageErrors.push(`normalized_items_generation: ${normalized.error}`);
  if (!normalized.ok) {
    throw new Error(`STAGED_PIPELINE_REQUIRED_STAGE_FAILED: normalized_items_generation: ${normalized.error}`);
  }

  const audit = await runConfiguredStage(context, {
    stageName: "audit_pass",
    prompt: promptAudit(context, normalized.value),
    definition: stageDefinition<z.infer<typeof AuditPassSchema>>("audit_pass"),
  });
  accumulateStageUsage(usageTotals, audit);
  if (!audit.ok) stageErrors.push(`audit_pass: ${audit.error}`);

  const auditValue = audit.value as { needs_repair?: boolean; issues?: unknown[] };
  let repair: StageOutput<unknown> = {
    ok: true,
    value: { rows: [], warnings: [] },
    error: null,
  };
  if (auditValue.needs_repair || (auditValue.issues ?? []).length > 0) {
    repair = await runConfiguredStage(context, {
      stageName: "repair_pass",
      prompt: promptRepair(context, normalized.value, audit.value),
      definition: stageDefinition<z.infer<typeof RepairPassSchema>>("repair_pass"),
      allowGrounding: true,
    });
    accumulateStageUsage(usageTotals, repair);
    if (!repair.ok) stageErrors.push(`repair_pass: ${repair.error}`);
  }

  const final = await runConfiguredStage(context, {
    stageName: "final_result",
    prompt: promptFinal(context, normalized.value, audit.value, repair.value),
    definition: {
      ...stageDefinition<MarketAnalysisTransportResult>("final_result"),
      fallbackValue: normalized.value as MarketAnalysisTransportResult,
    },
  });
  accumulateStageUsage(usageTotals, final);
  if (!final.ok) stageErrors.push(`final_result: ${final.error}`);

  let finalTransport = FinalResultSchema.parse(final.value) as MarketAnalysisTransportResult;
  finalTransport = {
    ...finalTransport,
    rows: hydrateReferenceUnitsFromPriceTable(finalTransport.rows, priceTable.value.price_rows),
  };
  const rowsNeedingQualityRepair = finalTransport.rows.filter(needsRowQualityRepair);
  if (rowsNeedingQualityRepair.length > 0) {
    const sourceGapRepair = await runConfiguredStage(context, {
      stageName: "repair_pass",
      traceStageName: "repair_pass:quality_gap",
      prompt: promptSourceGapRepair(context, rowsNeedingQualityRepair, audit.value),
      definition: {
        ...stageDefinition<z.infer<typeof RepairPassSchema>>("repair_pass"),
        fallbackValue: { rows: [], warnings: [] },
      },
      allowGrounding: true,
      retries: 0,
    });
    accumulateStageUsage(usageTotals, sourceGapRepair);

    if (sourceGapRepair.ok && sourceGapRepair.value.rows.length > 0) {
      finalTransport = {
        ...finalTransport,
        rows: hydrateReferenceUnitsFromPriceTable(
          mergeTransportRows(finalTransport.rows, sourceGapRepair.value.rows),
          priceTable.value.price_rows,
        ),
        warnings: Array.from(new Set([...finalTransport.warnings, ...sourceGapRepair.value.warnings])),
        provider_notes: Array.from(
          new Set([
            ...finalTransport.provider_notes,
            `Reparacion automatica de calidad ejecutada sobre ${rowsNeedingQualityRepair.length} item(s) con fuentes o campos incompletos.`,
          ]),
        ),
      };
    } else {
      finalTransport = {
        ...finalTransport,
        warnings: Array.from(
          new Set([
            ...finalTransport.warnings,
            `QUALITY_GAP_REPAIR_NOT_APPLIED: ${sourceGapRepair.error ?? "sin filas reparadas"}`,
          ]),
        ),
      };
    }
  }
  const result = normalizeMarketAnalysisTransportResult(finalTransport);
  const groundingSources = uniqueSources(usageTotals.groundingSources);
  result.warnings = Array.from(new Set([...result.warnings, ...stageErrors]));
  result.provider_notes = Array.from(
    new Set([
      ...result.provider_notes,
      "Pipeline IA-first por etapas ejecutado: document_map, extraction_plan, official_price_table_extraction, technical_specs_extraction_batches, normalized_items_generation, audit_pass, repair_pass, final_result.",
    ]),
  );

  return {
    result,
    usage: {
      provider: context.providerConnection.provider,
      model: context.providerConnection.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: usageTotals.inputTokens || null,
      outputTokens: usageTotals.outputTokens || null,
      finishReason: stageErrors.length > 0 ? "partial" : "STOP",
      grounded: groundingSources.length > 0,
      groundingSources,
    },
  };
}

export async function retryStagedMarketAnalysisStage(input: {
  runId: string;
  fileName: string;
  stageName: string;
  prompt: string;
  providerConnection: ProviderConnection;
  retryCount: number;
}) {
  const baseName = baseStageName(input.stageName);
  const schemaConfig = STAGE_SCHEMA_BY_NAME[baseName];
  if (!schemaConfig) {
    throw new Error(`No hay schema registrado para reintentar la etapa ${input.stageName}.`);
  }

  const context: StageContext = {
    runId: input.runId,
    fileName: input.fileName,
    fileType: "xlsx",
    sourceSummary: "",
    documentText: "",
    providerConnection: input.providerConnection,
    expectedItemCount: null,
  };

  return runJsonStage(context, {
    stageName: baseName,
    traceStageName: input.stageName,
    prompt: input.prompt,
    schema: schemaConfig.schema,
    schemaDescription: schemaConfig.schemaDescription,
    fallbackValue: schemaConfig.fallbackValue,
    allowGrounding: baseName === "normalized_items_generation" || baseName === "repair_pass",
    retries: 0,
  });
}
