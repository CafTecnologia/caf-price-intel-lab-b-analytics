import type { MarketAnalysisResult } from "./market-analysis-schema";
import type { MarketAnalysisStageTrace } from "./market-analysis-trace";
import { isMarketSourcePrice } from "./market-source-pricing";

export const MARKET_ANALYSIS_RUN_STATUSES = [
  "processing",
  "completed",
  "completed_with_warnings",
  "partial_review_required",
  "failed",
] as const;

export type MarketAnalysisRunStatus = (typeof MARKET_ANALYSIS_RUN_STATUSES)[number];

type ProviderUsageLike = {
  finishReason?: string | null;
  grounded?: boolean | null;
  groundingSources?: Array<unknown> | null;
} | null;

type QualityGateInput = {
  result: MarketAnalysisResult;
  usage: ProviderUsageLike;
  stages: MarketAnalysisStageTrace[];
};

type QualityGateOutput = {
  status: MarketAnalysisRunStatus;
  warnings: string[];
  unresolvedFailedStages: Array<{ stageName: string; errorMessage: string | null; retryCount: number }>;
};

const OPTIONAL_FAILURE_PREFIXES = ["repair_pass:quality_gap"];
const MARKET_SOURCE_FIELDS = ["Fuente 1 (Precio)", "Fuente 2 (Precio)", "Fuente 3 (Precio)"] as const;
const INTERNAL_FALLBACK_PATTERN =
  /\b(?:STAGED_PIPELINE_FALLBACK|FULL_RUN_FALLBACK|PDF_NATIVO_FALLBACK|IA_TEXT_FALLBACK|LEGACY_FULL_RUN)\b/i;

function isOptionalFailure(stageName: string): boolean {
  return OPTIONAL_FAILURE_PREFIXES.some((prefix) => stageName === prefix || stageName.startsWith(`${prefix}:`));
}

function stageTimestamp(stage: MarketAnalysisStageTrace): string {
  return stage.finished_at ?? stage.started_at;
}

function sourcePriceCount(row: MarketAnalysisResult["rows"][number]): number {
  return MARKET_SOURCE_FIELDS.filter((field) => isMarketSourcePrice(row[field])).length;
}

function hasAnySourceValue(row: MarketAnalysisResult["rows"][number]): boolean {
  return MARKET_SOURCE_FIELDS.some((field) => {
    const value = row[field]?.trim();
    return Boolean(value && !/^n\/?d$/i.test(value));
  });
}

function hasTraceableSourceLocation(value: string): boolean {
  return /https?:\/\/|www\.|(?:^|[\s|])[\w-]+(?:\.[\w-]+)+(?:\/|\s|$)/i.test(value);
}

function isIncompleteResultWarning(value: string): boolean {
  return /auditoria_cobertura|incomplete_run|filas?\s+faltantes|items?\s+faltantes|ítems?\s+faltantes|solo\s+se\s+generaron|no\s+se\s+generaron|no\s+se\s+pueden\s+inventar/i.test(
    value,
  );
}

export function getUnresolvedFailedStages(stages: MarketAnalysisStageTrace[]) {
  const latestTerminalByName = new Map<string, MarketAnalysisStageTrace>();

  for (const stage of stages) {
    if (stage.status === "started") {
      continue;
    }

    const current = latestTerminalByName.get(stage.stage_name);
    if (!current || stageTimestamp(stage).localeCompare(stageTimestamp(current)) >= 0) {
      latestTerminalByName.set(stage.stage_name, stage);
    }
  }

  const directTextCompleted = latestTerminalByName.get("ia_direct_text_generate")?.status === "completed";
  const fallbackFullRunCompleted =
    latestTerminalByName.get("legacy_full_run_after_direct_file")?.status === "completed" ||
    latestTerminalByName.get("legacy_full_run_after_staged_pipeline")?.status === "completed";
  const stagedPipelineStageNames = new Set([
    "document_map",
    "extraction_plan",
    "official_price_table_extraction",
    "technical_specs_extraction_batches",
    "normalized_items_generation",
    "audit_pass",
    "repair_pass",
    "final_result",
  ]);

  return Array.from(latestTerminalByName.values())
    .filter((stage) => stage.status === "failed")
    .filter((stage) => !(stage.stage_name === "ia_direct_file_generate" && directTextCompleted))
    .filter((stage) => !(fallbackFullRunCompleted && stagedPipelineStageNames.has(stage.stage_name)))
    .map((stage) => ({
      stageName: stage.stage_name,
      errorMessage: stage.error_message,
      retryCount: stage.retry_count,
    }));
}

export function evaluateMarketAnalysisRunQuality(input: QualityGateInput): QualityGateOutput {
  const warnings: string[] = [];

  if (input.result.rows.length === 0) {
    return {
      status: "failed",
      warnings: ["QUALITY_GATE_FAILED: el resultado final no contiene filas."],
      unresolvedFailedStages: [],
    };
  }

  const unresolvedFailedStages = getUnresolvedFailedStages(input.stages);
  const requiredFailures = unresolvedFailedStages.filter((stage) => !isOptionalFailure(stage.stageName));
  const optionalFailures = unresolvedFailedStages.filter((stage) => isOptionalFailure(stage.stageName));
  const finishReason = input.usage?.finishReason ?? null;
  const groundingSourceCount = input.usage?.groundingSources?.length ?? 0;
  const groundingVerified = input.usage?.grounded === true && groundingSourceCount > 0;
  const rowsWithNoMarketSources = input.result.rows.filter((row) => sourcePriceCount(row) === 0);
  const rowsWithLessThanTwoMarketSources = input.result.rows.filter((row) => sourcePriceCount(row) < 2);
  const rowsWithReportedSources = input.result.rows.filter(hasAnySourceValue);
  const sourceValues = input.result.rows.flatMap((row) =>
    MARKET_SOURCE_FIELDS.map((field) => row[field]).filter((value) => isMarketSourcePrice(value)),
  );
  const untraceableSourceValues = sourceValues.filter((value) => !hasTraceableSourceLocation(value));
  const noSourceRatio = rowsWithNoMarketSources.length / input.result.rows.length;
  const weakSourceRatio = rowsWithLessThanTwoMarketSources.length / input.result.rows.length;
  const untraceableSourceRatio = sourceValues.length === 0 ? 0 : untraceableSourceValues.length / sourceValues.length;
  const hasIncompleteResultWarning = input.result.warnings.some(isIncompleteResultWarning);
  const hasMissingTrace = input.stages.length === 0;
  const hasInternalFallbackWarning = input.result.warnings.some((warning) => INTERNAL_FALLBACK_PATTERN.test(warning));
  const hasProviderOrAppWarnings = input.result.warnings.length > 0;

  if (hasMissingTrace) {
    warnings.push("QUALITY_GATE_TRACE_MISSING: la corrida no tiene trazas de pipeline verificables.");
  }

  for (const stage of unresolvedFailedStages) {
    warnings.push(
      `QUALITY_GATE_STAGE_FAILURE: ${stage.stageName}${stage.errorMessage ? `: ${stage.errorMessage}` : ""}`,
    );
  }

  if (finishReason === "partial") {
    warnings.push("QUALITY_GATE_PARTIAL: el proveedor/pipeline reporto finishReason=partial.");
  }

  if (rowsWithNoMarketSources.length > 0) {
    warnings.push(
      `QUALITY_GATE_SOURCE_COVERAGE: ${rowsWithNoMarketSources.length}/${input.result.rows.length} item(s) no tienen fuentes de mercado con precio unitario reconocible.`,
    );
  }

  if (rowsWithLessThanTwoMarketSources.length > 0) {
    warnings.push(
      `QUALITY_GATE_WEAK_SOURCE_COVERAGE: ${rowsWithLessThanTwoMarketSources.length}/${input.result.rows.length} item(s) tienen menos de 2 fuentes de mercado con precio unitario reconocible.`,
    );
  }

  if (input.usage?.grounded === true && groundingSourceCount === 0) {
    warnings.push(
      "QUALITY_GATE_GROUNDING_MISMATCH: el proveedor fue marcado como grounded, pero no hay fuentes de grounding verificables.",
    );
  }

  if (rowsWithReportedSources.length > 0 && !groundingVerified) {
    warnings.push(
      "QUALITY_GATE_GROUNDING_NOT_VERIFIED: hay fuentes/precios reportados por IA, pero no hay grounding verificable; requieren validacion manual.",
    );
  }

  if (untraceableSourceValues.length > 0) {
    warnings.push(
      `QUALITY_GATE_SOURCE_TRACEABILITY: ${untraceableSourceValues.length}/${sourceValues.length} fuente(s) con precio no incluyen URL o dominio trazable.`,
    );
  }

  if (hasIncompleteResultWarning) {
    warnings.push("QUALITY_GATE_INCOMPLETE_RESULT_WARNING: el resultado reporto items o filas faltantes.");
  }

  if (hasInternalFallbackWarning) {
    warnings.push("QUALITY_GATE_INTERNAL_FALLBACK: la corrida uso fallback interno/legacy y requiere revision.");
  }

  if (
    hasMissingTrace ||
    requiredFailures.length > 0 ||
    finishReason === "partial" ||
    noSourceRatio > 0.2 ||
    weakSourceRatio > 0.5 ||
    untraceableSourceRatio > 0.5 ||
    hasIncompleteResultWarning
  ) {
    return {
      status: "partial_review_required",
      warnings,
      unresolvedFailedStages,
    };
  }

  if (optionalFailures.length > 0 || warnings.length > 0 || hasProviderOrAppWarnings) {
    return {
      status: "completed_with_warnings",
      warnings,
      unresolvedFailedStages,
    };
  }

  return {
    status: "completed",
    warnings,
    unresolvedFailedStages,
  };
}
