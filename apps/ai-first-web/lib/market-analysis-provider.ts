import "server-only";

import { readFile } from "node:fs/promises";

import type { AiProvider } from "@ai-first-contracts/enums";
import { parseJsonFromText } from "@ai-first-core/providers/shared/json";
import { ProviderHttpError, postJson } from "@ai-first-core/providers/shared/http";

import {
  MarketAnalysisTransportResultSchema,
  normalizeMarketAnalysisTransportPayload,
  normalizeMarketAnalysisTransportResult,
  type MarketAnalysisResult,
} from "./market-analysis-schema";

interface MarketAnalysisProviderInput {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  prompt: string;
  allowGrounding?: boolean;
  geminiFile?: GeminiFileReference;
  thinkingLevel?: "low" | "medium" | "high";
}

interface ProviderUsage {
  provider: AiProvider;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  grounded: boolean;
  groundingSources: Array<{ title: string | null; uri: string | null }>;
}

interface MarketAnalysisProviderOutput {
  result: MarketAnalysisResult;
  rawText: string;
  rawResponse: unknown;
  usage: ProviderUsage;
}

export interface GeminiFileReference {
  fileUri: string;
  mimeType: string;
  name?: string;
}

interface GeminiUploadResponse {
  file?: {
    name?: string;
    uri?: string;
    mimeType?: string;
    mime_type?: string;
    state?: string;
  };
}

interface GeminiTokenCountResponse {
  totalTokens?: number;
  total_tokens?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface OpenAiResponse {
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

type GeminiRequestMode = "grounded_schema" | "grounded_json" | "grounded_text" | "plain_schema";

const GEMINI_TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const GEMINI_GENERATE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
const DEFAULT_GEMINI_FIRST_SIGNAL_TIMEOUT_MS = 120_000;
const DEFAULT_GEMINI_STREAM_IDLE_TIMEOUT_MS = 60_000;
const GEMINI_FIRST_SIGNAL_TIMEOUT_MS = Number(
  process.env.AI_FIRST_GEMINI_FIRST_SIGNAL_TIMEOUT_MS ?? DEFAULT_GEMINI_FIRST_SIGNAL_TIMEOUT_MS,
);
const GEMINI_STREAM_IDLE_TIMEOUT_MS = Number(
  process.env.AI_FIRST_GEMINI_STREAM_IDLE_TIMEOUT_MS ?? DEFAULT_GEMINI_STREAM_IDLE_TIMEOUT_MS,
);
const GEMINI_ANALYSIS_FALLBACKS: Record<string, string[]> = {
  "gemini-3.1-pro-preview": ["gemini-3.1-flash-lite-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
  "gemini-3.1-flash-lite-preview": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "gemini-3-flash-preview": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "gemini-2.5-pro": ["gemini-2.5-flash"],
};

const MARKET_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Numero o codigo del item visible en el documento." },
          description: { type: "string", description: "Nombre o descripcion corta del item." },
          technical_description: { type: "string", description: "Ficha tecnica o descripcion tecnica completa reconstruida." },
          quantity: { type: "string", description: "Cantidad y unidad de medida como aparece en el documento." },
          fit_analysis: { type: "string", description: "Lectura tecnica breve del item; no debe incluir calculos financieros." },
          source_1: {
            type: "string",
            description:
              "Primera fuente externa de mercado. Formato Colombia: [COLOMBIA] proveedor | COP valor | URL. Formato internacional: [INTERNACIONAL] proveedor | USD valor | pais | URL.",
          },
          source_2: {
            type: "string",
            description:
              "Segunda fuente externa de mercado. No usar precio techo, promedio, documento base ni cotizaciones internas.",
          },
          source_3: {
            type: "string",
            description:
              "Tercera fuente externa de mercado. Si es internacional conserva USD; la app calcula TRM e importacion.",
          },
          reference_unit: {
            type: "string",
            description:
              "Precio techo, presupuesto unitario, promedio unitario o referencia unitario tomado/calculado desde el documento. No usar fuentes externas.",
          },
          notes: {
            type: "string",
            description:
              "Notas de trazabilidad por item: proveedor, fuente documental, dudas, comparabilidad, FUENTE_INTERNACIONAL, MONEDA=USD y APP_DEBE_CONVERTIR_TRM_MAS_30 cuando aplique.",
          },
        },
        required: [
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
        ],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    provider_notes: { type: "array", items: { type: "string" } },
  },
  required: ["rows"],
  additionalProperties: false,
} as const;

function isGemini3Model(model: string): boolean {
  return /^gemini-3(?:\.|-)/.test(model);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerErrorMessage(error: unknown): string {
  if (
    error instanceof ProviderHttpError &&
    error.responseBody &&
    typeof error.responseBody === "object" &&
    "error" in error.responseBody &&
    error.responseBody.error &&
    typeof error.responseBody.error === "object" &&
    "message" in error.responseBody.error &&
    typeof error.responseBody.error.message === "string"
  ) {
    return error.responseBody.error.message;
  }

  return error instanceof Error ? error.message : "Error desconocido consultando Gemini.";
}

function isTransientGeminiError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) {
    return GEMINI_TRANSIENT_STATUSES.has(error.status);
  }

  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    return (
      error.name === "AbortError" ||
      normalizedMessage.includes("aborted") ||
      normalizedMessage.includes("fetch failed") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("unexpected end of json input") ||
      normalizedMessage.includes("invalid json") ||
      normalizedMessage.includes("econnreset") ||
      normalizedMessage.includes("etimedout")
    );
  }

  return false;
}

function isConfirmedGeminiModelNegative(error: unknown): boolean {
  if (error instanceof ProviderHttpError) {
    if (GEMINI_TRANSIENT_STATUSES.has(error.status)) {
      return true;
    }

    const message = providerErrorMessage(error).toLowerCase();
    return error.status === 404 && (message.includes("not found") || message.includes("is not found"));
  }

  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    return (
      error.name === "AbortError" ||
      normalizedMessage.includes("high demand") ||
      normalizedMessage.includes("unavailable") ||
      normalizedMessage.includes("overloaded") ||
      normalizedMessage.includes("aborted") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("fetch failed") ||
      normalizedMessage.includes("econnreset") ||
      normalizedMessage.includes("etimedout") ||
      normalizedMessage.includes("no envio actividad") ||
      normalizedMessage.includes("no envio primera señal") ||
      normalizedMessage.includes("supero el maximo total") ||
      normalizedMessage.includes("respondio sin texto util")
    );
  }

  return false;
}

function buildGeminiModelFallbackOrder(model: string): string[] {
  return Array.from(new Set([model, ...(GEMINI_ANALYSIS_FALLBACKS[model] ?? [])]));
}

function geminiStreamTotalTimeoutMs(model: string): number {
  if (model === "gemini-3.1-pro-preview" || model === "gemini-2.5-pro") {
    return Number(process.env.AI_FIRST_GEMINI_PRO_TOTAL_TIMEOUT_MS ?? 10 * 60_000);
  }

  return Number(process.env.AI_FIRST_GEMINI_FLASH_TOTAL_TIMEOUT_MS ?? 8 * 60_000);
}

async function withGeminiGenerateRetries<T>(args: {
  model: string;
  mode: GeminiRequestMode;
  retryWarnings: string[];
  operation: () => Promise<T>;
}): Promise<T> {
  const maxAttempts = isGemini3Model(args.model) ? 2 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await args.operation();
    } catch (error) {
      lastError = error;
      if (!isTransientGeminiError(error) || attempt === maxAttempts) {
        break;
      }

      args.retryWarnings.push(
        `Gemini ${args.model} respondio con error transitorio en ${args.mode} (intento ${attempt}/${maxAttempts}): ${providerErrorMessage(error)}. Se reintento automaticamente.`,
      );
      await sleep(GEMINI_GENERATE_RETRY_DELAYS_MS[attempt - 1] ?? 60_000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini no respondio de forma estable.");
}

function geminiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function buildGeminiParts(input: Pick<MarketAnalysisProviderInput, "prompt" | "geminiFile">) {
  return [
    input.geminiFile
      ? {
          file_data: {
            mime_type: input.geminiFile.mimeType,
            file_uri: input.geminiFile.fileUri,
          },
        }
      : null,
    { text: input.prompt },
  ].filter(Boolean);
}

async function probeGeminiModelAvailability(input: Pick<MarketAnalysisProviderInput, "baseUrl" | "apiKey"> & { model: string }) {
  if (!input.apiKey || !isGemini3Model(input.model)) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(`${geminiBaseUrl(input.baseUrl)}/v1beta/models/${input.model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Return this JSON exactly: {"ok": true}' }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: "low",
            includeThoughts: true,
          },
        },
      }),
    });

    if (!response.ok) {
      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text().catch(() => null);
      }

      throw new ProviderHttpError(`Gemini ${input.model} no acepto la prueba de disponibilidad (${response.status}).`, response.status, responseBody);
    }

    await response.body?.cancel();
  } finally {
    clearTimeout(timeout);
  }
}

function buildGeminiGenerationConfig(input: MarketAnalysisProviderInput, mode: GeminiRequestMode) {
  return {
    temperature: 0,
    maxOutputTokens: 65_000,
    ...(isGemini3Model(input.model)
      ? { thinkingConfig: { thinkingLevel: input.thinkingLevel ?? "medium", includeThoughts: true } }
      : {}),
    ...(mode === "grounded_text" ? {} : { responseMimeType: "application/json" }),
    ...((mode === "grounded_schema" || mode === "plain_schema") ? { responseJsonSchema: MARKET_ANALYSIS_JSON_SCHEMA } : {}),
  };
}

export async function uploadGeminiFile(input: {
  baseUrl: string;
  apiKey: string | null;
  filePath: string;
  mimeType: string;
  displayName: string;
}): Promise<GeminiFileReference> {
  if (!input.apiKey) {
    throw new Error("No hay API key configurada para subir el PDF a Gemini.");
  }

  const bytes = await readFile(input.filePath);
  const startResponse = await fetch(`${geminiBaseUrl(input.baseUrl)}/upload/v1beta/files?key=${input.apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": input.mimeType,
    },
    body: JSON.stringify({ file: { display_name: input.displayName } }),
  });

  if (!startResponse.ok) {
    throw new Error(`Gemini no acepto iniciar la carga del archivo (${startResponse.status}).`);
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini no devolvio URL de carga para el archivo.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Gemini no acepto el archivo PDF (${uploadResponse.status}).`);
  }

  const uploaded = (await uploadResponse.json()) as GeminiUploadResponse;
  const file = uploaded.file;
  const fileUri = file?.uri;
  if (!fileUri) {
    throw new Error("Gemini no devolvio URI del archivo subido.");
  }

  return {
    fileUri,
    mimeType: file.mimeType ?? file.mime_type ?? input.mimeType,
    name: file.name,
  };
}

export async function countGeminiTokens(input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  prompt: string;
  geminiFile?: GeminiFileReference;
}): Promise<number | null> {
  if (!input.apiKey) {
    return null;
  }

  const response = await postJson<GeminiTokenCountResponse>({
    url: `${geminiBaseUrl(input.baseUrl)}/v1beta/models/${input.model}:countTokens`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey,
    },
    timeoutMs: 120_000,
    body: {
      contents: [{ parts: buildGeminiParts({ prompt: input.prompt, geminiFile: input.geminiFile }) }],
    },
  });

  return response.totalTokens ?? response.total_tokens ?? null;
}

function parseMarketAnalysisResult(rawText: string): MarketAnalysisResult {
  const parsed = normalizeMarketAnalysisTransportPayload(parseJsonFromText(rawText));
  return normalizeMarketAnalysisTransportResult(MarketAnalysisTransportResultSchema.parse(parsed));
}

function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "respuesta no convertible a JSON";
}

function sanitizeUngroundedBenchmarking(result: MarketAnalysisResult): MarketAnalysisResult {
  return {
    rows: result.rows.map((row) => ({
      ...row,
      "Fuente 1 (Precio)": "N/D",
      "Fuente 2 (Precio)": "N/D",
      "Fuente 3 (Precio)": "N/D",
      "Costo Optimista": "N/D",
      "Costo Moderado": "N/D",
      "COSTO PONDERADO UNIT": "N/D",
      "COSTO PONDERADO TOTAL": "N/D",
      "Viabilidad / Margen":
        row["PRECIO REFERENCIA (TECHO) UNIT"] && row["PRECIO REFERENCIA (TECHO) UNIT"] !== "N/D"
          ? "No calculable sin fuentes verificadas."
          : "Sin techo visible",
      "Resumen de Fuentes y Observaciones":
        "Benchmark externo no verificable en esta corrida porque Gemini no entrego grounding utilizable. Conserva la extraccion documental y el precio techo del archivo.",
    })),
    warnings: Array.from(
      new Set([
        ...result.warnings,
        "Se limpiaron fuentes y costos porque la corrida termino sin grounding verificable; se evita mostrar benchmarking no trazable.",
      ]),
    ),
    provider_notes: result.provider_notes,
  };
}

function extractGeminiText(response: GeminiResponse): string {
  return (
    response.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function extractGeminiThoughtSummaries(response: GeminiResponse): string[] {
  return (
    response.candidates?.[0]?.content?.parts
      ?.filter((part) => part.thought && part.text?.trim())
      .map((part) => part.text!.trim()) ?? []
  );
}

function extractGeminiSources(response: GeminiResponse): Array<{ title: string | null; uri: string | null }> {
  return (
    response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk) => ({
        title: chunk.web?.title ?? null,
        uri: chunk.web?.uri ?? null,
      }))
      .filter((chunk) => chunk.title || chunk.uri) ?? []
  );
}

async function runGeminiSingleModel(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  if (!input.apiKey) {
    throw new Error("No hay API key configurada para Gemini.");
  }

  const startedAt = Date.now();
  const requestBody = (mode: GeminiRequestMode) => ({
    contents: [{ parts: buildGeminiParts(input) }],
    ...((mode === "grounded_schema" || mode === "grounded_json" || mode === "grounded_text")
      ? { tools: [{ google_search: {} }] }
      : {}),
    generationConfig: buildGeminiGenerationConfig(input, mode),
  });
  const requestGeminiStream = async (mode: GeminiRequestMode) =>
    streamGeminiResponse({
      url: `${geminiBaseUrl(input.baseUrl)}/v1beta/models/${input.model}:streamGenerateContent?alt=sse`,
      apiKey: input.apiKey ?? "",
      body: requestBody(mode),
      model: input.model,
      mode,
    });

  const retryWarnings: string[] = [];
  const requestGemini = (mode: GeminiRequestMode) =>
    withGeminiGenerateRetries({
      model: input.model,
      mode,
      retryWarnings,
      operation: () => requestGeminiStream(mode),
    });
  let response: GeminiResponse;

  try {
    if (input.allowGrounding === false) {
      response = await requestGemini("plain_schema");
    } else try {
      response = await requestGemini("grounded_schema");
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 503) {
        retryWarnings.push(
          "Gemini respondio 503 con grounding despues de varios intentos; se reintento sin busqueda para conservar la generacion de la matriz.",
        );
        response = await requestGemini("plain_schema");
      } else if (!(error instanceof ProviderHttpError) || error.status !== 400) {
        throw error;
      } else {

        retryWarnings.push(
          "Gemini rechazo Google Search grounding con schema estricto; se reintento con JSON compacto sin schema para conservar la busqueda.",
        );

        try {
          response = await requestGemini("grounded_json");
        } catch (secondError) {
          if (secondError instanceof ProviderHttpError && secondError.status === 503) {
            retryWarnings.push(
              "Gemini respondio 503 en el reintento con JSON grounded despues de varios intentos; se uso generacion sin busqueda.",
            );
            response = await requestGemini("plain_schema");
          } else if (!(secondError instanceof ProviderHttpError) || secondError.status !== 400) {
            throw secondError;
          } else {

            retryWarnings.push(
              "Gemini tambien rechazo el transporte JSON grounded; se reintento con grounding en texto libre para conservar la busqueda.",
            );

            try {
              response = await requestGemini("grounded_text");
            } catch (thirdError) {
              if (thirdError instanceof ProviderHttpError && thirdError.status === 503) {
                retryWarnings.push(
                  "Gemini respondio 503 en el reintento con texto grounded despues de varios intentos; se uso generacion sin busqueda.",
                );
                response = await requestGemini("plain_schema");
              } else if (!(thirdError instanceof ProviderHttpError) || thirdError.status !== 400) {
                throw thirdError;
              } else {

                retryWarnings.push(
                  "Gemini tambien rechazo el grounding en texto libre; se reintento sin grounding. No se deben inventar fuentes.",
                );
                response = await requestGemini("plain_schema");
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (isTransientGeminiError(error)) {
      throw new Error(
        `Gemini ${input.model} no pudo completar el analisis despues de varios reintentos. Ultimo error: ${providerErrorMessage(error)}`,
      );
    }

    throw error;
  }

  let responseForResult = response;
  let rawText = extractGeminiText(responseForResult);
  if (!rawText) {
    const finishReason = responseForResult.candidates?.[0]?.finishReason ?? "sin finishReason";
    throw new Error(
      `Gemini ${input.model} respondio sin texto util para convertir a matriz (${finishReason}). Reintenta o cambia temporalmente de modelo si el preview esta saturado.`,
    );
  }

  let sources = extractGeminiSources(responseForResult);
  let thoughtSummaries = extractGeminiThoughtSummaries(responseForResult);
  let result: MarketAnalysisResult;
  try {
    result = parseMarketAnalysisResult(rawText);
  } catch (parseError) {
    if (input.allowGrounding === false) {
      throw parseError;
    }

    retryWarnings.push(
      `Gemini devolvio una respuesta no convertible a JSON en el primer intento (${parseErrorMessage(parseError)}). Se reintento con salida JSON flexible.`,
    );

    let lastParseError: unknown = parseError;
    let parsedAfterRetry: MarketAnalysisResult | null = null;

    for (const mode of ["grounded_json", "grounded_text", "plain_schema"] as const) {
      try {
        responseForResult = await requestGemini(mode);
      } catch (retryError) {
        retryWarnings.push(
          `Gemini no completo el reintento ${mode} (${providerErrorMessage(retryError)}).`,
        );
        lastParseError = retryError;
        continue;
      }

      rawText = extractGeminiText(responseForResult);
      if (!rawText) {
        const finishReason = responseForResult.candidates?.[0]?.finishReason ?? "sin finishReason";
        lastParseError = new Error(`respuesta sin texto util en ${mode} (${finishReason})`);
        retryWarnings.push(`Gemini devolvio ${parseErrorMessage(lastParseError)}.`);
        continue;
      }

      try {
        parsedAfterRetry = parseMarketAnalysisResult(rawText);
        sources = extractGeminiSources(responseForResult);
        thoughtSummaries = extractGeminiThoughtSummaries(responseForResult);
        break;
      } catch (retryParseError) {
        lastParseError = retryParseError;
        retryWarnings.push(
          `Gemini devolvio JSON no convertible en ${mode} (${parseErrorMessage(retryParseError)}).`,
        );
      }
    }

    if (!parsedAfterRetry) {
      throw lastParseError instanceof Error
        ? lastParseError
        : new Error("Gemini no devolvio JSON valido despues de los reintentos.");
    }

    result = parsedAfterRetry;
  }

  if (retryWarnings.length > 0) {
    result.warnings = Array.from(new Set([...result.warnings, ...retryWarnings]));
  }

  const streamDiagnostics = (responseForResult as GeminiResponse & { _streamDiagnostics?: string[] })._streamDiagnostics ?? [];
  result.provider_notes = Array.from(
    new Set([
      ...result.provider_notes,
      ...streamDiagnostics,
      thoughtSummaries.length > 0
        ? `Gemini envio ${thoughtSummaries.length} resumen(es) de pensamiento durante la corrida. Ultima señal: ${thoughtSummaries[thoughtSummaries.length - 1]?.slice(0, 240)}`
        : "Gemini uso streaming, pero no envio resumenes de pensamiento en esta corrida.",
    ]),
  );

  if (sources.length === 0 && retryWarnings.some((warning) => warning.includes("sin grounding"))) {
    result = sanitizeUngroundedBenchmarking(result);
  }

  return {
    result,
    rawText,
    rawResponse: responseForResult,
    usage: {
      provider: "gemini",
      model: input.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: responseForResult.usageMetadata?.promptTokenCount ?? null,
      outputTokens: responseForResult.usageMetadata?.candidatesTokenCount ?? null,
      finishReason: responseForResult.candidates?.[0]?.finishReason ?? null,
      grounded: sources.length > 0,
      groundingSources: sources,
    },
  };
}

async function streamGeminiResponse(input: {
  url: string;
  apiKey: string;
  body: unknown;
  model: string;
  mode: GeminiRequestMode;
}): Promise<GeminiResponse> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;
  let abortReason: string | null = null;
  const startedAt = Date.now();
  let firstChunkAt: number | null = null;
  let lastChunkAt: number | null = null;
  let chunkCount = 0;
  let thoughtChunkCount = 0;
  let answerChunkCount = 0;
  const firstSignalTimeoutSeconds = Math.round(GEMINI_FIRST_SIGNAL_TIMEOUT_MS / 1_000);
  const idleTimeoutSeconds = Math.round(GEMINI_STREAM_IDLE_TIMEOUT_MS / 1_000);
  const totalTimeoutMs = geminiStreamTotalTimeoutMs(input.model);
  const totalTimeoutMinutes = Math.round(totalTimeoutMs / 60_000);

  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    const timeoutMs = firstChunkAt ? GEMINI_STREAM_IDLE_TIMEOUT_MS : GEMINI_FIRST_SIGNAL_TIMEOUT_MS;
    const timeoutSeconds = firstChunkAt ? idleTimeoutSeconds : firstSignalTimeoutSeconds;
    idleTimer = setTimeout(() => {
      abortReason = firstChunkAt
        ? `Gemini ${input.model} no envio actividad por ${timeoutSeconds} segundos en ${input.mode}.`
        : `Gemini ${input.model} no envio primera señal por ${timeoutSeconds} segundos en ${input.mode}.`;
      controller.abort(new Error(abortReason));
    }, timeoutMs);
  };

  totalTimer = setTimeout(() => {
    abortReason = `Gemini ${input.model} supero el maximo total de ${totalTimeoutMinutes} minutos en ${input.mode}.`;
    controller.abort(new Error(abortReason));
  }, totalTimeoutMs);
  resetIdleTimer();
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify(input.body),
    });

    if (!response.ok) {
      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text().catch(() => null);
      }

      throw new ProviderHttpError(`Gemini ${input.model} no acepto ${input.mode} (${response.status}).`, response.status, responseBody);
    }

    if (!response.body) {
      throw new Error(`Gemini ${input.model} no devolvio stream para ${input.mode}.`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const chunks: GeminiResponse[] = [];
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      lastChunkAt = Date.now();
      firstChunkAt ??= lastChunkAt;
      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLines = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s?/, ""))
          .join("\n")
          .trim();

        if (!dataLines || dataLines === "[DONE]") {
          continue;
        }

        const parsed = JSON.parse(dataLines) as GeminiResponse;
        chunkCount += 1;
        for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought) {
            thoughtChunkCount += 1;
          } else if (part.text) {
            answerChunkCount += 1;
          }
        }
        chunks.push(parsed);
      }
    }

    const finalBuffer = buffer.trim();
    if (finalBuffer) {
      const dataLines = finalBuffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n")
        .trim();
      if (dataLines && dataLines !== "[DONE]") {
        const parsed = JSON.parse(dataLines) as GeminiResponse;
        chunkCount += 1;
        chunks.push(parsed);
      }
    }

    return mergeGeminiStreamChunks(chunks, {
      model: input.model,
      mode: input.mode,
      startedAt,
      firstChunkAt,
      lastChunkAt,
      chunkCount,
      thoughtChunkCount,
      answerChunkCount,
    });
  } catch (error) {
    if (abortReason) {
      throw new Error(abortReason);
    }
    throw error;
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (totalTimer) {
      clearTimeout(totalTimer);
    }
  }
}

function mergeGeminiStreamChunks(
  chunks: GeminiResponse[],
  diagnostics: {
    model: string;
    mode: GeminiRequestMode;
    startedAt: number;
    firstChunkAt: number | null;
    lastChunkAt: number | null;
    chunkCount: number;
    thoughtChunkCount: number;
    answerChunkCount: number;
  },
): GeminiResponse & { _streamDiagnostics?: string[] } {
  const parts = chunks.flatMap((chunk) => chunk.candidates?.[0]?.content?.parts ?? []);
  const groundingChunks = chunks.flatMap((chunk) => chunk.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []);
  const webSearchQueries = chunks.flatMap((chunk) => chunk.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []);
  const lastCandidate = [...chunks].reverse().find((chunk) => chunk.candidates?.[0])?.candidates?.[0];
  const lastUsage = [...chunks].reverse().find((chunk) => chunk.usageMetadata)?.usageMetadata;
  const firstSignalMs = diagnostics.firstChunkAt ? diagnostics.firstChunkAt - diagnostics.startedAt : null;
  const totalMs = (diagnostics.lastChunkAt ?? Date.now()) - diagnostics.startedAt;

  return {
    candidates: [
      {
        finishReason: lastCandidate?.finishReason,
        content: { parts },
        groundingMetadata: {
          groundingChunks,
          webSearchQueries,
        },
      },
    ],
    usageMetadata: lastUsage,
    _streamDiagnostics: [
      `STREAM_GEMINI: modelo=${diagnostics.model}, modo=${diagnostics.mode}, chunks=${diagnostics.chunkCount}, partes_respuesta=${diagnostics.answerChunkCount}, partes_pensamiento=${diagnostics.thoughtChunkCount}, primera_senal_ms=${firstSignalMs ?? "N/D"}, duracion_stream_ms=${totalMs}.`,
    ],
  };
}

async function runGemini(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  const fallbackOrder = buildGeminiModelFallbackOrder(input.model);
  const fallbackWarnings: string[] = [];
  let lastError: unknown = null;

  for (const [index, model] of fallbackOrder.entries()) {
    try {
      const output = await runGeminiSingleModel({ ...input, model });
      if (index > 0) {
        output.result.warnings = Array.from(
          new Set([
            ...fallbackWarnings,
            ...output.result.warnings,
            `FALLBACK_MODELO_IA: el modelo configurado ${input.model} no respondio de forma estable; la corrida se completo con ${model}.`,
          ]),
        );
        output.result.provider_notes = Array.from(
          new Set([...output.result.provider_notes, `Modelo IA efectivo para esta corrida: ${model}.`]),
        );
      }

      return output;
    } catch (error) {
      lastError = error;
      const message = providerErrorMessage(error);
      const hasNextModel = index < fallbackOrder.length - 1;

      if (!hasNextModel || !isConfirmedGeminiModelNegative(error)) {
        throw error;
      }

      const nextModel = fallbackOrder[index + 1];
      fallbackWarnings.push(
        `Gemini ${model} tuvo negativa confirmada (${message}). Se intenta fallback controlado con ${nextModel}.`,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini no respondio con ningun modelo configurado.");
}

async function runOpenAi(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  if (!input.apiKey) {
    throw new Error("No hay API key configurada para OpenAI.");
  }

  const startedAt = Date.now();
  const response = await postJson<OpenAiResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/v1/responses`,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    timeoutMs: 300_000,
    body: {
      model: input.model,
      input: input.prompt,
      temperature: 0.15,
      max_output_tokens: 65_000,
    },
  });
  const rawText = response.output_text?.trim() ?? "";

  return {
    result: parseMarketAnalysisResult(rawText),
    rawText,
    rawResponse: response,
    usage: {
      provider: "openai",
      model: input.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      finishReason: "stop",
      grounded: false,
      groundingSources: [],
    },
  };
}

async function runAnthropic(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  if (!input.apiKey) {
    throw new Error("No hay API key configurada para Anthropic.");
  }

  const startedAt = Date.now();
  const response = await postJson<AnthropicResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/v1/messages`,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    timeoutMs: 300_000,
    body: {
      model: input.model,
      max_tokens: 65_000,
      temperature: 0.15,
      messages: [{ role: "user", content: input.prompt }],
    },
  });
  const rawText = response.content?.find((item) => item.type === "text")?.text?.trim() ?? "";

  return {
    result: parseMarketAnalysisResult(rawText),
    rawText,
    rawResponse: response,
    usage: {
      provider: "anthropic",
      model: input.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      finishReason: response.stop_reason ?? null,
      grounded: false,
      groundingSources: [],
    },
  };
}

async function runDeepSeek(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  if (!input.apiKey) {
    throw new Error("No hay API key configurada para DeepSeek.");
  }

  const startedAt = Date.now();
  const response = await postJson<DeepSeekResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    timeoutMs: 300_000,
    body: {
      model: input.model,
      temperature: 0.15,
      max_tokens: 65_000,
      stream: false,
      messages: [{ role: "user", content: input.prompt }],
    },
  });
  const rawText = response.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    result: parseMarketAnalysisResult(rawText),
    rawText,
    rawResponse: response,
    usage: {
      provider: "deepseek",
      model: input.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      finishReason: response.choices?.[0]?.finish_reason ?? null,
      grounded: false,
      groundingSources: [],
    },
  };
}

export async function runMarketAnalysisProvider(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  switch (input.provider) {
    case "gemini":
      return runGemini(input);
    case "anthropic":
      return runAnthropic(input);
    case "deepseek":
      return runDeepSeek(input);
    case "openai":
    default:
      return runOpenAi(input);
  }
}
