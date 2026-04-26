import type { AiProvider } from "@ai-first-contracts/enums";
import type { ProviderUsageMetadata } from "@ai-first-contracts/providers/ai-provider";
import { postJson } from "@ai-first-core/providers/shared/http";

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
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
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
  const response = await postJson<GeminiPingResponse>({
    url: `${input.baseUrl.replace(/\/$/, "")}/v1beta/models/${input.model}:generateContent`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey,
    },
    timeoutMs: 20_000,
    body: {
      contents: [{ parts: [{ text: "Reply with the single word OK." }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 32,
        responseMimeType: "text/plain",
      },
    },
  });

  const preview =
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() || "OK";

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
