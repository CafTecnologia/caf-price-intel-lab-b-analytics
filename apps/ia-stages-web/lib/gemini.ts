import { GoogleGenAI, type GroundingMetadata } from "@google/genai";
import { PipelineFailure } from "@/lib/ai-failures";
import { getGeminiRuntimeConfig, type AiProvider, type AiStage } from "@/lib/config";
import { applyAiPromptProfile } from "@/lib/prompt-profiles";

type GeminiCallInput = {
  prompt: string;
  apiKey?: string;
  model?: string;
  stage?: AiStage;
};

type AiCallResult = {
  provider: AiProvider;
  model: string;
  text: string;
  usageMetadata?: unknown;
};

type AiSearchCallResult = AiCallResult & {
  groundingMetadata?: GroundingMetadata;
};

export async function callGemini({ prompt, apiKey, model, stage }: GeminiCallInput): Promise<AiCallResult> {
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });
  const profiledPrompt = applyAiPromptProfile(prompt, {
    provider: config.provider,
    model: config.model,
    stage
  });

  if (config.provider === "deepseek") {
    return callDeepSeekJson({
      apiKey: config.apiKey,
      model: config.model,
      prompt: profiledPrompt,
      stage
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await generateContentWithJsonPreference(ai, config.model, profiledPrompt);
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata
  };
}

export async function callGeminiWithSearch({
  prompt,
  apiKey,
  model,
  stage
}: GeminiCallInput): Promise<AiSearchCallResult> {
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });
  const profiledPrompt = applyAiPromptProfile(prompt, {
    provider: config.provider,
    model: config.model,
    stage
  });

  if (config.provider === "deepseek") {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "stage3",
      technicalMessage:
        "DeepSeek API oficial no incluye busqueda web/grounding. Etapa 3 requiere fuentes verificables."
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await generateContentWithSearch(ai, config.model, profiledPrompt);
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    groundingMetadata: response.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata
  };
}

type DeepSeekCallInput = {
  apiKey: string;
  model: string;
  prompt: string;
  stage?: AiStage;
};

type DeepSeekChatResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  model?: string;
  usage?: unknown;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

async function callDeepSeekJson({ apiKey, model, prompt, stage }: DeepSeekCallInput): Promise<AiCallResult> {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: stage === "stage3" ? 24000 : 12000
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    const providerMessage = extractDeepSeekErrorMessage(bodyText) || response.statusText;
    throw new PipelineFailure({
      code: response.status === 401 ? "API_KEY_INVALID" : "API_PROVIDER_ERROR",
      stage: stage ?? "pipeline",
      technicalMessage: providerMessage,
      details: {
        providerHttpCode: response.status,
        providerHttpStatusText: response.statusText
      }
    });
  }

  let body: DeepSeekChatResponse;
  try {
    body = JSON.parse(bodyText) as DeepSeekChatResponse;
  } catch {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "pipeline",
      technicalMessage: "DeepSeek respondio con un cuerpo no legible como JSON.",
      raw: bodyText
    });
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new PipelineFailure({
      code: "AI_EMPTY_RESPONSE",
      stage: stage ?? "pipeline",
      technicalMessage: "DeepSeek acepto la solicitud, pero no devolvio texto."
    });
  }

  return {
    provider: "deepseek",
    model: body.model ?? model,
    text,
    usageMetadata: body.usage
  };
}

function extractDeepSeekErrorMessage(bodyText: string) {
  try {
    const body = JSON.parse(bodyText) as DeepSeekChatResponse;
    return body.error?.message;
  } catch {
    return bodyText;
  }
}

async function generateContentWithJsonPreference(ai: GoogleGenAI, model: string, prompt: string) {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];

  try {
    return await ai.models.generateContent({
      model,
      contents,
      config: {
        responseMimeType: "application/json",
        temperature: 0
      }
    });
  } catch (error) {
    if (!shouldRetryWithoutJsonMimeType(error)) {
      throw error;
    }

    return ai.models.generateContent({
      model,
      contents,
      config: {
        temperature: 0
      }
    });
  }
}

function shouldRetryWithoutJsonMimeType(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /responseMimeType|response_mime_type|application\/json|mime|unsupported|not supported/i.test(
    message
  );
}

async function generateContentWithSearch(ai: GoogleGenAI, model: string, prompt: string) {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const tools = [{ googleSearch: {} }];

  try {
    return await ai.models.generateContent({
      model,
      contents,
      config: {
        tools,
        responseMimeType: "application/json",
        temperature: 0
      }
    });
  } catch (error) {
    if (!shouldRetryWithoutJsonMimeType(error)) {
      throw error;
    }

    return ai.models.generateContent({
      model,
      contents,
      config: {
        tools,
        temperature: 0
      }
    });
  }
}
