import { NextResponse } from "next/server";

import { AI_PROVIDERS, type AiProvider } from "@ai-first-contracts/enums";
import { ProviderHttpError } from "@ai-first-core/providers/shared/http";
import { z } from "zod";

import { testProviderConnection } from "@web/lib/provider-connection-test";
import {
  getProviderSettingsSummary,
  readStoredProviderSettings,
  recordProviderTestResult,
  resolveSavedModel,
  saveProviderConnection,
} from "@web/lib/provider-settings";

const TestProviderConnectionSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    apiKey: z.string().trim().optional(),
    model: z.string().trim().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const rawBody = await request.text();
  const unsafePayload = (() => {
    if (!rawBody) {
      return null;
    }

    try {
      return (JSON.parse(rawBody) as { provider?: AiProvider; model?: unknown }) ?? null;
    } catch {
      return null;
    }
  })();

  try {
    const payload = TestProviderConnectionSchema.parse(rawBody ? JSON.parse(rawBody) : {});
    const stored = readStoredProviderSettings();
    const provider = payload.provider as AiProvider;
    const apiKey = payload.apiKey?.trim() || stored.connections[provider].apiKey;
    const model = resolveSavedModel(provider, payload.model);

    if (!apiKey) {
      return NextResponse.json(
        { error: "Pega una API key o guarda una previamente para poder probar la conexion." },
        { status: 400 },
      );
    }

    saveProviderConnection({
      provider,
      apiKey: payload.apiKey,
      model,
      setActive: true,
    });

    const result = await testProviderConnection({
      provider,
      apiKey,
      model,
      baseUrl: stored.connections[provider].baseUrl,
    });

    const settings = recordProviderTestResult({
      provider,
      status: "success",
      message: result.message,
      model,
    });

    return NextResponse.json({
      ok: true,
      message: result.message,
      usage: result.usage,
      preview: result.preview,
      settings,
    });
  } catch (error) {
    const provider = unsafePayload?.provider;
    const providerMessage =
      error instanceof ProviderHttpError &&
      error.responseBody &&
      typeof error.responseBody === "object" &&
      "error" in error.responseBody &&
      error.responseBody.error &&
      typeof error.responseBody.error === "object" &&
      "message" in error.responseBody.error &&
      typeof error.responseBody.error.message === "string"
        ? error.responseBody.error.message
        : null;
    const message =
      providerMessage || (error instanceof Error ? error.message : "No se pudo probar la conexion.");

    const settings = provider
      ? recordProviderTestResult({
          provider,
          status: "error",
          message,
          model: unsafePayload && "model" in unsafePayload && typeof unsafePayload.model === "string" ? unsafePayload.model : undefined,
        })
      : getProviderSettingsSummary();

    return NextResponse.json(
      {
        ok: false,
        error: message,
        settings,
      },
      { status: 400 },
    );
  }
}
