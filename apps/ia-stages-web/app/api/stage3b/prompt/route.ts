import { NextResponse } from "next/server";
import { getDefaultStage3BPromptInstruction, readStage3BPromptConfig, saveStage3BPromptConfig } from "@/lib/stage3b-prompt-config";

export const runtime = "nodejs";

export async function GET() {
  const config = await readStage3BPromptConfig();
  return NextResponse.json({
    ok: true,
    ...config,
    defaultQuoteInstructionPrompt: getDefaultStage3BPromptInstruction()
  });
}

export async function POST(request: Request) {
  let body: { quoteInstructionPrompt?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (typeof body.quoteInstructionPrompt !== "string" || !body.quoteInstructionPrompt.trim()) {
    return NextResponse.json({ error: "Falta quoteInstructionPrompt para guardar el prompt 3-B." }, { status: 400 });
  }

  const config = await saveStage3BPromptConfig({ quoteInstructionPrompt: body.quoteInstructionPrompt });
  return NextResponse.json({ ok: true, ...config, defaultQuoteInstructionPrompt: getDefaultStage3BPromptInstruction() });
}