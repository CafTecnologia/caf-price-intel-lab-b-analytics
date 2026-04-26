import "server-only";

import type { AiProvider } from "@ai-first-contracts/enums";
import { parseJsonFromText } from "@ai-first-core/providers/shared/json";
import { ProviderHttpError, postJson } from "@ai-first-core/providers/shared/http";

import {
  MarketAnalysisTransportResultSchema,
  normalizeMarketAnalysisTransportResult,
  type MarketAnalysisResult,
} from "./market-analysis-schema";

interface MarketAnalysisProviderInput {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  prompt: string;
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

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string }>;
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

const MARKET_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          description: { type: "string" },
          technical_description: { type: "string" },
          quantity: { type: "string" },
          fit_analysis: { type: "string" },
          source_1: { type: "string" },
          source_2: { type: "string" },
          source_3: { type: "string" },
          cost_optimistic: { type: "string" },
          cost_moderate: { type: "string" },
          weighted_unit: { type: "string" },
          weighted_total: { type: "string" },
          reference_unit: { type: "string" },
          viability: { type: "string" },
          notes: { type: "string" },
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
          "cost_optimistic",
          "cost_moderate",
          "weighted_unit",
          "weighted_total",
          "reference_unit",
          "viability",
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

function parseMarketAnalysisResult(rawText: string): MarketAnalysisResult {
  return normalizeMarketAnalysisTransportResult(MarketAnalysisTransportResultSchema.parse(parseJsonFromText(rawText)));
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
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? ""
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

async function runGemini(input: MarketAnalysisProviderInput): Promise<MarketAnalysisProviderOutput> {
  if (!input.apiKey) {
    throw new Error("No hay API key configurada para Gemini.");
  }

  const startedAt = Date.now();
  const postGemini = (mode: GeminiRequestMode) =>
    postJson<GeminiResponse>({
      url: `${input.baseUrl.replace(/\/$/, "")}/v1beta/models/${input.model}:generateContent`,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey ?? "",
      },
      timeoutMs: 300_000,
      body: {
        contents: [{ parts: [{ text: input.prompt }] }],
        ...((mode === "grounded_schema" || mode === "grounded_json" || mode === "grounded_text")
          ? { tools: [{ google_search: {} }] }
          : {}),
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 65_000,
          ...((mode === "grounded_text" || mode === "plain_schema") ? {} : { responseMimeType: "application/json" }),
          ...((mode === "grounded_schema" || mode === "plain_schema") ? { responseJsonSchema: MARKET_ANALYSIS_JSON_SCHEMA } : {}),
        },
      },
    });

  const retryWarnings: string[] = [];
  let response: GeminiResponse;

  try {
    response = await postGemini("grounded_schema");
  } catch (error) {
    if (!(error instanceof ProviderHttpError) || error.status !== 400) {
      throw error;
    }

    retryWarnings.push(
      "Gemini rechazo Google Search grounding con schema estricto; se reintento con JSON compacto sin schema para conservar la busqueda.",
    );

    try {
      response = await postGemini("grounded_json");
    } catch (secondError) {
      if (!(secondError instanceof ProviderHttpError) || secondError.status !== 400) {
        throw secondError;
      }

      retryWarnings.push(
        "Gemini tambien rechazo el transporte JSON grounded; se reintento con grounding en texto libre para conservar la busqueda.",
      );

      try {
        response = await postGemini("grounded_text");
      } catch (thirdError) {
        if (!(thirdError instanceof ProviderHttpError) || thirdError.status !== 400) {
          throw thirdError;
        }

        retryWarnings.push(
          "Gemini tambien rechazo el grounding en texto libre; se reintento sin grounding. No se deben inventar fuentes.",
        );
        response = await postGemini("plain_schema");
      }
    }
  }

  const rawText = extractGeminiText(response);
  const sources = extractGeminiSources(response);
  let result = parseMarketAnalysisResult(rawText);

  if (retryWarnings.length > 0) {
    result.warnings = Array.from(new Set([...result.warnings, ...retryWarnings]));
  }

  if (sources.length === 0 && retryWarnings.some((warning) => warning.includes("sin grounding"))) {
    result = sanitizeUngroundedBenchmarking(result);
  }

  return {
    result,
    rawText,
    rawResponse: response,
    usage: {
      provider: "gemini",
      model: input.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      finishReason: response.candidates?.[0]?.finishReason ?? null,
      grounded: sources.length > 0,
      groundingSources: sources,
    },
  };
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
