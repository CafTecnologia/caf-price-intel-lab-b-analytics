import { buildSyntheticSourceSegments } from "./synthetic-source";
import { buildPersistenceSnapshot } from "../persistence/write-model";
import { BasicDocumentOrchestrator } from "../orchestration/basic-document-orchestrator";
import type { AiProvider } from "../../../ai-first-contracts/src/enums";
import type { ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";
import { resolvePrismaDatabaseUrl } from "../persistence/prisma-client";

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
  const segments = buildSyntheticSourceSegments(documentId);

  const output = await orchestrator.run({
    document_id: documentId,
    file_name: "estudio_mercado_demo.pdf",
    file_type: "pdf",
    segments,
    provider_config_used: buildProviderConfig(provider, model),
    processing_options: {
      batch_size: 2,
      batch_retry_limit: 1,
      export_formats: ["json"],
      enable_ocr_fallback: false,
      allow_batch_reprocess: true,
    },
  });

  let prismaDatabaseUrl: string | null = null;
  try {
    prismaDatabaseUrl = resolvePrismaDatabaseUrl();
  } catch {
    prismaDatabaseUrl = null;
  }

  const snapshot = buildPersistenceSnapshot({
    uploadedFile: {
      fileName: "estudio_mercado_demo.pdf",
      mimeType: "application/pdf",
      fileType: "pdf",
      checksumSha256: "demo-ai-first-upload-checksum-0001",
      storageKey: "demo/estudio_mercado_demo.pdf",
      sizeBytes: 24_576,
    },
    segments,
    output,
  });

  console.log(
    JSON.stringify(
      {
        mode: prismaDatabaseUrl ? "db_configured_snapshot_ready" : "dry_run_snapshot",
        prisma_database_url_detected: Boolean(prismaDatabaseUrl),
        document_id: snapshot.document.id,
        source_segment_count: snapshot.sourceSegments.length,
        batch_count: snapshot.batches.length,
        item_count: snapshot.items.length,
        batch_validation_count: snapshot.batchValidations.length,
        document_validation_count: snapshot.documentValidations.length,
        prompt_execution_count: snapshot.promptExecutions.length,
        batch_attempt_count: snapshot.batchAttempts.length,
        audit_log_count: snapshot.auditLogs.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
