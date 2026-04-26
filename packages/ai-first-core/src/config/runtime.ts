import { config as loadDotenv } from "dotenv";

import type { AiProvider } from "../../../ai-first-contracts/src/enums";

loadDotenv();

export interface ProviderRuntimeSettings {
  apiKey: string | null;
  baseUrl: string;
  forceMock: boolean;
  mockOnError: boolean;
}

export interface RuntimeSettings {
  providers: Record<AiProvider, ProviderRuntimeSettings>;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function loadRuntimeSettings(): RuntimeSettings {
  const forceMock = readBoolean("AI_FIRST_FORCE_MOCK", false);
  const mockOnError = readBoolean("AI_FIRST_PROVIDER_FALLBACK_ON_ERROR", false);

  return {
    providers: {
      openai: {
        apiKey: readString("OPENAI_API_KEY"),
        baseUrl: readString("OPENAI_BASE_URL") ?? "https://api.openai.com",
        forceMock,
        mockOnError,
      },
      gemini: {
        apiKey: readString("GEMINI_API_KEY"),
        baseUrl: readString("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com",
        forceMock,
        mockOnError,
      },
      anthropic: {
        apiKey: readString("ANTHROPIC_API_KEY"),
        baseUrl: readString("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com",
        forceMock,
        mockOnError,
      },
      deepseek: {
        apiKey: readString("DEEPSEEK_API_KEY"),
        baseUrl: readString("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
        forceMock,
        mockOnError,
      },
    },
  };
}
