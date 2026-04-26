import "server-only";

import type { AiProvider } from "@ai-first-contracts/enums";
import { ProviderHttpError } from "@ai-first-core/providers/shared/http";

import {
  DEFAULT_PROVIDER_BASE_URLS,
  PROVIDER_MODEL_OPTIONS,
  type ProviderModelOption,
} from "./provider-models";
import { readStoredProviderSettings } from "./provider-settings";

interface GeminiListModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
}

function fallbackModels(provider: AiProvider): ProviderModelOption[] {
  return PROVIDER_MODEL_OPTIONS[provider];
}

function toGeminiModelOption(model: {
  name?: string;
  displayName?: string;
  description?: string;
}): ProviderModelOption | null {
  if (!model.name?.startsWith("models/")) {
    return null;
  }

  const value = model.name.replace(/^models\//, "");
  return {
    value,
    label: model.displayName ? `${model.displayName} (${value})` : value,
    description: model.description ?? undefined,
  };
}

export async function discoverProviderModels(provider: AiProvider): Promise<{
  provider: AiProvider;
  models: ProviderModelOption[];
  source: "live" | "fallback";
  message: string | null;
}> {
  if (provider !== "gemini") {
    return {
      provider,
      models: fallbackModels(provider),
      source: "fallback",
      message: null,
    };
  }

  const settings = readStoredProviderSettings();
  const connection = settings.connections.gemini;
  const apiKey = connection.apiKey;
  const baseUrl = connection.baseUrl || DEFAULT_PROVIDER_BASE_URLS.gemini;

  if (!apiKey) {
    return {
      provider,
      models: fallbackModels(provider),
      source: "fallback",
      message: "No hay API key guardada para consultar el catalogo live de Gemini.",
    };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1beta/models?pageSize=1000`, {
      headers: {
        "x-goog-api-key": apiKey,
      },
      cache: "no-store",
    });

    const rawText = await response.text();
    const parsedBody = rawText ? (JSON.parse(rawText) as GeminiListModelsResponse | { error?: { message?: string } }) : {};

    if (!response.ok) {
      const providerMessage =
        parsedBody &&
        typeof parsedBody === "object" &&
        "error" in parsedBody &&
        parsedBody.error?.message
          ? parsedBody.error.message
          : `Gemini models.list failed with status ${response.status}`;

      throw new ProviderHttpError(providerMessage, response.status, parsedBody);
    }

    const models = (parsedBody as GeminiListModelsResponse).models ?? [];
    const options = models
      .filter(
        (model) =>
          typeof model.name === "string" &&
          model.name.startsWith("models/gemini") &&
          Array.isArray(model.supportedGenerationMethods) &&
          model.supportedGenerationMethods.includes("generateContent"),
      )
      .map(toGeminiModelOption)
      .filter((model): model is ProviderModelOption => Boolean(model))
      .sort((left, right) => left.value.localeCompare(right.value));

    return {
      provider,
      models: options.length > 0 ? options : fallbackModels(provider),
      source: options.length > 0 ? "live" : "fallback",
      message: options.length > 0 ? null : "Gemini no devolvio modelos generateContent; se usan opciones de respaldo.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron consultar los modelos de Gemini.";
    return {
      provider,
      models: fallbackModels(provider),
      source: "fallback",
      message,
    };
  }
}
