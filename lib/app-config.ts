import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];

export type AppAiConfig = {
  deepseekApiKey: string;
  deepseekModel: DeepSeekModel;
};

export type PublicAppAiConfig = {
  provider: "deepseek";
  hasDeepseekApiKey: boolean;
  deepseekModel: DeepSeekModel;
  models: DeepSeekModel[];
};

const DEFAULT_CONFIG: AppAiConfig = {
  deepseekApiKey: "",
  deepseekModel: "deepseek-flash",
};

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]financial-offer-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function configPath(): string {
  return resolve(projectRoot(), "data", "financial-offer", "app-config.json");
}

function normalizeModel(value: unknown): DeepSeekModel {
  if (value === "deepseek-v4-flash") return "deepseek-flash";
  return DEEPSEEK_MODELS.includes(value as DeepSeekModel) ? (value as DeepSeekModel) : DEFAULT_CONFIG.deepseekModel;
}

export async function readAppAiConfig(): Promise<AppAiConfig> {
  const path = configPath();
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<AppAiConfig>;
    return {
      deepseekApiKey: typeof parsed.deepseekApiKey === "string" ? parsed.deepseekApiKey : "",
      deepseekModel: normalizeModel(parsed.deepseekModel),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function publicAiConfig(config: AppAiConfig): PublicAppAiConfig {
  return {
    provider: "deepseek",
    hasDeepseekApiKey: Boolean(config.deepseekApiKey.trim()),
    deepseekModel: config.deepseekModel,
    models: [...DEEPSEEK_MODELS],
  };
}

export async function saveAppAiConfig(patch: { deepseekApiKey?: string | null; deepseekModel?: string | null }): Promise<AppAiConfig> {
  const current = await readAppAiConfig();
  const next: AppAiConfig = {
    deepseekApiKey: patch.deepseekApiKey === undefined ? current.deepseekApiKey : (patch.deepseekApiKey ?? "").trim(),
    deepseekModel: patch.deepseekModel === undefined ? current.deepseekModel : normalizeModel(patch.deepseekModel),
  };
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
  await rename(tmpPath, path);
  return next;
}
