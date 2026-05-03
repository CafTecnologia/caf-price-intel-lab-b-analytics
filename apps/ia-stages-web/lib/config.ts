import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_FILE = path.join(process.cwd(), ".env.local");

type EnvMap = Record<string, string>;

export type AiStage = "stage1" | "stage2" | "stage3";

export type StageModelConfig = Record<AiStage, string>;

export type PublicGeminiConfig = {
  hasApiKey: boolean;
  maskedApiKey: string | null;
  model: string;
  stageModels: StageModelConfig;
};

export type GeminiRuntimeConfig = {
  apiKey: string;
  model: string;
  stage?: AiStage;
};

type RuntimeConfigValues = {
  apiKey: string;
  model: string;
  stageModels: StageModelConfig;
};

type SaveGeminiConfigInput = {
  apiKey?: string;
  model?: string;
  stageModels?: Partial<StageModelConfig>;
};

export async function getPublicGeminiConfig(): Promise<PublicGeminiConfig> {
  const config = await readRuntimeConfig();

  return {
    hasApiKey: Boolean(config.apiKey),
    maskedApiKey: config.apiKey ? maskApiKey(config.apiKey) : null,
    model: config.model,
    stageModels: config.stageModels
  };
}

export async function getGeminiRuntimeConfig(
  overrides: Partial<GeminiRuntimeConfig> = {}
): Promise<GeminiRuntimeConfig> {
  const config = await readRuntimeConfig();
  const apiKey = overrides.apiKey?.trim() || config.apiKey;
  const stageModel = overrides.stage ? config.stageModels[overrides.stage] : "";
  const model = overrides.model?.trim() || stageModel || config.model;

  if (!apiKey) {
    throw new Error("Falta configurar GEMINI_API_KEY.");
  }

  if (!model) {
    throw new Error("Falta configurar GEMINI_MODEL.");
  }

  return { apiKey, model };
}

export async function saveGeminiConfig(input: SaveGeminiConfigInput) {
  const current = await readEnvFile();
  const next: EnvMap = { ...current };

  if (input.apiKey?.trim()) {
    next.GEMINI_API_KEY = input.apiKey.trim();
  }

  if (input.model?.trim()) {
    next.GEMINI_MODEL = input.model.trim();
  }

  for (const stage of STAGES) {
    const value = input.stageModels?.[stage];
    if (typeof value === "string") {
      next[STAGE_ENV_KEYS[stage]] = value.trim();
    }
  }

  const existing = await readEnvText();
  const body = upsertEnvValues(existing, {
    GEMINI_API_KEY: next.GEMINI_API_KEY ?? "",
    GEMINI_MODEL: next.GEMINI_MODEL ?? "",
    GEMINI_MODEL_STAGE1: next.GEMINI_MODEL_STAGE1 ?? "",
    GEMINI_MODEL_STAGE2: next.GEMINI_MODEL_STAGE2 ?? "",
    GEMINI_MODEL_STAGE3: next.GEMINI_MODEL_STAGE3 ?? ""
  });

  await writeFile(ENV_FILE, body, "utf8");
  return getPublicGeminiConfig();
}

async function readRuntimeConfig(): Promise<RuntimeConfigValues> {
  const fileEnv = await readEnvFile();

  return {
    apiKey: firstNonEmpty(fileEnv.GEMINI_API_KEY, process.env.GEMINI_API_KEY),
    model: firstNonEmpty(fileEnv.GEMINI_MODEL, process.env.GEMINI_MODEL),
    stageModels: {
      stage1: firstNonEmpty(fileEnv.GEMINI_MODEL_STAGE1, process.env.GEMINI_MODEL_STAGE1),
      stage2: firstNonEmpty(fileEnv.GEMINI_MODEL_STAGE2, process.env.GEMINI_MODEL_STAGE2),
      stage3: firstNonEmpty(fileEnv.GEMINI_MODEL_STAGE3, process.env.GEMINI_MODEL_STAGE3)
    }
  };
}

async function readEnvFile(): Promise<EnvMap> {
  const text = await readEnvText();
  const values: EnvMap = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    values[key] = unquoteEnvValue(value);
  }

  return values;
}

async function readEnvText() {
  try {
    return await readFile(ENV_FILE, "utf8");
  } catch {
    return "";
  }
}

function upsertEnvValues(existing: string, values: EnvMap) {
  const keys = new Set(Object.keys(values));
  const seen = new Set<string>();
  const lines = existing
    .split(/\r?\n/)
    .filter((line, index, all) => index < all.length - 1 || line.length > 0)
    .map((line) => {
      const trimmed = line.trim();
      const equalsIndex = trimmed.indexOf("=");
      const key = equalsIndex >= 0 ? trimmed.slice(0, equalsIndex).trim() : "";

      if (!keys.has(key)) {
        return line;
      }

      seen.add(key);
      return `${key}=${quoteEnvValue(values[key])}`;
    });

  for (const key of keys) {
    if (!seen.has(key)) {
      lines.push(`${key}=${quoteEnvValue(values[key])}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

const STAGES: AiStage[] = ["stage1", "stage2", "stage3"];

const STAGE_ENV_KEYS: Record<AiStage, string> = {
  stage1: "GEMINI_MODEL_STAGE1",
  stage2: "GEMINI_MODEL_STAGE2",
  stage3: "GEMINI_MODEL_STAGE3"
};

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function maskApiKey(apiKey: string) {
  if (apiKey.length <= 8) {
    return "****";
  }

  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}
