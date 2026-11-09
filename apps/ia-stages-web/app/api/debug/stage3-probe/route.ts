import { NextResponse } from "next/server";
import { PipelineFailure, failureToApiBody } from "@/lib/ai-failures";
import { callGeminiWithSearch } from "@/lib/gemini";
import { buildStage3Prompt } from "@/prompts/stage3-pricing";

export const runtime = "nodejs";

type ProbeBody = {
  stage2Json?: unknown;
  model?: string;
  maxItems?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProbeBody;

    if (!body?.stage2Json) {
      return NextResponse.json({ error: "Falta stage2Json." }, { status: 400 });
    }

    const stage2Json = sliceStage2Json(body.stage2Json, body.maxItems);
    const prompt = buildStage3Prompt(stage2Json);
    const ai = await callGeminiWithSearch({ prompt, stage: "stage3", model: body.model });

    const parsed = safeParseJson(ai.text);
    const items = Array.isArray(parsed?.items) ? parsed?.items : [];
    const stats = summarizePricing(items);

    return NextResponse.json({
      ok: true,
      provider: ai.provider,
      model: ai.model,
      stats,
      // Returned for inspection; callers should not persist blindly.
      result: parsed ?? null
    });
  } catch (error) {
    if (error instanceof PipelineFailure) {
      return NextResponse.json(failureToApiBody(error), { status: error.httpStatus });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado en stage3-probe." },
      { status: 500 }
    );
  }
}

function sliceStage2Json(input: unknown, maxItems?: number) {
  const max = clampInt(maxItems ?? 0, 0, 200);
  if (!max) return input;
  if (!input || typeof input !== "object") return input;
  if (!("items" in input)) return input;
  const items = (input as { items?: unknown }).items;
  if (!Array.isArray(items)) return input;

  return {
    ...(input as Record<string, unknown>),
    items: items.slice(0, max)
  };
}

function safeParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const withoutFences = trimmed.startsWith("```")
    ? trimmed
        .split("\n")
        .filter((line) => !line.trim().startsWith("```"))
        .join("\n")
        .trim()
    : trimmed;

  try {
    const parsed = JSON.parse(withoutFences) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarizePricing(items: unknown[]) {
  let with0 = 0;
  let with1 = 0;
  let with2 = 0;
  let with3p = 0;
  const examples: Array<{ idx: number; consecutivo?: unknown; fuentes: number; vista?: unknown }> = [];

  items.forEach((item, idx) => {
    const sources = isRecord(item) ? item["Cotizaciones encontradas"] : null;
    const count = Array.isArray(sources) ? sources.length : 0;
    if (count === 0) with0 += 1;
    else if (count === 1) with1 += 1;
    else if (count === 2) with2 += 1;
    else with3p += 1;

    if (examples.length < 8 && (count === 0 || count >= 1)) {
      examples.push({
        idx: idx + 1,
        consecutivo: isRecord(item) ? item["Consecutivo interno"] : undefined,
        fuentes: count,
        vista: isRecord(item) ? item["Vista rápida de cotización"] : undefined
      });
    }
  });

  return {
    total: items.length,
    cotizados_0: with0,
    cotizados_1: with1,
    cotizados_2: with2,
    cotizados_3_mas: with3p,
    examples
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInt(value: number, min: number, max: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

