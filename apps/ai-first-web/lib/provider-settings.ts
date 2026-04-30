import "server-only";

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { AI_PROVIDERS, type AiProvider } from "@ai-first-contracts/enums";
import { z } from "zod";

import {
  DEFAULT_PROVIDER_BASE_URLS,
  PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  type ProviderConnectionSummary,
  type ProviderSettingsSummary,
} from "./provider-models";
import { backupCorruptedJsonFile, readSanitizedJsonText } from "./local-json-file";

const StoredProviderConnectionSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    apiKey: z.string().trim().min(1).nullable().default(null),
    baseUrl: z.string().trim().url(),
    model: z.string().trim().min(1),
    lastTestStatus: z.enum(["idle", "success", "error"]).default("idle"),
    lastTestMessage: z.string().trim().min(1).nullable().default(null),
    lastTestAt: z.string().datetime().nullable().default(null),
    lastTestModel: z.string().trim().min(1).nullable().default(null),
  })
  .strict();

const StoredProviderSettingsSchema = z
  .object({
    activeProvider: z.enum(AI_PROVIDERS),
    connections: z.object({
      openai: StoredProviderConnectionSchema,
      gemini: StoredProviderConnectionSchema,
      anthropic: StoredProviderConnectionSchema,
      deepseek: StoredProviderConnectionSchema,
    }),
  })
  .strict();

type StoredProviderConnection = z.infer<typeof StoredProviderConnectionSchema>;
type StoredProviderSettings = z.infer<typeof StoredProviderSettingsSchema>;

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function settingsPath(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "provider-settings.json");
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function defaultModel(provider: AiProvider): string {
  return PROVIDER_MODEL_OPTIONS[provider][0]?.value ?? "gpt-4.1-mini";
}

function defaultConnection(provider: AiProvider): StoredProviderConnection {
  return {
    provider,
    apiKey: null,
    baseUrl: DEFAULT_PROVIDER_BASE_URLS[provider],
    model: defaultModel(provider),
    lastTestStatus: "idle",
    lastTestMessage: null,
    lastTestAt: null,
    lastTestModel: null,
  };
}

function defaultSettings(): StoredProviderSettings {
  return {
    activeProvider: "openai",
    connections: {
      openai: defaultConnection("openai"),
      gemini: defaultConnection("gemini"),
      anthropic: defaultConnection("anthropic"),
      deepseek: defaultConnection("deepseek"),
    },
  };
}

function persist(settings: StoredProviderSettings): void {
  const targetPath = settingsPath();
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(settings, null, 2), "utf8");
}

function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) {
    return null;
  }

  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***${apiKey.slice(-2)}`;
  }

  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
}

function toSummary(settings: StoredProviderSettings): ProviderSettingsSummary {
  const connections = Object.fromEntries(
    (Object.keys(settings.connections) as AiProvider[]).map((provider) => {
      const connection = settings.connections[provider];
      const summary: ProviderConnectionSummary = {
        provider,
        model: connection.model,
        apiKeyStored: Boolean(connection.apiKey),
        apiKeyPreview: maskApiKey(connection.apiKey),
        lastTestStatus: connection.lastTestStatus,
        lastTestMessage: connection.lastTestMessage,
        lastTestAt: connection.lastTestAt,
        lastTestModel: connection.lastTestModel,
        isActive: settings.activeProvider === provider,
      };

      return [provider, summary];
    }),
  ) as ProviderSettingsSummary["connections"];

  return {
    activeProvider: settings.activeProvider,
    connections,
  };
}

export function readStoredProviderSettings(): StoredProviderSettings {
  const targetPath = settingsPath();

  if (!existsSync(targetPath)) {
    const settings = defaultSettings();
    persist(settings);
    return settings;
  }

  try {
    const rawText = readSanitizedJsonText(targetPath);
    if (!rawText) {
      const settings = defaultSettings();
      persist(settings);
      return settings;
    }

    return StoredProviderSettingsSchema.parse(JSON.parse(rawText));
  } catch {
    backupCorruptedJsonFile(targetPath);
    const settings = defaultSettings();
    persist(settings);
    return settings;
  }
}

export function getProviderSettingsSummary(): ProviderSettingsSummary {
  return toSummary(readStoredProviderSettings());
}

export function getActiveProviderDefaults(): { provider: AiProvider; model: string; label: string } {
  const settings = readStoredProviderSettings();
  const connection = settings.connections[settings.activeProvider];

  return {
    provider: settings.activeProvider,
    model: connection.model,
    label: PROVIDER_LABELS[settings.activeProvider],
  };
}

export function getActiveProviderConnectionForServer(): {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  label: string;
} {
  const settings = readStoredProviderSettings();
  const connection = settings.connections[settings.activeProvider];

  return {
    provider: settings.activeProvider,
    model: connection.model,
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    label: PROVIDER_LABELS[settings.activeProvider],
  };
}

export function resolveSavedModel(provider: AiProvider, preferredModel?: string | null): string {
  const explicitModel = preferredModel?.trim();
  if (explicitModel) {
    return explicitModel;
  }

  const settings = readStoredProviderSettings();
  return settings.connections[provider].model || defaultModel(provider);
}

export function applyStoredProviderSettingsToProcessEnv(): void {
  const settings = readStoredProviderSettings();

  process.env.AI_FIRST_FORCE_MOCK = "false";
  process.env.AI_FIRST_PROVIDER_FALLBACK_ON_ERROR = "false";

  for (const provider of Object.keys(settings.connections) as AiProvider[]) {
    const connection = settings.connections[provider];
    const upper = provider.toUpperCase();
    const apiKeyName = `${upper}_API_KEY`;
    const baseUrlName = `${upper}_BASE_URL`;

    if (connection.apiKey) {
      process.env[apiKeyName] = connection.apiKey;
    } else {
      delete process.env[apiKeyName];
    }

    process.env[baseUrlName] = connection.baseUrl;
  }
}

export function saveProviderConnection(input: {
  provider: AiProvider;
  apiKey?: string | null;
  clearApiKey?: boolean;
  model: string;
  setActive?: boolean;
}): ProviderSettingsSummary {
  const settings = readStoredProviderSettings();
  const current = settings.connections[input.provider];
  const nextModel = input.model.trim() || current.model;
  const nextApiKey = input.clearApiKey
    ? null
    : input.apiKey && input.apiKey.trim().length > 0
      ? input.apiKey.trim()
      : current.apiKey;
  const connectionChanged =
    current.model !== nextModel ||
    current.apiKey !== nextApiKey ||
    Boolean(input.clearApiKey);

  settings.connections[input.provider] = {
    ...current,
    apiKey: nextApiKey,
    model: nextModel,
    ...(connectionChanged
      ? {
          lastTestStatus: "idle",
          lastTestMessage: "Configuracion guardada. Falta probar la conexion para confirmar este modelo.",
          lastTestAt: null,
          lastTestModel: null,
        }
      : {}),
  };

  if (input.setActive !== false) {
    settings.activeProvider = input.provider;
  }

  persist(settings);
  return toSummary(settings);
}

export function recordProviderTestResult(input: {
  provider: AiProvider;
  status: "success" | "error";
  message: string;
  model?: string;
}): ProviderSettingsSummary {
  const settings = readStoredProviderSettings();
  const current = settings.connections[input.provider];

  settings.connections[input.provider] = {
    ...current,
    lastTestStatus: input.status,
    lastTestMessage: input.message,
    lastTestAt: toIsoNow(),
    lastTestModel: input.model?.trim() || current.model,
  };

  persist(settings);
  return toSummary(settings);
}
