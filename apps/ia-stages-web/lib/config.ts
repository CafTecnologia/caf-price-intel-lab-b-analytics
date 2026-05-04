import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_FILE = path.join(process.cwd(), ".env.local");

type EnvMap = Record<string, string>;

export type AiStage = "stage1" | "stage2" | "stage3";
export type AiProvider = "gemini" | "deepseek";
export type WorkProfile = "default" | "medio" | "avanzado" | "manual";

export type StageModelConfig = Record<AiStage, string>;
export type StageProviderConfig = Record<AiStage, "" | AiProvider>;

export type PublicGeminiConfig = {
  hasApiKey: boolean;
  maskedApiKey: string | null;
  hasGeminiApiKey: boolean;
  hasDeepSeekApiKey: boolean;
  maskedGeminiApiKey: string | null;
  maskedDeepSeekApiKey: string | null;
  provider: AiProvider;
  geminiModel: string;
  deepseekModel: string;
  model: string;
  workProfile: WorkProfile;
  stageProviders: StageProviderConfig;
  stageModels: StageModelConfig;
};

export type GeminiRuntimeConfig = {
  apiKey: string;
  provider: AiProvider;
  model: string;
  stage?: AiStage;
};

type RuntimeConfigValues = {
  geminiApiKey: string;
  deepseekApiKey: string;
  provider: AiProvider;
  geminiModel: string;
  deepseekModel: string;
  workProfile: WorkProfile;
  stageProviders: StageProviderConfig;
  stageModels: StageModelConfig;
};

type SaveGeminiConfigInput = {
  apiKey?: string;
  geminiApiKey?: string;
  deepseekApiKey?: string;
  provider?: AiProvider;
  geminiModel?: string;
  deepseekModel?: string;
  model?: string;
  workProfile?: WorkProfile;
  stageProviders?: Partial<StageProviderConfig>;
  stageModels?: Partial<StageModelConfig>;
};

export async function getPublicGeminiConfig(): Promise<PublicGeminiConfig> {
  const config = await readRuntimeConfig();
  const selected = resolveSelection(config);
  const selectedApiKey = selected.provider === "deepseek" ? config.deepseekApiKey : config.geminiApiKey;

  return {
    hasApiKey: Boolean(selectedApiKey),
    maskedApiKey: selectedApiKey ? maskApiKey(selectedApiKey) : null,
    hasGeminiApiKey: Boolean(config.geminiApiKey),
    hasDeepSeekApiKey: Boolean(config.deepseekApiKey),
    maskedGeminiApiKey: config.geminiApiKey ? maskApiKey(config.geminiApiKey) : null,
    maskedDeepSeekApiKey: config.deepseekApiKey ? maskApiKey(config.deepseekApiKey) : null,
    provider: config.provider,
    geminiModel: config.geminiModel,
    deepseekModel: config.deepseekModel,
    model: `${selected.provider}:${selected.model}`,
    workProfile: config.workProfile,
    stageProviders: config.stageProviders,
    stageModels: config.stageModels
  };
}

export async function getGeminiRuntimeConfig(
  overrides: Partial<GeminiRuntimeConfig> = {}
): Promise<GeminiRuntimeConfig> {
  const config = await readRuntimeConfig();
  const overrideRef = overrides.model?.trim();
  const selected = overrideRef ? parseModelRef(overrideRef) : resolveSelection(config, overrides.stage);
  const providerApiKey = selected.provider === "deepseek" ? config.deepseekApiKey : config.geminiApiKey;
  const apiKey = overrides.apiKey?.trim() || providerApiKey;

  if (!apiKey) {
    throw new Error(
      selected.provider === "deepseek"
        ? "Falta configurar DEEPSEEK_API_KEY."
        : "Falta configurar GEMINI_API_KEY."
    );
  }

  if (!selected.model) {
    throw new Error("Falta configurar AI_MODEL.");
  }

  return { apiKey, provider: selected.provider, model: selected.model };
}

export async function saveGeminiConfig(input: SaveGeminiConfigInput) {
  const current = await readEnvFile();
  const next: EnvMap = { ...current };

  if (input.apiKey?.trim() || input.geminiApiKey?.trim()) {
    next.GEMINI_API_KEY = (input.geminiApiKey ?? input.apiKey ?? "").trim();
  }

  if (input.deepseekApiKey?.trim()) {
    next.DEEPSEEK_API_KEY = input.deepseekApiKey.trim();
  }

  if (input.provider === "gemini" || input.provider === "deepseek") {
    next.AI_PROVIDER = input.provider;
  }

  if (input.geminiModel?.trim()) {
    next.GEMINI_MODEL = stripProvider(input.geminiModel.trim());
  }

  if (input.deepseekModel?.trim()) {
    next.DEEPSEEK_MODEL = stripProvider(input.deepseekModel.trim());
  }

  if (input.model?.trim() && !input.provider) {
    const selected = parseModelRef(input.model.trim());
    next.AI_PROVIDER = selected.provider;
    if (selected.provider === "gemini") {
      next.GEMINI_MODEL = selected.model;
    } else {
      next.DEEPSEEK_MODEL = selected.model;
    }
  }

  if (isWorkProfile(input.workProfile)) {
    next.AI_WORK_PROFILE = input.workProfile;
  }

  for (const stage of STAGES) {
    const providerValue = input.stageProviders?.[stage];
    if (providerValue === "" || providerValue === "gemini" || providerValue === "deepseek") {
      next[STAGE_PROVIDER_ENV_KEYS[stage]] = providerValue;
    }

    const value = input.stageModels?.[stage];
    if (typeof value === "string") {
      next[STAGE_ENV_KEYS[stage]] = stripProvider(value.trim());
    }
  }

  const defaultProvider = normalizeProvider(next.AI_PROVIDER);
  const defaultModel = defaultProvider === "deepseek" ? next.DEEPSEEK_MODEL : next.GEMINI_MODEL;
  const existing = await readEnvText();
  const body = upsertEnvValues(existing, {
    GEMINI_API_KEY: next.GEMINI_API_KEY ?? "",
    DEEPSEEK_API_KEY: next.DEEPSEEK_API_KEY ?? "",
    AI_PROVIDER: defaultProvider,
    GEMINI_MODEL: next.GEMINI_MODEL ?? "",
    DEEPSEEK_MODEL: next.DEEPSEEK_MODEL ?? "",
    AI_MODEL: normalizeProviderModel(defaultProvider, defaultModel ?? ""),
    AI_PROVIDER_STAGE1: next.AI_PROVIDER_STAGE1 ?? "",
    AI_PROVIDER_STAGE2: next.AI_PROVIDER_STAGE2 ?? "",
    AI_PROVIDER_STAGE3: next.AI_PROVIDER_STAGE3 ?? "",
    AI_MODEL_STAGE1: next.AI_MODEL_STAGE1 ?? "",
    AI_MODEL_STAGE2: next.AI_MODEL_STAGE2 ?? "",
    AI_MODEL_STAGE3: next.AI_MODEL_STAGE3 ?? "",
    AI_WORK_PROFILE: next.AI_WORK_PROFILE ?? "manual"
  });

  await writeFile(ENV_FILE, body, "utf8");
  return getPublicGeminiConfig();
}

async function readRuntimeConfig(): Promise<RuntimeConfigValues> {
  const fileEnv = await readEnvFile();
  const legacyModel = firstNonEmpty(fileEnv.GEMINI_MODEL, process.env.GEMINI_MODEL);
  const aiModel = parseModelRef(
    firstNonEmpty(fileEnv.AI_MODEL, process.env.AI_MODEL, normalizeLegacyModelRef(legacyModel))
  );
  const provider = normalizeProvider(
    firstNonEmpty(fileEnv.AI_PROVIDER, process.env.AI_PROVIDER, aiModel.provider)
  );
  const geminiModel = firstNonEmpty(
    fileEnv.GEMINI_MODEL,
    process.env.GEMINI_MODEL,
    aiModel.provider === "gemini" ? aiModel.model : ""
  );
  const deepseekModel = firstNonEmpty(
    fileEnv.DEEPSEEK_MODEL,
    process.env.DEEPSEEK_MODEL,
    aiModel.provider === "deepseek" ? aiModel.model : ""
  );
  const stage1 = readStageConfig("stage1", fileEnv);
  const stage2 = readStageConfig("stage2", fileEnv);
  const stage3 = readStageConfig("stage3", fileEnv);
  const workProfile = normalizeWorkProfile(
    firstNonEmpty(fileEnv.AI_WORK_PROFILE, process.env.AI_WORK_PROFILE)
  );

  return {
    geminiApiKey: firstNonEmpty(fileEnv.GEMINI_API_KEY, process.env.GEMINI_API_KEY),
    deepseekApiKey: firstNonEmpty(fileEnv.DEEPSEEK_API_KEY, process.env.DEEPSEEK_API_KEY),
    provider,
    geminiModel,
    deepseekModel,
    workProfile,
    stageProviders: {
      stage1: stage1.provider,
      stage2: stage2.provider,
      stage3: stage3.provider
    },
    stageModels: {
      stage1: stage1.model,
      stage2: stage2.model,
      stage3: stage3.model
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
  stage1: "AI_MODEL_STAGE1",
  stage2: "AI_MODEL_STAGE2",
  stage3: "AI_MODEL_STAGE3"
};

const STAGE_PROVIDER_ENV_KEYS: Record<AiStage, string> = {
  stage1: "AI_PROVIDER_STAGE1",
  stage2: "AI_PROVIDER_STAGE2",
  stage3: "AI_PROVIDER_STAGE3"
};

function resolveSelection(config: RuntimeConfigValues, stage?: AiStage) {
  const stageProvider = stage ? config.stageProviders[stage] : "";
  const provider = stageProvider || config.provider;
  const stageModel = stage ? config.stageModels[stage] : "";
  const providerDefault = provider === "deepseek" ? config.deepseekModel : config.geminiModel;

  return {
    provider,
    model: stripProvider(stageModel || providerDefault)
  };
}

function readStageConfig(stage: AiStage, env: EnvMap): { provider: "" | AiProvider; model: string } {
  const provider = normalizeOptionalProvider(
    firstNonEmpty(env[STAGE_PROVIDER_ENV_KEYS[stage]], process.env[STAGE_PROVIDER_ENV_KEYS[stage]])
  );
  const rawModel = firstNonEmpty(env[STAGE_ENV_KEYS[stage]], process.env[STAGE_ENV_KEYS[stage]]);
  const parsed = rawModel ? parseModelRef(rawModel) : null;

  return {
    provider: provider || parsed?.provider || "",
    model: parsed?.model ?? rawModel
  };
}

function parseModelRef(value: string): { provider: AiProvider; model: string } {
  const normalized = normalizeModelRef(value);
  const separatorIndex = normalized.indexOf(":");

  if (separatorIndex > 0) {
    const provider = normalized.slice(0, separatorIndex) as AiProvider;
    const model = normalized.slice(separatorIndex + 1);
    return {
      provider: provider === "deepseek" ? "deepseek" : "gemini",
      model
    };
  }

  return {
    provider: normalized.startsWith("deepseek-") ? "deepseek" : "gemini",
    model: normalized
  };
}

function normalizeProvider(value: string | undefined): AiProvider {
  return value?.trim().toLowerCase() === "deepseek" ? "deepseek" : "gemini";
}

function normalizeOptionalProvider(value: string | undefined): "" | AiProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "gemini" || normalized === "deepseek") {
    return normalized;
  }

  return "";
}

function normalizeWorkProfile(value: string | undefined): WorkProfile {
  return isWorkProfile(value) ? value : "manual";
}

function isWorkProfile(value: unknown): value is WorkProfile {
  return value === "default" || value === "medio" || value === "avanzado" || value === "manual";
}

function normalizeProviderModel(provider: AiProvider, model: string) {
  return model.trim() ? `${provider}:${stripProvider(model)}` : "";
}

function stripProvider(value: string) {
  const trimmed = value.trim();
  const parsed = /^(gemini|deepseek):(.+)$/i.exec(trimmed);
  return parsed ? parsed[2].trim() : trimmed;
}

function normalizeModelRef(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^(gemini|deepseek):/i.test(trimmed)) {
    const [provider, ...rest] = trimmed.split(":");
    return `${provider.toLowerCase()}:${rest.join(":").trim()}`;
  }

  if (/^deepseek-/i.test(trimmed)) {
    return `deepseek:${trimmed}`;
  }

  return `gemini:${trimmed}`;
}

function normalizeLegacyModelRef(value: string) {
  return value.trim() ? normalizeModelRef(value) : "";
}

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
