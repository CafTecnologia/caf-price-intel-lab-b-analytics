import type { AiProvider } from "../../../ai-first-contracts/src/enums";
import type { ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";

import { BasicDocumentOrchestrator } from "../orchestration/basic-document-orchestrator";
import { buildSyntheticSourceSegments } from "./synthetic-source";

function resolveProvider(): AiProvider {
  const rawProvider = (process.env.AI_FIRST_PROVIDER ?? "openai").trim().toLowerCase();
  if (rawProvider === "openai" || rawProvider === "gemini" || rawProvider === "anthropic" || rawProvider === "deepseek") {
    return rawProvider;
  }

  return "openai";
}

function resolveDefaultModel(provider: AiProvider): string {
  switch (provider) {
    case "gemini":
      return process.env.AI_FIRST_MODEL ?? "gemini-2.5-flash";
    case "anthropic":
      return process.env.AI_FIRST_MODEL ?? "claude-sonnet-4-20250514";
    case "deepseek":
      return process.env.AI_FIRST_MODEL ?? "deepseek-chat";
    case "openai":
    default:
      return process.env.AI_FIRST_MODEL ?? "gpt-4.1-mini";
  }
}

function buildProviderConfig(provider: AiProvider, model: string): ProviderConfigByTask {
  return {
    detectOfficialBlock: {
      provider,
      model,
      temperature: 0,
      timeout_ms: 60_000,
      max_retries: 1,
      max_input_tokens: null,
      max_output_tokens: 4_000,
      top_p: null,
      seed: null,
      prompt_version: "2026-04-21.1",
      extra: {},
    },
    extractItemsBatch: {
      provider,
      model,
      temperature: 0,
      timeout_ms: 60_000,
      max_retries: 1,
      max_input_tokens: null,
      max_output_tokens: 4_000,
      top_p: null,
      seed: null,
      prompt_version: "2026-04-21.1",
      extra: {},
    },
    validateBatch: {
      provider,
      model,
      temperature: 0,
      timeout_ms: 60_000,
      max_retries: 1,
      max_input_tokens: null,
      max_output_tokens: 4_000,
      top_p: null,
      seed: null,
      prompt_version: "2026-04-21.1",
      extra: {},
    },
    validateGlobal: {
      provider,
      model,
      temperature: 0,
      timeout_ms: 60_000,
      max_retries: 1,
      max_input_tokens: null,
      max_output_tokens: 4_000,
      top_p: null,
      seed: null,
      prompt_version: "2026-04-21.1",
      extra: {},
    },
  };
}

async function main() {
  const provider = resolveProvider();
  const model = resolveDefaultModel(provider);
  const documentId = "demo-ai-first-document";
  const orchestrator = new BasicDocumentOrchestrator();

  const result = await orchestrator.run({
    document_id: documentId,
    file_name: "estudio_mercado_demo.pdf",
    file_type: "pdf",
    segments: buildSyntheticSourceSegments(documentId),
    provider_config_used: buildProviderConfig(provider, model),
    processing_options: {
      batch_size: 2,
      batch_retry_limit: 1,
      export_formats: ["json"],
      enable_ocr_fallback: false,
      allow_batch_reprocess: true,
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
