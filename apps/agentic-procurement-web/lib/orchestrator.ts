import type { AgentEvent, AgentItem, AgentRun, AgentStep, ProviderId, StageId, TechnicalInterpretation, ValidationIssue } from "./types";
import { getRun, saveRun } from "./store";
import { isNonRetryableProviderError, runProviderTask } from "./providers";
import { chunks, hash, id, now, parseCop, safeJsonFromText } from "./utils";
import { extractionPrompt, marketPrompt, repairPrompt, stageLabel, supervisionPrompt, technicalPrompt } from "./prompts";
import {
  contractRecords,
  confidenceValue,
  effectiveDecision,
  normalizeMarketResult,
  normalizeResolutionPlan,
  normalizeSupervision,
  numberOrNull,
  stringList,
  text,
  type JsonRecord
} from "./commercial-policy";
import { findCaseMemories } from "./case-memory";
import { applyHumanCorrection, clearFromStage } from "./human-loop";

type ApplyOutcome = { appliedIds: string[]; issues: ValidationIssue[] };

const STAGE_PIPELINE = [
  ["extraction", "Normalizar sin reinterpretar", extractionPrompt, mockExtraction, applyExtraction],
  ["technical", "Separar requisitos duros, flexibles y ambiguos", technicalPrompt, mockTechnical, applyTechnical],
  ["market", "Buscar y sustentar una referencia comercial", marketPrompt, mockMarket, applyMarket],
  ["supervision", "Auditar precio, producto y evidencia", supervisionPrompt, mockSupervision, applySupervision]
] as const;

export async function executeRun(runId: string, taskRunner: typeof runProviderTask = runProviderTask, providerOverride?: ProviderId) {
  const run = await getRun(runId);
  if (!run) throw new Error("Proceso no encontrado.");
  if (!run.items.length) throw new Error("El proceso no tiene items detectados.");
  if (providerOverride && providerOverride !== run.providerId) {
    const previousProvider = run.providerId;
    run.providerId = providerOverride;
    run.model = providerOverride === "mock" ? "synthetic-v1" : "codex-cli";
    event(run, "human", run.activeStage, "Proveedor cambiado", `${previousProvider} -> ${providerOverride}. La corrida conserva el archivo y reanuda desde ${stageLabel(run.activeStage)}.`);
  }
  if (run.status === "needs_review") {
    const retryItems = run.items.filter((item) =>
      item.status !== "excluded" &&
      ["retry", "no_result"].includes(effectiveDecision(item)) &&
      (item.attempts?.market || 0) < 3
    );
    if (!retryItems.length) {
      event(run, "human", "supervision", "Control humano requerido", "No quedan items elegibles para busqueda automatica: los pendientes agotaron tres intentos o exigen criterio humano.");
      updateMetrics(run);
      await saveRun(run);
      return run;
    }
    run.branch += 1;
    run.activeStage = nextResumeStage(run.items);
    if (run.activeStage === "market") {
      for (const item of retryItems.filter((entry) => Boolean(entry.technical))) {
        item.market = undefined;
        item.supervision = undefined;
        item.supervisedAt = undefined;
        item.status = "interpreted";
      }
    }
    event(run, "human", run.activeStage, "Reintento dirigido", `${retryItems.length} pendientes pasan a la rama ${run.branch} desde ${stageLabel(run.activeStage)}; los resultados validos se conservan.`);
  }
  run.status = "running";
  run.startedAt ||= now();
  event(run, "system", "source", "Ejecucion iniciada", `${activeItems(run.items).length} items activos; proveedor ${run.providerId}.`);
  await saveRun(run);

  try {
    const resumeFrom = run.activeStage === "source" ? 0 : Math.max(0, STAGE_PIPELINE.findIndex(([stage]) => stage === run.activeStage));
    for (const [stage, expected, prompt, mock, apply] of STAGE_PIPELINE.slice(resumeFrom)) {
      await executeBatchedStage(run, stage, expected, prompt, mock, apply, taskRunner);
    }
    updateMetrics(run);
    run.status = run.metrics.pending > 0 ? "needs_review" : "completed";
    run.completedAt = now();
    event(run, "system", "supervision", "Proceso cerrado", `${run.metrics.accepted} aceptables; ${run.metrics.pending} pendientes de criterio humano.`);
  } catch (error) {
    run.status = "failed";
    event(run, "error", run.activeStage, "Ejecucion interrumpida", error instanceof Error ? error.message : String(error));
  }
  updateMetrics(run);
  await saveRun(run);
  return run;
}

export async function executeItemCorrection(
  runId: string,
  itemId: string,
  reviewId: string,
  taskRunner: typeof runProviderTask = runProviderTask,
  providerOverride?: ProviderId
) {
  const run = await getRun(runId);
  if (!run) throw new Error("Proceso no encontrado.");
  const item = run.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Item no encontrado.");
  const review = (item.reviews || []).find((entry) => entry.id === reviewId);
  if (!review) throw new Error("Revision humana no encontrada.");
  if (providerOverride) {
    run.providerId = providerOverride;
    run.model = providerOverride === "mock" ? "synthetic-v1" : "codex-cli";
  }
  const startStage = review.stage === "source" ? "extraction" : review.stage;
  clearFromStage(item, startStage);
  run.branch += 1;
  run.status = "running";
  run.activeStage = startStage;
  run.completedAt = undefined;
  event(
    run,
    "human",
    startStage,
    "Correccion focalizada",
    `Solo el item ${item.id} se repite desde ${stageLabel(startStage)} con la revision ${review.id}.`,
    undefined,
    item.id
  );
  await saveRun(run);

  try {
    const resumeFrom = Math.max(0, STAGE_PIPELINE.findIndex(([stage]) => stage === startStage));
    const targetIds = new Set([item.id]);
    for (const [stage, expected, prompt, mock, apply] of STAGE_PIPELINE.slice(resumeFrom)) {
      await executeBatchedStage(run, stage, expected, prompt, mock, apply, taskRunner, targetIds);
    }
    if (review.correction && Object.keys(review.correction).length) {
      applyHumanCorrection(item, review);
    }
    review.resolvedAt = now();
    updateMetrics(run);
    run.status = run.metrics.pending > 0 ? "needs_review" : "completed";
    run.completedAt = now();
    event(
      run,
      "system",
      "supervision",
      "Correccion aplicada",
      `El item ${item.id} genero una nueva version; ${run.items.length - 1} item(s) permanecieron intactos.`,
      undefined,
      item.id
    );
  } catch (error) {
    run.status = "needs_review";
    event(
      run,
      "error",
      startStage,
      "Correccion focalizada interrumpida",
      error instanceof Error ? error.message : String(error),
      undefined,
      item.id
    );
  }
  updateMetrics(run);
  await saveRun(run);
  return run;
}

async function executeBatchedStage(
  run: AgentRun,
  stage: Exclude<StageId, "source">,
  expected: string,
  promptBuilder: (items: AgentItem[]) => string,
  mockBuilder: (items: AgentItem[]) => unknown,
  apply: (run: AgentRun, records: Map<string, JsonRecord>, itemIds: string[]) => ApplyOutcome,
  taskRunner: typeof runProviderTask,
  targetIds?: Set<string>
) {
  run.activeStage = stage;
  const initialPending = itemsPendingForStage(run.items, stage).filter((item) => !targetIds || targetIds.has(item.id));
  if (!initialPending.length) {
    event(run, "system", stage, `${stageLabel(stage)} conservada`, "No hay items pendientes en este checkpoint.");
    return;
  }
  const trackedIds = new Set(initialPending.map((item) => item.id));
  const maxPasses = 2;
  let remaining = initialPending;
  let successfulCalls = 0;
  let appliedTotal = 0;
  event(run, "system", stage, `${stageLabel(stage)} iniciada`, `${initialPending.length} item(s); hasta ${maxPasses} pasada(s) de cobertura.`);
  await saveRun(run);

  for (let pass = 1; pass <= maxPasses && remaining.length; pass += 1) {
    const batches = chunks(remaining, Math.max(1, Math.min(30, run.batchSize)));
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      await attachLearningContext(batch, stage);
      const basePrompt = promptBuilder(batch);
      const prompt = pass > 1 ? repairPrompt(stage, basePrompt, batch) : basePrompt;
      const learningMemoryIds = unique(batch.flatMap((item) =>
        (item.learningContext || []).filter((entry) => entry.stage === stage).map((entry) => entry.memoryId)
      ));
      const step: AgentStep = {
        id: id(`step_${stage}_p${pass}_b${batchIndex + 1}`),
        stage,
        title: `${stageLabel(stage)} · pasada ${pass}/${maxPasses} · lote ${batchIndex + 1}/${batches.length}`,
        expected: `${expected}. Cobertura esperada: ${batch.length}/${batch.length}.`,
        observed: "Proveedor trabajando.",
        status: "running",
        startedAt: now(),
        provider: run.providerId,
        model: run.model,
        inputHash: hash(prompt),
        prompt,
        itemIds: batch.map((item) => item.id),
        learningMemoryIds
      };
      run.steps.push(step);
      event(run, "agent", stage, step.title, `Entrada ${step.inputHash}; ${batch.length} items.`, step.id);
      if (learningMemoryIds.length) {
        event(run, "system", stage, "Precedentes presentados", `${learningMemoryIds.length} memoria(s) de casos similares se incluyeron como contexto, no como hechos.`, step.id);
      }
      run.metrics.providerCalls += 1;
      await saveRun(run);
      const started = Date.now();

      try {
        const response = await taskRunner(run.providerId, {
          jobId: `${run.id}_${stage}_p${pass}_b${batchIndex + 1}_r${run.branch}`,
          stage,
          prompt,
          mockResponse: mockBuilder(batch)
        });
        const parsed = safeJsonFromText(response.rawResponse) as JsonRecord;
        const contract = contractRecords(stage, parsed, step.itemIds);
        const outcome = apply(run, contract.records, step.itemIds);
        const appliedIds = outcome.appliedIds;
        const validationIssues = [...contract.issues, ...outcome.issues];
        successfulCalls += 1;
        appliedTotal += appliedIds.length;
        step.rawResponse = response.rawResponse;
        step.validationIssues = validationIssues;
        step.status = appliedIds.length === batch.length && !validationIssues.length ? "passed" : "warning";
        step.observed = `${appliedIds.length}/${batch.length} registros aplicados; ${batch.length - appliedIds.length} requieren reparacion.`;
        step.completedAt = now();
        step.durationMs = Date.now() - started;
        event(run, appliedIds.length === batch.length ? "agent" : "warning", stage, `${step.title} completada`, step.observed, step.id);
        if (validationIssues.length) {
          const codes = [...new Set(validationIssues.map((entry) => entry.code))];
          event(run, "warning", stage, `${stageLabel(stage)}: validacion`, `${validationIssues.length} hallazgo(s): ${codes.join(", ")}.`, step.id);
        }
      } catch (error) {
        step.status = "failed";
        step.error = error instanceof Error ? error.message : String(error);
        step.observed = "El proveedor no entrego un resultado aplicable; este lote queda aislado.";
        step.completedAt = now();
        step.durationMs = Date.now() - started;
        event(run, "error", stage, `${step.title} fallo`, step.error, step.id);
        if (isNonRetryableProviderError(error)) {
          const action = error.userAction ? ` ${error.userAction}` : "";
          throw new Error(`${error.message}${action}`);
        }
      }
      updateMetrics(run);
      await saveRun(run);
    }
    remaining = itemsPendingForStage(run.items, stage).filter((item) => trackedIds.has(item.id));
    const covered = initialPending.length - remaining.length;
    event(run, remaining.length ? "warning" : "system", stage, `Cobertura ${stageLabel(stage)}`, `${covered}/${initialPending.length} item(s) completos tras la pasada ${pass}.`);
    if (remaining.length && pass < maxPasses) {
      event(run, "agent", stage, "Reparacion focalizada", `La siguiente pasada recibe unicamente ${remaining.length} item(s) omitidos o invalidos.`);
    }
  }

  if (remaining.length) event(run, "warning", stage, `${stageLabel(stage)} parcial`, `${remaining.length}/${initialPending.length} item(s) quedan para una rama posterior.`);
  if (!successfulCalls && !appliedTotal) throw new Error(`Todos los lotes de ${stageLabel(stage)} fallaron.`);
}

export function nextResumeStage(items: AgentItem[]): Exclude<StageId, "source"> {
  const active = activeItems(items);
  if (active.some((item) => !item.normalized)) return "extraction";
  if (active.some((item) => item.normalized && !item.technical)) return "technical";
  if (active.some((item) => item.technical && !item.market)) return "market";
  if (active.some((item) => item.market && !item.supervisedAt)) return "supervision";
  return "market";
}

function itemsPendingForStage(items: AgentItem[], stage: Exclude<StageId, "source">) {
  const active = activeItems(items);
  if (stage === "extraction") return active.filter((item) => !item.normalized);
  if (stage === "technical") return active.filter((item) => Boolean(item.normalized) && !item.technical);
  if (stage === "market") return active.filter((item) => Boolean(item.technical) && !item.market);
  return active.filter((item) => Boolean(item.market) && !item.supervisedAt);
}

function applyExtraction(run: AgentRun, records: Map<string, JsonRecord>, itemIds: string[]): ApplyOutcome {
  const applied: string[] = [];
  const issues: ValidationIssue[] = [];
  for (const item of run.items.filter((entry) => itemIds.includes(entry.id))) {
    const record = records.get(item.id);
    if (!record) continue;
    if (record.isItem === false || text(record.isItem).toLowerCase() === "false") {
      item.status = "excluded";
      item.normalized = undefined;
      item.technical = undefined;
      item.market = undefined;
      item.supervision = undefined;
      item.supervisedAt = undefined;
      event(
        run,
        "warning",
        "extraction",
        `Registro ${item.id} excluido del inventario activo`,
        stringList(record.transformations)[0] || "El agente determino que la fila era contenido auxiliar y no un item cotizable.",
        undefined,
        item.id
      );
      applied.push(item.id);
      continue;
    }
    const fallbackFields: string[] = [];
    const name = text(record.name) || fallback("name", item.original.name, fallbackFields);
    const description = text(record.description) || fallback("description", item.original.description, fallbackFields);
    const lot = text(record.lot) || item.original.lot || undefined;
    const unit = text(record.unit) || fallback("unit", item.original.unit, fallbackFields);
    if (fallbackFields.length) {
      issues.push({
        stage: "extraction",
        itemId: item.id,
        code: "system_fallback_used",
        severity: "warning",
        message: `Se conservaron campos originales porque el modelo los omitio: ${fallbackFields.join(", ")}.`
      });
    }
    item.normalized = {
      name,
      description,
      ...(lot ? { lot } : {}),
      unit,
      quantity: numberOrNull(record.quantity),
      ceilingPriceCop: numberOrNull(record.ceilingPriceCop),
      transformations: stringList(record.transformations),
      fallbackFields
    };
    item.status = "normalized";
    applied.push(item.id);
  }
  return { appliedIds: applied, issues };
}

function applyTechnical(run: AgentRun, records: Map<string, JsonRecord>, itemIds: string[]): ApplyOutcome {
  const applied: string[] = [];
  const issues: ValidationIssue[] = [];
  for (const item of run.items.filter((entry) => itemIds.includes(entry.id))) {
    const record = records.get(item.id);
    if (!record || !text(record.searchBrief) || !["exact", "defined_range", "open", "unclear"].includes(text(record.purchaseMode))) continue;
    const normalizedPlan = normalizeResolutionPlan(record, item);
    issues.push(...normalizedPlan.issues);
    if (!normalizedPlan.plan || normalizedPlan.issues.some((entry) => entry.severity === "error")) continue;
    item.technical = {
      purchaseMode: ["exact", "defined_range", "open", "unclear"].includes(text(record.purchaseMode)) ? text(record.purchaseMode) as TechnicalInterpretation["purchaseMode"] : "unclear",
      hardRequirements: stringList(record.hardRequirements),
      flexibleRequirements: stringList(record.flexibleRequirements),
      ambiguities: stringList(record.ambiguities),
      searchBrief: text(record.searchBrief),
      confidence: confidenceValue(record.confidence),
      resolutionPlan: normalizedPlan.plan
    };
    item.status = "interpreted";
    applied.push(item.id);
  }
  return { appliedIds: applied, issues };
}

function applyMarket(run: AgentRun, records: Map<string, JsonRecord>, itemIds: string[]): ApplyOutcome {
  const applied: string[] = [];
  const issues: ValidationIssue[] = [];
  for (const item of run.items.filter((entry) => itemIds.includes(entry.id))) {
    const record = records.get(item.id);
    if (!record) continue;
    const normalizedMarket = normalizeMarketResult(record, item);
    issues.push(...normalizedMarket.issues);
    if (normalizedMarket.issues.some((entry) => entry.severity === "error")) continue;
    item.market = normalizedMarket.market;
    item.attempts = { market: (item.attempts?.market || 0) + 1 };
    item.supervision = undefined;
    item.supervisedAt = undefined;
    item.status = item.market.supplier && item.market.price !== null ? "priced" : "pending";
    applied.push(item.id);
  }
  return { appliedIds: applied, issues };
}

function applySupervision(run: AgentRun, records: Map<string, JsonRecord>, itemIds: string[]): ApplyOutcome {
  const applied: string[] = [];
  const issues: ValidationIssue[] = [];
  for (const item of run.items.filter((entry) => itemIds.includes(entry.id))) {
    const record = records.get(item.id);
    if (!record || !item.market) continue;
    const supervision = normalizeSupervision(record, item);
    item.supervision = supervision;
    item.supervisedAt = now();
    item.status = ["accept", "accept_with_note"].includes(supervision.decision) ? "priced" : supervision.decision === "human_review" ? "escalated" : "pending";
    if (supervision.firstDeviation) event(run, "warning", "supervision", `Desviacion en item ${item.id}`, supervision.firstDeviation, undefined, item.id);
    if (supervision.policyAdjustments.length) {
      issues.push({
        stage: "supervision",
        itemId: item.id,
        code: "policy_adjustment",
        severity: "warning",
        message: supervision.policyAdjustments.join(" ")
      });
    }
    applied.push(item.id);
  }
  return { appliedIds: applied, issues };
}

function mockExtraction(items: AgentItem[]) {
  return {
    contract: "caf-extraction/v1",
    items: items.map((item) => ({
      id: item.id,
      isItem: true,
      name: item.original.name.trim(),
      description: item.original.description.trim(),
      lot: item.original.lot,
      unit: item.original.unit.trim().toUpperCase(),
      quantity: Number(String(item.original.quantity).replace(",", ".")) || null,
      ceilingPriceCop: parseCop(item.original.ceilingPrice),
      transformations: ["Espacios limpiados", "Unidad llevada a mayusculas"]
    })),
    warnings: []
  };
}

function mockTechnical(items: AgentItem[]) {
  return {
    contract: "caf-technical/v2",
    items: items.map((item) => {
      const textValue = `${item.original.name} ${item.original.description}`.toLowerCase();
      const exact = /marca|modelo|referencia|retie|segun muestra|según muestra|compatible/.test(textValue);
      const ambiguous = /cantidad no indicada|presentacion no indicada|unidad ambigua/.test(textValue);
      return {
        id: item.id,
        purchaseMode: ambiguous ? "unclear" : exact ? "exact" : "open",
        hardRequirements: exact ? [item.original.name] : [],
        flexibleRequirements: exact ? [] : ["Equivalente funcional comercial"],
        ambiguities: ambiguous ? ["Confirmar presentacion comercial"] : [],
        searchBrief: `Buscar en Colombia: ${item.original.name}`,
        confidence: ambiguous ? "medium" : "high",
        resolutionPlan: {
          mode: ambiguous ? "ambiguous" : "direct_product",
          automationLevel: ambiguous ? "human" : "automatic",
          rationale: ambiguous
            ? "La presentacion comercial no esta definida con suficiente precision."
            : "Una referencia comercial individual resuelve el requerimiento.",
          components: ambiguous ? [] : [{
            id: "main",
            label: item.normalized?.name || item.original.name,
            kind: "product",
            required: true,
            quantity: 1,
            unit: item.normalized?.unit || item.original.unit || "UN",
            sourcingBrief: `Buscar en Colombia: ${item.original.name}`,
            requirementBasis: [item.original.name],
            assumptions: []
          }],
          conversion: null,
          assumptions: [],
          missingInformation: ambiguous ? ["Presentacion comercial exacta"] : [],
          humanQuestions: ambiguous ? ["¿Que cantidad contiene la presentacion solicitada?"] : [],
          stopReasons: ambiguous ? ["No es seguro convertir un precio sin conocer el contenido de la presentacion."] : []
        }
      };
    }),
    warnings: []
  };
}

function mockMarket(items: AgentItem[]) {
  return {
    contract: "caf-market/v2",
    items: items.map((item, index) => index % 4 === 3 ? {
      id: item.id,
      pricingType: "no_result",
      supplier: "",
      product: "",
      price: null,
      currency: "COP",
      url: "",
      notes: "Sin fuente sintetica para probar reintento.",
      evidence: [],
      confidence: "no_data",
      workerRecommendation: "no_result",
      missingComponents: [],
      calculationWarnings: [],
      lines: []
    } : {
      id: item.id,
      pricingType: "observed_single",
      supplier: index % 2 ? "Proveedor especializado demo" : "Tienda Colombia demo",
      product: item.normalized?.name || item.original.name,
      price: Math.max(1000, Math.round((item.normalized?.ceilingPriceCop || 20000) * (0.72 + index * 0.03))),
      currency: "COP",
      url: `https://example.com/producto/${encodeURIComponent(item.id)}`,
      notes: "Candidato sintetico; no usar como precio real.",
      evidence: ["Producto coincide", "Precio presente"],
      confidence: index % 3 === 2 ? "medium" : "high",
      workerRecommendation: index % 3 === 2 ? "accept_with_note" : "accept",
      missingComponents: [],
      calculationWarnings: [],
      lines: [mockPricingLine(item, index)]
    }),
    warnings: ["Las fuentes example.com son evidencia sintetica."]
  };
}

function mockSupervision(items: AgentItem[]) {
  return {
    contract: "caf-supervision/v2",
    items: items.map((item) => {
      const hasData = Boolean(item.market?.supplier && item.market?.price !== null);
      return {
        id: item.id,
        sourceSupport: hasData ? "yes" : "unknown",
        priceObserved: hasData ? "yes" : "unknown",
        productMatch: hasData ? "yes" : "unknown",
        presentationMatch: hasData ? "yes" : "unknown",
        componentCompleteness: hasData ? "complete" : "unknown",
        calculationValid: hasData ? "yes" : "unknown",
        confidence: hasData ? "high" : "no_data",
        decision: hasData ? "accept" : "no_result",
        reason: hasData ? "Producto y precio tienen soporte sintetico coherente." : "No hay proveedor y precio para evaluar.",
        firstDeviation: hasData ? "" : "La busqueda no encontro una fuente candidata.",
        humanAction: ""
      };
    }),
    warnings: []
  };
}

function mockPricingLine(item: AgentItem, index: number) {
  const supplier = index % 2 ? "Proveedor especializado demo" : "Tienda Colombia demo";
  const product = item.normalized?.name || item.original.name;
  const price = Math.max(1000, Math.round((item.normalized?.ceilingPriceCop || 20000) * (0.72 + index * 0.03)));
  const url = `https://example.com/producto/${encodeURIComponent(item.id)}`;
  const unit = item.normalized?.unit || item.original.unit || "UN";
  return {
    componentId: "main",
    coveredComponentIds: ["main"],
    label: product,
    supplier,
    product,
    observedPackagePrice: price,
    currency: "COP",
    url,
    sourceQuantity: 1,
    sourceUnit: unit,
    requiredQuantity: 1,
    requiredUnit: unit,
    pricingMethod: "direct",
    evidence: [{
      url,
      finalUrl: url,
      observedAt: "2026-07-23T00:00:00.000Z",
      pageTitle: product,
      observedProduct: product,
      observedPrice: price,
      currency: "COP",
      presentation: "Una unidad",
      availability: "in_stock",
      verificationMethod: "direct_page",
      observations: ["Evidencia sintetica controlada"]
    }]
  };
}

function event(run: AgentRun, kind: AgentEvent["kind"], stage: StageId, title: string, detail: string, stepId?: string, itemId?: string) {
  run.events.push({ id: id("event"), at: now(), kind, stage, title, detail, stepId, itemId });
}

export function updateMetrics(run: AgentRun) {
  const active = activeItems(run.items);
  run.inventory.detectedRows = active.length;
  run.metrics.totalItems = active.length;
  run.metrics.normalized = active.filter((item) => item.normalized).length;
  run.metrics.interpreted = active.filter((item) => item.technical).length;
  run.metrics.priced = active.filter((item) => item.market?.price !== null && item.market?.supplier).length;
  run.metrics.accepted = active.filter((item) => ["accept", "accept_with_note"].includes(effectiveDecision(item))).length;
  run.metrics.pending = active.length - run.metrics.accepted;
  run.metrics.warnings = run.events.filter((entry) => ["warning", "error"].includes(entry.kind)).length;
  run.metrics.durationMs = run.startedAt ? new Date(run.completedAt || now()).getTime() - new Date(run.startedAt).getTime() : 0;
}

function activeItems(items: AgentItem[]) {
  return items.filter((item) => item.status !== "excluded");
}

export function readStringList(value: unknown) {
  return stringList(value);
}

async function attachLearningContext(items: AgentItem[], stage: Exclude<StageId, "source">) {
  await Promise.all(items.map(async (item) => {
    const otherStages = (item.learningContext || []).filter((entry) => entry.stage !== stage);
    const matches = await findCaseMemories(item, stage);
    item.learningContext = [...otherStages, ...matches];
  }));
}

function fallback(field: string, value: unknown, fields: string[]) {
  fields.push(field);
  return text(value);
}

function unique(values: string[]) {
  return [...new Set(values)];
}
