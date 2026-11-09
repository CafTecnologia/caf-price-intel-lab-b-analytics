import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findCaseMemories, listCaseMemories } from "../lib/case-memory";
import { recordHumanReview } from "../lib/human-loop";
import { executeItemCorrection, executeRun } from "../lib/orchestrator";
import { parseDocument } from "../lib/document-parser";
import { resetData, saveRun } from "../lib/store";
import type { AgentItem, AgentRun, AgentTaskResponse, OriginalItem } from "../lib/types";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-human-learning");

const relatedCases = [
  "Papel bond carta 75 g caja x10 resmas",
  "Papel bond oficio caja por 10 resmas de 500 hojas",
  "Caja de papel reprografico carta x 10 resmas",
  "Suministro de diez resmas papel bond 75 gramos",
  "Papel tamaño carta presentacion caja 10 resmas",
  "Caja x10 resmas de papel blanco oficio 75 g"
];

const unrelatedCases = [
  "Brazo hidraulico para puerta de 85 kg",
  "Tomacorriente doble 15 A certificado RETIE",
  "Cable solar rojo 6 mm2 rollo 100 metros",
  "Bisagra pivotante de aluminio para vitrina",
  "Etiquetas poliester plata 50 x 25 mm",
  "Pintura exterior blanca cuñete 18.9 litros",
  "Carretilla metalica de 156 litros",
  "Sensor de presion 4 a 20 mA",
  "Reflector LED 100 W 6500 K",
  "Tornillo punta lenteja para cielo falso"
];

async function main() {
  await resetData();
  const fixture = path.join(process.cwd(), "fixtures", "licitacion-papeleria-12.json");
  const parsed = parseDocument(path.basename(fixture), fs.readFileSync(fixture));
  const baseline = makeRun(`learning_baseline_${Date.now()}`, parsed.items);
  await saveRun(baseline);
  const completed = await executeRun(baseline.id);
  const untouchedId = "10";
  const untouchedBefore = structuredClone(completed.items.find((entry) => entry.id === untouchedId));

  const correctionGuidance = "Confirmar que el precio sea por caja de diez resmas y no por una resma individual.";
  for (let index = 0; index < 3; index += 1) {
    const source = makeRun(`learning_source_${index}_${Date.now()}`, [
      original(String(index + 1), relatedCases[index])
    ]);
    await saveRun(source);
    await recordHumanReview(source.id, {
      itemId: String(index + 1),
      verdict: "incorrect",
      stage: "market",
      comment: correctionGuidance,
      tags: ["Unidad o empaque"],
      rememberForSimilar: true,
      action: "record"
    });
  }

  const review = await recordHumanReview(completed.id, {
    itemId: "9",
    verdict: "incorrect",
    stage: "market",
    comment: correctionGuidance,
    tags: ["Unidad o empaque"],
    rememberForSimilar: true,
    action: "rerun",
    correction: {
      supplier: "Proveedor confirmado por humano",
      price: 178000,
      currency: "COP",
      url: "https://example.com/papel-caja-x10",
      confidence: "high",
      decision: "accept"
    }
  });
  const prompts: string[] = [];
  const corrected = await executeItemCorrection(completed.id, "9", review.review.id, async (_provider, request) => {
    prompts.push(request.prompt);
    return {
      ok: true,
      contract: "caf-agent-task/v1",
      jobId: request.jobId,
      status: "completed",
      stage: request.stage,
      rawResponse: JSON.stringify(request.mockResponse)
    } satisfies AgentTaskResponse;
  });

  const relatedResults = await Promise.all(relatedCases.map(async (name) => ({
    name,
    matches: (await findCaseMemories(makeItem(original(name, name)), "market")).length
  })));
  const unrelatedResults = await Promise.all(unrelatedCases.map(async (name) => ({
    name,
    matches: (await findCaseMemories(makeItem(original(name, name)), "market")).length
  })));
  const memories = await listCaseMemories();
  const recurring = memories.filter((entry) => entry.strength === "recurring");
  const targetAfter = corrected.items.find((entry) => entry.id === "9");
  const untouchedAfter = corrected.items.find((entry) => entry.id === untouchedId);
  const relatedHits = relatedResults.filter((entry) => entry.matches > 0).length;
  const unrelatedHits = unrelatedResults.filter((entry) => entry.matches > 0).length;
  const report = {
    generatedAt: new Date().toISOString(),
    contract: "caf-human-learning-evaluation/v1",
    scope: "Revision humana simulada sobre un proceso realista de papeleria, recuperacion semantica controlada y correccion focalizada.",
    baseline: {
      items: completed.items.length,
      normalized: completed.metrics.normalized,
      interpreted: completed.metrics.interpreted,
      supervised: completed.items.filter((entry) => entry.supervision).length
    },
    learning: {
      memories: memories.length,
      recurring: recurring.length,
      confirmations: recurring[0]?.confirmations || 0,
      relatedRecall: relatedHits / relatedCases.length,
      unrelatedFalsePositiveRate: unrelatedHits / unrelatedCases.length,
      relatedResults,
      unrelatedResults
    },
    targetedCorrection: {
      correctedItem: targetAfter?.id,
      supplier: targetAfter?.market?.supplier,
      price: targetAfter?.market?.price,
      decision: targetAfter?.humanDecision?.decision,
      promptCarriedHumanGuidance: prompts.some((entry) => entry.includes(correctionGuidance)),
      promptCarriedPrecedent: prompts.some((entry) => entry.includes("precedentes")),
      untouchedItemPreserved: JSON.stringify(untouchedBefore) === JSON.stringify(untouchedAfter),
      rerunStages: corrected.steps
        .filter((step) => step.itemIds.length === 1 && step.itemIds[0] === "9")
        .map((step) => step.stage)
    }
  };

  const outputDir = path.join(process.cwd(), ".test-reports");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "human-learning.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  assert.equal(report.baseline.items, 12);
  assert.ok(report.learning.relatedRecall >= 0.8);
  assert.equal(report.learning.unrelatedFalsePositiveRate, 0);
  assert.ok(report.learning.recurring >= 1);
  assert.equal(report.targetedCorrection.supplier, "Proveedor confirmado por humano");
  assert.equal(report.targetedCorrection.price, 178000);
  assert.equal(report.targetedCorrection.untouchedItemPreserved, true);
  assert.equal(report.targetedCorrection.promptCarriedHumanGuidance, true);
  assert.equal(report.targetedCorrection.promptCarriedPrecedent, true);

}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function makeRun(id: string, originals: OriginalItem[]): AgentRun {
  const at = new Date().toISOString();
  const items = originals.map(makeItem);
  return {
    contract: "caf-agent-run/v1",
    id,
    name: "Evaluacion aprendizaje humano",
    branch: 1,
    status: "draft",
    providerId: "mock",
    model: "mock-deterministic",
    batchSize: 30,
    createdAt: at,
    updatedAt: at,
    activeStage: "source",
    inventory: {
      fileName: "human-learning.json",
      extension: ".json",
      size: items.length,
      sheets: [{ name: "JSON", rows: items.length, columns: 7 }],
      parser: "evaluation",
      detectedRows: items.length,
      warnings: []
    },
    items,
    steps: [],
    events: [],
    metrics: {
      totalItems: items.length,
      normalized: 0,
      interpreted: 0,
      priced: 0,
      accepted: 0,
      pending: items.length,
      warnings: 0,
      durationMs: 0,
      providerCalls: 0
    }
  };
}

function makeItem(value: OriginalItem): AgentItem {
  return { id: value.id, original: value, status: "imported", reviews: [] };
}

function original(id: string, name: string): OriginalItem {
  return {
    id,
    name,
    description: name,
    unit: "CX",
    quantity: 1,
    ceilingPrice: "$ 200.000",
    source: { file: "human-learning.json", row: Number(id) || 1 },
    raw: {}
  };
}
