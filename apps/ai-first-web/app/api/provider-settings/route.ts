import { NextResponse } from "next/server";

import { AI_PROVIDERS, type AiProvider } from "@ai-first-contracts/enums";
import { z } from "zod";

import { getProviderSettingsSummary, saveProviderConnection } from "@web/lib/provider-settings";

const SaveProviderSettingsSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    apiKey: z.string().trim().optional(),
    model: z.string().trim().min(1),
    clearApiKey: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  return NextResponse.json({
    settings: getProviderSettingsSummary(),
  });
}

export async function POST(request: Request) {
  try {
    const payload = SaveProviderSettingsSchema.parse(await request.json());
    const settings = saveProviderConnection({
      provider: payload.provider as AiProvider,
      apiKey: payload.apiKey,
      clearApiKey: payload.clearApiKey,
      model: payload.model,
      setActive: true,
    });

    return NextResponse.json({
      settings,
      message: `Configuracion guardada. ${payload.provider} queda como proveedor por defecto; prueba la conexion para confirmarla.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la configuracion del proveedor." },
      { status: 400 },
    );
  }
}
