import { centralResponse, centralText, centralSources } from "./central-routing";
import { GoogleGenAI, ThinkingLevel, type GroundingMetadata } from "@google/genai";
import { PipelineFailure } from "@/lib/ai-failures";
import { getGeminiRuntimeConfig, type AiProvider, type AiStage } from "@/lib/config";
import {
  GEMINI_CONGESTION_BACKOFF_MS,
  isGeminiCongestionError,
  maxCongestionRetriesForGeminiModel,
  sleepMs
} from "@/lib/gemini-retry";

type GeminiCallInput = {
  prompt: string;
  apiKey?: string;
  model?: string;
  stage?: AiStage;
};

export type AiCallResult = {
  provider: AiProvider | "openai" | "vps";
  model: string;
  text: string;
  usageMetadata?: unknown;
  /** Reintentos por congestión del proveedor (no incluye el intento inicial). */
  congestionRetries?: number;
};

type AiSearchCallResult = AiCallResult & {
  groundingMetadata?: GroundingMetadata;
};

type AiUrlContextCallResult = AiCallResult & {
  urlContextMetadata?: unknown;
};

type AiSearchAndUrlContextCallResult = AiSearchCallResult & {
  urlContextMetadata?: unknown;
};

async function callCentralStage(prompt: string, stage: AiStage | undefined, search: boolean, json: boolean): Promise<AiSearchAndUrlContextCallResult | null> {
  const task = search ? "stage_price_search" : stage === "stage1" ? "stage_extraction" : "stage_analysis";
  const response = await centralResponse(task, {
    input: prompt, max_output_tokens: 16384,
    ...(json ? { text: { format: { type: "json_object" } } } : {}),
    ...(search ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {})
  }, 600000);
  if (!response) return null;
  const text = centralText(response).trim();
  if (!text) throw new Error("La política central respondió sin contenido.");
  const sources = centralSources(response);
  const usageMetadata = response.usage ? {
    promptTokenCount: response.usage.input_tokens,
    candidatesTokenCount: response.usage.output_tokens,
    totalTokenCount: response.usage.input_tokens + response.usage.output_tokens,
    thoughtsTokenCount: 0,
    accountingSource: "central_ledger" as const
  } : undefined;
  return { provider: response.caf_routing?.provider === "vps" ? "vps" : "openai", model: response.model,
    text, usageMetadata, congestionRetries: 0,
    ...(sources.length ? { groundingMetadata: { groundingChunks: sources.map(web => ({ web })) } as GroundingMetadata } : {}) };
}

export async function callGemini({ prompt, apiKey, model, stage }: GeminiCallInput): Promise<AiCallResult> {
  const central = await callCentralStage(prompt, stage, false, true);
  if (central) return central;
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  if (config.provider === "deepseek") {
    return callDeepSeekJson({
      apiKey: config.apiKey,
      model: config.model,
      prompt,
      stage
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { response, congestionRetries } = await generateContentJsonWithCongestionRetry(
    ai,
    config.model,
    prompt
  );
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata,
    congestionRetries
  };
}

export async function callGeminiWithSearch({
  prompt,
  apiKey,
  model,
  stage
}: GeminiCallInput): Promise<AiSearchCallResult> {
  const central = await callCentralStage(prompt, stage, true, true);
  if (central) return central;
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  if (config.provider === "deepseek") {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "stage3",
      technicalMessage:
        "DeepSeek API oficial no incluye busqueda web/grounding. Etapa 3 requiere fuentes verificables."
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { response, congestionRetries } = await generateContentSearchWithCongestionRetry(
    ai,
    config.model,
    prompt
  );
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    groundingMetadata: response.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata,
    congestionRetries
  };
}


export async function callGeminiWithSearchFreeform({
  prompt,
  apiKey,
  model,
  stage
}: GeminiCallInput): Promise<AiSearchCallResult> {
  const central = await callCentralStage(prompt, stage, true, false);
  if (central) return central;
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  if (config.provider === "deepseek") {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "stage3",
      technicalMessage:
        "DeepSeek API oficial no incluye busqueda web/grounding. Este laboratorio requiere Google Gemini."
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { response, congestionRetries } = await generateContentSearchFreeformWithCongestionRetry(
    ai,
    config.model,
    prompt
  );
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    groundingMetadata: response.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata,
    congestionRetries
  };
}



export async function callGeminiWithSearchAndUrlContextFreeform({
  prompt,
  apiKey,
  model,
  stage
}: GeminiCallInput): Promise<AiSearchAndUrlContextCallResult> {
  const central = await callCentralStage(prompt, stage, true, false);
  if (central) return central;
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  if (config.provider === "deepseek") {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "stage3",
      technicalMessage:
        "DeepSeek API oficial no incluye Google Search ni URL Context. Este laboratorio requiere Google Gemini."
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { response, congestionRetries } = await generateContentSearchAndUrlContextFreeformWithCongestionRetry(
    ai,
    config.model,
    prompt
  );
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    groundingMetadata: response.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined,
    urlContextMetadata: (response.candidates?.[0] as { urlContextMetadata?: unknown } | undefined)?.urlContextMetadata,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata,
    congestionRetries
  };
}

export async function callGeminiWithSearchAndUrlContext({
  prompt,
  apiKey,
  model,
  stage
}: GeminiCallInput): Promise<AiSearchAndUrlContextCallResult> {
  const central = await callCentralStage(prompt, stage, true, true);
  if (central) return central;
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  if (config.provider === "deepseek") {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "stage3",
      technicalMessage:
        "DeepSeek API oficial no incluye Google Search ni URL Context. Este experimento requiere Google Gemini."
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { response, congestionRetries } = await generateContentSearchAndUrlContextWithCongestionRetry(
    ai,
    config.model,
    prompt
  );
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    groundingMetadata: response.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined,
    urlContextMetadata: (response.candidates?.[0] as { urlContextMetadata?: unknown } | undefined)?.urlContextMetadata,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata,
    congestionRetries
  };
}


export async function callGeminiWithUrlContext({
  prompt,
  apiKey,
  model,
  stage
}: GeminiCallInput): Promise<AiUrlContextCallResult> {
  const central = await callCentralStage(prompt, stage, true, true);
  if (central) return central;
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  if (config.provider === "deepseek") {
    throw new PipelineFailure({
      code: "API_PROVIDER_ERROR",
      stage: stage ?? "stage3",
      technicalMessage:
        "DeepSeek API oficial no incluye URL Context. Esta validacion requiere Google Gemini con urlContext."
    });
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { response, congestionRetries } = await generateContentUrlContextWithCongestionRetry(
    ai,
    config.model,
    prompt
  );
  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model: config.model,
    text,
    urlContextMetadata: (response.candidates?.[0] as { urlContextMetadata?: unknown } | undefined)?.urlContextMetadata,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata,
    congestionRetries
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
    const modelError = /supported api model names|model names are|model .*not|passed .*deepseek/i.test(providerMessage);
    throw new PipelineFailure({
      code: response.status === 401 ? "API_KEY_INVALID" : modelError ? "API_MODEL_NOT_FOUND" : "API_PROVIDER_ERROR",
      stage: stage ?? "pipeline",
      technicalMessage: providerMessage,
      details: {
        providerHttpCode: response.status,
        providerHttpStatusText: response.statusText,
        providerModel: model
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

async function generateContentJsonWithCongestionRetry(ai: GoogleGenAI, model: string, prompt: string) {
  const maxRetries = maxCongestionRetriesForGeminiModel(model);
  let congestionRetries = 0;

  while (true) {
    try {
      const response = await generateContentWithJsonPreferenceOnce(ai, model, prompt);
      return { response, congestionRetries };
    } catch (error) {
      if (!isGeminiCongestionError(error) || congestionRetries >= maxRetries) {
        throw error;
      }
      await sleepMs(GEMINI_CONGESTION_BACKOFF_MS[congestionRetries] ?? 8000);
      congestionRetries += 1;
    }
  }
}

async function generateContentSearchWithCongestionRetry(ai: GoogleGenAI, model: string, prompt: string) {
  const maxRetries = maxCongestionRetriesForGeminiModel(model);
  let congestionRetries = 0;

  while (true) {
    try {
      const response = await generateContentWithSearchOnce(ai, model, prompt);
      return { response, congestionRetries };
    } catch (error) {
      if (!isGeminiCongestionError(error) || congestionRetries >= maxRetries) {
        throw error;
      }
      await sleepMs(GEMINI_CONGESTION_BACKOFF_MS[congestionRetries] ?? 8000);
      congestionRetries += 1;
    }
  }
}


async function generateContentSearchFreeformWithCongestionRetry(ai: GoogleGenAI, model: string, prompt: string) {
  const maxRetries = maxCongestionRetriesForGeminiModel(model);
  let congestionRetries = 0;

  while (true) {
    try {
      const response = await generateContentWithSearchFreeformOnce(ai, model, prompt);
      return { response, congestionRetries };
    } catch (error) {
      if (!isGeminiCongestionError(error) || congestionRetries >= maxRetries) {
        throw error;
      }
      await sleepMs(GEMINI_CONGESTION_BACKOFF_MS[congestionRetries] ?? 8000);
      congestionRetries += 1;
    }
  }
}



async function generateContentSearchAndUrlContextFreeformWithCongestionRetry(ai: GoogleGenAI, model: string, prompt: string) {
  const maxRetries = maxCongestionRetriesForGeminiModel(model);
  let congestionRetries = 0;

  while (true) {
    try {
      const response = await generateContentWithSearchAndUrlContextFreeformOnce(ai, model, prompt);
      return { response, congestionRetries };
    } catch (error) {
      if (!isGeminiCongestionError(error) || congestionRetries >= maxRetries) {
        throw error;
      }
      await sleepMs(GEMINI_CONGESTION_BACKOFF_MS[congestionRetries] ?? 8000);
      congestionRetries += 1;
    }
  }
}

async function generateContentSearchAndUrlContextWithCongestionRetry(ai: GoogleGenAI, model: string, prompt: string) {
  const maxRetries = maxCongestionRetriesForGeminiModel(model);
  let congestionRetries = 0;

  while (true) {
    try {
      const response = await generateContentWithSearchAndUrlContextOnce(ai, model, prompt);
      return { response, congestionRetries };
    } catch (error) {
      if (!isGeminiCongestionError(error) || congestionRetries >= maxRetries) {
        throw error;
      }
      await sleepMs(GEMINI_CONGESTION_BACKOFF_MS[congestionRetries] ?? 8000);
      congestionRetries += 1;
    }
  }
}

async function generateContentUrlContextWithCongestionRetry(ai: GoogleGenAI, model: string, prompt: string) {
  const maxRetries = maxCongestionRetriesForGeminiModel(model);
  let congestionRetries = 0;

  while (true) {
    try {
      const response = await generateContentWithUrlContextOnce(ai, model, prompt);
      return { response, congestionRetries };
    } catch (error) {
      if (!isGeminiCongestionError(error) || congestionRetries >= maxRetries) {
        throw error;
      }
      await sleepMs(GEMINI_CONGESTION_BACKOFF_MS[congestionRetries] ?? 8000);
      congestionRetries += 1;
    }
  }
}

async function generateContentWithJsonPreferenceOnce(ai: GoogleGenAI, model: string, prompt: string) {
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


async function generateContentWithUrlContextOnce(ai: GoogleGenAI, model: string, prompt: string) {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const tools = [{ urlContext: {} }];

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

async function generateContentWithSearchAndUrlContextOnce(ai: GoogleGenAI, model: string, prompt: string) {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const tools = [{ googleSearch: {} }, { urlContext: {} }];

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



async function generateContentWithSearchAndUrlContextFreeformOnce(ai: GoogleGenAI, model: string, prompt: string) {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const tools = [{ googleSearch: {} }, { urlContext: {} }];

  return ai.models.generateContent({
    model,
    contents,
    config: {
      tools,
      temperature: 0.2,
      ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } } : {})
    }
  });
}

async function generateContentWithSearchFreeformOnce(ai: GoogleGenAI, model: string, prompt: string) {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  const tools = [{ googleSearch: {} }];

  return ai.models.generateContent({
    model,
    contents,
    config: {
      tools,
      temperature: 1
    }
  });
}


async function generateContentWithSearchOnce(ai: GoogleGenAI, model: string, prompt: string) {
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
