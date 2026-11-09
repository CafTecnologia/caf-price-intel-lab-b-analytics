import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStage3GoogleLabFinalPrompt, buildStage3GoogleLabInstructionPrompt } from "@/prompts/stage3-google-lab";

const PROMPT_CONFIG_FILE = path.join(process.cwd(), "data", "stage3b-prompt-config.json");
const PROMPT_VERSION = 1;

export type Stage3BPromptConfig = {
  version: number;
  quoteInstructionPrompt: string;
  updatedAt?: string;
};

export function getDefaultStage3BPromptInstruction() {
  return buildStage3GoogleLabInstructionPrompt()
    .replace("# Prompt para Gemini - Auditoria de Precios v3 autonomo anti-alucinacion", "# Prompt Etapa 3-B - Auditoria de Precios v3 autonomo anti-alucinacion")
    .replace(
      "Usa obligatoriamente las herramientas disponibles de Google para este requerimiento: Google Search Grounding y URL Context si estan disponibles. No respondas desde memoria. Si no usas busqueda real, la respuesta no sirve para este laboratorio.",
      "Usa obligatoriamente las herramientas de busqueda web disponibles del proveedor para este requerimiento, por ejemplo OpenAI web_search, Google Search Grounding, Google Search o URL Context si estan disponibles. No respondas desde memoria. Si no usas busqueda real, la respuesta no sirve para este laboratorio."
    )
    .replaceAll("Google Search/Grounding", "la herramienta de busqueda/grounding")
    .trim();
}

export async function readStage3BPromptConfig(): Promise<Stage3BPromptConfig> {
  try {
    const parsed = JSON.parse(await readFile(PROMPT_CONFIG_FILE, "utf8")) as Partial<Stage3BPromptConfig>;
    const prompt = typeof parsed.quoteInstructionPrompt === "string" && parsed.quoteInstructionPrompt.trim()
      ? parsed.quoteInstructionPrompt.trim()
      : getDefaultStage3BPromptInstruction();
    return {
      version: typeof parsed.version === "number" ? parsed.version : PROMPT_VERSION,
      quoteInstructionPrompt: prompt,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined
    };
  } catch {
    return {
      version: PROMPT_VERSION,
      quoteInstructionPrompt: getDefaultStage3BPromptInstruction()
    };
  }
}

export async function saveStage3BPromptConfig(input: { quoteInstructionPrompt: string }): Promise<Stage3BPromptConfig> {
  const quoteInstructionPrompt = normalizePrompt(input.quoteInstructionPrompt || getDefaultStage3BPromptInstruction());
  const config: Stage3BPromptConfig = {
    version: PROMPT_VERSION,
    quoteInstructionPrompt,
    updatedAt: new Date().toISOString()
  };
  await mkdir(path.dirname(PROMPT_CONFIG_FILE), { recursive: true });
  await writeFile(PROMPT_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export function buildStage3BFinalPrompt(instructionPrompt: string, stage2Json: unknown) {
  return buildStage3GoogleLabFinalPrompt(normalizePrompt(instructionPrompt), stage2Json);
}

function normalizePrompt(value: string) {
  const text = String(value || "").trim();
  if (!text) return getDefaultStage3BPromptInstruction();
  return text.length > 80000 ? text.slice(0, 80000) : text;
}