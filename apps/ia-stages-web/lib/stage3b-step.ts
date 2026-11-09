import { randomUUID } from "node:crypto";
import type { StageOutput } from "@/lib/ai-pipeline";
import { getReviewAgentRuntimeConfig } from "@/lib/config";
import { runGoogleStage3Lab } from "@/lib/stage3-google-lab";
import { runGoogleUrlContextValidation } from "@/lib/stage3-google-url-context";
import { parseOpenAiRows, runOpenAiStage3Lab, stage3FromTsvRows } from "@/lib/stage3-openai-lab";
import { buildStage3BFinalPrompt, readStage3BPromptConfig } from "@/lib/stage3b-prompt-config";
import { runStage3SourceSupervisor } from "@/lib/stage3-source-supervisor";
import { getStageItems, isJsonRecord, itemKeyFromRecord, type JsonRecord } from "@/lib/stage-field-access";
import type { AiCostSummary, AiUsageSummary } from "@/lib/usage-cost";

export type Stage3BProvider = "openai" | "google" | "manual";
export type Stage3BStepAction = "quote" | "manual_quote" | "supervise" | "apply" | "discard_last_attempt";

type Stage3BStepInput = {
  action: Stage3BStepAction;
  stage2Json: unknown;
  currentStage3B?: unknown;
  runId?: string;
  provider?: Stage3BProvider;
  model?: string;
  reasoningEffort?: string;
  supervisorModel?: string;
  maxAttempts?: number;
  batchSize?: number;
  searchContextSize?: "low" | "medium" | "high";
  urlContextModel?: string;
  promptInstruction?: string;
  manualRaw?: string;
  manualItemKeys?: string[];
  manualPromptFinal?: string;
  autoSupervise?: boolean;
  selectedItemKeys?: string[];
};

type CostBreakdownEntry = {
  role: "cotizador" | "url_context" | "supervisor";
  provider: string;
  model: string;
  usage?: AiUsageSummary;
  cost?: AiCostSummary;
};

type Stage3BDecision = {
  itemKey: string;
  status: "sirve_directo" | "sirve_con_cautela" | "rescatable" | "sin_fuente_usable";
  accepted: boolean;
  attempt: number;
  batch: number;
  sourceStates: string[];
  confidence: "alta" | "media" | "baja" | "sin_datos";
  comment: string;
  nextAction: string;
};

type Stage3BAttempt = {
  id: string;
  attempt: number;
  batch: number;
  status: "quoted" | "supervised" | "supervisor_failed";
  requestedItemKeys: string[];
  provider: Stage3BProvider;
  model: string;
  reasoningEffort?: string;
  searchContextSize?: string;
  raw: string;
  pricingResult: Record<string, unknown>;
  pricingUsage?: AiUsageSummary;
  pricingCost?: AiCostSummary;
  pricingDetails?: Record<string, unknown>;
  groundingMetadata?: unknown;
  promptInstruction?: string;
  promptFinal?: string;
  createdAt: string;
  supervisor?: {
    model: string;
    raw: string;
    supervision: Record<string, unknown>;
    decisions: Stage3BDecision[];
    passes?: Array<Record<string, unknown>>;
    evidence?: unknown;
    evidenceSummary?: unknown;
    usage?: AiUsageSummary;
    cost?: AiCostSummary;
    urlContextResult?: unknown;
    urlContextRaw?: string;
    urlContextUsage?: AiUsageSummary;
    urlContextCost?: AiCostSummary;
    urlContextError?: string | null;
    supervisedAt: string;
    nextPromptInstruction?: string;
  };
  supervisorError?: string | null;
};

type Stage3BState = {
  attempts: Stage3BAttempt[];
};

type SupervisorPassOutput = Awaited<ReturnType<typeof runStage3SourceSupervisor>>;

const STAGE3B_DEEPSEEK_SUPERVISOR_PASSES = 2;

export async function runStage3BStep(input: Stage3BStepInput): Promise<StageOutput & { details: Record<string, unknown> }> {
  const runId = input.runId || randomUUID();
  const stage2Block = normalizeStage2Block(input.stage2Json);
  const originalItems = stage2Block.items;
  if (!originalItems.length) {
    throw new Error("Etapa 3-B necesita items de Etapa 2.");
  }

  const state = readState(input.currentStage3B);
  const provider = input.provider || "openai";
  const model = input.model || (provider === "manual" ? "manual-copy-paste" : provider === "google" ? "gemini-3.5-flash" : "gpt-5.4-mini");
  const reasoningEffort = input.reasoningEffort || "medium";
  const maxAttempts = clampInt(input.maxAttempts, 1, 3, 3);
  const batchSize = clampInt(input.batchSize, 5, 20, 20);
  const searchContextSize = input.searchContextSize || (model.includes("mini") || model.includes("nano") ? "low" : "medium");
  const supervisorModel = input.supervisorModel || await defaultSupervisorModelRef();
  const urlContextModel = input.urlContextModel || "gemini:gemini-3.5-flash";

  if (input.action === "apply") {
    return applySelectedItems({
      runId,
      state,
      stage2Block,
      selectedItemKeys: Array.isArray(input.selectedItemKeys) ? input.selectedItemKeys : [],
      model,
      provider
    });
  }

  if (input.action === "discard_last_attempt") {
    return discardLastAttempt({
      runId,
      state,
      stage2Block,
      model,
      provider
    });
  }

  if (input.action === "quote") {
    return quoteNextBatch({
      runId,
      state,
      stage2Block,
      provider,
      model,
      reasoningEffort,
      maxAttempts,
      batchSize,
      searchContextSize,
      promptInstruction: input.promptInstruction
    });
  }

  if (input.action === "manual_quote") {
    const imported = importManualQuote({
      runId,
      state,
      stage2Block,
      raw: input.manualRaw || "",
      manualItemKeys: Array.isArray(input.manualItemKeys) ? input.manualItemKeys : [],
      promptInstruction: input.promptInstruction,
      promptFinal: input.manualPromptFinal,
      model
    });
    if (!input.autoSupervise) return imported;
    return superviseLatestAttempt({
      runId,
      state: readState(imported),
      stage2Block,
      supervisorModel,
      urlContextModel
    });
  }

  return superviseLatestAttempt({
    runId,
    state,
    stage2Block,
    supervisorModel,
    urlContextModel
  });
}

async function quoteNextBatch(input: {
  runId: string;
  state: Stage3BState;
  stage2Block: { metadata?: Record<string, unknown>; items: JsonRecord[] };
  provider: Stage3BProvider;
  model: string;
  reasoningEffort: string;
  maxAttempts: number;
  batchSize: number;
  searchContextSize: "low" | "medium" | "high";
  promptInstruction?: string;
}) {
  const lastUnsupervised = [...input.state.attempts].reverse().find((attempt) => attempt.status === "quoted" && !attempt.supervisor);
  if (lastUnsupervised) {
    return buildOutput({
      runId: input.runId,
      stage2Block: input.stage2Block,
      attempts: input.state.attempts,
      stepBreakdown: [],
      model: input.model,
      provider: input.provider,
      statusNote: "Hay una cotizacion pendiente de supervision. Ejecuta primero el supervisor sobre el ultimo intento."
    });
  }

  const acceptedKeys = getAcceptedKeys(input.state.attempts);
  const attemptsByKey = countAttemptsByKey(input.state.attempts);
  const candidates = input.stage2Block.items
    .map((item, index) => ({ item, key: itemKeyFromRecord(item, index) }))
    .filter(({ key }) => !acceptedKeys.has(key) && (attemptsByKey.get(key) ?? 0) < input.maxAttempts);
  const neverAttempted = candidates.filter(({ key }) => (attemptsByKey.get(key) ?? 0) === 0);
  const retryCandidates = candidates.filter(({ key }) => (attemptsByKey.get(key) ?? 0) > 0);
  const selectedCandidates = neverAttempted.length ? neverAttempted : retryCandidates;
  const batchItems = selectedCandidates.slice(0, input.batchSize);

  if (!batchItems.length) {
    return buildOutput({
      runId: input.runId,
      stage2Block: input.stage2Block,
      attempts: input.state.attempts,
      stepBreakdown: [],
      model: input.model,
      provider: input.provider,
      statusNote: "No quedan items pendientes con intentos disponibles."
    });
  }

  const nextAttempt = input.state.attempts.length + 1;
  const batchNumber = Math.ceil(nextAttempt);
  const stage2Subset = {
    metadata: {
      ...(input.stage2Block.metadata ?? {}),
      stage3b_mode: "semi_automatic_visible",
      stage3b_attempt: nextAttempt,
      stage3b_batch: batchNumber,
      stage3b_instruction: neverAttempted.length ? "primer_pase_items_sin_cotizar" : "rescatar_solo_pendientes_visible",
      lab_prompt_style: "markdown_table_one_source"
    },
    items: batchItems.map((entry) => entry.item)
  };

  const savedPromptConfig = await readStage3BPromptConfig();
  const promptInstruction = input.promptInstruction?.trim() || savedPromptConfig.quoteInstructionPrompt;
  const promptFinal = buildStage3BFinalPrompt(promptInstruction, stage2Subset);

  const pricing = input.provider === "google"
    ? await runGoogleStage3Lab({ stage2Json: stage2Subset, model: input.model, runId: input.runId, promptOverride: promptFinal })
    : await runOpenAiStage3Lab({
        stage2Json: stage2Subset,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        searchContextSize: input.searchContextSize,
        runId: input.runId,
        maxOutputTokens: input.model.includes("mini") || input.model.includes("nano") ? 10000 : 16000,
        promptOverride: promptFinal
      });

  const costEntry: CostBreakdownEntry = {
    role: "cotizador",
    provider: pricing.provider,
    model: pricing.model,
    usage: pricing.usage,
    cost: pricing.cost
  };

  const attempt: Stage3BAttempt = {
    id: randomUUID(),
    attempt: nextAttempt,
    batch: batchNumber,
    status: "quoted",
    requestedItemKeys: batchItems.map((entry) => entry.key),
    provider: input.provider,
    model: pricing.model,
    reasoningEffort: input.reasoningEffort,
    searchContextSize: input.searchContextSize,
    raw: pricing.raw,
    pricingResult: pricing.result,
    pricingUsage: pricing.usage,
    pricingCost: pricing.cost,
    pricingDetails: isJsonRecord(pricing.details) ? pricing.details : undefined,
    groundingMetadata: pricing.groundingMetadata,
    promptInstruction,
    promptFinal,
    createdAt: new Date().toISOString()
  };

  return buildOutput({
    runId: input.runId,
    stage2Block: input.stage2Block,
    attempts: [...input.state.attempts, attempt],
    stepBreakdown: [costEntry],
    model: pricing.model,
    provider: input.provider,
    statusNote: "Cotizador termino. El raw queda guardado; ejecuta supervisor para decidir que pasa a la tabla maestra."
  });
}

function importManualQuote(input: {
  runId: string;
  state: Stage3BState;
  stage2Block: { metadata?: Record<string, unknown>; items: JsonRecord[] };
  raw: string;
  manualItemKeys: string[];
  promptInstruction?: string;
  promptFinal?: string;
  model: string;
}) {
  const raw = input.raw.trim();
  if (!raw) {
    throw new Error("Pega la respuesta Markdown del proveedor IA antes de importar el intento manual.");
  }

  const requested = new Set(input.manualItemKeys.map((key) => String(key || "").trim()).filter(Boolean));
  const rows = parseOpenAiRows(raw);
  const rowKeys = new Set(rows.map((row) => String(row.ITEM || "").trim()).filter(Boolean));
  const subsetItems = input.stage2Block.items.filter((item, index) => {
    const key = itemKeyFromRecord(item, index);
    if (requested.size) return requested.has(key);
    if (rowKeys.size) return rowKeys.has(key);
    return true;
  });

  if (!subsetItems.length) {
    throw new Error("La respuesta manual no coincide con items de Etapa 2. Revisa la columna Item.");
  }

  const nextAttempt = input.state.attempts.length + 1;
  const stage2Subset = {
    metadata: {
      ...(input.stage2Block.metadata ?? {}),
      stage3b_mode: "manual_copy_paste",
      stage3b_attempt: nextAttempt,
      lab_prompt_style: "markdown_table_one_source"
    },
    items: subsetItems
  };
  const pricingResult = stage3FromTsvRows(rows, stage2Subset, { model: input.model || "manual-copy-paste", reasoningEffort: "manual" });
  const attempt: Stage3BAttempt = {
    id: randomUUID(),
    attempt: nextAttempt,
    batch: nextAttempt,
    status: "quoted",
    requestedItemKeys: subsetItems.map((item, index) => itemKeyFromRecord(item, index)),
    provider: "manual",
    model: input.model || "manual-copy-paste",
    reasoningEffort: "manual",
    searchContextSize: "manual",
    raw,
    pricingResult: pricingResult as Record<string, unknown>,
    pricingDetails: {
      manualCopyPaste: true,
      parsedRows: rows.length,
      promptText: input.promptFinal || input.promptInstruction || null
    },
    promptInstruction: input.promptInstruction,
    promptFinal: input.promptFinal,
    createdAt: new Date().toISOString()
  };

  return buildOutput({
    runId: input.runId,
    stage2Block: input.stage2Block,
    attempts: [...input.state.attempts, attempt],
    stepBreakdown: [],
    model: attempt.model,
    provider: "manual",
    statusNote: "Intento manual importado. Ejecuta el supervisor para decidir que pasa a la tabla maestra."
  });
}

function applySelectedItems(input: {
  runId: string;
  state: Stage3BState;
  stage2Block: { metadata?: Record<string, unknown>; items: JsonRecord[] };
  selectedItemKeys: string[];
  model: string;
  provider: Stage3BProvider;
}) {
  const selected = new Set(input.selectedItemKeys.map((key) => String(key || "").trim()).filter(Boolean));
  if (!selected.size) {
    return buildOutput({
      runId: input.runId,
      stage2Block: input.stage2Block,
      attempts: input.state.attempts,
      stepBreakdown: [],
      model: input.model,
      provider: input.provider,
      statusNote: "No se seleccionaron items para subir a la tabla principal."
    });
  }

  const attempts = input.state.attempts.map((attempt) => ({ ...attempt }));
  const appliedKeys = new Set<string>();

  for (let attemptIndex = attempts.length - 1; attemptIndex >= 0; attemptIndex -= 1) {
    const attempt = attempts[attemptIndex];
    const items = getStageItems(attempt.pricingResult);
    const existingSupervisor = attempt.supervisor;
    const previousDecisions = existingSupervisor?.decisions ?? [];
    const previousByKey = new Map(previousDecisions.map((decision) => [decision.itemKey, decision]));
    const manualDecisions: Stage3BDecision[] = [];

    items.forEach((item, itemIndex) => {
      const key = itemKeyFromRecord(item, itemIndex);
      if (!selected.has(key) || appliedKeys.has(key)) return;
      if (!itemHasUsableCandidate(item)) return;
      appliedKeys.add(key);
      const supervisorDecision = previousByKey.get(key);
      manualDecisions.push(supervisorDecision?.accepted
        ? {
            ...supervisorDecision,
            accepted: true,
            sourceStates: Array.from(new Set([...supervisorDecision.sourceStates, "manual_usuario"]))
          }
        : {
            itemKey: key,
            status: "sirve_con_cautela",
            accepted: true,
            attempt: attempt.attempt,
            batch: attempt.batch,
            sourceStates: ["manual_usuario"],
            confidence: "media",
            comment: "Subido manualmente por el usuario desde Etapa 3-B. Requiere revision humana antes de decision financiera final.",
            nextAction: "aceptar_manual"
          });
    });

    if (!manualDecisions.length) continue;

    const manualByKey = new Map(manualDecisions.map((decision) => [decision.itemKey, decision]));
    const mergedDecisions = [
      ...previousDecisions.filter((decision) => !manualByKey.has(decision.itemKey)),
      ...manualDecisions
    ];

    attempts[attemptIndex] = {
      ...attempt,
      status: "supervised",
      supervisor: {
        model: existingSupervisor?.model || "manual:usuario",
        raw: existingSupervisor?.raw || "Aplicacion manual de resultados seleccionados por el usuario.",
        supervision: {
          ...(isJsonRecord(existingSupervisor?.supervision) ? existingSupervisor?.supervision : {}),
          aplicacion_manual_usuario: true,
          items_subidos_manualmente: manualDecisions.map((decision) => decision.itemKey)
        },
        decisions: mergedDecisions,
        passes: existingSupervisor?.passes,
        evidence: existingSupervisor?.evidence,
        evidenceSummary: existingSupervisor?.evidenceSummary,
        usage: existingSupervisor?.usage,
        cost: existingSupervisor?.cost,
        urlContextResult: existingSupervisor?.urlContextResult,
        urlContextRaw: existingSupervisor?.urlContextRaw,
        urlContextUsage: existingSupervisor?.urlContextUsage,
        urlContextCost: existingSupervisor?.urlContextCost,
        urlContextError: existingSupervisor?.urlContextError,
        supervisedAt: new Date().toISOString(),
        nextPromptInstruction: existingSupervisor?.nextPromptInstruction
      },
      supervisorError: null
    };
  }

  return buildOutput({
    runId: input.runId,
    stage2Block: input.stage2Block,
    attempts,
    stepBreakdown: [],
    model: input.model,
    provider: input.provider,
    statusNote: appliedKeys.size
      ? "Aplicacion manual: " + appliedKeys.size + " item(s) subidos a la tabla principal."
      : "No se encontro ningun item seleccionado con datos utiles para subir."
  });
}

function itemHasUsableCandidate(item: JsonRecord) {
  return extractQuotes(item).some((quote) => {
    const fuente = isJsonRecord(quote.fuente) ? quote.fuente : {};
    const precio = isJsonRecord(quote.precio) ? quote.precio : {};
    return Boolean(
      asText(fuente.nombre) ||
      asText(fuente.url) ||
      asText(precio.texto_original) ||
      typeof precio.valor === "number" ||
      asText(quote.evidencia_corta)
    );
  });
}

function discardLastAttempt(input: {
  runId: string;
  state: Stage3BState;
  stage2Block: { metadata?: Record<string, unknown>; items: JsonRecord[] };
  model: string;
  provider: Stage3BProvider;
}) {
  if (!input.state.attempts.length) {
    return buildOutput({
      runId: input.runId,
      stage2Block: input.stage2Block,
      attempts: input.state.attempts,
      stepBreakdown: [],
      model: input.model,
      provider: input.provider,
      statusNote: "No hay intentos 3-B para descartar."
    });
  }

  const attempts = input.state.attempts.slice(0, -1);
  return buildOutput({
    runId: input.runId,
    stage2Block: input.stage2Block,
    attempts,
    stepBreakdown: [],
    model: input.model,
    provider: input.provider,
    statusNote: "Se descarto el ultimo intento de Etapa 3-B. Puedes volver a pegar/cotizar los items pendientes."
  });
}

async function superviseLatestAttempt(input: {
  runId: string;
  state: Stage3BState;
  stage2Block: { metadata?: Record<string, unknown>; items: JsonRecord[] };
  supervisorModel: string;
  urlContextModel: string;
}) {
  let targetIndex = -1;
  for (let index = input.state.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = input.state.attempts[index];
    if (attempt.status === "quoted" && !attempt.supervisor) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) {
    return buildOutput({
      runId: input.runId,
      stage2Block: input.stage2Block,
      attempts: input.state.attempts,
      stepBreakdown: [],
      model: input.supervisorModel,
      provider: "openai",
      statusNote: "No hay un intento cotizado pendiente de supervisor."
    });
  }

  const attempts = input.state.attempts.map((attempt) => ({ ...attempt }));
  const target = attempts[targetIndex];
  const targetKeys = new Set(target.requestedItemKeys.map((key) => String(key || "").trim()).filter(Boolean));
  const supervisorStage2Block = {
    metadata: {
      ...(input.stage2Block.metadata ?? {}),
      stage3b_supervisor_scope: "latest_attempt_only",
      stage3b_supervisor_items: targetKeys.size
    },
    items: targetKeys.size
      ? input.stage2Block.items.filter((item, index) => targetKeys.has(itemKeyFromRecord(item, index)))
      : input.stage2Block.items
  };
  const stepBreakdown: CostBreakdownEntry[] = [];
  let urlContextResult: unknown = null;
  let urlContextRaw: string | undefined;
  let urlContextError: string | null = null;
  let urlContextUsage: AiUsageSummary | undefined;
  let urlContextCost: AiCostSummary | undefined;
  const targetSourceLimit = Math.min(Math.max(target.requestedItemKeys.length, getStageItems(target.pricingResult).length, 4), 120);

  try {
    const urlContext = await runGoogleUrlContextValidationWithRetry({
      stage3Result: target.pricingResult,
      model: input.urlContextModel,
      maxSources: Math.min(targetSourceLimit, 80),
      runId: input.runId
    });
    urlContextResult = urlContext.result;
    urlContextRaw = urlContext.raw;
    urlContextUsage = urlContext.usage;
    urlContextCost = urlContext.cost;
    stepBreakdown.push({ role: "url_context", provider: urlContext.provider, model: urlContext.model, usage: urlContext.usage, cost: urlContext.cost });
  } catch (error) {
    urlContextError = error instanceof Error ? error.message : String(error);
  }

  try {
    const supervisorPasses = await runStage3BSupervisorPasses({
      stage2Json: supervisorStage2Block,
      stage3Result: target.pricingResult,
      rawText: target.raw,
      maxSources: targetSourceLimit,
      urlContextResult,
      model: input.supervisorModel
    });
    for (const supervisor of supervisorPasses) {
      stepBreakdown.push({ role: "supervisor", provider: supervisor.provider, model: supervisor.model, usage: supervisor.usage, cost: supervisor.cost });
    }
    const mergedSupervisor = mergeStage3BSupervisorPasses(supervisorPasses);
    const supervisionResult = isJsonRecord(mergedSupervisor.supervision) ? mergedSupervisor.supervision : {};
    const decisions = Array.from(classifyStage3BItems(target.pricingResult, supervisionResult, target.attempt, target.batch).values());
    const nextPromptInstruction = buildNextPromptInstruction(target.promptInstruction, decisions);
    attempts[targetIndex] = {
      ...target,
      status: "supervised",
      supervisor: {
        model: mergedSupervisor.model,
        raw: mergedSupervisor.rawPreview,
        supervision: supervisionResult,
        decisions,
        passes: mergedSupervisor.passes,
        evidence: mergedSupervisor.evidence,
        evidenceSummary: mergedSupervisor.evidenceSummary,
        usage: mergedSupervisor.usage,
        cost: mergedSupervisor.cost,
        urlContextResult,
        urlContextRaw,
        urlContextUsage,
        urlContextCost,
        urlContextError,
        supervisedAt: new Date().toISOString(),
        nextPromptInstruction
      },
      supervisorError: null
    };
  } catch (error) {
    attempts[targetIndex] = {
      ...target,
      status: "supervisor_failed",
      supervisorError: error instanceof Error ? error.message : String(error)
    };
  }

  return buildOutput({
    runId: input.runId,
    stage2Block: input.stage2Block,
    attempts,
    stepBreakdown,
    model: input.supervisorModel,
    provider: target.provider,
    statusNote: attempts[targetIndex].status === "supervised"
      ? "Supervisor termino. La tabla maestra fue actualizada solo con items aceptados o utiles con cautela."
      : "El supervisor fallo. Se conserva el raw del cotizador y no se modifica la tabla maestra."
  });
}

async function runGoogleUrlContextValidationWithRetry(input: {
  stage3Result: unknown;
  model: string;
  maxSources: number;
  runId: string;
}) {
  try {
    return await runGoogleUrlContextValidation(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/503|deadline|unavailable|timeout|temporar/i.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return runGoogleUrlContextValidation(input);
  }
}

async function runStage3BSupervisorPasses(input: {
  stage2Json: unknown;
  stage3Result: unknown;
  rawText: string;
  maxSources: number;
  urlContextResult: unknown;
  model: string;
}) {
  const requestedPasses = input.model.toLowerCase().includes("deepseek") ? STAGE3B_DEEPSEEK_SUPERVISOR_PASSES : 1;
  const passes: SupervisorPassOutput[] = [];
  let sharedEvidence: unknown;

  for (let index = 0; index < requestedPasses; index += 1) {
    const supervisor = await runStage3SourceSupervisor({
      stage2Json: input.stage2Json,
      stage3Result: input.stage3Result,
      rawText: input.rawText,
      maxSources: input.maxSources,
      evidence: sharedEvidence,
      urlContextResult: input.urlContextResult,
      model: input.model
    });
    if (!sharedEvidence) sharedEvidence = supervisor.evidence;
    passes.push(supervisor);
  }

  return passes;
}

function mergeStage3BSupervisorPasses(passes: SupervisorPassOutput[]) {
  const first = passes[0];
  const sourcesById = new Map<string, Record<string, unknown>[]>();
  const evidenceById = buildSupervisorEvidenceMap(first?.evidence);

  for (const pass of passes) {
    const supervision = isJsonRecord(pass.supervision) ? pass.supervision : {};
    const fuentes = Array.isArray(supervision.fuentes) ? supervision.fuentes.filter(isJsonRecord) : [];
    for (const source of fuentes) {
      const key = supervisorSourceMergeKey(source);
      if (!key) continue;
      const normalizedSource = normalizeSupervisorSourceForDecision(source, evidenceById.get(key) ?? evidenceById.get(key.split("#")[0]));
      const bucket = sourcesById.get(key) ?? [];
      bucket.push(normalizedSource);
      sourcesById.set(key, bucket);
    }
  }

  const mergedSources = Array.from(sourcesById.entries()).map(([key, sources]) => mergeSupervisorSource(key, sources));
  const summary = summarizeMergedSupervisorSources(mergedSources);
  const mergedSupervision = {
    resumen: {
      estado_general: summary.confirmed + summary.caution > 0 ? "mixto_con_fuentes_utiles" : summary.rescuable > 0 ? "requiere_rescate" : "sin_soporte",
      fuentes_evaluadas: mergedSources.length,
      precios_confirmados: summary.confirmed,
      precios_con_cautela: summary.caution,
      fuentes_rescatables: summary.rescuable,
      sin_soporte: summary.noSupport,
      comentario: `${summary.confirmed} confirmada(s), ${summary.caution} con cautela, ${summary.rescuable} rescatable(s), ${summary.noSupport} sin soporte. Decision combinada de ${passes.length} lectura(s) del supervisor.`
    },
    fuentes: mergedSources,
    items_prioritarios: buildMergedPriorityItems(mergedSources)
  };

  const rawPreview = JSON.stringify({
    modo: "supervisor_consenso",
    pasadas: passes.length,
    resumen: mergedSupervision.resumen,
    raw_pasadas: passes.map((pass, index) => ({
      pasada: index + 1,
      model: pass.model,
      rawPreview: pass.rawPreview
    }))
  }, null, 2).slice(0, 12000);

  return {
    model: first?.model ?? "supervisor",
    rawPreview,
    evidence: first?.evidence,
    evidenceSummary: first?.evidenceSummary,
    supervision: mergedSupervision,
    usage: sumUsage(passes.map((pass) => pass.usage)),
    cost: aggregateCosts(passes.map((pass) => pass.cost), `Supervisor 3-B consenso x${passes.length}`),
    passes: passes.map((pass, index) => ({
      pass: index + 1,
      provider: pass.provider,
      model: pass.model,
      rawPreview: pass.rawPreview,
      supervision: pass.supervision,
      usage: pass.usage,
      cost: pass.cost
    }))
  };
}

function supervisorSourceMergeKey(source: Record<string, unknown>) {
  const sourceId = asText(source.sourceId);
  if (sourceId) return sourceId;
  const itemKey = asText(source.itemKey);
  const sourceIndex = asText(source.sourceIndex);
  return itemKey && sourceIndex ? `${itemKey}#${sourceIndex}` : itemKey;
}

function buildSupervisorEvidenceMap(evidence: unknown) {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(evidence)) return map;
  for (const item of evidence.filter(isJsonRecord)) {
    const sourceId = asText(item.sourceId);
    const itemKey = asText(item.itemKey);
    const sourceIndex = asText(item.sourceIndex);
    if (sourceId) map.set(sourceId, item);
    if (itemKey) map.set(itemKey, item);
    if (itemKey && sourceIndex) map.set(`${itemKey}#${sourceIndex}`, item);
  }
  return map;
}

function normalizeSupervisorSourceForDecision(source: Record<string, unknown>, evidence?: Record<string, unknown>) {
  const signals = isJsonRecord(evidence?.toolSignals) ? evidence.toolSignals : {};
  const originalState = asText(source.estado) || "sin_fuente";
  const priceSupport = supportLevel(source.precio_soportado);
  const urlSupport = supportLevel(source.url_soportada);
  const productSupport = supportLevel(source.producto_corresponde);
  const providerReported = signalYes(signals, "proveedor_reportado");
  const priceReported = signalYes(signals, "precio_reportado");
  const urlReported = signalYes(signals, "url_reportada");
  const hasCandidate = providerReported || priceReported || urlReported || Boolean(asText(source.sourceId) || asText(source.itemKey));
  const observed = isJsonRecord(evidence?.observed) ? evidence.observed : {};
  const observedHttpStatus = typeof observed.httpStatus === "number" ? observed.httpStatus : null;
  const urlHardNotFound = observedHttpStatus === 404 || observedHttpStatus === 410;

  let state = originalState;
  if (!hasCandidate || originalState === "sin_fuente") {
    state = "sin_fuente";
  } else if (productSupport === "no" || originalState === "producto_no_corresponde") {
    state = "producto_no_corresponde";
  } else {
    const priceConfirmed = priceSupport === "si"
      || signalYes(signals, "precio_reportado_aparece_en_pagina")
      || signalYes(signals, "google_url_context_precio_reportado_coincide")
      || signalYes(signals, "rescate_precio_reportado_aparece");
    const pricePartial = priceSupport === "parcial"
      || signalYes(signals, "pagina_tiene_precio")
      || signalYes(signals, "google_url_context_precio_visible")
      || signalYes(signals, "google_url_context_devolvio_precio");
    const urlConfirmed = urlSupport === "si"
      || signalYes(signals, "link_abre")
      || signalYes(signals, "google_url_context_leyo_url")
      || (signalYes(signals, "rescate_link_abre") && signalYes(signals, "rescate_url_mismo_proveedor"));
    const productSeen = productSupport === "si"
      || productSupport === "parcial"
      || signalYes(signals, "google_url_context_producto_leido")
      || signalYes(signals, "rescate_tokens_producto")
      || signalYes(signals, "url_comparte_tokens_con_item")
      || signalYes(signals, "url_comparte_tokens_con_notas_google");
    const hasExternalSupport = priceConfirmed || urlConfirmed;
    const hasCommercialProductUrl = Boolean(
      urlReported &&
      priceReported &&
      providerReported &&
      !urlHardNotFound &&
      signalYes(signals, "dominio_resuelve") &&
      signalYes(signals, "url_parece_ficha_producto") &&
      (
        signalYes(signals, "url_comparte_tokens_con_item") ||
        signalYes(signals, "url_comparte_tokens_con_producto_reportado") ||
        signalYes(signals, "url_comparte_tokens_con_notas_google")
      )
    );
    const hasReadableProductWithoutPrice = Boolean(
      priceReported &&
      providerReported &&
      urlReported &&
      !urlHardNotFound &&
      (signalYes(signals, "link_abre") || signalYes(signals, "google_url_context_leyo_url") || signalYes(signals, "rescate_link_abre")) &&
      productSeen
    );
    const hasOnlyWeakUrlHints = !hasExternalSupport && (
      signalYes(signals, "dominio_resuelve")
      || signalYes(signals, "rescate_encontro_url")
      || signalYes(signals, "url_contiene_tokens_tecnicos")
      || signalYes(signals, "url_fallida_con_pistas_rescate")
    );

    if ((originalState === "precio_confirmado" || originalState === "precio_confirmado_url_corregida") && priceConfirmed && urlConfirmed && productSeen) {
      state = originalState;
    } else if ((originalState === "precio_confirmado" || originalState === "precio_confirmado_url_corregida") && hasExternalSupport && productSeen) {
      state = "precio_confirmado_con_cautela";
    } else if ((originalState === "precio_confirmado" || originalState === "precio_confirmado_url_corregida") && (hasReadableProductWithoutPrice || hasCommercialProductUrl)) {
      state = "precio_confirmado_con_cautela";
    } else if (originalState === "precio_confirmado" || originalState === "precio_confirmado_url_corregida") {
      state = urlReported ? "url_no_verificable" : "fuente_sin_url_rescatable";
    } else if (originalState === "precio_confirmado_con_cautela" || originalState === "fuente_real_url_no_canonica" || originalState === "benchmark_util") {
      if (hasExternalSupport && productSeen && (priceReported || priceConfirmed || pricePartial)) {
        state = "precio_confirmado_con_cautela";
      } else if (hasReadableProductWithoutPrice || hasCommercialProductUrl) {
        state = "precio_confirmado_con_cautela";
      } else if (hasOnlyWeakUrlHints || productSeen) {
        state = urlReported ? "url_no_verificable" : "fuente_sin_url_rescatable";
      } else {
        state = priceReported ? "precio_sin_confirmar" : "sin_fuente";
      }
    } else if (originalState === "precio_sin_confirmar" || originalState === "fuente_sin_url_rescatable" || originalState === "url_no_verificable") {
      if (hasReadableProductWithoutPrice || hasCommercialProductUrl) {
        state = "precio_confirmado_con_cautela";
      } else {
        state = originalState;
      }
    }

    if ((state === "precio_confirmado_con_cautela" || state === "fuente_real_url_no_canonica") && !priceReported && !priceConfirmed && !pricePartial) {
      state = "precio_sin_confirmar";
    }
  }

  const normalizedConfidence = confidenceForSupervisorState(state, source.confianza);
  const normalizedAction = actionForSupervisorState(state);
  const comment = asText(source.comentario);
  const normalizedNote = state !== originalState
    ? `Normalizacion app: ${originalState} -> ${state} por consistencia entre senales binarias, estado y confianza.`
    : "";

  return {
    ...source,
    estado: state,
    confianza: normalizedConfidence,
    accion_sugerida: normalizedAction,
    comentario: [comment, normalizedNote].filter(Boolean).join(" ")
  };
}

function mergeSupervisorSource(key: string, sources: Record<string, unknown>[]) {
  const selected = [...sources].sort((a, b) => supervisorStateRank(asText(b.estado)) - supervisorStateRank(asText(a.estado)))[0] ?? {};
  const states = sources.map((source) => asText(source.estado)).filter(Boolean);
  const comments = sources.map((source) => asText(source.comentario)).filter(Boolean);
  const evidenceUsed = Array.from(new Set(sources.flatMap((source) => Array.isArray(source.evidencia_usada) ? source.evidencia_usada.map(String) : [])));
  const selectedState = asText(selected.estado);
  const hasDisagreement = new Set(states).size > 1;
  const usableVotes = sources.filter((source) => supervisorStateRank(asText(source.estado)) >= 70).length;
  const noSupportVotes = sources.filter((source) => supervisorStateRank(asText(source.estado)) <= 20).length;

  return {
    ...selected,
    sourceId: asText(selected.sourceId) || key,
    itemKey: asText(selected.itemKey) || key.split("#")[0],
    estado: selectedState || "sin_fuente",
    evidencia_usada: evidenceUsed.length ? evidenceUsed : selected.evidencia_usada,
    comentario: [
      hasDisagreement ? `Consenso supervisor: ${usableVotes} lectura(s) ven fuente util y ${noSupportVotes} lectura(s) no ven soporte pleno.` : "",
      comments[0] || "Evaluado por supervisor.",
      comments.length > 1 && comments[1] !== comments[0] ? `Otra lectura: ${comments[1]}` : ""
    ].filter(Boolean).join(" "),
    confianza: mergeConfidence(sources.map((source) => asText(source.confianza)), selectedState),
    accion_sugerida: asText(selected.accion_sugerida) || actionForSupervisorState(selectedState)
  };
}

function supervisorStateRank(state: string) {
  switch (state) {
    case "precio_confirmado_url_corregida": return 100;
    case "precio_confirmado": return 95;
    case "precio_confirmado_con_cautela": return 85;
    case "fuente_real_url_no_canonica": return 78;
    case "benchmark_util": return 76;
    case "fuente_sin_url_rescatable": return 62;
    case "precio_sin_confirmar": return 55;
    case "rescatable_por_url":
    case "rescatable_por_referencia":
    case "referencia_tecnica_sin_precio": return 50;
    case "url_no_verificable": return 35;
    case "producto_no_corresponde": return 20;
    case "sin_fuente": return 10;
    default: return 0;
  }
}

function supportLevel(value: unknown): "si" | "no" | "parcial" | "no_evaluable" {
  const text = asText(value).toLowerCase();
  if (text === "si" || text === "sí" || text === "true" || text === "ok" || text === "confirmado") return "si";
  if (text === "parcial" || text === "media" || text === "cautela") return "parcial";
  if (text === "no" || text === "false" || text === "error") return "no";
  return "no_evaluable";
}

function signalYes(signals: Record<string, unknown>, key: string) {
  return supportLevel(signals[key]) === "si";
}

function confidenceForSupervisorState(state: string, rawConfidence: unknown): Stage3BDecision["confidence"] {
  const base = bestConfidence([asText(rawConfidence)]);
  if (state === "precio_confirmado" || state === "precio_confirmado_url_corregida") {
    return base === "baja" || base === "sin_datos" ? "media" : base;
  }
  if (state === "precio_confirmado_con_cautela" || state === "fuente_real_url_no_canonica" || state === "benchmark_util") {
    return "media";
  }
  if (state === "sin_fuente") return "sin_datos";
  return "baja";
}

function mergeConfidence(values: string[], state: string) {
  const base = bestConfidence(values);
  if (state === "precio_confirmado" || state === "precio_confirmado_url_corregida") {
    return base === "baja" || base === "sin_datos" ? "media" : base;
  }
  if (state === "precio_confirmado_con_cautela" || state === "fuente_real_url_no_canonica" || state === "benchmark_util") {
    return "media";
  }
  if (state === "sin_fuente") return "sin_datos";
  if (
    state === "precio_sin_confirmar"
    || state === "fuente_sin_url_rescatable"
    || state === "url_no_verificable"
    || state === "rescatable_por_url"
    || state === "rescatable_por_referencia"
    || state === "referencia_tecnica_sin_precio"
    || state === "producto_no_corresponde"
  ) {
    return "baja";
  }
  const rank = supervisorStateRank(state);
  if (rank >= 35) return base === "baja" ? "baja" : "media";
  if (rank > 0) return base === "sin_datos" ? "sin_datos" : "baja";
  return "sin_datos";
}

function actionForSupervisorState(state: string) {
  if (state === "precio_confirmado") return "aceptar";
  if (state === "precio_confirmado_url_corregida") return "aceptar_url_corregida";
  if (state === "precio_confirmado_con_cautela" || state === "fuente_real_url_no_canonica" || state === "benchmark_util") return "aceptar_con_cautela";
  if (state === "fuente_sin_url_rescatable" || state === "rescatable_por_url" || state === "rescatable_por_referencia") return "rescatar_url";
  if (state === "precio_sin_confirmar" || state === "url_no_verificable") return "buscar_precio";
  return "nueva_busqueda";
}

function summarizeMergedSupervisorSources(sources: Record<string, unknown>[]) {
  let confirmed = 0;
  let caution = 0;
  let rescuable = 0;
  let noSupport = 0;

  for (const source of sources) {
    const rank = supervisorStateRank(asText(source.estado));
    if (rank >= 90) confirmed += 1;
    else if (rank >= 70) caution += 1;
    else if (rank >= 35) rescuable += 1;
    else noSupport += 1;
  }

  return { confirmed, caution, rescuable, noSupport };
}

function buildMergedPriorityItems(sources: Record<string, unknown>[]) {
  return sources
    .filter((source) => supervisorStateRank(asText(source.estado)) < 70)
    .slice(0, 40)
    .map((source) => ({
      itemKey: asText(source.itemKey) || asText(source.sourceId),
      motivo: asText(source.comentario) || "Fuente no queda lista para aceptar.",
      accion_sugerida: asText(source.accion_sugerida) || actionForSupervisorState(asText(source.estado))
    }));
}

function buildOutput(input: {
  runId: string;
  stage2Block: { metadata?: Record<string, unknown>; items: JsonRecord[] };
  attempts: Stage3BAttempt[];
  stepBreakdown: CostBreakdownEntry[];
  model: string;
  provider: Stage3BProvider | "openai";
  statusNote?: string;
}): StageOutput & { details: Record<string, unknown> } {
  const accepted = new Map<string, { item: JsonRecord; decision: Stage3BDecision }>();
  const latestDecision = new Map<string, Stage3BDecision>();

  for (const attempt of input.attempts) {
    if (!attempt.supervisor) continue;
    const items = getStageItems(attempt.pricingResult);
    const itemByKey = new Map(items.map((item, index) => [itemKeyFromRecord(item, index), item]));
    for (const decision of attempt.supervisor.decisions) {
      latestDecision.set(decision.itemKey, decision);
      const item = itemByKey.get(decision.itemKey);
      const canIntegrateDecision = attempt.provider !== "manual" || decision.sourceStates.includes("manual_usuario");
      if (decision.accepted && item && canIntegrateDecision) {
        accepted.set(decision.itemKey, { item, decision });
      }
    }
  }

  const finalItems = input.stage2Block.items.map((original, index) => {
    const key = itemKeyFromRecord(original, index);
    const selected = accepted.get(key);
    if (!selected) {
      return annotateBlankItem(original, latestDecision.get(key), key);
    }
    return annotateItem(original, selected.item, selected.decision);
  });

  const total = finalItems.length;
  const acceptedDirect = Array.from(accepted.values()).filter((entry) => entry.decision.status === "sirve_directo").length;
  const acceptedCaution = Array.from(accepted.values()).filter((entry) => entry.decision.status === "sirve_con_cautela").length;
  const rescatables = Array.from(latestDecision.values()).filter((decision) => decision.status === "rescatable").length;
  const noUsable = Array.from(latestDecision.values()).filter((decision) => decision.status === "sin_fuente_usable").length;
  const acceptedCount = acceptedDirect + acceptedCaution;
  const pending = Math.max(0, total - acceptedCount);
  const status = pending === 0 ? "completo" : acceptedCount > 0 ? "parcial" : input.attempts.length ? "en_revision" : "sin_resultado";
  const allBreakdown = getAllBreakdown(input.attempts);
  const cumulativeUsage = sumUsage(allBreakdown.map((entry) => entry.usage));
  const pricingProvider = input.provider === "google" ? "gemini" : "openai";
  const cumulativeCost = buildAggregateCost(pricingProvider, input.model, allBreakdown, "Etapa 3-B acumulado");
  const stepUsage = sumUsage(input.stepBreakdown.map((entry) => entry.usage));
  const stepCost = buildAggregateCost(pricingProvider, input.model, input.stepBreakdown, "Etapa 3-B paso");

  const result = {
    stage3b_attempts: input.attempts,
    stage3b_cumulative: { usage: cumulativeUsage, cost: cumulativeCost },
    metadata: {
      ...(input.stage2Block.metadata ?? {}),
      modo: "stage3b_semi_automatic_visible",
      total_items: total,
      intentos_guardados: input.attempts.length,
      aceptados_directos: acceptedDirect,
      aceptados_con_cautela: acceptedCaution,
      pendientes: pending,
      nota_operativa: input.statusNote ?? null
    },
    items: finalItems,
    control_calidad: {
      etapa3b: true,
      modo: "semi_automatico_visible",
      estado_general: status,
      total_items: total,
      sirve_directo: acceptedDirect,
      sirve_con_cautela: acceptedCaution,
      rescatable: rescatables,
      sin_fuente_usable: noUsable,
      pendiente_revision: pending,
      intentos_guardados: input.attempts.length,
      politica: "solo se integran a la tabla maestra los items aceptados por supervisor; lo demas queda en blanco y trazado en raw"
    }
  } satisfies Record<string, unknown>;

  return {
    runId: input.runId,
    provider: pricingProvider,
    model: input.model,
    result,
    raw: JSON.stringify({ note: input.statusNote, attempts: input.attempts.map(summarizeAttemptForRaw) }, null, 2),
    usage: stepUsage,
    cost: stepCost,
    details: {
      stage3b: true,
      mode: "semi_automatic_visible",
      note: input.statusNote ?? null,
      stage3bAttempts: input.attempts,
      cumulativeUsage,
      cumulativeCost,
      cumulativeCostBreakdown: allBreakdown.map((entry) => ({ role: entry.role, provider: entry.provider, model: entry.model, usage: entry.usage, cost: entry.cost }))
    }
  };
}

function summarizeAttemptForRaw(attempt: Stage3BAttempt) {
  return {
    attempt: attempt.attempt,
    batch: attempt.batch,
    status: attempt.status,
    requestedItemKeys: attempt.requestedItemKeys,
    provider: attempt.provider,
    model: attempt.model,
    rawLength: attempt.raw.length,
    rawPreview: attempt.raw.slice(0, 12000),
    supervisorError: attempt.supervisorError ?? null,
    supervisorSummary: isJsonRecord(attempt.supervisor?.supervision?.resumen) ? attempt.supervisor?.supervision?.resumen : null
  };
}

function readState(value: unknown): Stage3BState {
  const root = isJsonRecord(value) ? value : {};
  const details = isJsonRecord(root.details) ? root.details : {};
  const result = isJsonRecord(root.result) ? root.result : {};
  const attemptsSource = Array.isArray(details.stage3bAttempts)
    ? details.stage3bAttempts
    : Array.isArray(result.stage3b_attempts)
      ? result.stage3b_attempts
      : [];
  const attempts = attemptsSource.filter(isStage3BAttempt);
  return { attempts };
}

function isStage3BAttempt(value: unknown): value is Stage3BAttempt {
  return isJsonRecord(value) && typeof value.id === "string" && Array.isArray(value.requestedItemKeys) && typeof value.raw === "string" && isJsonRecord(value.pricingResult);
}

function normalizeStage2Block(stage2Json: unknown): { metadata?: Record<string, unknown>; items: JsonRecord[] } {
  if (!isJsonRecord(stage2Json)) return { metadata: {}, items: [] };
  return {
    metadata: isJsonRecord(stage2Json.metadata) ? stage2Json.metadata : {},
    items: getStageItems(stage2Json)
  };
}

async function defaultSupervisorModelRef() {
  const cfg = await getReviewAgentRuntimeConfig();
  if (cfg?.provider && cfg.model) return `${cfg.provider}:${cfg.model}`;
  return "deepseek:deepseek-v4-pro";
}

function getAcceptedKeys(attempts: Stage3BAttempt[]) {
  const keys = new Set<string>();
  for (const attempt of attempts) {
    for (const decision of attempt.supervisor?.decisions ?? []) {
      if (decision.accepted) keys.add(decision.itemKey);
    }
  }
  return keys;
}

function countAttemptsByKey(attempts: Stage3BAttempt[]) {
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    for (const key of attempt.requestedItemKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function classifyStage3BItems(stage3Result: unknown, supervision: unknown, attempt: number, batch: number) {
  const supervisorBySource = new Map<string, Record<string, unknown>>();
  if (isJsonRecord(supervision) && Array.isArray(supervision.fuentes)) {
    for (const source of supervision.fuentes.filter(isJsonRecord)) {
      const id = asText(source.sourceId);
      const itemKey = asText(source.itemKey);
      const sourceIndex = asText(source.sourceIndex);
      if (id) supervisorBySource.set(id, source);
      if (itemKey) supervisorBySource.set(itemKey, source);
      if (itemKey && sourceIndex) supervisorBySource.set(`${itemKey}#${sourceIndex}`, source);
    }
  }

  const decisions = new Map<string, Stage3BDecision>();
  const items = getStageItems(stage3Result);
  items.forEach((item, index) => {
    const key = itemKeyFromRecord(item, index);
    const quotes = extractQuotes(item);
    const supervisorSources = quotes.map((_, quoteIndex) => getSupervisorSource(supervisorBySource, key, quoteIndex));
    const sourceStates = supervisorSources.map((source) => asText(source?.estado)).filter(Boolean);
    const sourceActions = supervisorSources.map((source) => asText(source?.accion_sugerida)).filter(Boolean);
    const comments = supervisorSources.map((source) => asText(source?.comentario)).filter(Boolean);
    const sourceConfidenceValues = supervisorSources.map((source) => asText(source?.confianza));
    const hasUsableFlag = quotes.some((quote) => isJsonRecord(quote.defensa) && quote.defensa.usable_para_pricing === true);
    const hasSupervisorVerdict = sourceStates.length > 0;

    let status: Stage3BDecision["status"] = "sin_fuente_usable";
    let accepted = false;
    let nextAction = "nueva_busqueda";
		    if (sourceStates.some((state) => state === "precio_confirmado" || state === "precio_confirmado_url_corregida" || state === "ok")) {
		      status = "sirve_directo";
		      accepted = true;
		      nextAction = sourceStates.includes("precio_confirmado_url_corregida") ? "aceptar_url_corregida" : "aceptar";
		    } else if (sourceStates.some((state) => state === "precio_confirmado_con_cautela" || state === "fuente_real_url_no_canonica" || state === "benchmark_util" || state === "precio_dudoso")) {
		      status = "sirve_con_cautela";
		      accepted = true;
		      nextAction = "aceptar_con_cautela";
		    } else if (sourceStates.some((state) => state === "precio_sin_confirmar" || state === "fuente_sin_url_rescatable" || state === "url_no_verificable" || state === "rescatable_por_url" || state === "rescatable_por_referencia" || state === "referencia_tecnica_sin_precio")) {
		      status = "rescatable";
		      nextAction = sourceActions.find(Boolean) || "rescatar";
    } else if (!hasSupervisorVerdict && hasUsableFlag && quotes.length) {
      status = "sirve_con_cautela";
      accepted = true;
      nextAction = "aceptar_con_cautela";
    }

    const unitMismatchRisk = hasUnitMismatchRisk(item, quotes, comments);
    if (unitMismatchRisk && (status === "sirve_directo" || status === "sirve_con_cautela")) {
      status = "sirve_con_cautela";
      accepted = true;
      nextAction = "aceptar_con_cautela";
      if (!sourceStates.includes("unidad_diferente")) sourceStates.push("unidad_diferente");
    }

    const confidence = confidenceForDecisionStatus(status, sourceStates, sourceConfidenceValues);

    decisions.set(key, {
      itemKey: key,
      status,
      accepted,
      attempt,
      batch,
      sourceStates,
      confidence,
      comment: comments[0] || (quotes.length ? "Evaluado por supervisor 3-B." : "Sin fuente candidata."),
      nextAction
    });
  });

  return decisions;
}

function hasUnitMismatchRisk(item: JsonRecord, quotes: JsonRecord[], comments: string[]) {
  const unit = normalizeAuditText(asText(item["Und de medida"]) || asText(item["Und"]) || asText(item["unidad"]));
  const text = normalizeAuditText([
    ...comments,
    ...quotes.flatMap((quote) => {
      const price = isJsonRecord(quote.precio) ? quote.precio : {};
      const defense = isJsonRecord(quote.defensa) ? quote.defensa : {};
      const product = isJsonRecord(quote.producto) ? quote.producto : {};
      return [
        asText(price.texto_original),
        asText(price.moneda),
        asText(product.unidad_cotizada),
        asText(defense.coincidencia_unidad),
        asText(defense.evidencia_precio),
        asText(defense.justificacion),
        asText(quote.evidencia_corta),
        asText(quote.observacion_tsv)
      ];
    })
  ].filter(Boolean).join(" | "));
  if (!text) return false;
  const requestedMeters = unit === "m" || unit === "ml" || unit.includes("metro");
  const priceInFeet = /(?:^|[^a-z])\/\s*ft(?:[^a-z]|$)|\bpor pie\b|\bprecio en pie\b|\bprecio por pie\b|\bper foot\b|\bpor ft\b/.test(text);
  const explicitMismatch = /unidad difiere|unidad distinta|requiere conversion|requiere conversión|no convertido|no convertida|convertir a metro|convertir a metros/.test(text);
  return requestedMeters && (priceInFeet || explicitMismatch);
}

function normalizeAuditText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getSupervisorSource(sources: Map<string, Record<string, unknown>>, itemKey: string, quoteIndex: number) {
  return sources.get(`${itemKey}#${quoteIndex + 1}`)
    ?? sources.get(`${itemKey}-${quoteIndex + 1}`)
    ?? sources.get(`${itemKey}_${quoteIndex + 1}`)
    ?? sources.get(itemKey);
}

function confidenceForDecisionStatus(status: Stage3BDecision["status"], sourceStates: string[], values: string[]): Stage3BDecision["confidence"] {
  const base = bestConfidence(values);
  if (status === "sirve_directo") {
    return base === "baja" || base === "sin_datos" ? "media" : base;
  }
  if (status === "sirve_con_cautela") {
    return "media";
  }
  if (status === "rescatable") {
    return "baja";
  }
  if (status === "sin_fuente_usable") {
    const onlyNoSource = sourceStates.length === 0 || sourceStates.every((state) => state === "sin_fuente");
    return onlyNoSource ? "sin_datos" : "baja";
  }
  if (sourceStates.length > 0) return "baja";
  return "sin_datos";
}

function annotateItem(original: JsonRecord, selected: JsonRecord, decision: Stage3BDecision): JsonRecord {
  const selectedStatus = isJsonRecord(selected["Estado de cotizacion"]) ? selected["Estado de cotizacion"] : {};
  const selectedAudit = isJsonRecord(selected["Auditoria de busqueda"]) ? selected["Auditoria de busqueda"] : {};
  return {
    ...original,
    ...selected,
    "Estado de cotizacion": {
      ...selectedStatus,
      etapa3b_estado: decision.status,
      etapa3b_aceptado: decision.accepted,
      etapa3b_intento: decision.attempt,
      etapa3b_confianza: decision.confidence,
      etapa3b_siguiente_accion: decision.nextAction
    },
    "Auditoria de busqueda": {
      ...selectedAudit,
      etapa3b_decision: decision
    }
  };
}

function annotateBlankItem(original: JsonRecord, decision: Stage3BDecision | undefined, key: string): JsonRecord {
  return {
    ...original,
    "Estado de cotizacion": {
      etapa3b_estado: decision?.status ?? "pendiente",
      etapa3b_aceptado: false,
      etapa3b_confianza: decision?.confidence ?? "sin_datos",
      etapa3b_siguiente_accion: decision?.nextAction ?? "cotizar_o_revisar"
    },
    "Cotizaciones encontradas": [],
    "Auditoria de busqueda": {
      etapa3b_decision: decision ?? {
        itemKey: key,
        status: "sin_fuente_usable",
        accepted: false,
        attempt: 0,
        batch: 0,
        sourceStates: [],
        confidence: "sin_datos",
        comment: "Sin fuente aceptada en tabla maestra.",
        nextAction: "cotizar_o_revisar"
      }
    }
  };
}

function extractQuotes(item: JsonRecord): JsonRecord[] {
  const quotes = item["Cotizaciones encontradas"] ?? item.cotizaciones ?? item.quotes;
  return Array.isArray(quotes) ? quotes.filter(isJsonRecord) : [];
}

function getAllBreakdown(attempts: Stage3BAttempt[]): CostBreakdownEntry[] {
  const entries: CostBreakdownEntry[] = [];
  for (const attempt of attempts) {
    entries.push({ role: "cotizador", provider: attempt.provider === "google" ? "gemini" : "openai", model: attempt.model, usage: attempt.pricingUsage, cost: attempt.pricingCost });
    if (attempt.supervisor?.urlContextUsage || attempt.supervisor?.urlContextCost) {
      entries.push({ role: "url_context", provider: "gemini", model: "url_context", usage: attempt.supervisor.urlContextUsage, cost: attempt.supervisor.urlContextCost });
    }
    if (attempt.supervisor?.usage || attempt.supervisor?.cost) {
      entries.push({ role: "supervisor", provider: attempt.supervisor.model.split(":")[0] || "deepseek", model: attempt.supervisor.model, usage: attempt.supervisor.usage, cost: attempt.supervisor.cost });
    }
  }
  return entries;
}

function buildNextPromptInstruction(basePrompt: string | undefined, decisions: Stage3BDecision[]) {
  const base = stripPreviousStage3BAdjustment(basePrompt || "");
  if (!base) return undefined;
  const pending = decisions.filter((decision) => !decision.accepted);
  if (!pending.length) return base;
  const notes = pending.slice(0, 30).map((decision) => [
    "- ITEM " + decision.itemKey + ": " + decision.status + "; confianza " + decision.confidence + "; accion sugerida " + decision.nextAction + ".",
    decision.comment ? "  Nota supervisor: " + decision.comment : ""
  ].filter(Boolean).join("\n")).join("\n");
  return [
    base,
    "",
    "## Ajuste para el siguiente intento 3-B",
    "",
    "Este ajuste viene del supervisor del intento anterior. Usalo para pedir un rescate mas preciso solo sobre los items pendientes que la app adjuntara debajo.",
    "",
    "En el siguiente intento no llenes por cumplir: busca mejor los items pendientes, corrige fuentes dudosas, evita URLs reconstruidas, y si encuentras precio real por encima del techo reportalo igual con nota clara.",
    "",
    "Senales del supervisor:",
    notes
  ].join("\n");
}

function stripPreviousStage3BAdjustment(prompt: string) {
  return String(prompt || "").replace(/\n## Ajuste para el siguiente intento 3-B[\s\S]*$/u, "").trim();
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? Math.trunc(value) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function bestConfidence(values: string[]): Stage3BDecision["confidence"] {
  if (values.includes("alta")) return "alta";
  if (values.includes("media")) return "media";
  if (values.includes("baja")) return "baja";
  return "sin_datos";
}

function sumUsage(values: Array<AiUsageSummary | undefined>): AiUsageSummary | undefined {
  const total = values.reduce<AiUsageSummary>((acc, value) => ({
    inputTokens: acc.inputTokens + (value?.inputTokens ?? 0),
    cachedInputTokens: acc.cachedInputTokens + (value?.cachedInputTokens ?? 0),
    outputTokens: acc.outputTokens + (value?.outputTokens ?? 0),
    thinkingTokens: acc.thinkingTokens + (value?.thinkingTokens ?? 0),
    totalTokens: acc.totalTokens + (value?.totalTokens ?? 0)
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 });
  return total.totalTokens > 0 ? total : undefined;
}

function buildAggregateCost(provider: "gemini" | "openai", model: string, entries: CostBreakdownEntry[], label: string): AiCostSummary | undefined {
  const totals = entries.reduce((acc, entry) => ({
    inputUsd: acc.inputUsd + (entry.cost?.inputUsd ?? 0),
    cachedInputUsd: acc.cachedInputUsd + (entry.cost?.cachedInputUsd ?? 0),
    outputUsd: acc.outputUsd + (entry.cost?.outputUsd ?? 0),
    searchUsd: acc.searchUsd + (entry.cost?.searchUsd ?? 0),
    totalUsd: acc.totalUsd + (entry.cost?.totalUsd ?? 0)
  }), { inputUsd: 0, cachedInputUsd: 0, outputUsd: 0, searchUsd: 0, totalUsd: 0 });
  if (totals.totalUsd <= 0) return undefined;
  return {
    provider,
    model,
    pricingLabel: label,
    pricingVerifiedAt: new Date().toISOString().slice(0, 10),
    pricingSourceUrl: "local:stage3b-step-cost-breakdown",
    inputUsd: roundUsd(totals.inputUsd),
    cachedInputUsd: roundUsd(totals.cachedInputUsd),
    outputUsd: roundUsd(totals.outputUsd),
    searchUsd: roundUsd(totals.searchUsd),
    totalUsd: roundUsd(totals.totalUsd),
    note: label
  };
}

function aggregateCosts(values: Array<AiCostSummary | undefined>, label: string): AiCostSummary | undefined {
  const costs = values.filter((value): value is AiCostSummary => Boolean(value));
  const first = costs[0];
  if (!first) return undefined;
  const totals = costs.reduce((acc, cost) => ({
    inputUsd: acc.inputUsd + cost.inputUsd,
    cachedInputUsd: acc.cachedInputUsd + cost.cachedInputUsd,
    outputUsd: acc.outputUsd + cost.outputUsd,
    searchUsd: acc.searchUsd + cost.searchUsd,
    totalUsd: acc.totalUsd + cost.totalUsd
  }), { inputUsd: 0, cachedInputUsd: 0, outputUsd: 0, searchUsd: 0, totalUsd: 0 });
  return {
    ...first,
    pricingLabel: label,
    pricingSourceUrl: "local:stage3b-supervisor-consensus",
    inputUsd: roundUsd(totals.inputUsd),
    cachedInputUsd: roundUsd(totals.cachedInputUsd),
    outputUsd: roundUsd(totals.outputUsd),
    searchUsd: roundUsd(totals.searchUsd),
    totalUsd: roundUsd(totals.totalUsd),
    note: label
  };
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
