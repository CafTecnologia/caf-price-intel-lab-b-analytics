import type {
  AgentItem,
  AgentRun,
  Confidence,
  Decision,
  HumanCorrection,
  HumanReview,
  ItemSnapshot,
  ProviderId,
  StageId
} from "./types";
import { registerCaseMemory } from "./case-memory";
import { effectiveConfidence, effectiveDecision } from "./commercial-policy";
import { getRun, saveRun } from "./store";
import { id, now } from "./utils";

const STAGES = new Set<StageId>(["source", "extraction", "technical", "market", "supervision"]);
const DECISIONS = new Set<Decision>(["accept", "accept_with_note", "retry", "human_review", "no_result"]);
const CONFIDENCES = new Set<Confidence>(["high", "medium", "low", "no_data"]);

export type HumanReviewInput = {
  itemId: string;
  verdict: "correct" | "incorrect" | "unclear";
  stage: StageId;
  comment: string;
  tags?: string[];
  rememberForSimilar?: boolean;
  action?: "record" | "apply" | "rerun" | "exclude";
  correction?: HumanCorrection;
  providerId?: ProviderId;
};

export async function recordHumanReview(runId: string, input: HumanReviewInput) {
  const run = await getRun(runId);
  if (!run) throw new Error("Proceso no encontrado.");
  const item = run.items.find((entry) => entry.id === String(input.itemId));
  if (!item) throw new Error("Item no encontrado.");
  const correction = normalizeCorrection(input.correction);
  const review: HumanReview = {
    id: id("review"),
    verdict: ["correct", "incorrect", "unclear"].includes(input.verdict) ? input.verdict : "unclear",
    stage: STAGES.has(input.stage) ? input.stage : "supervision",
    comment: String(input.comment || "").trim(),
    tags: unique(input.tags || []),
    rememberForSimilar: Boolean(input.rememberForSimilar),
    action: ["record", "apply", "rerun", "exclude"].includes(input.action || "") ? input.action! : "record",
    correction: Object.keys(correction).length ? correction : undefined,
    snapshotBefore: snapshot(item),
    createdAt: now()
  };
  item.reviews ||= [];
  item.reviews.push(review);

  if (review.action === "exclude") {
    review.resolvedAt = now();
    item.status = "excluded";
    item.humanDecision = {
      reviewId: review.id,
      decision: "no_result",
      confidence: "no_data",
      reason: review.comment || "La persona confirmo que esta fila no corresponde a un item cotizable.",
      updatedAt: now()
    };
  } else if (review.action === "apply") {
    applyHumanCorrection(item, review);
    review.resolvedAt = now();
  } else if (review.verdict !== "correct") {
    item.humanDecision = {
      reviewId: review.id,
      decision: review.verdict === "incorrect" ? "retry" : "human_review",
      confidence: review.verdict === "incorrect" ? "low" : "medium",
      reason: review.comment || "El resultado requiere criterio humano.",
      updatedAt: now()
    };
    item.status = review.verdict === "incorrect" ? "pending" : "escalated";
  }

  const memory = await registerCaseMemory(run, item, review);
  if (memory) review.memoryId = memory.id;
  run.events.push({
    id: id("event"),
    at: review.createdAt,
    kind: "human",
    stage: review.stage,
    title: `Revision humana: ${review.verdict}`,
    detail: review.comment || "Sin comentario.",
    itemId: item.id
  });
  if (review.action === "exclude") {
    run.events.push({
      id: id("event"),
      at: review.createdAt,
      kind: "human",
      stage: "source",
      title: "Fila excluida del inventario activo",
      detail: `El registro ${item.id} se conserva en la traza, pero ya no cuenta como item ni se enviara a los agentes.`,
      itemId: item.id
    });
    refreshMetricsAfterReview(run);
  }
  await saveRun(run);
  return { run, item, review, memory };
}

export function applyHumanCorrection(item: AgentItem, review: HumanReview) {
  const correction = review.correction || {};
  if (item.normalized) {
    if (correction.name !== undefined) item.normalized.name = correction.name;
    if (correction.description !== undefined) item.normalized.description = correction.description;
    if (correction.unit !== undefined) item.normalized.unit = correction.unit;
    if (correction.quantity !== undefined) item.normalized.quantity = correction.quantity;
    if (correction.ceilingPriceCop !== undefined) item.normalized.ceilingPriceCop = correction.ceilingPriceCop;
  }
  if (item.market) {
    if (correction.supplier !== undefined) item.market.supplier = correction.supplier;
    if (correction.product !== undefined) item.market.product = correction.product;
    if (correction.price !== undefined) item.market.price = correction.price;
    if (correction.currency !== undefined) item.market.currency = correction.currency;
    if (correction.url !== undefined) item.market.url = correction.url;
    if (correction.notes !== undefined) item.market.notes = correction.notes;
    if (correction.confidence !== undefined) item.market.confidence = correction.confidence;
    if (correction.decision !== undefined) item.market.decision = correction.decision;
  }
  const decision = correction.decision || decisionFromReview(item, review);
  const confidence = correction.confidence || confidenceFromReview(item, review);
  item.humanDecision = {
    reviewId: review.id,
    decision,
    confidence,
    reason: review.comment || "Resultado ajustado por una persona.",
    updatedAt: now()
  };
  item.status = ["accept", "accept_with_note"].includes(decision)
    ? "priced"
    : decision === "human_review"
      ? "escalated"
      : "pending";
}

export function clearFromStage(item: AgentItem, stage: StageId) {
  if (item.status === "excluded") return;
  if (["source", "extraction"].includes(stage)) item.normalized = undefined;
  if (["source", "extraction", "technical"].includes(stage)) item.technical = undefined;
  if (["source", "extraction", "technical", "market"].includes(stage)) item.market = undefined;
  item.supervision = undefined;
  item.supervisedAt = undefined;
  item.humanDecision = undefined;
  item.status = item.market ? "priced" : item.technical ? "interpreted" : item.normalized ? "normalized" : "imported";
}

function refreshMetricsAfterReview(run: AgentRun) {
  const activeItems = run.items.filter((item) => item.status !== "excluded");
  run.inventory.detectedRows = activeItems.length;
  run.metrics.totalItems = activeItems.length;
  run.metrics.normalized = activeItems.filter((item) => item.normalized).length;
  run.metrics.interpreted = activeItems.filter((item) => item.technical).length;
  run.metrics.priced = activeItems.filter((item) => item.market?.supplier && item.market.price !== null).length;
  run.metrics.accepted = activeItems.filter((item) => ["accept", "accept_with_note"].includes(effectiveDecision(item))).length;
  run.metrics.pending = activeItems.length - run.metrics.accepted;
  run.metrics.warnings = run.events.filter((entry) => ["warning", "error"].includes(entry.kind)).length;
}

export function snapshot(item: AgentItem): ItemSnapshot {
  return structuredClone({
    normalized: item.normalized,
    technical: item.technical,
    market: item.market,
    supervision: item.supervision,
    status: item.status
  });
}

function decisionFromReview(item: AgentItem, review: HumanReview): Decision {
  if (review.verdict === "correct") return effectiveDecision(item);
  if (review.verdict === "unclear") return "human_review";
  return item.market?.supplier && item.market.price !== null ? "retry" : "no_result";
}

function confidenceFromReview(item: AgentItem, review: HumanReview): Confidence {
  if (review.verdict === "correct") return effectiveConfidence(item);
  if (review.verdict === "unclear") return "medium";
  return item.market?.supplier && item.market.price !== null ? "low" : "no_data";
}

function normalizeCorrection(value?: HumanCorrection) {
  if (!value || typeof value !== "object") return {} as HumanCorrection;
  const result: HumanCorrection = {};
  for (const field of ["name", "description", "unit", "supplier", "product", "currency", "url", "notes"] as const) {
    if (value[field] !== undefined) result[field] = String(value[field]).trim();
  }
  for (const field of ["quantity", "ceilingPriceCop", "price"] as const) {
    if (value[field] === null) result[field] = null;
    else if (value[field] !== undefined && Number.isFinite(Number(value[field]))) result[field] = Number(value[field]);
  }
  if (value.confidence && CONFIDENCES.has(value.confidence)) result.confidence = value.confidence;
  if (value.decision && DECISIONS.has(value.decision)) result.decision = value.decision;
  return result;
}

function unique(values: string[]) {
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}
