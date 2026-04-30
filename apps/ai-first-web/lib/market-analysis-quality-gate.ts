import type { MarketAnalysisResult } from "./market-analysis-schema";
import type { MarketAnalysisStageTrace } from "./market-analysis-trace";

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

function isOptionalFailure(stageName: string): boolean {
  return OPTIONAL_FAILURE_PREFIXES.some((prefix) => stageName === prefix || stageName.startsWith(`${prefix}:`));
}

function stageTimestamp(stage: MarketAnalysisStageTrace): string {
  return stage.finished_at ?? stage.started_at;
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

  return Array.from(latestTerminalByName.values())
    .filter((stage) => stage.status === "failed")
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

  for (const stage of unresolvedFailedStages) {
    warnings.push(
      `QUALITY_GATE_STAGE_FAILURE: ${stage.stageName}${stage.errorMessage ? `: ${stage.errorMessage}` : ""}`,
    );
  }

  if (finishReason === "partial") {
    warnings.push("QUALITY_GATE_PARTIAL: el proveedor/pipeline reporto finishReason=partial.");
  }

  if (requiredFailures.length > 0 || finishReason === "partial") {
    return {
      status: "partial_review_required",
      warnings,
      unresolvedFailedStages,
    };
  }

  if (optionalFailures.length > 0) {
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
