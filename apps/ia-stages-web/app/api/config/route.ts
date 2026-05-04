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
    const geminiApiKey = typeof body?.geminiApiKey === "string" ? body.geminiApiKey : "";
    const deepseekApiKey = typeof body?.deepseekApiKey === "string" ? body.deepseekApiKey : "";
    const provider = body?.provider === "deepseek" ? "deepseek" : body?.provider === "gemini" ? "gemini" : undefined;
    const geminiModel = typeof body?.geminiModel === "string" ? body.geminiModel : "";
    const deepseekModel = typeof body?.deepseekModel === "string" ? body.deepseekModel : "";
    const model = typeof body?.model === "string" ? body.model : "";
    const workProfile = parseWorkProfile(body?.workProfile);
    const stageProviders = parseStageProviders(body?.stageProviders);
    const stageModels = parseStageModels(body?.stageModels);

    if (!model.trim() && !geminiModel.trim() && !deepseekModel.trim()) {
      return NextResponse.json({ error: "Indica un modelo del motor IA." }, { status: 400 });
    }

    const config = await saveGeminiConfig({
      apiKey,
      geminiApiKey,
      deepseekApiKey,
      provider,
      geminiModel,
      deepseekModel,
      model,
      workProfile,
      stageProviders,
      stageModels
    });
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la configuración." },
      { status: 500 }
    );
  }
}

function parseStageProviders(
  value: unknown
): { stage1: "" | "gemini" | "deepseek"; stage2: "" | "gemini" | "deepseek"; stage3: "" | "gemini" | "deepseek" } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  return {
    stage1:
      input.stage1 === "gemini" || input.stage1 === "deepseek"
        ? (input.stage1 as "gemini" | "deepseek")
        : "",
    stage2:
      input.stage2 === "gemini" || input.stage2 === "deepseek"
        ? (input.stage2 as "gemini" | "deepseek")
        : "",
    stage3:
      input.stage3 === "gemini" || input.stage3 === "deepseek"
        ? (input.stage3 as "gemini" | "deepseek")
        : ""
  };
}

function parseWorkProfile(value: unknown) {
  if (value === "default" || value === "medio" || value === "avanzado" || value === "manual") {
    return value;
  }
  return undefined;
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
