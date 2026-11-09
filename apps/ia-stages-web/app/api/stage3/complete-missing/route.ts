import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PipelineFailure, failureToApiBody } from "@/lib/ai-failures";
import { runStage3ForJson, type StageOutput } from "@/lib/ai-pipeline";
import type { AiCostSummary, AiUsageSummary } from "@/lib/usage-cost";
import { saveStageSuccess, type StageSuccessSaveOutcome } from "@/lib/run-history";
import {
  buildStage3CoverageReport,
  getMissingStage2Items,
  getStage3ItemKey,
  makeStage2SubsetForMissing,
  mergeStage3Results
} from "@/lib/stage3Review";

export const runtime = "nodejs";

const RAW_TEXT_PREVIEW_LIMIT = 20000;
const DEFAULT_BLOCK_SIZE = 10;
const MAX_BLOCK_SIZE = 20;
const MAX_ROUNDS = 80;

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? Math.floor(value) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function rawPreview(raw: string) {
  return raw.length <= RAW_TEXT_PREVIEW_LIMIT
    ? raw
    : raw.slice(0, RAW_TEXT_PREVIEW_LIMIT) + "\n\n... [resultado fusionado recortado para proteger el navegador]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sumUsage(outputs: StageOutput[]): AiUsageSummary | undefined {
  const usages = outputs.map((output) => output.usage).filter(Boolean) as AiUsageSummary[];
  if (!usages.length) {
    return undefined;
  }

  return usages.reduce<AiUsageSummary>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      thinkingTokens: total.thinkingTokens + usage.thinkingTokens,
      totalTokens: total.totalTokens + usage.totalTokens
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 }
  );
}

function sumCost(outputs: StageOutput[]): AiCostSummary | undefined {
  const costs = outputs.map((output) => output.cost).filter(Boolean) as AiCostSummary[];
  if (!costs.length) {
    return undefined;
  }

  const first = costs[0];
  return {
    ...first,
    pricingLabel: costs.length > 1 ? `${first.pricingLabel} (miniagente agregado)` : first.pricingLabel,
    inputUsd: sum(costs, "inputUsd"),
    cachedInputUsd: sum(costs, "cachedInputUsd"),
    outputUsd: sum(costs, "outputUsd"),
    searchUsd: sum(costs, "searchUsd"),
    totalUsd: sum(costs, "totalUsd"),
    searchBillableUnits: costs.reduce((total, cost) => total + (cost.searchBillableUnits ?? 0), 0)
  };
}



function preservationPayload(outcome: StageSuccessSaveOutcome, attempted: StageOutput) {
  if (!outcome.preservedPrevious) {
    return undefined;
  }
  return {
    preservedPrevious: true,
    reason: outcome.reason,
    attemptedItemCount: outcome.attemptedItemCount,
    activeItemCount: outcome.activeItemCount,
    attemptedCoverage: outcome.attemptedCoverage,
    activeCoverage: outcome.activeCoverage,
    activeRunId: outcome.activeStage?.runId ?? null,
    activeModel: outcome.activeStage?.model ?? null,
    activeProvider: outcome.activeStage?.provider ?? null,
    attemptedModel: attempted.model ?? null,
    attemptedProvider: attempted.provider ?? null
  };
}

function sum<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  return Math.round(
    items.reduce((total, item) => total + (typeof item[key] === "number" ? item[key] as number : 0), 0) * 1_000_000_000
  ) / 1_000_000_000;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = await request.json();
    const stage2Json = body.stage2Json;
    const currentStage3 = body.stage3Result ?? body.stage3Json ?? body.result;

    if (!isRecord(stage2Json)) {
      return NextResponse.json({ error: "Falta stage2Json para detectar faltantes." }, { status: 400 });
    }
    if (!isRecord(currentStage3)) {
      return NextResponse.json({ error: "Falta stage3Result actual para fusionar resultados." }, { status: 400 });
    }

    const baseRunId = typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : randomUUID();
    const modelRef = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const blockSize = clampInt(body.blockSize, DEFAULT_BLOCK_SIZE, 1, MAX_BLOCK_SIZE);
    const initialMissingCount = getMissingStage2Items(stage2Json, currentStage3).length;
    const defaultMaxRounds = Math.min(
      MAX_ROUNDS,
      Math.max(Math.ceil(initialMissingCount / Math.max(1, blockSize)) + 5, initialMissingCount)
    );
    const maxRounds = body.maxRounds === undefined
      ? defaultMaxRounds
      : clampInt(body.maxRounds, defaultMaxRounds, 1, MAX_ROUNDS);

    let merged = currentStage3;
    const noProgressKeys = new Set<string>();
    const rounds: Array<{
      round: number;
      requested: number;
      received: number;
      added: number;
      remainingAfter: number;
      skippedNoProgress: number;
      model?: string;
    }> = [];
    let lastOutput: StageOutput | null = null;
    const blockOutputs: StageOutput[] = [];

    for (let round = 1; round <= maxRounds; round += 1) {
      const allMissing = getMissingStage2Items(stage2Json, merged);
      if (!allMissing.length) {
        break;
      }

      const missing = allMissing.filter((item) => !noProgressKeys.has(getStage3ItemKey(item).key));
      if (!missing.length) {
        break;
      }

      const block = missing.slice(0, blockSize);
      const beforeCount = Array.isArray(merged.items) ? merged.items.length : 0;
      const miniRunId = `${baseRunId}:stage3-mini-${round}`;
      const subset = makeStage2SubsetForMissing(stage2Json, block);
      const output = await runStage3ForJson(subset, miniRunId, modelRef ? { modelRef } : undefined);
      lastOutput = output;
      blockOutputs.push(output);
      merged = mergeStage3Results(stage2Json, merged, output.result);
      const afterCount = Array.isArray(merged.items) ? merged.items.length : 0;
      const added = Math.max(0, afterCount - beforeCount);
      const remainingAfter = getMissingStage2Items(stage2Json, merged).length;

      if (added <= 0) {
        for (const item of block) {
          noProgressKeys.add(getStage3ItemKey(item).key);
        }
      }

      rounds.push({
        round,
        requested: block.length,
        received: Array.isArray(output.result.items) ? output.result.items.length : 0,
        added,
        remainingAfter,
        skippedNoProgress: noProgressKeys.size,
        model: output.model
      });
    }

    const coverage = buildStage3CoverageReport(stage2Json, merged);
    const raw = JSON.stringify(merged, null, 2);
    const outputToSave: StageOutput = {
      runId: baseRunId,
      result: merged,
      raw,
      provider: lastOutput?.provider,
      model: lastOutput?.model ?? "stage3-mini-agent",
      groundingMetadata: lastOutput?.groundingMetadata,
      usage: sumUsage(blockOutputs),
      cost: sumCost(blockOutputs),
      callTrace: { status: coverage.complete ? "ok" : "partial" }
    };

    const saveOutcome = saveStageSuccess("stage3", outputToSave, Date.now() - startedAt);
    const activeStage = saveOutcome.preservedPrevious ? saveOutcome.activeStage : null;
    const activeResult = activeStage?.result ?? merged;
    const activeRaw = activeStage?.raw ?? raw;

    return NextResponse.json({
      runId: baseRunId,
      result: activeResult,
      raw: rawPreview(activeRaw),
      model: activeStage?.model ?? outputToSave.model,
      provider: activeStage?.provider ?? outputToSave.provider,
      groundingMetadata: outputToSave.groundingMetadata,
      usage: outputToSave.usage,
      cost: outputToSave.cost,
      coverage: saveOutcome.activeCoverage ?? coverage,
      rounds,
      preservation: preservationPayload(saveOutcome, outputToSave),
      usageAttempt: {
        provider: outputToSave.provider,
        model: outputToSave.model,
        usage: outputToSave.usage,
        cost: outputToSave.cost,
        itemCount: saveOutcome.attemptedItemCount
      }
    });
  } catch (error) {
    if (error instanceof PipelineFailure) {
      return NextResponse.json(failureToApiBody(error), { status: error.httpStatus });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado completando faltantes." },
      { status: 500 }
    );
  }
}
