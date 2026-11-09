import { NextResponse } from "next/server";
import { buildStage3GoogleLabInstructionPrompt } from "@/prompts/stage3-google-lab";
import { runStage3ConversationalLab } from "@/lib/stage3-conversational-lab";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const stage2Json = body.stage2Json;
    if (!stage2Json) {
      return NextResponse.json({ ok: false, error: "Falta stage2Json para ejecutar el laboratorio conversacional." }, { status: 400 });
    }

    const result = await runStage3ConversationalLab({
      stage2Json,
      instructionPrompt: typeof body.instructionPrompt === "string" && body.instructionPrompt.trim()
        ? body.instructionPrompt
        : buildStage3GoogleLabInstructionPrompt(),
      googleModel: typeof body.googleModel === "string" ? body.googleModel : undefined,
      auditorModel: typeof body.auditorModel === "string" ? body.auditorModel : "deepseek:deepseek-v4-pro",
      maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : 3,
      runId: typeof body.runId === "string" ? body.runId : undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "No se pudo ejecutar el laboratorio conversacional.", diagnostic: message }, { status: 500 });
  }
}
