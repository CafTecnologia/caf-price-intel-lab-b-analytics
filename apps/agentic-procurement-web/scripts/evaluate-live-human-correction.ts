import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-live");

async function main() {
  const { recordHumanReview } = await import("../lib/human-loop");
  const { executeItemCorrection } = await import("../lib/orchestrator");
  const { getRun } = await import("../lib/store");
  const runsDir = path.join(process.cwd(), ".test-live", "runs");
  const runId = process.env.LIVE_CORRECTION_RUN_ID || latestLiveRun(runsDir);
  const run = await getRun(runId);
  if (!run) throw new Error(`No se encontro la corrida viva ${runId}.`);
  const itemId = process.env.LIVE_CORRECTION_ITEM_ID || "direct-exact";
  const target = run.items.find((entry) => entry.id === itemId);
  if (!target) throw new Error(`No se encontro el item ${itemId}.`);
  const othersBefore = run.items
    .filter((entry) => entry.id !== itemId)
    .map((entry) => structuredClone(entry));
  const beforeCalls = run.metrics.providerCalls;
  const comment = "El titulo observado confirma tomacorriente doble blanco 15A con polo a tierra y RETIE. La pagina directa bloqueada no invalida por si sola el artefacto de busqueda, pero conserva confianza media.";

  const recorded = await recordHumanReview(run.id, {
    itemId,
    verdict: "unclear",
    stage: "supervision",
    comment,
    tags: ["Conservar fuente", "URL general con referencia"],
    rememberForSimilar: true,
    action: "rerun",
    correction: { decision: "accept_with_note", confidence: "medium" }
  });
  const corrected = await executeItemCorrection(run.id, itemId, recorded.review.id);
  const result = corrected.items.find((entry) => entry.id === itemId)!;
  const othersAfter = corrected.items.filter((entry) => entry.id !== itemId);
  const lastStep = [...corrected.steps].reverse().find((entry) => entry.itemIds.length === 1 && entry.itemIds[0] === itemId);
  const report = {
    generatedAt: new Date().toISOString(),
    contract: "caf-live-human-correction/v1",
    runId,
    itemId,
    provider: corrected.providerId,
    before: {
      decision: target.supervision?.decision,
      confidence: target.supervision?.confidence,
      supplier: target.market?.supplier,
      price: target.market?.price
    },
    after: {
      decision: result.humanDecision?.decision,
      confidence: result.humanDecision?.confidence,
      status: result.status,
      reviewId: result.humanDecision?.reviewId
    },
    isolation: {
      untouchedItems: othersAfter.length,
      allUntouched: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
      providerCallsAdded: corrected.metrics.providerCalls - beforeCalls,
      rerunStage: lastStep?.stage,
      rerunItemIds: lastStep?.itemIds,
      learningMemoryIds: lastStep?.learningMemoryIds || []
    }
  };
  assert.equal(report.after.decision, "accept_with_note");
  assert.equal(report.after.confidence, "medium");
  assert.equal(report.isolation.allUntouched, true);
  assert.equal(report.isolation.providerCallsAdded, 1);
  assert.equal(report.isolation.rerunStage, "supervision");
  assert.deepEqual(report.isolation.rerunItemIds, [itemId]);
  assert.ok(report.isolation.learningMemoryIds.length >= 1);

  const outputDir = path.join(process.cwd(), ".test-reports");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "live-human-correction.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function latestLiveRun(directory: string) {
  const files = fs.readdirSync(directory)
    .filter((entry) => entry.startsWith("live_golden_") && entry.endsWith(".json"))
    .map((entry) => ({ entry, mtime: fs.statSync(path.join(directory, entry)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  if (!files.length) throw new Error("No hay una corrida viva golden para corregir.");
  return files[0].entry.replace(/\.json$/, "");
}
