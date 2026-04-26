import type { AiProviderRegistry } from "../../../ai-first-contracts/src/providers/ai-provider";

import { loadRuntimeSettings } from "../config/runtime";
import { AnthropicAdapter } from "./anthropic-adapter";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { GeminiAdapter } from "./gemini-adapter";
import { OpenAiAdapter } from "./openai-adapter";

export class DefaultAiProviderRegistry implements AiProviderRegistry {
  private readonly providers = new Map();

  constructor() {
    const runtime = loadRuntimeSettings();

    this.providers.set("openai", new OpenAiAdapter("openai", runtime.providers.openai));
    this.providers.set("gemini", new GeminiAdapter("gemini", runtime.providers.gemini));
    this.providers.set("anthropic", new AnthropicAdapter("anthropic", runtime.providers.anthropic));
    this.providers.set("deepseek", new DeepSeekAdapter("deepseek", runtime.providers.deepseek));
  }

  get(provider: "openai" | "gemini" | "anthropic" | "deepseek") {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new Error(`Provider adapter not registered: ${provider}`);
    }

    return adapter;
  }

  list() {
    return Array.from(this.providers.values());
  }
}
