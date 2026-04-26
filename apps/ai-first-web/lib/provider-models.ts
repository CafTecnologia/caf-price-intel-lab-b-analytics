import type { AiProvider } from "@ai-first-contracts/enums";

export interface ProviderModelOption {
  value: string;
  label: string;
  description?: string;
}

export interface ProviderConnectionSummary {
  provider: AiProvider;
  model: string;
  apiKeyStored: boolean;
  apiKeyPreview: string | null;
  lastTestStatus: "idle" | "success" | "error";
  lastTestMessage: string | null;
  lastTestAt: string | null;
  isActive: boolean;
}

export interface ProviderSettingsSummary {
  activeProvider: AiProvider;
  connections: Record<AiProvider, ProviderConnectionSummary>;
}

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
};

export const DEFAULT_PROVIDER_BASE_URLS: Record<AiProvider, string> = {
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
};

export const PROVIDER_MODEL_OPTIONS: Record<AiProvider, ProviderModelOption[]> = {
  openai: [
    { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "claude-sonnet-4-20250514" },
    { value: "claude-3-7-sonnet-latest", label: "claude-3-7-sonnet-latest" },
    { value: "claude-3-5-haiku-latest", label: "claude-3-5-haiku-latest" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "deepseek-chat" },
    { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  ],
};
