import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { findCaseMemories, listCaseMemories } from "../lib/case-memory";
import { effectiveDecision } from "../lib/commercial-policy";
import { recordHumanReview } from "../lib/human-loop";
import { executeItemCorrection, executeRun } from "../lib/orchestrator";
import { resetData, saveRun } from "../lib/store";
import type { AgentItem, AgentRun, AgentTaskResponse, OriginalItem } from "../lib/types";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-data-learning");

test("la evaluacion incorrecta manda sobre el supervisor sin borrar el resultado", async () => {
  await resetData();
  const run = await completedRun("human_override", [
    original("1", "Papel bond carta caja x10 resmas"),
    original("2", "Marcador borrable negro")
  ]);
  const before = structuredClone(run.items[1]);
  const result = await recordHumanReview(run.id, {
    itemId: "1",
    verdict: "incorrect",
    stage: "market",
    comment: "El precio publicado corresponde a una resma y el item solicita caja por diez.",
    tags: ["Unidad o empaque"],
    action: "record"
  });
  assert.equal(effectiveDecision(result.item), "retry");
  assert.equal(result.item.humanDecision?.confidence, "low");
  assert.equal(result.review.snapshotBefore?.market?.supplier, "Tienda Colombia demo");
  assert.deepEqual(result.run.items[1], before);
});

test("una persona puede corregir campos y aprobar sin reprocesar la lista", async () => {
  await resetData();
  const run = await completedRun("human_apply", [original("1", "Caja x10 resmas papel bond 75 g carta")]);
  const result = await recordHumanReview(run.id, {
    itemId: "1",
    verdict: "correct",
    stage: "market",
    comment: "Se verifico manualmente la caja completa.",
    tags: ["Unidad o empaque"],
    action: "apply",
    correction: {
      supplier: "Papeleria verificada",
      price: 178000,
      currency: "COP",
      url: "https://example.com/caja-x10",
      decision: "accept",
      confidence: "high"
    }
  });
  assert.equal(result.item.market?.supplier, "Papeleria verificada");
  assert.equal(result.item.market?.price, 178000);
  assert.equal(effectiveDecision(result.item), "accept");
  assert.ok(result.review.resolvedAt);
});

test("la correccion focalizada solo repite el item y lleva el comentario al prompt", async () => {
  await resetData();
  const run = await completedRun("targeted_rerun", [
    original("1", "Caja x10 resmas papel bond 75 g carta"),
    original("2", "Marcador borrable negro")
  ]);
  const untouched = structuredClone(run.items[1]);
  const recorded = await recordHumanReview(run.id, {
    itemId: "1",
    verdict: "incorrect",
    stage: "market",
    comment: "Busca la presentacion caja x10; no uses el precio de una resma.",
    tags: ["Unidad o empaque"],
    rememberForSimilar: true,
    action: "rerun",
    correction: { decision: "accept_with_note", confidence: "medium" }
  });
  const prompts: string[] = [];
  const corrected = await executeItemCorrection(run.id, "1", recorded.review.id, async (_provider, request) => {
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
  const newSteps = corrected.steps.filter((step) => step.itemIds.length === 1 && step.itemIds[0] === "1" && ["market", "supervision"].includes(step.stage));
  assert.equal(newSteps.length, 2);
  assert.ok(prompts.some((prompt) => prompt.includes("Busca la presentacion caja x10")));
  assert.ok(prompts.some((prompt) => prompt.includes("precedentes")));
  assert.deepEqual(corrected.items[1], untouched);
  assert.equal(effectiveDecision(corrected.items[0]), "accept_with_note");
  assert.ok(recorded.review.snapshotBefore?.market);
});

test("buscar otra referencia conserva la fuente nueva y no reaplica silenciosamente la anterior", async () => {
  await resetData();
  const run = await completedRun("targeted_new_source", [original("1", "PC AIO i5 23 pulgadas RAM 16 GB DDR5")]);
  const previousSupplier = run.items[0].market?.supplier;
  const recorded = await recordHumanReview(run.id, {
    itemId: "1",
    verdict: "incorrect",
    stage: "market",
    comment: "Busca una referencia DDR5 disponible y no reutilices la fuente anterior.",
    action: "rerun"
  });
  const corrected = await executeItemCorrection(run.id, "1", recorded.review.id, async (_provider, request) => {
    const response = structuredClone(request.mockResponse) as { items?: Array<Record<string, unknown>> };
    if (request.stage === "market" && response.items?.[0]) {
      response.items[0].supplier = "Proveedor nuevo";
      response.items[0].product = "PC AIO DDR5 disponible";
      response.items[0].price = 3200000;
      response.items[0].url = "https://example.com/aio-ddr5";
      const lines = response.items[0].lines as Array<Record<string, unknown>>;
      lines[0].supplier = "Proveedor nuevo";
      lines[0].product = "PC AIO DDR5 disponible";
      lines[0].observedPackagePrice = 3200000;
      lines[0].url = "https://example.com/aio-ddr5";
      const evidence = lines[0].evidence as Array<Record<string, unknown>>;
      evidence[0].url = "https://example.com/aio-ddr5";
      evidence[0].finalUrl = "https://example.com/aio-ddr5";
      evidence[0].observedProduct = "PC AIO DDR5 disponible";
      evidence[0].observedPrice = 3200000;
    }
    return { ok: true, contract: "caf-agent-task/v1", jobId: request.jobId, status: "completed", stage: request.stage, rawResponse: JSON.stringify(response) };
  });
  assert.notEqual(previousSupplier, "Proveedor nuevo");
  assert.equal(corrected.items[0].market?.supplier, "Proveedor nuevo");
  assert.equal(corrected.items[0].market?.price, 3200000);
  assert.equal(corrected.steps.filter((step) => step.itemIds[0] === "1" && step.stage === "market").length, 2);
});

test("una fila marcada como no item sale del flujo pero permanece en la traza", async () => {
  await resetData();
  const run = makeRun("human_exclude", [
    original("1", "Producto real"),
    original("2", "Link de trazabilidad")
  ]);
  await saveRun(run);
  const result = await recordHumanReview(run.id, {
    itemId: "2",
    verdict: "incorrect",
    stage: "source",
    comment: "Esta fila pertenece a las instrucciones de la plantilla.",
    action: "exclude"
  });
  assert.equal(result.item.status, "excluded");
  assert.equal(result.run.items.length, 2);
  assert.equal(result.run.inventory.detectedRows, 1);
  assert.equal(result.run.metrics.totalItems, 1);
  assert.equal(result.run.metrics.pending, 1);
  const completed = await executeRun(run.id);
  assert.equal(completed.items[1].status, "excluded");
  assert.equal(completed.items[1].normalized, undefined);
  assert.equal(completed.metrics.totalItems, 1);
});

test("la memoria se recupera para casos parecidos pero no para categorias ajenas", async () => {
  await resetData();
  const sourceRun = makeRun("memory_source", [original("1", "Caja x10 resmas papel bond carta 75 gramos")]);
  await saveRun(sourceRun);
  await recordHumanReview(sourceRun.id, {
    itemId: "1",
    verdict: "incorrect",
    stage: "market",
    comment: "Confirmar que el precio sea por caja de diez resmas y no por una resma.",
    tags: ["Unidad o empaque"],
    rememberForSimilar: true,
    action: "record"
  });
  const similar = makeItem(original("2", "Papel bond oficio 75 g caja por 10 resmas"));
  const unrelated = makeItem(original("3", "Brazo hidraulico para puerta de 85 kg"));
  const similarMatches = await findCaseMemories(similar, "market");
  const unrelatedMatches = await findCaseMemories(unrelated, "market");
  assert.equal(similarMatches.length, 1);
  assert.equal(unrelatedMatches.length, 0);
});

test("un tip solo se vuelve recurrente despues de tres correcciones relacionadas", async () => {
  await resetData();
  const names = [
    "Papel bond carta caja x10 resmas 75 g",
    "Papel bond oficio caja por 10 resmas 75 gramos",
    "Caja de papel reprografico x10 resmas"
  ];
  for (let index = 0; index < names.length; index += 1) {
    const run = makeRun(`memory_repeat_${index}`, [original(String(index + 1), names[index])]);
    await saveRun(run);
    await recordHumanReview(run.id, {
      itemId: String(index + 1),
      verdict: "incorrect",
      stage: "market",
      comment: "Confirmar que el precio sea por caja de diez resmas y no por una resma.",
      tags: ["Unidad o empaque"],
      rememberForSimilar: true,
      action: "record"
    });
  }
  const memories = await listCaseMemories();
  assert.equal(memories.length, 1);
  assert.equal(memories[0].confirmations, 3);
  assert.equal(memories[0].strength, "recurring");
});

test("correcciones contradictorias no se mezclan aunque compartan producto y etiqueta", async () => {
  await resetData();
  const comments = [
    "Confirmar que el precio sea por caja de diez resmas y no por una resma.",
    "La entidad aclaro que el precio solicitado es por resma individual, no por caja."
  ];
  for (let index = 0; index < comments.length; index += 1) {
    const run = makeRun(`memory_conflict_${index}`, [original(String(index + 1), "Papel bond carta 75 g")]);
    await saveRun(run);
    await recordHumanReview(run.id, {
      itemId: String(index + 1),
      verdict: "incorrect",
      stage: "market",
      comment: comments[index],
      tags: ["Unidad o empaque"],
      rememberForSimilar: true,
      action: "record"
    });
  }
  const memories = await listCaseMemories();
  assert.equal(memories.length, 2);
  assert.ok(memories.every((entry) => entry.confirmations === 1 && entry.strength === "candidate"));
});

async function completedRun(id: string, originals: OriginalItem[]) {
  const run = makeRun(id, originals);
  await saveRun(run);
  return executeRun(run.id);
}

function makeRun(id: string, originals: OriginalItem[]): AgentRun {
  const at = new Date().toISOString();
  const items = originals.map(makeItem);
  return {
    contract: "caf-agent-run/v1",
    id,
    name: "Prueba aprendizaje humano",
    branch: 1,
    status: "draft",
    providerId: "mock",
    model: "synthetic-v1",
    batchSize: 30,
    createdAt: at,
    updatedAt: at,
    activeStage: "source",
    inventory: { fileName: "human.json", extension: ".json", size: 1, sheets: [{ name: "JSON", rows: items.length, columns: 7 }], parser: "test", detectedRows: items.length, warnings: [] },
    items,
    steps: [{ id: "source", stage: "source", title: "Inventario", expected: "Conservar", observed: `${items.length} items`, status: "passed", itemIds: items.map((item) => item.id) }],
    events: [],
    metrics: { totalItems: items.length, normalized: 0, interpreted: 0, priced: 0, accepted: 0, pending: items.length, warnings: 0, durationMs: 0, providerCalls: 0 }
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
    source: { file: "human.json", row: Number(id) || 1 },
    raw: {}
  };
}
