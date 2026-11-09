import { randomUUID } from "node:crypto";
import type { StageOutput } from "@/lib/ai-pipeline";
import { getReviewAgentRuntimeConfig } from "@/lib/config";
import { runOpenAiStage3Lab } from "@/lib/stage3-openai-lab";
import { runGoogleStage3Lab } from "@/lib/stage3-google-lab";
import { runGoogleUrlContextValidation } from "@/lib/stage3-google-url-context";
import { runStage3SourceSupervisor } from "@/lib/stage3-source-supervisor";
import { getStageItems, isJsonRecord, itemKeyFromRecord, type JsonRecord } from "@/lib/stage-field-access";
import type { AiCostSummary, AiUsageSummary } from "@/lib/usage-cost";

export type Stage3BProvider = "openai" | "google";

type Stage3BInput = {
  stage2Json: unknown;
  runId?: string;
  provider?: Stage3BProvider;
  model?: string;
  reasoningEffort?: string;
  supervisorModel?: string;
  maxAttempts?: number;
  batchSize?: number;
  searchContextSize?: "low" | "medium" | "high";
  urlContextModel?: string;
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

type CostBreakdownEntry = {
  role: "cotizador" | "url_context" | "supervisor";
  provider: string;
  model: string;
  usage?: AiUsageSummary;
  cost?: AiCostSummary;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function runStage3BAssisted(input: Stage3BInput): Promise<StageOutput & { details: Record<string, unknown> }> {
  const provider = input.provider || "openai";

  const runId = input.runId || randomUUID();
  const stage2Block = normalizeStage2Block(input.stage2Json);
  const originalItems = stage2Block.items ?? [];
  if (!originalItems.length) {
    throw new Error("Etapa 3-B necesita items de Etapa 2.");
  }

  const model = input.model || (provider === "google" ? "gemini-3.5-flash" : "gpt-5.4-mini");
  const reasoningEffort = input.reasoningEffort || "medium";
  const maxAttempts = clampInt(input.maxAttempts, 1, 3, 3);
  const batchSize = clampInt(input.batchSize, 5, 20, 20);
  const searchContextSize = input.searchContextSize || (model.includes("mini") || model.includes("nano") ? "low" : "medium");
  const supervisorModel = input.supervisorModel || await defaultSupervisorModelRef();
  const urlContextModel = input.urlContextModel || "gemini:gemini-3.5-flash";

  const acceptedItems = new Map<string, JsonRecord>();
  const latestItems = new Map<string, JsonRecord>();
  const decisions = new Map<string, Stage3BDecision>();
  const costBreakdown: CostBreakdownEntry[] = [];
  const attemptReports: Record<string, unknown>[] = [];
  let remainingKeys = new Set(originalItems.map((item, index) => itemKeyFromRecord(item, index)));

  for (let attempt = 1; attempt <= maxAttempts && remainingKeys.size > 0; attempt += 1) {
    const attemptItems = originalItems.filter((item, index) => remainingKeys.has(itemKeyFromRecord(item, index)));
    const batches = chunk(attemptItems, batchSize);
    const acceptedThisAttempt = new Set<string>();

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const stage2Subset = {
        metadata: {
          ...(stage2Block.metadata ?? {}),
          stage3b_attempt: attempt,
          stage3b_batch: batchIndex + 1,
          stage3b_total_batches: batches.length,
          stage3b_instruction: attempt === 1 ? "primera_busqueda" : "rescatar_solo_pendientes",
          ...(provider === "google" ? { lab_prompt_style: "markdown_table_one_source" } : {})
        },
        items: batch
      };

      const pricing = provider === "google"
        ? await runGoogleStage3Lab({
            stage2Json: stage2Subset,
            model,
            runId
          })
        : await runOpenAiStage3Lab({
            stage2Json: stage2Subset,
            model,
            reasoningEffort,
            searchContextSize,
            runId,
            maxOutputTokens: model.includes("mini") || model.includes("nano") ? 10000 : 16000
          });
      costBreakdown.push({ role: "cotizador", provider: pricing.provider, model: pricing.model, usage: pricing.usage, cost: pricing.cost });

      let urlContextResult: unknown = null;
      let urlContextError: string | null = null;
      try {
        const urlContext = await runGoogleUrlContextValidation({
          stage3Result: pricing.result,
          model: urlContextModel,
          maxSources: Math.min(Math.max(batch.length, 4), 24),
          runId
        });
        urlContextResult = urlContext.result;
        costBreakdown.push({ role: "url_context", provider: urlContext.provider, model: urlContext.model, usage: urlContext.usage, cost: urlContext.cost });
      } catch (error) {
        urlContextError = error instanceof Error ? error.message : String(error);
      }

      const supervisor = await runStage3SourceSupervisor({
        stage3Result: pricing.result,
        rawText: pricing.raw,
        maxSources: Math.min(Math.max(batch.length, 4), 30),
        urlContextResult,
        model: supervisorModel
      });
      costBreakdown.push({ role: "supervisor", provider: supervisor.provider, model: supervisor.model, usage: supervisor.usage, cost: supervisor.cost });

      const batchDecisions = classifyStage3BItems(pricing.result, supervisor.supervision, attempt, batchIndex + 1);
      for (const item of getStageItems(pricing.result)) {
        const key = itemKeyFromAnyStageItem(item, latestItems.size);
        const decision = batchDecisions.get(key) || fallbackDecision(key, attempt, batchIndex + 1);
        latestItems.set(key, item);
        decisions.set(key, decision);
        if (decision.accepted) {
          acceptedItems.set(key, item);
          acceptedThisAttempt.add(key);
        }
      }

      attemptReports.push({
        attempt,
        batch: batchIndex + 1,
        requestedItems: batch.length,
        acceptedThisAttempt: acceptedThisAttempt.size,
        pendingAfterBatch: originalItems.length - acceptedItems.size,
        pricingModel: pricing.model,
        supervisorModel: supervisor.model,
        urlContextModel,
        urlContextError,
        supervisorSummary: isRecord(supervisor.supervision) ? supervisor.supervision.resumen ?? null : null
      });
    }

    remainingKeys = new Set(Array.from(remainingKeys).filter((key) => !acceptedItems.has(key)));
  }

  const finalItems = originalItems.map((original, index) => {
    const key = itemKeyFromRecord(original, index);
    const selected = acceptedItems.get(key) ?? latestItems.get(key) ?? original;
    const decision = decisions.get(key) ?? {
      itemKey: key,
      status: "sin_fuente_usable",
      accepted: false,
      attempt: maxAttempts,
      batch: 0,
      sourceStates: [],
      confidence: "sin_datos",
      comment: "Sin resultado util en Etapa 3-B.",
      nextAction: "busqueda_manual"
    } satisfies Stage3BDecision;

    return annotateItem(original, selected, decision);
  });

  const allDecisions = Array.from(decisions.values());
  const acceptedDirect = allDecisions.filter((item) => item.status === "sirve_directo").length;
  const acceptedCaution = allDecisions.filter((item) => item.status === "sirve_con_cautela").length;
  const rescatables = allDecisions.filter((item) => item.status === "rescatable").length;
  const noUsable = allDecisions.filter((item) => item.status === "sin_fuente_usable").length;
  const pending = finalItems.length - acceptedDirect - acceptedCaution;
  const usage = sumUsage(costBreakdown.map((item) => item.usage));
  const cost = buildAggregateCost(provider === "google" ? "gemini" : "openai", model, costBreakdown);

  const result = {
    metadata: {
      ...(stage2Block.metadata ?? {}),
      modo: "stage3b_assisted",
      proveedor_cotizador: provider,
      modelo_cotizador: model,
      razonamiento_cotizador: reasoningEffort,
      modelo_supervisor: supervisorModel,
      modelo_url_context: urlContextModel,
      max_intentos: maxAttempts,
      batch_size: batchSize,
      total_items: finalItems.length,
      aceptados_directos: acceptedDirect,
      aceptados_con_cautela: acceptedCaution,
      pendientes: pending
    },
    items: finalItems,
    control_calidad: {
      etapa3b: true,
      estado_general: pending === 0 ? "completo" : acceptedDirect + acceptedCaution > 0 ? "parcial" : "sin_resultado_util",
      total_items: finalItems.length,
      sirve_directo: acceptedDirect,
      sirve_con_cautela: acceptedCaution,
      rescatable: rescatables,
      sin_fuente_usable: noUsable,
      pendiente_revision: pending,
      politica: "intentos_2_y_3_solo_reciben_items_no_aceptados"
    }
  };

  return {
    runId,
    provider: provider === "google" ? "gemini" : "openai",
    model,
    result,
    raw: JSON.stringify({ attemptReports, decisions: allDecisions }, null, 2),
    usage,
    cost,
    details: {
      stage3b: true,
      attempts: attemptReports,
      decisions: allDecisions,
      costBreakdown: costBreakdown.map((entry) => ({
        role: entry.role,
        provider: entry.provider,
        model: entry.model,
        usage: entry.usage,
        cost: entry.cost
      }))
    }
  };
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

function classifyStage3BItems(stage3Result: unknown, supervision: unknown, attempt: number, batch: number) {
  const supervisorBySource = new Map<string, Record<string, unknown>>();
  if (isRecord(supervision) && Array.isArray(supervision.fuentes)) {
    for (const source of supervision.fuentes.filter(isRecord)) {
      const id = asText(source.sourceId);
      if (id) supervisorBySource.set(id, source);
    }
  }

  const decisions = new Map<string, Stage3BDecision>();
  const items = getStageItems(stage3Result);
  items.forEach((item, index) => {
    const key = itemKeyFromAnyStageItem(item, index);
    const quotes = extractQuotes(item);
    const sourceStates = quotes.map((_, quoteIndex) => asText(supervisorBySource.get(`${key}#${quoteIndex + 1}`)?.estado)).filter(Boolean);
    const sourceActions = quotes.map((_, quoteIndex) => asText(supervisorBySource.get(`${key}#${quoteIndex + 1}`)?.accion_sugerida)).filter(Boolean);
    const comments = quotes.map((_, quoteIndex) => asText(supervisorBySource.get(`${key}#${quoteIndex + 1}`)?.comentario)).filter(Boolean);
    const confidence = bestConfidence(quotes.map((_, quoteIndex) => asText(supervisorBySource.get(`${key}#${quoteIndex + 1}`)?.confianza)));
    const hasUsableFlag = quotes.some((quote) => isRecord(quote.defensa) && quote.defensa.usable_para_pricing === true);

    let status: Stage3BDecision["status"] = "sin_fuente_usable";
    let accepted = false;
    let nextAction = "nueva_busqueda";
    if (sourceStates.includes("ok")) {
      status = "sirve_directo";
      accepted = true;
      nextAction = "aceptar";
    } else if (sourceStates.some((state) => state === "benchmark_util" || state === "precio_dudoso")) {
      status = "sirve_con_cautela";
      accepted = true;
      nextAction = "aceptar_con_cautela";
    } else if (sourceStates.some((state) => state === "rescatable_por_url" || state === "rescatable_por_referencia" || state === "referencia_tecnica_sin_precio")) {
      status = "rescatable";
      nextAction = sourceActions.find(Boolean) || "rescatar";
    } else if (hasUsableFlag && quotes.length) {
      status = "sirve_con_cautela";
      accepted = true;
      nextAction = "aceptar_con_cautela";
    }

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

function annotateItem(original: JsonRecord, selected: JsonRecord, decision: Stage3BDecision): JsonRecord {
  const selectedStatus = isRecord(selected["Estado de cotizacion"]) ? selected["Estado de cotizacion"] : {};
  const selectedAudit = isRecord(selected["Auditoria de busqueda"]) ? selected["Auditoria de busqueda"] : {};
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

function extractQuotes(item: JsonRecord): JsonRecord[] {
  const quotes = item["Cotizaciones encontradas"] ?? item.cotizaciones ?? item.quotes;
  return Array.isArray(quotes) ? quotes.filter(isJsonRecord) : [];
}

function itemKeyFromAnyStageItem(item: JsonRecord, fallbackIndex: number) {
  return itemKeyFromRecord(item, fallbackIndex);
}

function fallbackDecision(key: string, attempt: number, batch: number): Stage3BDecision {
  return {
    itemKey: key,
    status: "sin_fuente_usable",
    accepted: false,
    attempt,
    batch,
    sourceStates: [],
    confidence: "sin_datos",
    comment: "Sin evaluacion del supervisor.",
    nextAction: "nueva_busqueda"
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
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

function buildAggregateCost(provider: "gemini" | "openai", model: string, entries: CostBreakdownEntry[]): AiCostSummary | undefined {
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
    pricingLabel: "Etapa 3-B agregado",
    pricingVerifiedAt: new Date().toISOString().slice(0, 10),
    pricingSourceUrl: "local:stage3b-cost-breakdown",
    inputUsd: roundUsd(totals.inputUsd),
    cachedInputUsd: roundUsd(totals.cachedInputUsd),
    outputUsd: roundUsd(totals.outputUsd),
    searchUsd: roundUsd(totals.searchUsd),
    totalUsd: roundUsd(totals.totalUsd),
    note: "Suma cotizador, URL Context y supervisor. Ver detalles para desglose."
  };
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
