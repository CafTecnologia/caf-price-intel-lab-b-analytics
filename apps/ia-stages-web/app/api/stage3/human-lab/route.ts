import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildStage3GoogleLabFinalPrompt, buildStage3GoogleLabInstructionPrompt } from "@/prompts/stage3-google-lab";

export const runtime = "nodejs";

const DEFAULT_FIXTURE = path.join("data", "lab-fixtures", "outputs", "lab_stage2_office_writing_20260513.json");

export async function GET() {
  try {
    const fixturePath = path.join(process.cwd(), DEFAULT_FIXTURE);
    const stage2Json = JSON.parse(await readFile(fixturePath, "utf8"));
    const prompt = buildStage3GoogleLabInstructionPrompt();
    const finalPrompt = buildStage3GoogleLabFinalPrompt(prompt, stage2Json);
    return NextResponse.json({
      ok: true,
      fixturePath: DEFAULT_FIXTURE,
      stage2Json,
      prompt,
      finalPrompt,
      defaultModels: {
        google: "gemini:gemini-3.5-flash",
        supervisor: "deepseek:deepseek-v4-pro",
        urlContext: "gemini:gemini-3.5-flash"
      },
      models: {
        google: [
          { value: "gemini:gemini-3.5-flash", label: "Gemini 3.5 Flash" },
          { value: "gemini:gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
          { value: "gemini:gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
          { value: "gemini:gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
          { value: "gemini:gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
          { value: "gemini:gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview" },
          { value: "gemini:gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { value: "gemini:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { value: "gemini:gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
          { value: "gemini:gemini-2.5-flash-lite-preview-09-2025", label: "Gemini 2.5 Flash-Lite Preview 09-2025" }
        ],
        supervisor: [
          { value: "gemini:gemini-3.5-flash", label: "Gemini 3.5 Flash" },
          { value: "gemini:gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
          { value: "gemini:gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
          { value: "gemini:gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
          { value: "gemini:gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
          { value: "gemini:gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview" },
          { value: "gemini:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { value: "gemini:gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { value: "gemini:gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
          { value: "deepseek:deepseek-v4-pro", label: "DeepSeek V4 Pro" }
        ],
        urlContext: [
          { value: "gemini:gemini-3.5-flash", label: "Gemini 3.5 Flash" },
          { value: "gemini:gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
          { value: "gemini:gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
          { value: "gemini:gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
          { value: "gemini:gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
          { value: "gemini:gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview" },
          { value: "gemini:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { value: "gemini:gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { value: "gemini:gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
          { value: "gemini:gemini-2.5-flash-lite-preview-09-2025", label: "Gemini 2.5 Flash-Lite Preview 09-2025" }
        ]
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "No se pudo cargar el laboratorio humano.", diagnostic: message }, { status: 500 });
  }
}
