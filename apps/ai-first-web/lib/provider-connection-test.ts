import type { AiProvider } from "@ai-first-contracts/enums";
import type { ProviderUsageMetadata } from "@ai-first-contracts/providers/ai-provider";
import { ProviderHttpError, postJson } from "@ai-first-core/providers/shared/http";

interface OpenAiPingResponse {
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface GeminiPingResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface GeminiStreamDiagnostic {
  preview: string;
  thoughtPreview: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  finishReason?: string | null;
}

interface AnthropicPingResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface DeepSeekPingResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface PingResult {
  message: string;
  usage: ProviderUsageMetadata;
  preview: string;
}

const GEMINI_TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const GEMINI_PING_RETRY_DELAYS_MS = [3_000, 8_000, 15_000];

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

  return error instanceof Error ? error.message : "Error desconocido probando Gemini.";
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
      normalizedMessage.includes("econnreset") ||
      normalizedMessage.includes("etimedout")
    );
  }

  return false;
}

async function withGeminiPingRetries<T>(args: { model: string; operation: () => Promise<T> }): Promise<T> {
  const maxAttempts = isGemini3Model(args.model) ? 4 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await args.operation();
    } catch (error) {
      lastError = error;
      if (!isTransientGeminiError(error) || attempt === maxAttempts) {
        break;
      }

      await sleep(GEMINI_PING_RETRY_DELAYS_MS[attempt - 1] ?? 15_000);
    }
  }

  throw new Error(
    `Gemini no respondio de forma estable despues de ${maxAttempts} intento(s). Ultimo error: ${providerErrorMessage(lastError)}`,
  );
}

function buildUsage(args: {
  provider: AiProvider;
  model: string;
  startedAt: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  finishReason?: string | null;
}): ProviderUsageMetadata {
  return {
    provider: args.provider,
    model: args.model,
    input_tokens: args.inputTokens ?? null,
    output_tokens: args.outputTokens ?? null,
    latency_ms: Date.now() - args.startedAt,
    finish_reason: args.finishReason ?? null,
  };
}

async function pingOpenAi(input: { apiKey: string; baseUrl: string; model: string }): Promise<PingResult> {
  const startedAt = Date.now();
  const response = await postJson<OpenAiPingResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/v1/responses`,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    timeoutMs: 20_000,
    body: {
      model: input.model,
      input: "Reply with the single word OK.",
      temperature: 0,
      max_output_tokens: 32,
    },
  });

  return {
    message: `Conexion exitosa con openai:${input.model}.`,
    preview: response.output_text?.trim() || "OK",
    usage: buildUsage({
      provider: "openai",
      model: input.model,
      startedAt,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      finishReason: "stop",
    }),
  };
}

async function pingGemini(input: { apiKey: string; baseUrl: string; model: string }): Promise<PingResult> {
  const startedAt = Date.now();
  if (isGemini3Model(input.model)) {
    const diagnostic = await pingGeminiStream(input);

    return {
      message: `Conexion exitosa con gemini:${input.model}.`,
      preview: diagnostic.preview || diagnostic.thoughtPreview || "OK",
      usage: buildUsage({
        provider: "gemini",
        model: input.model,
        startedAt,
        inputTokens: diagnostic.usage?.promptTokenCount ?? null,
        outputTokens: diagnostic.usage?.candidatesTokenCount ?? null,
        finishReason: diagnostic.finishReason ?? null,
      }),
    };
  }

  const timeoutMs = isGemini3Model(input.model) ? 180_000 : 30_000;
  const response = await withGeminiPingRetries({
    model: input.model,
    operation: () =>
      postJson<GeminiPingResponse>({
        url: `${input.baseUrl.replace(/\/$/, "")}/v1beta/models/${input.model}:generateContent`,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        timeoutMs,
        body: {
          contents: [{ parts: [{ text: 'Return this JSON exactly: {"ok": true}' }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
              },
              required: ["ok"],
              additionalProperties: false,
            },
            ...(isGemini3Model(input.model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
          },
        },
      }),
  });

  const preview =
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? "";

  if (!preview) {
    const finishReason = response.candidates?.[0]?.finishReason ?? "sin finishReason";
    throw new Error(`Gemini respondio, pero no devolvio texto util para confirmar conexion (${finishReason}).`);
  }

  return {
    message: `Conexion exitosa con gemini:${input.model}.`,
    preview,
    usage: buildUsage({
      provider: "gemini",
      model: input.model,
      startedAt,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      finishReason: response.candidates?.[0]?.finishReason ?? null,
    }),
  };
}

async function pingGeminiStream(input: { apiKey: string; baseUrl: string; model: string }): Promise<GeminiStreamDiagnostic> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/v1beta/models/${input.model}:streamGenerateContent?alt=sse`, {
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
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: "low",
            includeThoughts: true,
          },
        },
      }),
    });

    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => null);
      }

      throw new ProviderHttpError(`Gemini stream respondio ${response.status}.`, response.status, body);
    }

    if (!response.body) {
      throw new Error("Gemini stream no devolvio cuerpo de respuesta.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    let thoughts = "";
    let finishReason: string | null = null;
    let usage: GeminiStreamDiagnostic["usage"] | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        const json = JSON.parse(data) as GeminiPingResponse;
        finishReason = json.candidates?.[0]?.finishReason ?? finishReason;
        usage = json.usageMetadata ?? usage;

        for (const part of json.candidates?.[0]?.content?.parts ?? []) {
          if (!part.text) {
            continue;
          }

          if ("thought" in part && part.thought === true) {
            thoughts += part.text;
          } else {
            answer += part.text;
          }
        }
      }
    }

    if (!answer && !thoughts) {
      throw new Error(`Gemini stream termino sin texto util (${finishReason ?? "sin finishReason"}).`);
    }

    return {
      preview: answer.trim(),
      thoughtPreview: thoughts.trim(),
      usage,
      finishReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function pingAnthropic(input: { apiKey: string; baseUrl: string; model: string }): Promise<PingResult> {
  const startedAt = Date.now();
  const response = await postJson<AnthropicPingResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/v1/messages`,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    timeoutMs: 20_000,
    body: {
      model: input.model,
      max_tokens: 32,
      temperature: 0,
      system: "Reply with the single word OK.",
      messages: [
        {
          role: "user",
          content: "Connection test",
        },
      ],
    },
  });

  const preview = response.content?.find((item) => item.type === "text")?.text?.trim() || "OK";

  return {
    message: `Conexion exitosa con anthropic:${input.model}.`,
    preview,
    usage: buildUsage({
      provider: "anthropic",
      model: input.model,
      startedAt,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      finishReason: response.stop_reason ?? null,
    }),
  };
}

async function pingDeepSeek(input: { apiKey: string; baseUrl: string; model: string }): Promise<PingResult> {
  const startedAt = Date.now();
  const response = await postJson<DeepSeekPingResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    timeoutMs: 20_000,
    body: {
      model: input.model,
      temperature: 0,
      max_tokens: 32,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Reply with the single word OK.",
        },
        {
          role: "user",
          content: "Connection test",
        },
      ],
    },
  });

  const preview = response.choices?.[0]?.message?.content?.trim() || "OK";

  return {
    message: `Conexion exitosa con deepseek:${input.model}.`,
    preview,
    usage: buildUsage({
      provider: "deepseek",
      model: input.model,
      startedAt,
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      finishReason: response.choices?.[0]?.finish_reason ?? null,
    }),
  };
}

export async function testProviderConnection(input: {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}) {
  switch (input.provider) {
    case "gemini":
      return pingGemini(input);
    case "anthropic":
      return pingAnthropic(input);
    case "deepseek":
      return pingDeepSeek(input);
    case "openai":
    default:
      return pingOpenAi(input);
  }
}
