import { NextResponse } from "next/server";
import { getPublicGeminiConfig, saveGeminiConfig } from "@/lib/config";
import { getPublicExternalProvidersConfig, saveExternalProviderKeys } from "@/lib/provider-services";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await buildPublicConfigResponse());
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
    const enableStage3ReviewTools =
      typeof body?.enableStage3ReviewTools === "boolean" ? body.enableStage3ReviewTools : undefined;
    const reviewProvider = parseReviewProvider(body?.reviewProvider);
    const reviewModel = typeof body?.reviewModel === "string" ? body.reviewModel : "";
    const displayNumberFormat = parseDisplayNumberFormat(body?.displayNumberFormat);
    const providerServiceKeys = body?.providerServiceKeys;

    if (!model.trim() && !geminiModel.trim() && !deepseekModel.trim()) {
      return NextResponse.json({ error: "Indica un modelo del motor IA." }, { status: 400 });
    }

    await saveGeminiConfig({
      apiKey,
      geminiApiKey,
      deepseekApiKey,
      provider,
      geminiModel,
      deepseekModel,
      model,
      workProfile,
      stageProviders,
      stageModels,
      ...(enableStage3ReviewTools !== undefined ? { enableStage3ReviewTools } : {}),
      ...(reviewProvider !== undefined ? { reviewProvider } : {}),
      ...(reviewModel !== undefined ? { reviewModel } : {}),
      ...(displayNumberFormat !== undefined ? { displayNumberFormat } : {})
    });
    await saveExternalProviderKeys(providerServiceKeys);
    return NextResponse.json(await buildPublicConfigResponse());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la configuración." },
      { status: 500 }
    );
  }
}

async function buildPublicConfigResponse() {
  const [base, providerServices] = await Promise.all([
    getPublicGeminiConfig(),
    getPublicExternalProvidersConfig()
  ]);
  return { ...base, providerServices };
}

function parseDisplayNumberFormat(value: unknown): "es-CO" | "raw" | undefined {
  if (value === "es-CO" || value === "raw") {
    return value;
  }
  return undefined;
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

function parseReviewProvider(value: unknown): "" | "gemini" | "deepseek" | undefined {
  if (value === "" || value === "gemini" || value === "deepseek") {
    return value;
  }
  return undefined;
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
