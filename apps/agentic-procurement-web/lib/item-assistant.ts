import type {
  AgentItem,
  AgentRun,
  HumanCorrection,
  ItemAssistantExchange,
  ProviderId,
  StageId
} from "./types";
import { getRun, saveRun } from "./store";
import { runProviderTask } from "./providers";
import { id, now, safeJsonFromText } from "./utils";

type AssistantRecord = {
  reply?: unknown;
  diagnosis?: unknown;
  suggestedAction?: unknown;
  suggestedStage?: unknown;
  instruction?: unknown;
  proposedCorrection?: unknown;
  tags?: unknown;
};

const ACTIONS = new Set<ItemAssistantExchange["suggestedAction"]>([
  "accept", "apply", "rerun", "exclude", "human_review"
]);
const STAGES = new Set<StageId>(["source", "extraction", "technical", "market", "supervision"]);

export async function consultItemAssistant(
  runId: string,
  itemId: string,
  question: string,
  providerId: ProviderId,
  taskRunner: typeof runProviderTask = runProviderTask
) {
  const run = await getRun(runId);
  if (!run) throw new Error("Proceso no encontrado.");
  const item = run.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Item no encontrado.");
  const cleanQuestion = question.trim();
  if (!cleanQuestion) throw new Error("Describe la falla o la duda que quieres resolver.");

  const jobId = id("item-assistant");
  const response = await taskRunner(providerId, {
    jobId,
    stage: "supervision",
    prompt: itemAssistantPrompt(run, item, cleanQuestion),
    mockResponse: mockAssistantResponse(item, cleanQuestion)
  });
  const parsed = safeJsonFromText(response.rawResponse) as AssistantRecord;
  const exchange = normalizeExchange(parsed, providerId, cleanQuestion);
  item.assistantExchanges ||= [];
  item.assistantExchanges.push(exchange);
  run.events.push({
    id: id("event"),
    at: exchange.createdAt,
    kind: "agent",
    stage: exchange.suggestedStage,
    title: "Asistente focalizado propuso una accion",
    detail: `${item.id}: ${exchange.diagnosis}`,
    itemId: item.id
  });
  await saveRun(run);
  return { run, item, exchange };
}

function itemAssistantPrompt(run: AgentRun, item: AgentItem, question: string) {
  return `Eres un asistente de correccion de compras publicas. Trabajas SOLO sobre el item recibido.
Tu tarea es responder a la observacion humana, diagnosticar el punto concreto y proponer la accion minima para resolverlo.

PRINCIPIOS:
- El objetivo comercial es obtener un precio de referencia razonable, no certificar una compra definitiva.
- No descartes un benchmark por una diferencia tecnica menor que no cambie materialmente el tipo, capacidad, presentacion o rango de precio.
- Se estricto con marca, modelo, norma, compatibilidad, unidad, componentes y servicios cuando si cambien el precio o la viabilidad.
- No inventes hechos, precios, URLs, cantidades ni presentaciones.
- No modifiques nada. Solo explica y propone. La persona decidira si aplica o reprocesa.
- Usa accept si el resultado ya es suficiente.
- Usa apply solo cuando proposedCorrection contiene datos concretos sustentados que pueden aplicarse sin nueva busqueda.
- Usa rerun cuando haga falta repetir una etapa con una instruccion mejor.
- Usa exclude solo cuando la fila claramente no sea un item cotizable.
- Usa human_review cuando falta una decision o dato que ni una nueva busqueda puede resolver con fiabilidad.
- suggestedStage indica desde donde debe repetirse: source, extraction, technical, market o supervision.
- instruction debe ser autosuficiente y precisa para el agente que ejecutara la correccion.

CONTRATO JSON:
{"reply":"respuesta breve al usuario","diagnosis":"causa concreta","suggestedAction":"accept|apply|rerun|exclude|human_review","suggestedStage":"source|extraction|technical|market|supervision","instruction":"instruccion concreta para resolver","proposedCorrection":{"supplier":"...","product":"...","price":123,"currency":"COP","url":"...","notes":"..."},"tags":["..."]}

CONTEXTO:
${JSON.stringify({
    run: { id: run.id, name: run.name },
    item: {
      id: item.id,
      original: item.original,
      normalized: item.normalized,
      technical: item.technical,
      market: item.market,
      supervision: item.supervision,
      humanDecision: item.humanDecision,
      recentReviews: item.reviews.slice(-4),
      precedents: item.learningContext || []
    },
    humanQuestion: question
  }, null, 2)}`;
}

function normalizeExchange(
  record: AssistantRecord,
  providerId: ProviderId,
  question: string
): ItemAssistantExchange {
  const suggestedAction = stringValue(record.suggestedAction) as ItemAssistantExchange["suggestedAction"];
  const suggestedStage = stringValue(record.suggestedStage) as StageId;
  const correction = correctionValue(record.proposedCorrection);
  return {
    id: id("assistant"),
    createdAt: now(),
    providerId,
    question,
    reply: stringValue(record.reply) || "Analicé el punto indicado y preparé una recomendación.",
    diagnosis: stringValue(record.diagnosis) || "No fue posible aislar una causa más específica.",
    suggestedAction: ACTIONS.has(suggestedAction) ? suggestedAction : "human_review",
    suggestedStage: STAGES.has(suggestedStage) ? suggestedStage : "supervision",
    instruction: stringValue(record.instruction) || question,
    ...(Object.keys(correction).length ? { proposedCorrection: correction } : {}),
    tags: stringArray(record.tags)
  };
}

function correctionValue(value: unknown): HumanCorrection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: HumanCorrection = {};
  for (const field of ["name", "description", "unit", "supplier", "product", "currency", "url", "notes"] as const) {
    if (source[field] !== undefined) result[field] = stringValue(source[field]);
  }
  for (const field of ["quantity", "ceilingPriceCop", "price"] as const) {
    if (source[field] === null) result[field] = null;
    else if (source[field] !== undefined && Number.isFinite(Number(source[field]))) result[field] = Number(source[field]);
  }
  return result;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(stringValue).filter(Boolean))].slice(0, 8);
}

function mockAssistantResponse(item: AgentItem, question: string) {
  const hasCandidate = Boolean(item.market?.supplier && item.market?.price !== null);
  return {
    reply: hasCandidate
      ? "La observacion puede resolverse revisando la evidencia del candidato sin afectar los demas items."
      : "El item necesita una nueva busqueda focalizada porque no tiene una referencia comercial util.",
    diagnosis: hasCandidate ? "La duda se concentra en la sustentacion del candidato actual." : "No existe candidato comercial para contrastar.",
    suggestedAction: "rerun",
    suggestedStage: hasCandidate ? "supervision" : "market",
    instruction: question,
    proposedCorrection: {},
    tags: ["Correccion focalizada"]
  };
}
