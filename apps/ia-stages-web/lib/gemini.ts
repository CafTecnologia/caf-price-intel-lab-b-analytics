import { GoogleGenAI, type GroundingMetadata } from "@google/genai";
import { getGeminiRuntimeConfig, type AiStage } from "@/lib/config";

type GeminiCallInput = {
  prompt: string;
  apiKey?: string;
  model?: string;
  stage?: AiStage;
};

export async function callGemini({ prompt, apiKey, model, stage }: GeminiCallInput) {
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await generateContentWithJsonPreference(ai, config.model, prompt);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    model: config.model,
    text,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata
  };
}

export async function callGeminiWithSearch({ prompt, apiKey, model, stage }: GeminiCallInput) {
  const config = await getGeminiRuntimeConfig({ apiKey, model, stage });

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await generateContentWithSearch(ai, config.model, prompt);

  const text = response.text?.trim();
  if (!text) {
    throw new Error("El motor IA no devolvio contenido.");
  }

  return {
    model: config.model,
    text,
    groundingMetadata: response.candidates?.[0]?.groundingMetadata as GroundingMetadata | undefined,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata
  };
}

async function generateContentWithJsonPreference(
  ai: GoogleGenAI,
  model: string,
  prompt: string
) {
  const contents = [
    {
      role: "user",
      parts: [{ text: prompt }]
    }
  ];

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
  const contents = [
    {
      role: "user",
      parts: [{ text: prompt }]
    }
  ];
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
