import { NextResponse } from "next/server";
import { failureToApiBody, normalizePipelineFailure } from "@/lib/ai-failures";
import { callGemini } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import { estimateAiCost, extractGeminiUsageMetadata } from "@/lib/usage-cost";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey : undefined;
    const model = typeof body?.model === "string" ? body.model : undefined;

    const response = await callGemini({
      apiKey,
      model,
      prompt:
        'Prueba de conexión. Devuelve únicamente este JSON válido: {"ok":true,"message":"conexion_ok"}'
    });

    parseJsonFromModelText(response.text);
    const usage = extractGeminiUsageMetadata(response.usageMetadata);
    const cost = estimateAiCost({ provider: "gemini", model: response.model, usage });

    return NextResponse.json({
      ok: true,
      model: response.model,
      message: "Conexion exitosa con el motor IA.",
      usage,
      cost
    });
  } catch (error) {
    const failure = normalizePipelineFailure(error, "pipeline");
    return NextResponse.json(
      {
        ok: false,
        ...failureToApiBody(failure)
      },
      { status: failure.httpStatus }
    );
  }
}
