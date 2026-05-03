import { NextResponse } from "next/server";
import { getPublicGeminiConfig, saveGeminiConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getPublicGeminiConfig());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo leer la configuración." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey : "";
    const model = typeof body?.model === "string" ? body.model : "";
    const stageModels = parseStageModels(body?.stageModels);

    if (!model.trim()) {
      return NextResponse.json({ error: "Indica un modelo del motor IA." }, { status: 400 });
    }

    const config = await saveGeminiConfig({ apiKey, model, stageModels });
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la configuración." },
      { status: 500 }
    );
  }
}

function parseStageModels(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  return {
    stage1: typeof input.stage1 === "string" ? input.stage1 : "",
    stage2: typeof input.stage2 === "string" ? input.stage2 : "",
    stage3: typeof input.stage3 === "string" ? input.stage3 : ""
  };
}
