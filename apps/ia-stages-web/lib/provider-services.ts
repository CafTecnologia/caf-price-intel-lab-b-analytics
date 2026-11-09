import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_FILE = path.join(process.cwd(), ".env.local");

type EnvMap = Record<string, string>;

export type ExternalProviderId =
  | "openai"
  | "anthropic"
  | "perplexity"
  | "brave"
  | "tavily"
  | "exa"
  | "serpapi";

export type ExternalProviderService = "llm_web_search" | "search_api" | "shopping_search";

export type ExternalProviderModelOption = {
  value: string;
  label: string;
};

export type ExternalProviderDefinition = {
  id: ExternalProviderId;
  label: string;
  envKey: string;
  modelEnvKey?: string;
  reasoningEnvKey?: string;
  defaultModel?: string;
  defaultReasoningEffort?: string;
  modelOptions?: ExternalProviderModelOption[];
  services: ExternalProviderService[];
  role: "cotizador_con_busqueda" | "buscador_evidencia" | "buscador_compras";
  docsUrl: string;
  notes: string;
};

export type PublicExternalProvider = ExternalProviderDefinition & {
  hasApiKey: boolean;
  maskedApiKey: string | null;
  model: string;
  reasoningEffort?: string;
};

export const EXTERNAL_PROVIDER_DEFINITIONS: ExternalProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    modelEnvKey: "OPENAI_WEB_MODEL",
    reasoningEnvKey: "OPENAI_REASONING_EFFORT",
    defaultModel: "gpt-5.5",
    defaultReasoningEffort: "medium",
    modelOptions: [
      { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
      { value: "gpt-5.5", label: "GPT-5.5" },
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
      { value: "gpt-5.4-pro", label: "GPT-5.4 Pro" }
    ],
    services: ["llm_web_search"],
    role: "cotizador_con_busqueda",
    docsUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
    notes: "Modelo con herramienta web_search. Candidato para cotizar con busqueda integrada."
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    envKey: "ANTHROPIC_API_KEY",
    modelEnvKey: "ANTHROPIC_WEB_MODEL",
    defaultModel: "claude-sonnet-4-5",
    services: ["llm_web_search"],
    role: "cotizador_con_busqueda",
    docsUrl: "https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool",
    notes: "Modelo con herramienta de busqueda web. Candidato para comparar razonamiento y honestidad."
  },
  {
    id: "perplexity",
    label: "Perplexity Sonar",
    envKey: "PERPLEXITY_API_KEY",
    modelEnvKey: "PERPLEXITY_WEB_MODEL",
    defaultModel: "sonar-pro",
    services: ["llm_web_search"],
    role: "cotizador_con_busqueda",
    docsUrl: "https://docs.perplexity.ai/docs/grounded-llm/chat-completions/quickstart",
    notes: "API orientada a respuestas grounded con citas. Candidato fuerte para laboratorio de fuentes."
  },
  {
    id: "brave",
    label: "Brave Search",
    envKey: "BRAVE_SEARCH_API_KEY",
    services: ["search_api"],
    role: "buscador_evidencia",
    docsUrl: "https://brave.com/search/api/",
    notes: "Buscador externo. La app trae candidatos reales y la IA solo organiza/evalua evidencia."
  },
  {
    id: "tavily",
    label: "Tavily",
    envKey: "TAVILY_API_KEY",
    services: ["search_api"],
    role: "buscador_evidencia",
    docsUrl: "https://docs.tavily.com/api-reference/endpoint/search",
    notes: "Busqueda web con contenido resumido. Util para recuperar evidencia antes de pasar a IA."
  },
  {
    id: "exa",
    label: "Exa",
    envKey: "EXA_API_KEY",
    services: ["search_api"],
    role: "buscador_evidencia",
    docsUrl: "https://docs.exa.ai/reference/search",
    notes: "Busqueda semantica. Util para encontrar paginas candidatas y comparar pertinencia."
  },
  {
    id: "serpapi",
    label: "SerpAPI",
    envKey: "SERPAPI_API_KEY",
    services: ["search_api", "shopping_search"],
    role: "buscador_compras",
    docsUrl: "https://serpapi.com/search-api",
    notes: "Google/Shopping via API. Candidato para precios/productos cuando necesitamos resultados comerciales."
  }
];

export async function getPublicExternalProvidersConfig(): Promise<PublicExternalProvider[]> {
  const env = await readEnvFile();
  return EXTERNAL_PROVIDER_DEFINITIONS.map((provider) => {
    const apiKey = firstNonEmpty(env[provider.envKey], process.env[provider.envKey]);
    const model = provider.modelEnvKey
      ? firstNonEmpty(env[provider.modelEnvKey], process.env[provider.modelEnvKey], provider.defaultModel)
      : "";
    const reasoningEffort = provider.reasoningEnvKey
      ? firstNonEmpty(env[provider.reasoningEnvKey], process.env[provider.reasoningEnvKey], provider.defaultReasoningEffort)
      : undefined;
    return {
      ...provider,
      hasApiKey: Boolean(apiKey),
      maskedApiKey: apiKey ? maskApiKey(apiKey) : null,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {})
    };
  });
}

export async function getExternalProviderRuntimeConfig(id: ExternalProviderId) {
  const provider = EXTERNAL_PROVIDER_DEFINITIONS.find((item) => item.id === id);
  if (!provider) return null;
  const env = await readEnvFile();
  const apiKey = firstNonEmpty(env[provider.envKey], process.env[provider.envKey]);
  const model = provider.modelEnvKey
    ? firstNonEmpty(env[provider.modelEnvKey], process.env[provider.modelEnvKey], provider.defaultModel)
    : "";
  const reasoningEffort = provider.reasoningEnvKey
    ? firstNonEmpty(env[provider.reasoningEnvKey], process.env[provider.reasoningEnvKey], provider.defaultReasoningEffort)
    : "";
  return { provider, apiKey, model, reasoningEffort };
}

export async function saveExternalProviderKeys(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return;
  }

  const current = await readEnvFile();
  const next: EnvMap = { ...current };
  const payload = input as Record<string, unknown>;
  let changed = false;

  for (const provider of EXTERNAL_PROVIDER_DEFINITIONS) {
    const value = payload[provider.id];
    if (typeof value === "string" && value.trim()) {
      next[provider.envKey] = value.trim();
      changed = true;
    }

    const modelValue = payload[`${provider.id}Model`];
    if (provider.modelEnvKey && typeof modelValue === "string" && modelValue.trim()) {
      next[provider.modelEnvKey] = modelValue.trim();
      changed = true;
    }

    const reasoningValue = payload[`${provider.id}ReasoningEffort`];
    if (provider.reasoningEnvKey && typeof reasoningValue === "string" && reasoningValue.trim()) {
      next[provider.reasoningEnvKey] = reasoningValue.trim();
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  const existing = await readEnvText();
  const values = Object.fromEntries(
    EXTERNAL_PROVIDER_DEFINITIONS.flatMap((provider) => {
      const entries: Array<[string, string]> = [[provider.envKey, next[provider.envKey] ?? ""]];
      if (provider.modelEnvKey) {
        entries.push([provider.modelEnvKey, next[provider.modelEnvKey] ?? provider.defaultModel ?? ""]);
      }
      if (provider.reasoningEnvKey) {
        entries.push([provider.reasoningEnvKey, next[provider.reasoningEnvKey] ?? provider.defaultReasoningEffort ?? "medium"]);
      }
      return entries;
    })
  );
  await writeFile(ENV_FILE, upsertEnvValues(existing, values), "utf8");
}

async function readEnvFile(): Promise<EnvMap> {
  const text = await readEnvText();
  const values: EnvMap = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx < 0) {
      continue;
    }
    values[trimmed.slice(0, idx).trim()] = unquoteEnvValue(trimmed.slice(idx + 1).trim());
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

function maskApiKey(value: string) {
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function quoteEnvValue(value: string | undefined) {
  const raw = value ?? "";
  if (!raw || /^[A-Za-z0-9_./:@-]+$/.test(raw)) {
    return raw;
  }
  return JSON.stringify(raw);
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
