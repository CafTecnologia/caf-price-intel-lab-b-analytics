import { NextResponse } from "next/server";

import { publicAiConfig, readAppAiConfig, saveAppAiConfig } from "@offer/lib/app-config";

export async function GET() {
  return NextResponse.json(publicAiConfig(await readAppAiConfig()));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { deepseekApiKey?: string | null; deepseekModel?: string | null };
    const config = await saveAppAiConfig(body);
    return NextResponse.json(publicAiConfig(config));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo guardar la configuracion IA.",
        code: "AI_CONFIG_SAVE_FAILED",
      },
      { status: 400 },
    );
  }
}
