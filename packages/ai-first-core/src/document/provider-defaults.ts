import type { AiProvider } from "../../../ai-first-contracts/src/enums";
import type { ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";

export function resolveDefaultModel(provider: AiProvider): string {
  switch (provider) {
    case "gemini":
      return "gemini-2.5-flash";
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "deepseek":
      return "deepseek-chat";
    case "openai":
    default:
      return "gpt-4.1-mini";
  }
}

export function buildProviderConfigByTask(input: {
  detectOfficialBlock: { provider: AiProvider; model?: string };
  extractItemsBatch: { provider: AiProvider; model?: string };
  validateBatch: { provider: AiProvider; model?: string };
  validateGlobal: { provider: AiProvider; model?: string };
}): ProviderConfigByTask {
  const buildConfig = (config: { provider: AiProvider; model?: string }) => ({
    provider: config.provider,
    model: config.model?.trim() || resolveDefaultModel(config.provider),
    temperature: 0,
    timeout_ms: config.provider === "gemini" ? 120_000 : 60_000,
    max_retries: config.provider === "gemini" ? 3 : 1,
    max_input_tokens: null,
    max_output_tokens: 4_000,
    top_p: null,
    seed: null,
    prompt_version: "2026-04-21.1",
    extra: {},
  });

  return {
    detectOfficialBlock: buildConfig(input.detectOfficialBlock),
    extractItemsBatch: buildConfig(input.extractItemsBatch),
    validateBatch: buildConfig(input.validateBatch),
    validateGlobal: buildConfig(input.validateGlobal),
  };
}
