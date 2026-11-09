import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StageOutput } from "@/lib/ai-pipeline";

const originalCwd = process.cwd();
let tempDir: string | null = null;

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function loadIsolatedModules() {
  tempDir = mkdtempSync(path.join(tmpdir(), "ia-stage3-history-"));
  process.chdir(tempDir);
  vi.resetModules();
  const runHistory = await import("@/lib/run-history");
  const stage3Review = await import("@/lib/stage3Review");
  return { runHistory, stage3Review };
}

function makeStageOutput(runId: string, result: Record<string, unknown>, model: string, totalTokens = 100): StageOutput {
  return {
    runId,
    result,
    raw: JSON.stringify(result),
    provider: "gemini" as const,
    model,
    usage: {
      inputTokens: Math.floor(totalTokens / 2),
      cachedInputTokens: 0,
      outputTokens: Math.ceil(totalTokens / 2),
      thinkingTokens: 0,
      totalTokens
    },
    cost: {
      provider: "gemini" as const,
      model,
      pricingLabel: "test",
      pricingVerifiedAt: "test",
      pricingSourceUrl: "test",
      inputUsd: 0.001,
      cachedInputUsd: 0,
      outputUsd: 0.001,
      searchUsd: 0,
      totalUsd: 0.002
    },
    callTrace: { status: "ok" as const }
  };
}

function stage2Fixture() {
  return {
    items: [
      { "Consecutivo interno": 1, "No. item": "A", "Nombre o descripci?n": "Equipo A" },
      { "Consecutivo interno": 2, "No. item": "B", "Nombre o descripci?n": "Equipo B" }
    ]
  };
}

describe("run-history Etapa 3 preservation", () => {
  it("guarda el intento parcial pero conserva activo el resultado completo anterior", async () => {
    const { runHistory, stage3Review } = await loadIsolatedModules();
    const stage2 = stage2Fixture();
    const complete = stage3Review.annotateStage3Coverage(stage2, {
      items: [
        { "Consecutivo interno": 1, precio: 100 },
        { "Consecutivo interno": 2, precio: 200 }
      ]
    });
    const partial = stage3Review.annotateStage3Coverage(stage2, {
      items: [{ "Consecutivo interno": 1, precio: 100 }]
    });

    const first = runHistory.saveStageSuccess("stage3", makeStageOutput("run-a", complete, "complete-model", 120));
    const second = runHistory.saveStageSuccess("stage3", makeStageOutput("run-a", partial, "partial-model", 80));
    const run = runHistory.getRun("run-a");
    const activeStage3 = run?.stages.find((stage) => stage.stage === "stage3");

    expect(first.activeUpdated).toBe(true);
    expect(second.preservedPrevious).toBe(true);
    expect(second.activeUpdated).toBe(false);
    expect(activeStage3?.model).toBe("complete-model");
    expect(activeStage3?.result.items).toHaveLength(2);
    expect(run?.usageAttempts).toHaveLength(2);
    expect(run?.usageAttempts.map((attempt) => attempt.model)).toEqual([
      "complete-model",
      "partial-model"
    ]);
  });

  it("permite que un intento completo reemplace un activo parcial", async () => {
    const { runHistory, stage3Review } = await loadIsolatedModules();
    const stage2 = stage2Fixture();
    const partial = stage3Review.annotateStage3Coverage(stage2, {
      items: [{ "Consecutivo interno": 1, precio: 100 }]
    });
    const complete = stage3Review.annotateStage3Coverage(stage2, {
      items: [
        { "Consecutivo interno": 1, precio: 100 },
        { "Consecutivo interno": 2, precio: 200 }
      ]
    });

    runHistory.saveStageSuccess("stage3", makeStageOutput("run-b", partial, "partial-model", 80));
    const second = runHistory.saveStageSuccess("stage3", makeStageOutput("run-b", complete, "complete-model", 120));
    const run = runHistory.getRun("run-b");
    const activeStage3 = run?.stages.find((stage) => stage.stage === "stage3");

    expect(second.activeUpdated).toBe(true);
    expect(second.preservedPrevious).toBe(false);
    expect(activeStage3?.model).toBe("complete-model");
    expect(activeStage3?.result.items).toHaveLength(2);
  });

  it("encuentra el mejor resultado historico del mismo analisis sin alterar datos", async () => {
    const { runHistory, stage3Review } = await loadIsolatedModules();
    const analysis = runHistory.createAnalysis({ odooProjectId: "407", title: "Proyecto prueba" });
    const stage2 = stage2Fixture();
    const partial = stage3Review.annotateStage3Coverage(stage2, {
      items: [{ "Consecutivo interno": 1, precio: 100 }]
    });
    const complete = stage3Review.annotateStage3Coverage(stage2, {
      items: [
        { "Consecutivo interno": 1, precio: 100 },
        { "Consecutivo interno": 2, precio: 200 }
      ]
    });

    runHistory.upsertRun({ runId: "run-c1", analysisId: analysis.id });
    runHistory.upsertRun({ runId: "run-c2", analysisId: analysis.id });
    runHistory.saveStageSuccess("stage3", makeStageOutput("run-c1", partial, "partial-model", 80));
    runHistory.saveStageSuccess("stage3", makeStageOutput("run-c2", complete, "complete-model", 120));

    const best = runHistory.findBestStage3ResultForRunContext({ runId: "run-c1", stage2Result: stage2 });

    expect(best?.runId).toBe("run-c2");
    expect(best?.status).toBe("complete");
    expect(best?.result?.items).toEqual(complete.items);
  });
});
