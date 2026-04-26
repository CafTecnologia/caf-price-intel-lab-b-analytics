import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { AiProviderRegistry } from "../../../ai-first-contracts/src/providers/ai-provider";
import type { DocumentResult } from "../../../ai-first-contracts/src/schemas/document";

import { DocumentResultSchema } from "../../../ai-first-contracts/src/schemas/document";
import { ProcessingOptionsSchema, ProviderConfigByTaskSchema } from "../../../ai-first-contracts/src/schemas/provider-config";
import { PromptCatalog } from "../prompts/prompt-catalog";
import { DefaultAiProviderRegistry } from "../providers/provider-registry";
import { AiTaskOrchestrator } from "../services/ai-task-orchestrator";
import { BasicDocumentOrchestrator } from "../orchestration/basic-document-orchestrator";
import {
  buildAuditProviderConfig,
  buildSyntheticDocumentSegments,
  buildSyntheticRows,
  cloneSyntheticRow,
  type SyntheticRow,
} from "./fixtures";
import { ScenarioProviderAdapter, SingleProviderRegistry } from "./scenario-provider";

interface ScenarioDefinition {
  name: string;
  documentId: string;
  rows: SyntheticRow[];
  expectedExtractedCount: number;
  expectedFinalCount: number;
  batchSize: number;
  rowsPerSegment: number;
  expectedRetries: number;
  expectedDuplicateGroups: number;
  expectedStatus: DocumentResult["processing_status"];
  providerRegistry?: AiProviderRegistry;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildItemKey(value: { numero_item: string | null; nombre_o_descripcion: string | null }): string {
  return `${value.numero_item ?? ""}|${normalizeText(value.nombre_o_descripcion ?? "")}`;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function buildUniqueExpectedKeys(rows: SyntheticRow[]): string[] {
  return Array.from(new Set(rows.map((row) => buildItemKey(row))));
}

async function runScenario(definition: ScenarioDefinition) {
  process.env.AI_FIRST_FORCE_MOCK = "1";

  const providerConfig = buildAuditProviderConfig("openai");
  const tasks = definition.providerRegistry ? new AiTaskOrchestrator(definition.providerRegistry) : undefined;
  const orchestrator = tasks ? new BasicDocumentOrchestrator(tasks) : new BasicDocumentOrchestrator();

  const startedAt = performance.now();
  const output = await orchestrator.run({
    document_id: definition.documentId,
    file_name: `${definition.documentId}.pdf`,
    file_type: "pdf",
    segments: buildSyntheticDocumentSegments({
      documentId: definition.documentId,
      rows: definition.rows,
      rowsPerSegment: definition.rowsPerSegment,
      includeCover: true,
      finalNote: "Nota: documento sintetico de auditoria.",
    }),
    provider_config_used: providerConfig,
    processing_options: {
      batch_size: definition.batchSize,
      batch_retry_limit: 1,
      export_formats: ["json"],
      enable_ocr_fallback: false,
      allow_batch_reprocess: true,
    },
  });
  const durationMs = performance.now() - startedAt;

  const schemaCheck = DocumentResultSchema.safeParse(output.document);
  const expectedKeys = buildUniqueExpectedKeys(definition.rows);
  const actualKeys = new Set(output.document.items.map((item) => buildItemKey(item)));
  const matchedUniqueItems = expectedKeys.filter((key) => actualKeys.has(key)).length;
  const uniqueRecall = expectedKeys.length === 0 ? 1 : matchedUniqueItems / expectedKeys.length;
  const extractionCoverage =
    definition.expectedExtractedCount === 0
      ? 1
      : output.document.total_extracted_items / definition.expectedExtractedCount;
  const duplicateGroups = output.trace.consolidation?.duplicate_resolutions.length ?? 0;
  const retries = output.trace.metrics.retried_batch_count;
  const plannedBatches = output.trace.metrics.planned_batch_count;
  const acceptedBatches = output.trace.metrics.accepted_batch_count;

  const passed =
    schemaCheck.success &&
    output.document.total_extracted_items === definition.expectedExtractedCount &&
    output.document.items.length === definition.expectedFinalCount &&
    duplicateGroups === definition.expectedDuplicateGroups &&
    retries === definition.expectedRetries &&
    output.document.processing_status === definition.expectedStatus &&
    roundMetric(uniqueRecall) === 1 &&
    roundMetric(extractionCoverage) === 1;

  return {
    name: definition.name,
    passed,
    duration_ms: Math.round(durationMs),
    schema_valid: schemaCheck.success,
    expected_extracted_count: definition.expectedExtractedCount,
    extracted_count: output.document.total_extracted_items,
    expected_final_count: definition.expectedFinalCount,
    final_count: output.document.items.length,
    unique_recall: roundMetric(uniqueRecall),
    extraction_coverage: roundMetric(extractionCoverage),
    planned_batches: plannedBatches,
    accepted_batches: acceptedBatches,
    retried_batches: retries,
    duplicate_groups_resolved: duplicateGroups,
    final_confidence_score: output.document.final_confidence_score,
    processing_status: output.document.processing_status,
    warnings: output.document.global_warnings,
  };
}

async function main() {
  const promptCatalog = new PromptCatalog();
  process.env.AI_FIRST_FORCE_MOCK = "1";
  const registry = new DefaultAiProviderRegistry();

  const architectureArtifacts = [
    "docs/ai-first-phase-1-architecture.md",
    "packages/ai-first-contracts/src/index.ts",
    "packages/ai-first-prompts/src/index.ts",
    "packages/ai-first-core/src/services/ai-task-orchestrator.ts",
    "integrations/odoo/src/dtos.ts",
    "integrations/odoo/src/mappers.ts",
  ].map((relativePath) => ({
    path: relativePath,
    exists: existsSync(resolve(process.cwd(), relativePath)),
  }));

  const promptChecks = [
    promptCatalog.resolve("detectOfficialBlock", "2026-04-21.1"),
    promptCatalog.resolve("extractItemsBatch", "2026-04-21.1"),
    promptCatalog.resolve("validateBatch", "2026-04-21.1"),
    promptCatalog.resolve("validateGlobal", "2026-04-21.1"),
  ].map((prompt) => ({
    key: prompt.key,
    version: prompt.version,
    response_schema_name: prompt.response_schema_name,
  }));

  const schemaChecks = {
    processing_options_strict: !ProcessingOptionsSchema.safeParse({
      batch_size: 10,
      batch_retry_limit: 1,
      export_formats: ["json"],
      enable_ocr_fallback: false,
      allow_batch_reprocess: true,
      unexpected: true,
    }).success,
    provider_config_strict: !ProviderConfigByTaskSchema.safeParse({
      ...buildAuditProviderConfig("openai"),
      unexpected: true,
    }).success,
  };

  const baselineRows = buildSyntheticRows(4);
  const largeRows = buildSyntheticRows(23);
  const retryRows = buildSyntheticRows(12, { descriptionPrefix: "Item con retry sintetico" });
  const duplicateBaseRows = buildSyntheticRows(4, { descriptionPrefix: "Item con duplicado" });
  const duplicateRows = [...duplicateBaseRows, cloneSyntheticRow(duplicateBaseRows[1])];

  const retryProvider = new ScenarioProviderAdapter("openai", {
    retryOnceBatchIds: ["audit-retry-12:batch-1"],
  });

  const scenarios = await Promise.all([
    runScenario({
      name: "baseline_4_items",
      documentId: "audit-baseline-4",
      rows: baselineRows,
      expectedExtractedCount: 4,
      expectedFinalCount: 4,
      batchSize: 2,
      rowsPerSegment: 2,
      expectedRetries: 0,
      expectedDuplicateGroups: 0,
      expectedStatus: "completed",
    }),
    runScenario({
      name: "batching_23_items",
      documentId: "audit-batching-23",
      rows: largeRows,
      expectedExtractedCount: 23,
      expectedFinalCount: 23,
      batchSize: 10,
      rowsPerSegment: 8,
      expectedRetries: 0,
      expectedDuplicateGroups: 0,
      expectedStatus: "completed",
    }),
    runScenario({
      name: "retry_12_items",
      documentId: "audit-retry-12",
      rows: retryRows,
      expectedExtractedCount: 12,
      expectedFinalCount: 12,
      batchSize: 6,
      rowsPerSegment: 6,
      expectedRetries: 1,
      expectedDuplicateGroups: 0,
      expectedStatus: "completed",
      providerRegistry: new SingleProviderRegistry(retryProvider),
    }),
    runScenario({
      name: "duplicate_consolidation",
      documentId: "audit-duplicate-5",
      rows: duplicateRows,
      expectedExtractedCount: 5,
      expectedFinalCount: 4,
      batchSize: 2,
      rowsPerSegment: 2,
      expectedRetries: 0,
      expectedDuplicateGroups: 1,
      expectedStatus: "completed_with_warnings",
    }),
  ]);

  const aggregate = {
    scenario_count: scenarios.length,
    passed_scenarios: scenarios.filter((scenario) => scenario.passed).length,
    mean_unique_recall: roundMetric(
      scenarios.reduce((sum, scenario) => sum + scenario.unique_recall, 0) / scenarios.length,
    ),
    mean_extraction_coverage: roundMetric(
      scenarios.reduce((sum, scenario) => sum + scenario.extraction_coverage, 0) / scenarios.length,
    ),
    mean_duration_ms: Math.round(
      scenarios.reduce((sum, scenario) => sum + scenario.duration_ms, 0) / scenarios.length,
    ),
  };

  const report = {
    generated_at: new Date().toISOString(),
    phase_1: {
      architecture_artifacts: architectureArtifacts,
      schema_checks: schemaChecks,
      prompts: promptChecks,
      passed:
        architectureArtifacts.every((artifact) => artifact.exists) &&
        Object.values(schemaChecks).every((value) => value === true) &&
        promptChecks.length === 4,
    },
    phase_2: {
      provider_registry: registry.list().map((provider) => provider.provider),
      scenarios,
      aggregate,
      passed:
        registry.list().length === 4 &&
        aggregate.passed_scenarios === aggregate.scenario_count &&
        aggregate.mean_unique_recall === 1 &&
        aggregate.mean_extraction_coverage === 1,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.phase_1.passed || !report.phase_2.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
