import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";

import { Parser as Json2CsvParser } from "json2csv";

import type { FileType } from "@ai-first-contracts/enums";
import { segmentDocumentFromFile } from "@ai-first-core/document/document-segmenter";

import { buildInitialOfferControls, buildOfferSimulation, toOfferExportRows } from "./financial-simulation";
import {
  buildMarketAnalysisChunkPrompt,
  buildMarketAnalysisConsolidationPrompt,
  buildMarketAnalysisPrompt,
  buildMarketAnalysisSourceRepairPrompt,
  buildNativePdfMarketAnalysisPrompt,
  MARKET_ANALYSIS_PROMPT_VERSION,
} from "./market-analysis-prompt";
import { countGeminiTokens, runMarketAnalysisProvider, uploadGeminiFile } from "./market-analysis-provider";
import { evaluateMarketAnalysisRunQuality } from "./market-analysis-quality-gate";
import { MARKET_ANALYSIS_COLUMNS, normalizeMarketAnalysisRow, type MarketAnalysisResult } from "./market-analysis-schema";
import { retryStagedMarketAnalysisStage, runStagedMarketAnalysisPipeline } from "./market-analysis-stage-pipeline";
import { isMarketSourcePrice, parseMarketSourceUnitPrice, INTERNATIONAL_IMPORT_FACTOR } from "./market-source-pricing";
import { getActiveProviderConnectionForServer } from "./provider-settings";
import { MarketAnalysisStore, type MarketAnalysisRun } from "./market-analysis-store";
import {
  buildMarketAnalysisDebugReport,
  finishMarketAnalysisStage,
  getMarketAnalysisStages,
  registerMarketAnalysisFixture,
  startMarketAnalysisStage,
} from "./market-analysis-trace";
import { getOfficialTrmSnapshot, type TrmSnapshot } from "./trm-service";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");
const activeMarketAnalysisJobs = new Map<string, Promise<MarketAnalysisRun>>();

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function uploadsRoot(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "market-analysis-uploads");
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function normalizeFileType(fileName: string, mimeType: string): FileType {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (extension === ".xlsx" || mimeType.includes("spreadsheetml")) {
    return "xlsx";
  }
  if (extension === ".xls" || mimeType.includes("ms-excel")) {
    return "xls";
  }
  if (extension === ".docx" || mimeType.includes("wordprocessingml")) {
    return "docx";
  }
  if (extension === ".doc" || mimeType.includes("msword")) {
    return "doc";
  }

  throw new Error(`Tipo de archivo no soportado: ${fileName}`);
}

function buildChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildDocumentText(segments: Awaited<ReturnType<typeof segmentDocumentFromFile>>): string {
  return segments
    .map((segment) => {
      const location = [
        segment.locator.sheet ? `sheet=${segment.locator.sheet}` : null,
        segment.locator.page ? `page=${segment.locator.page}` : null,
        segment.locator.row_start ? `row=${segment.locator.row_start}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return `--- segment_id=${segment.segment_id}${location ? ` (${location})` : ""} ---\n${segment.raw_text}`;
    })
    .join("\n\n")
    .slice(0, 180_000);
}

function buildSourceSummary(segments: Awaited<ReturnType<typeof segmentDocumentFromFile>>): string {
  const sheets = Array.from(new Set(segments.map((segment) => segment.locator.sheet).filter(Boolean)));
  const rowCount = segments.filter((segment) => segment.unit_type === "table_row_range").length;

  return [
    `Segmentos extraídos localmente: ${segments.length}`,
    rowCount > 0 ? `Filas de tabla detectadas: ${rowCount}` : null,
    sheets.length > 0 ? `Hojas detectadas: ${sheets.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function splitDocumentTextForAi(documentText: string, maxChunkChars = 80_000, overlapLines = 8): string[] {
  const lines = documentText.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length + 1 > maxChunkChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = current.slice(Math.max(0, current.length - overlapLines));
      currentLength = current.join("\n").length;
    }

    current.push(line);
    currentLength += line.length + 1;
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

function hasIncompleteSampleLanguage(result: MarketAnalysisResult): boolean {
  const text = [...result.warnings, ...result.provider_notes].join(" ").toLowerCase();
  return /\brepresentativ|\bmuestra|\bseleccionad|\bpor volumen|\bpor valor tecnico/.test(text);
}

function shouldUseAiFirstPipeline(documentText: string): boolean {
  return documentText.length > 18_000;
}

function estimateExpectedItemCount(
  segments: Awaited<ReturnType<typeof segmentDocumentFromFile>>,
  documentText: string,
): number | null {
  const tableRowCount = segments.filter((segment) => segment.unit_type === "table_row_range").length;
  if (tableRowCount >= 20) {
    return tableRowCount;
  }

  const declaredCount = documentText.match(/\b(?:items?|ítems?|elementos)\b[^\d]{0,30}(\d{2,4})/i);
  if (declaredCount) {
    const parsed = Number(declaredCount[1]);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 1000 ? parsed : null;
  }

  return null;
}

function buildCoverageWarnings(result: MarketAnalysisResult, expectedItemCount: number | null): string[] {
  if (!expectedItemCount || result.rows.length >= Math.floor(expectedItemCount * 0.9)) {
    return [];
  }

  return [
    `AUDITORIA_COBERTURA: la extraccion devolvio ${result.rows.length} filas y la lectura local sugiere cerca de ${expectedItemCount} items. Revisar antes de usar como final.`,
  ];
}

type ProviderConnection = ReturnType<typeof getActiveProviderConnectionForServer>;
type ProviderOutput = Awaited<ReturnType<typeof runMarketAnalysisProvider>>;

async function runProviderStage(input: {
  runId: string;
  documentName: string;
  stageName: string;
  providerConnection: ProviderConnection;
  prompt: string;
  allowGrounding?: boolean;
  geminiFile?: Parameters<typeof runMarketAnalysisProvider>[0]["geminiFile"];
  thinkingLevel?: Parameters<typeof runMarketAnalysisProvider>[0]["thinkingLevel"];
  retryCount?: number;
}): Promise<ProviderOutput> {
  const stageStartedAt = startMarketAnalysisStage({
    runId: input.runId,
    documentName: input.documentName,
    stageName: input.stageName,
    prompt: input.prompt,
    retryCount: input.retryCount ?? 0,
    model: input.providerConnection.model,
  });

  try {
    const output = await runMarketAnalysisProvider({
      provider: input.providerConnection.provider,
      model: input.providerConnection.model,
      baseUrl: input.providerConnection.baseUrl,
      apiKey: input.providerConnection.apiKey,
      prompt: input.prompt,
      allowGrounding: input.allowGrounding,
      geminiFile: input.geminiFile,
      thinkingLevel: input.thinkingLevel,
    });

    finishMarketAnalysisStage({
      runId: input.runId,
      documentName: input.documentName,
      stageName: input.stageName,
      startedAt: stageStartedAt,
      prompt: input.prompt,
      rawResponse: output.rawResponse,
      parsedJson: output.result,
      status: "completed",
      retryCount: input.retryCount ?? 0,
      model: output.usage.model,
    });

    return output;
  } catch (error) {
    finishMarketAnalysisStage({
      runId: input.runId,
      documentName: input.documentName,
      stageName: input.stageName,
      startedAt: stageStartedAt,
      prompt: input.prompt,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Error desconocido en etapa IA.",
      retryCount: input.retryCount ?? 0,
      model: input.providerConnection.model,
    });

    throw error;
  }
}

function parseCopMoney(value: string): number | null {
  if (!value || /^n\/?d$/i.test(value.trim())) {
    return null;
  }

  const normalizedValue = value.replace(/(\d)[\s\u00a0]+(?=\d)/g, "$1");
  const parseToken = (candidate: string): number | null => {
    const cleaned = candidate.replace(/(\d)[\s\u00a0]+(?=\d)/g, "$1").replace(/[^\d.,]/g, "");
    if (!cleaned) {
      return null;
    }

    const normalized = cleaned.replace(/[.,]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const moneyMarkerMatches = Array.from(normalizedValue.matchAll(/(?:COP|COL\$|\$)\s*([0-9][0-9.,]*)/gi));
  const markerCandidates = moneyMarkerMatches
    .map((match) => parseToken(match[1] ?? ""))
    .filter((candidate): candidate is number => candidate !== null);
  if (markerCandidates.length > 0) {
    return markerCandidates[markerCandidates.length - 1] ?? null;
  }

  const trimmed = normalizedValue.trim();
  if (/^[\d\s.,]+$/.test(trimmed)) {
    return parseToken(trimmed);
  }

  const thousandsCandidates = (normalizedValue.match(/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?\b/g) ?? [])
    .map(parseToken)
    .filter((candidate): candidate is number => candidate !== null);
  if (thousandsCandidates.length > 0) {
    return thousandsCandidates[thousandsCandidates.length - 1] ?? null;
  }

  return null;
}

function hasPricedSourceText(value: string): boolean {
  return parseCopMoney(value) !== null || /\bUSD\b|US\$|\[INTERNACIONAL\]/i.test(value);
}

function parseQuantity(value: string): number {
  const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function formatMoney(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "N/D" : String(Math.round(value));
}

function calculateMarketAnalysisRow(row: MarketAnalysisResult["rows"][number], trm: TrmSnapshot): MarketAnalysisResult["rows"][number] {
  const sourcePrices = [
    parseMarketSourceUnitPrice(row["Fuente 1 (Precio)"], trm.value),
    parseMarketSourceUnitPrice(row["Fuente 2 (Precio)"], trm.value),
    parseMarketSourceUnitPrice(row["Fuente 3 (Precio)"], trm.value),
  ];
  const sourcePriceValues = sourcePrices.flatMap((source) => (source ? [source.priceCop] : []));

  if (sourcePriceValues.length === 0) {
    return {
      ...row,
      "Costo Optimista": "N/D",
      "Costo Moderado": "N/D",
      "COSTO PONDERADO UNIT": "N/D",
      "COSTO PONDERADO TOTAL": "N/D",
      "Viabilidad / Margen": row["PRECIO REFERENCIA (TECHO) UNIT"] ? "No calculable sin fuentes." : "Sin techo visible",
    };
  }

  const quantity = parseQuantity(row.Cant);
  const optimistic = Math.min(...sourcePriceValues);
  const moderate = sourcePriceValues.reduce((total, price) => total + price, 0) / sourcePriceValues.length;
  const weightedUnit = (optimistic + moderate) / 2;
  const weightedTotal = weightedUnit * quantity;
  const referenceUnit = parseCopMoney(row["PRECIO REFERENCIA (TECHO) UNIT"]);
  const viability =
    referenceUnit === null
      ? "Sin techo visible"
      : weightedUnit <= referenceUnit
        ? `Viable, margen estimado ${(((referenceUnit - weightedUnit) / referenceUnit) * 100).toFixed(2)}%`
        : `No viable, supera techo ${(((weightedUnit - referenceUnit) / referenceUnit) * 100).toFixed(2)}%`;

  return {
    ...row,
    "Costo Optimista": formatMoney(optimistic),
    "Costo Moderado": formatMoney(moderate),
    "COSTO PONDERADO UNIT": formatMoney(weightedUnit),
    "COSTO PONDERADO TOTAL": formatMoney(weightedTotal),
    "Viabilidad / Margen": viability,
  };
}

async function calculateMarketAnalysisResult(result: MarketAnalysisResult): Promise<MarketAnalysisResult> {
  const trm = await getOfficialTrmSnapshot();
  const internationalSources = result.rows
    .flatMap((row) => [row["Fuente 1 (Precio)"], row["Fuente 2 (Precio)"], row["Fuente 3 (Precio)"]])
    .map((source) => parseMarketSourceUnitPrice(source, trm.value))
    .filter((source) => source !== null && source.adjustedWithImportCost);

  return {
    rows: result.rows.map((row) => calculateMarketAnalysisRow(normalizeMarketAnalysisRow(row), trm)),
    warnings: result.warnings,
    provider_notes: Array.from(
      new Set([
        ...result.provider_notes,
        "Calculos financieros generados por la app a partir de las fuentes/precios unitarios devueltos por IA.",
        ...(internationalSources.length > 0
          ? [
              `Fuentes internacionales USD convertidas por la app con TRM ${trm.value} (${trm.date}) y factor de importacion ${INTERNATIONAL_IMPORT_FACTOR}. Fuente TRM: ${trm.source}.`,
            ]
          : []),
      ]),
    ),
  };
}

function resultHasAnySourcePrice(result: MarketAnalysisResult): boolean {
  return result.rows.some((row) =>
    [
      row["Fuente 1 (Precio)"],
      row["Fuente 2 (Precio)"],
      row["Fuente 3 (Precio)"],
    ].some(isMarketSourcePrice),
  );
}

function marketSourceCount(row: MarketAnalysisResult["rows"][number]): number {
  return [
    row["Fuente 1 (Precio)"],
    row["Fuente 2 (Precio)"],
    row["Fuente 3 (Precio)"],
  ].filter(isMarketSourcePrice).length;
}

function rowHasMarketSourcePrice(row: MarketAnalysisResult["rows"][number]): boolean {
  return marketSourceCount(row) > 0;
}

function sanitizeNonMarketSources(result: MarketAnalysisResult): MarketAnalysisResult {
  let removed = 0;
  const rows = result.rows.map((row) => {
    const next = { ...row };
    (["Fuente 1 (Precio)", "Fuente 2 (Precio)", "Fuente 3 (Precio)"] as const).forEach((field) => {
      const value = next[field];
      if (hasPricedSourceText(value) && !isMarketSourcePrice(value)) {
        next[field] = "N/D";
        removed += 1;
      }
    });
    return next;
  });

  return {
    ...result,
    rows,
    warnings:
      removed > 0
        ? Array.from(
            new Set([
              ...result.warnings,
              `FUENTES_DEPURADAS: se descartaron ${removed} precio(s) de documento/base/techo para no usarlos como mercado.`,
            ]),
          )
        : result.warnings,
  };
}

async function repairMissingMarketSources(input: {
  runId: string;
  providerConnection: ReturnType<typeof getActiveProviderConnectionForServer>;
  fileName: string;
  result: MarketAnalysisResult;
}) {
  if (input.providerConnection.provider !== "gemini") {
    return input.result;
  }

  const cleanedResult = sanitizeNonMarketSources(input.result);
  const rowsNeedingSources = cleanedResult.rows.filter((row) => marketSourceCount(row) < 3);
  if (rowsNeedingSources.length === 0) {
    return cleanedResult;
  }

  const repairPrompt = buildMarketAnalysisSourceRepairPrompt({
    fileName: input.fileName,
    rowsJson: JSON.stringify(
      {
        rows: rowsNeedingSources.map((row) => ({
          item: row["Ítem"],
          description: row["Nombre o descripción"],
          technical_description: row["Descripción o ficha técnica"],
          quantity: row.Cant,
          reference_unit: row["PRECIO REFERENCIA (TECHO) UNIT"],
          notes: row["Resumen de Fuentes y Observaciones"],
        })),
      },
      null,
      2,
    ),
  });

  const repairOutput = await runProviderStage({
    runId: input.runId,
    documentName: input.fileName,
    stageName: "ia_source_repair",
    providerConnection: input.providerConnection,
    prompt: repairPrompt,
    allowGrounding: true,
    thinkingLevel: "medium",
  });
  const repairedByItem = new Map(repairOutput.result.rows.map((row) => [row["Ítem"], row]));
  const nextRows = cleanedResult.rows.map((row) => {
    const repaired = repairedByItem.get(row["Ítem"]);
    if (!repaired) {
      return row;
    }

    return {
      ...row,
      "Fuente 1 (Precio)": isMarketSourcePrice(repaired["Fuente 1 (Precio)"])
        ? repaired["Fuente 1 (Precio)"]
        : isMarketSourcePrice(row["Fuente 1 (Precio)"])
          ? row["Fuente 1 (Precio)"]
          : "N/D",
      "Fuente 2 (Precio)": isMarketSourcePrice(repaired["Fuente 2 (Precio)"])
        ? repaired["Fuente 2 (Precio)"]
        : isMarketSourcePrice(row["Fuente 2 (Precio)"])
          ? row["Fuente 2 (Precio)"]
          : "N/D",
      "Fuente 3 (Precio)": isMarketSourcePrice(repaired["Fuente 3 (Precio)"])
        ? repaired["Fuente 3 (Precio)"]
        : isMarketSourcePrice(row["Fuente 3 (Precio)"])
          ? row["Fuente 3 (Precio)"]
          : "N/D",
      "Resumen de Fuentes y Observaciones": [row["Resumen de Fuentes y Observaciones"], repaired["Resumen de Fuentes y Observaciones"]]
        .filter(Boolean)
        .join(" | "),
    };
  });
  const sanitizedRows = sanitizeNonMarketSources({ ...cleanedResult, rows: nextRows }).rows;
  const stillMissing = sanitizedRows.filter((row) => marketSourceCount(row) < 3);

  return {
    rows: sanitizedRows,
    warnings: Array.from(
      new Set([
        ...cleanedResult.warnings,
        ...repairOutput.result.warnings,
        `SEGUNDA_PASADA_FUENTES: ${rowsNeedingSources.length} item(s) se enviaron a busqueda adicional de precios.`,
        ...(stillMissing.length > 0
          ? [`FUENTES_INCOMPLETAS: ${stillMissing.length} item(s) siguen con menos de 3 precios de mercado externos defendibles.`]
          : []),
      ]),
    ),
    provider_notes: Array.from(
      new Set([
        ...input.result.provider_notes,
        ...repairOutput.result.provider_notes,
        "Se ejecuto una segunda pasada IA-first para completar fuentes de mercado faltantes.",
      ]),
    ),
  };
}

async function runAiFirstChunkedMarketAnalysis(input: {
  runId: string;
  providerConnection: ReturnType<typeof getActiveProviderConnectionForServer>;
  fileName: string;
  fileType: FileType;
  documentText: string;
  expectedItemCount: number | null;
}) {
  const chunks = splitDocumentTextForAi(input.documentText);
  const partialRows: MarketAnalysisResult["rows"] = [];
  const warnings: string[] = [
    `Flujo IA-first por fragmentos activado: ${chunks.length} partes enviadas al modelo para evitar respuestas resumidas.`,
  ];
  const providerNotes: string[] = [];
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const [chunkIndex, documentChunk] of chunks.entries()) {
    const chunkPrompt = buildMarketAnalysisChunkPrompt({
      fileName: input.fileName,
      fileType: input.fileType,
      chunkIndex,
      chunkTotal: chunks.length,
      documentChunk,
    });
    const chunkOutput = await runProviderStage({
      runId: input.runId,
      documentName: input.fileName,
      stageName: `ia_chunk_${chunkIndex + 1}_of_${chunks.length}`,
      providerConnection: input.providerConnection,
      prompt: chunkPrompt,
      allowGrounding: true,
      retryCount: chunkIndex,
    });

    latencyMs += chunkOutput.usage.latencyMs;
    inputTokens += chunkOutput.usage.inputTokens ?? 0;
    outputTokens += chunkOutput.usage.outputTokens ?? 0;
    partialRows.push(...chunkOutput.result.rows);
    warnings.push(...chunkOutput.result.warnings.map((warning) => `Fragmento ${chunkIndex + 1}: ${warning}`));
    providerNotes.push(...chunkOutput.result.provider_notes.map((note) => `Fragmento ${chunkIndex + 1}: ${note}`));
  }

  if (chunks.length === 1) {
    const result: MarketAnalysisResult = {
      rows: partialRows,
      warnings: Array.from(new Set(warnings)),
      provider_notes: Array.from(
        new Set([
          ...providerNotes,
          "Flujo IA-first de una etapa: extraccion documental completa, sin benchmarking externo.",
          `Filas finales generadas por IA: ${partialRows.length}.`,
        ]),
      ),
    };

    if (hasIncompleteSampleLanguage(result)) {
      throw new Error(
        "La IA devolvio lenguaje de muestra o seleccion parcial. Se detuvo la corrida para no aceptar un resultado incompleto.",
      );
    }

    return {
      result,
      usage: {
        provider: input.providerConnection.provider,
        model: input.providerConnection.model,
        latencyMs,
        inputTokens,
        outputTokens,
        finishReason: null,
        grounded: false,
        groundingSources: [],
      },
    };
  }

  const consolidationPrompt = buildMarketAnalysisConsolidationPrompt({
    fileName: input.fileName,
    partialRowsJson: JSON.stringify({ rows: partialRows }, null, 2),
  });
  const consolidatedOutput = await runProviderStage({
    runId: input.runId,
    documentName: input.fileName,
    stageName: "ia_chunk_consolidation",
    providerConnection: input.providerConnection,
    prompt: consolidationPrompt,
    allowGrounding: false,
  });

  latencyMs += consolidatedOutput.usage.latencyMs;
  inputTokens += consolidatedOutput.usage.inputTokens ?? 0;
  outputTokens += consolidatedOutput.usage.outputTokens ?? 0;

  const result: MarketAnalysisResult = {
    rows: consolidatedOutput.result.rows,
    warnings: Array.from(
      new Set([
        ...warnings,
        ...consolidatedOutput.result.warnings,
        ...buildCoverageWarnings(consolidatedOutput.result, input.expectedItemCount),
      ]),
    ),
    provider_notes: Array.from(
      new Set([
        ...providerNotes,
        ...consolidatedOutput.result.provider_notes,
        `Filas parciales generadas por IA antes de consolidar: ${partialRows.length}.`,
        `Filas finales consolidadas por IA: ${consolidatedOutput.result.rows.length}.`,
      ]),
    ),
  };

  if (hasIncompleteSampleLanguage(result)) {
    throw new Error(
      "La IA devolvio lenguaje de muestra o seleccion parcial. Se detuvo la corrida para no aceptar un resultado incompleto.",
    );
  }

  return {
    result,
    usage: {
      provider: input.providerConnection.provider,
      model: input.providerConnection.model,
      latencyMs,
      inputTokens,
      outputTokens,
      finishReason: consolidatedOutput.usage.finishReason,
      grounded: false,
      groundingSources: [],
    },
  };
}

async function runNativePdfMarketAnalysis(input: {
  runId: string;
  providerConnection: ReturnType<typeof getActiveProviderConnectionForServer>;
  fileName: string;
  uploadedFilePath: string;
  sourceSummary: string;
  expectedItemCount: number | null;
}) {
  const prompt = buildNativePdfMarketAnalysisPrompt({
    fileName: input.fileName,
    sourceSummary: input.sourceSummary,
    expectedItemHint: input.expectedItemCount,
  });
  const geminiFile = await uploadGeminiFile({
    baseUrl: input.providerConnection.baseUrl,
    apiKey: input.providerConnection.apiKey,
    filePath: input.uploadedFilePath,
    mimeType: "application/pdf",
    displayName: input.fileName,
  });
  const countedTokens = await countGeminiTokens({
    baseUrl: input.providerConnection.baseUrl,
    apiKey: input.providerConnection.apiKey,
    model: input.providerConnection.model,
    prompt,
    geminiFile,
  }).catch(() => null);
  const output = await runProviderStage({
    runId: input.runId,
    documentName: input.fileName,
    stageName: "ia_native_pdf_generate",
    providerConnection: input.providerConnection,
    prompt,
    allowGrounding: true,
    geminiFile,
    thinkingLevel: "high",
  });

  const result: MarketAnalysisResult = {
    rows: output.result.rows,
    warnings: Array.from(new Set([...output.result.warnings, ...buildCoverageWarnings(output.result, input.expectedItemCount)])),
    provider_notes: Array.from(
      new Set([
        ...output.result.provider_notes,
        "Flujo Gemini PDF nativo: el archivo se envio como PDF a Gemini, no solo como texto extraido.",
        countedTokens ? `Conteo previo Gemini: ${countedTokens} tokens aproximados.` : "Conteo previo Gemini no disponible.",
        input.expectedItemCount ? `Auditoria local previa: cerca de ${input.expectedItemCount} items esperados.` : "Auditoria local previa sin conteo confiable.",
      ]),
    ),
  };

  if (hasIncompleteSampleLanguage(result)) {
    throw new Error(
      "La IA devolvio lenguaje de muestra o seleccion parcial en PDF nativo. Se detuvo la corrida para no aceptar un resultado incompleto.",
    );
  }

  return {
    result,
    usage: {
      ...output.usage,
      inputTokens: output.usage.inputTokens ?? countedTokens,
    },
  };
}

function createMockResult(documentText: string) {
  const rows = documentText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return normalizeMarketAnalysisRow({
        "Ítem": cells[0] ?? "",
        "Nombre o descripción": cells[1] ?? "",
        "Descripción o ficha técnica": cells[1] ?? "",
        "Cant": "",
        "Análisis de Ficha": "Pendiente de análisis con IA real.",
        "Fuente 1 (Precio)": "N/D",
        "Fuente 2 (Precio)": "N/D",
        "Fuente 3 (Precio)": "N/D",
        "Costo Optimista": "N/D",
        "Costo Moderado": "N/D",
        "COSTO PONDERADO UNIT": "N/D",
        "COSTO PONDERADO TOTAL": "N/D",
        "PRECIO REFERENCIA (TECHO) UNIT": cells[cells.length - 1] ?? "",
        "Viabilidad / Margen": "N/D",
        "Resumen de Fuentes y Observaciones": "Mock local: no se consultaron fuentes de mercado.",
      });
    });

  return {
    rows,
    warnings: ["Resultado generado en modo mock local; no contiene benchmarking real."],
    provider_notes: ["Configura una API con crédito disponible para análisis comercial real."],
  };
}

export class MarketAnalysisService {
  constructor(
    private readonly store = new MarketAnalysisStore(),
    private readonly uploadsDirectory = uploadsRoot(),
  ) {}

  async startUpload(request: {
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    odooProjectId?: number | null;
    odooProjectName?: string | null;
  }): Promise<MarketAnalysisRun> {
    const runId = randomUUID();
    const fileType = normalizeFileType(request.fileName, request.mimeType);
    const uploadDirectory = resolve(this.uploadsDirectory, runId);
    await mkdir(uploadDirectory, { recursive: true });
    const uploadedFilePath = resolve(uploadDirectory, request.fileName);
    await writeFile(uploadedFilePath, request.bytes);

    const startedAt = toIsoNow();
    const uploadStageStartedAt = startMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "upload_local",
      model: null,
    });
    finishMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "upload_local",
      startedAt: uploadStageStartedAt,
      parsedJson: {
        uploadedFilePath,
        fileType,
        sizeBytes: request.bytes.length,
        sha256: buildChecksum(request.bytes),
      },
      status: "completed",
      model: null,
    });

    const providerConnection = getActiveProviderConnectionForServer();
    const processingRun = this.store.save({
      runId,
      odooProjectId: request.odooProjectId ?? null,
      odooProjectName: request.odooProjectName?.trim() || null,
      fileName: request.fileName,
      fileType,
      status: "processing",
      createdAt: startedAt,
      updatedAt: startedAt,
      provider: providerConnection.provider,
      model: providerConnection.model,
      promptVersion: MARKET_ANALYSIS_PROMPT_VERSION,
      rowCount: 0,
      uploadedFilePath,
      sourceSummary: `Archivo recibido. Procesamiento IA en curso.\nSHA256: ${buildChecksum(request.bytes)}`,
      result: {
        rows: [],
        warnings: ["PROCESSING_STARTED: el analisis fue recibido y sigue en ejecucion."],
        provider_notes: [],
      },
      groundingSources: [],
      usage: null,
      errorMessage: null,
    });

    const job = this.processUpload({ ...request, runId })
      .catch((error) => {
        if (error && typeof error === "object" && "runId" in error) {
          return this.store.get(runId) ?? processingRun;
        }
        throw error;
      })
      .finally(() => {
        activeMarketAnalysisJobs.delete(runId);
      });
    activeMarketAnalysisJobs.set(runId, job);

    return processingRun;
  }

  async processUpload(request: {
    runId?: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    odooProjectId?: number | null;
    odooProjectName?: string | null;
  }): Promise<MarketAnalysisRun> {
    const runId = request.runId ?? randomUUID();
    const fileType = normalizeFileType(request.fileName, request.mimeType);
    const uploadDirectory = resolve(this.uploadsDirectory, runId);
    await mkdir(uploadDirectory, { recursive: true });
    const uploadedFilePath = resolve(uploadDirectory, request.fileName);
    await writeFile(uploadedFilePath, request.bytes);

    const uploadStageStartedAt = startMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "upload_local",
      model: null,
    });
    finishMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "upload_local",
      startedAt: uploadStageStartedAt,
      parsedJson: {
        uploadedFilePath,
        fileType,
        sizeBytes: request.bytes.length,
        sha256: buildChecksum(request.bytes),
      },
      status: "completed",
      model: null,
    });

    const segmentStageStartedAt = startMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "segment_document",
      model: null,
    });
    let segments: Awaited<ReturnType<typeof segmentDocumentFromFile>>;
    try {
      segments = await segmentDocumentFromFile({
        documentId: runId,
        filePath: uploadedFilePath,
        fileType,
      });
      finishMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "segment_document",
        startedAt: segmentStageStartedAt,
        parsedJson: { segmentCount: segments.length },
        status: "completed",
        model: null,
      });
    } catch (error) {
      finishMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "segment_document",
        startedAt: segmentStageStartedAt,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Error segmentando documento.",
        model: null,
      });
      throw error;
    }
    const sourceSummary = buildSourceSummary(segments);
    const documentText = buildDocumentText(segments);
    const providerConnection = getActiveProviderConnectionForServer();
    const expectedItemCount = estimateExpectedItemCount(segments, documentText);
    const enrichedSourceSummary = [
      sourceSummary,
      expectedItemCount ? `Conteo local estimado de items: ${expectedItemCount}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const prompt = buildMarketAnalysisPrompt({
      fileName: request.fileName,
      fileType,
      sourceSummary: enrichedSourceSummary,
      documentText,
    });
    const promptStageStartedAt = startMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "build_prompt",
      prompt,
      model: providerConnection.model,
    });
    finishMarketAnalysisStage({
      runId,
      documentName: request.fileName,
      stageName: "build_prompt",
      startedAt: promptStageStartedAt,
      prompt,
      parsedJson: {
        promptVersion: MARKET_ANALYSIS_PROMPT_VERSION,
        promptChars: prompt.length,
        documentChars: documentText.length,
        expectedItemCount,
      },
      status: "completed",
      model: providerConnection.model,
    });

    const startedAt = toIsoNow();
    try {
      let providerOutput: Pick<Awaited<ReturnType<typeof runMarketAnalysisProvider>>, "result" | "usage">;

      if (process.env.AI_FIRST_FORCE_MARKET_MOCK === "true" || process.env.AI_FIRST_FORCE_MOCK === "1") {
        providerOutput = {
          result: createMockResult(documentText),
          usage: {
            provider: providerConnection.provider,
            model: providerConnection.model,
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            finishReason: "mock",
            grounded: false,
            groundingSources: [],
          },
        };
      } else if (
        providerConnection.provider === "gemini" &&
        process.env.AI_FIRST_USE_STAGED_PIPELINE !== "false"
      ) {
        try {
          const stagedOutput = await runStagedMarketAnalysisPipeline({
            runId,
            fileName: request.fileName,
            fileType,
            sourceSummary: enrichedSourceSummary,
            documentText,
            providerConnection,
            expectedItemCount,
          });

          if (stagedOutput.result.rows.length === 0) {
            throw new Error("El pipeline IA-first por etapas no produjo filas finales.");
          }

          providerOutput = stagedOutput;
        } catch (stagedPipelineError) {
          providerOutput = await runProviderStage({
            runId,
            documentName: request.fileName,
            stageName: "legacy_full_run_after_staged_pipeline",
            providerConnection,
            prompt,
            allowGrounding: true,
            thinkingLevel: "high",
          });
          providerOutput.result.warnings = Array.from(
            new Set([
              ...providerOutput.result.warnings,
              `STAGED_PIPELINE_FALLBACK: ${stagedPipelineError instanceof Error ? stagedPipelineError.message : "fallo pipeline por etapas"}. Se uso flujo legacy completo.`,
            ]),
          );
        }
      } else if (providerConnection.provider === "gemini" && fileType === "pdf") {
        try {
          providerOutput = await runNativePdfMarketAnalysis({
            runId,
            providerConnection,
            fileName: request.fileName,
            uploadedFilePath,
            sourceSummary: enrichedSourceSummary,
            expectedItemCount,
          });
        } catch (nativePdfError) {
          try {
            providerOutput = await runProviderStage({
                runId,
                documentName: request.fileName,
                stageName: "ia_text_fallback_after_pdf",
                providerConnection,
                prompt,
                allowGrounding: true,
                thinkingLevel: "high",
            });
          } catch (textFallbackError) {
            providerOutput = shouldUseAiFirstPipeline(documentText)
              ? await runAiFirstChunkedMarketAnalysis({
                  runId,
                  providerConnection,
                  fileName: request.fileName,
                  fileType,
                  documentText,
                  expectedItemCount,
                })
              : (() => {
                  throw textFallbackError;
                })();
          }
          providerOutput.result.warnings = Array.from(
            new Set([
              ...providerOutput.result.warnings,
              `PDF_NATIVO_FALLBACK: ${nativePdfError instanceof Error ? nativePdfError.message : "fallo PDF nativo"}. Se uso extraccion textual.`,
            ]),
          );
        }
      } else {
        const countedTokens =
          providerConnection.provider === "gemini"
            ? await countGeminiTokens({
                baseUrl: providerConnection.baseUrl,
                apiKey: providerConnection.apiKey,
                model: providerConnection.model,
                prompt,
              }).catch(() => null)
            : null;
        try {
          providerOutput = await runProviderStage({
            runId,
            documentName: request.fileName,
            stageName: "ia_full_run",
            providerConnection,
            prompt,
            allowGrounding: true,
            thinkingLevel: providerConnection.provider === "gemini" ? "high" : "medium",
          });
        } catch (fullRunError) {
          if (providerConnection.provider !== "gemini" || !shouldUseAiFirstPipeline(documentText)) {
            throw fullRunError;
          }

          providerOutput = await runAiFirstChunkedMarketAnalysis({
            runId,
            providerConnection,
            fileName: request.fileName,
            fileType,
            documentText,
            expectedItemCount,
          });
          providerOutput.result.warnings = Array.from(
            new Set([
              ...providerOutput.result.warnings,
              `FULL_RUN_FALLBACK: ${fullRunError instanceof Error ? fullRunError.message : "fallo corrida completa"}. Se uso fragmentacion como ultima opcion.`,
            ]),
          );
        }
        providerOutput.usage.inputTokens = providerOutput.usage.inputTokens ?? countedTokens;
      }

      if (process.env.AI_FIRST_ENABLE_SOURCE_REPAIR === "true") {
        providerOutput.result = await repairMissingMarketSources({
          runId,
          providerConnection,
          fileName: request.fileName,
          result: providerOutput.result,
        });
      } else {
        providerOutput.result = sanitizeNonMarketSources(providerOutput.result);
      }
      if (providerOutput.usage.groundingSources.length === 0) {
        providerOutput.usage.grounded = false;
        if (providerOutput.result.provider_notes.some((note) => /busqueda web|búsqueda web|segunda pasada/i.test(note))) {
          providerOutput.result.warnings = Array.from(
            new Set([
              ...providerOutput.result.warnings,
              "GROUNDING_NO_VERIFICADO: la IA reporto busqueda o segunda pasada, pero el proveedor no entrego fuentes de grounding verificables.",
            ]),
          );
        }
      }

      if (providerOutput.result.rows.length > 0 && !resultHasAnySourcePrice(providerOutput.result)) {
        throw new Error(
          "La IA no devolvio ninguna fuente/precio util. La corrida se marco como fallida para evitar un resultado vacio.",
        );
      }

      const calculateStageStartedAt = startMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "calculate_financials",
        model: providerOutput.usage.model,
      });
      const calculatedResult = await calculateMarketAnalysisResult(providerOutput.result);
      const qualityGate = evaluateMarketAnalysisRunQuality({
        result: calculatedResult,
        usage: providerOutput.usage,
        stages: getMarketAnalysisStages(runId),
      });
      const persistedWarnings = Array.from(new Set([...calculatedResult.warnings, ...qualityGate.warnings]));
      finishMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "calculate_financials",
        startedAt: calculateStageStartedAt,
        parsedJson: {
          rows: calculatedResult.rows.length,
          warnings: calculatedResult.warnings.length,
          providerNotes: calculatedResult.provider_notes.length,
        },
        status: "completed",
        model: providerOutput.usage.model,
      });

      const persistStageStartedAt = startMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "persist_run",
        model: providerOutput.usage.model,
      });
      const completedRun = this.store.save({
        runId,
        odooProjectId: request.odooProjectId ?? null,
        odooProjectName: request.odooProjectName?.trim() || null,
        fileName: request.fileName,
        fileType,
        status: qualityGate.status,
        createdAt: startedAt,
        updatedAt: toIsoNow(),
        provider: providerConnection.provider,
        model: providerOutput.usage.model,
        promptVersion: MARKET_ANALYSIS_PROMPT_VERSION,
        rowCount: calculatedResult.rows.length,
        uploadedFilePath,
        sourceSummary: `${enrichedSourceSummary}\nSHA256: ${buildChecksum(request.bytes)}`,
        result: {
          rows: calculatedResult.rows,
          warnings: persistedWarnings,
          provider_notes: calculatedResult.provider_notes,
        },
        groundingSources: providerOutput.usage.groundingSources,
        usage: {
          latencyMs: providerOutput.usage.latencyMs,
          inputTokens: providerOutput.usage.inputTokens,
          outputTokens: providerOutput.usage.outputTokens,
          finishReason: providerOutput.usage.finishReason,
          grounded: providerOutput.usage.grounded,
        },
        errorMessage: null,
      });
      finishMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "persist_run",
        startedAt: persistStageStartedAt,
        parsedJson: {
          status: completedRun.status,
          rowCount: completedRun.rowCount,
          unresolvedFailedStages: qualityGate.unresolvedFailedStages,
        },
        status: "completed",
        model: providerOutput.usage.model,
      });

      return completedRun;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado procesando el análisis de mercado.";
      const failedStageStartedAt = startMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "persist_failed_run",
        model: providerConnection.model,
      });
      const failedRun = this.store.save({
        runId,
        odooProjectId: request.odooProjectId ?? null,
        odooProjectName: request.odooProjectName?.trim() || null,
        fileName: request.fileName,
        fileType,
        status: "failed",
        createdAt: startedAt,
        updatedAt: toIsoNow(),
        provider: providerConnection.provider,
        model: providerConnection.model,
        promptVersion: MARKET_ANALYSIS_PROMPT_VERSION,
        rowCount: 0,
        uploadedFilePath,
        sourceSummary: `${enrichedSourceSummary}\nSHA256: ${buildChecksum(request.bytes)}`,
        result: {
          rows: [],
          warnings: [message],
          provider_notes: [],
        },
        groundingSources: [],
        usage: null,
        errorMessage: message,
      });
      finishMarketAnalysisStage({
        runId,
        documentName: request.fileName,
        stageName: "persist_failed_run",
        startedAt: failedStageStartedAt,
        parsedJson: { status: failedRun.status, errorMessage: failedRun.errorMessage },
        status: "completed",
        model: providerConnection.model,
      });

      throw Object.assign(new Error(message), { runId: failedRun.runId });
    }
  }

  getRun(runId: string): MarketAnalysisRun | null {
    return this.store.get(runId);
  }

  listRuns(limit = 8): MarketAnalysisRun[] {
    return this.store.list(limit);
  }

  getRunStages(runId: string) {
    return getMarketAnalysisStages(runId);
  }

  buildDebugReport(runId: string): string {
    return buildMarketAnalysisDebugReport({ runId, run: this.getRun(runId) });
  }

  registerFixture(runId: string): string {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`No existe el análisis: ${runId}`);
    }

    return registerMarketAnalysisFixture({
      runId,
      documentName: run.fileName,
      uploadedFilePath: run.uploadedFilePath,
      metadata: {
        run,
        stages: this.getRunStages(runId),
      },
    });
  }

  async retryRun(runId: string): Promise<MarketAnalysisRun> {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`No existe el análisis: ${runId}`);
    }

    const bytes = await readFile(run.uploadedFilePath);
    return this.processUpload({
      fileName: run.fileName,
      mimeType: "application/octet-stream",
      bytes,
      odooProjectId: run.odooProjectId,
      odooProjectName: run.odooProjectName,
    });
  }

  async retryRunStage(runId: string, stageName: string) {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`No existe el anÃ¡lisis: ${runId}`);
    }

    const stage = this.getRunStages(runId)
      .filter((candidate) => candidate.stage_name === stageName && candidate.prompt)
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];

    if (!stage?.prompt) {
      throw new Error(`No hay prompt guardado para reintentar la etapa ${stageName}.`);
    }

    return retryStagedMarketAnalysisStage({
      runId,
      fileName: run.fileName,
      stageName,
      prompt: stage.prompt,
      providerConnection: getActiveProviderConnectionForServer(),
      retryCount: stage.retry_count + 1,
    });
  }

  exportRun(runId: string, format: "json" | "csv" | "xlsx", view: "market" | "financial" = "market") {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`No existe el análisis: ${runId}`);
    }

    if (view === "financial") {
      const simulation = buildOfferSimulation(run.result.rows, buildInitialOfferControls(run.result.rows));
      const exportRows = toOfferExportRows(simulation);

      if (format === "json") {
        return {
          fileName: `${run.fileName}.financial-simulation.json`,
          mimeType: "application/json",
          body: Buffer.from(JSON.stringify({ summary: simulation.summary, rows: exportRows }, null, 2), "utf8"),
        };
      }

      if (format === "csv") {
        const parser = new Json2CsvParser({
          fields: [
            "item",
            "description",
            "unit",
            "quantity",
            "costUnit",
            "referenceUnit",
            "referenceTotal",
            "costTotal",
            "costVsReferencePct",
            "maxProfitPctBeforeCeiling",
            "selectedProfitPct",
            "offerUnit",
            "offerTotal",
            "ceilingOk",
            "discountPctVsReference",
            "status",
            "warnings",
            "sourceNotes",
          ],
        });
        return {
          fileName: `${run.fileName}.financial-simulation.csv`,
          mimeType: "text/csv; charset=utf-8",
          body: Buffer.from(parser.parse(exportRows), "utf8"),
        };
      }

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Oferta");
      const body = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      }) as Buffer;

      return {
        fileName: `${run.fileName}.financial-simulation.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body,
      };
    }

    if (format === "json") {
      return {
        fileName: `${run.fileName}.market-analysis.json`,
        mimeType: "application/json",
        body: Buffer.from(JSON.stringify(run.result, null, 2), "utf8"),
      };
    }

    if (format === "csv") {
      const parser = new Json2CsvParser({ fields: [...MARKET_ANALYSIS_COLUMNS] });
      return {
        fileName: `${run.fileName}.market-analysis.csv`,
        mimeType: "text/csv; charset=utf-8",
        body: Buffer.from(parser.parse(run.result.rows), "utf8"),
      };
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(run.result.rows, {
      header: [...MARKET_ANALYSIS_COLUMNS],
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, "Matriz");
    const body = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    return {
      fileName: `${run.fileName}.market-analysis.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
    };
  }
}

let singleton: MarketAnalysisService | null = null;

export function getMarketAnalysisService() {
  singleton ??= new MarketAnalysisService();
  return singleton;
}
