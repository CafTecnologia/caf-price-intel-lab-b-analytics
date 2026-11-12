import type { AiResultEvidence } from "./ai-result-evidence";
import { chatInProgress, type ChatTurn } from "./chat-outcome";
import { visibleStudyEvents } from "./study-events";

export const AI_SAVED_EVENT = "caf:financial-ai-saved";
export type SavedAiActivity = { projectId: string; operationIds: string[]; itemIds: string[]; baseVersionIds: string[] };

// Only validated receipts for this calculation and request may announce a save.
export function savedAiActivity(projectId: string, turn: ChatTurn | undefined, evidence: AiResultEvidence | null, seen: ReadonlySet<string>): SavedAiActivity | null {
  if (!turn?.job_id || evidence?.jobId !== turn.job_id || evidence.calculationId !== projectId) return null;
  const receipts = evidence.receipts.filter(receipt => receipt.status === "applied" && receipt.active && !receipt.historical && !seen.has(receipt.operationId));
  if (!receipts.length) return null;
  return { projectId, operationIds: receipts.map(receipt => receipt.operationId), itemIds: [...new Set(receipts.flatMap(receipt => receipt.changedItemIds))], baseVersionIds: [...new Set(receipts.map(receipt => receipt.baseVersionId))] };
}

export function activityStep(turn?: ChatTurn): string {
  if (!turn || !chatInProgress(turn)) return "";
  if (["waiting", "applying", "reconciling"].includes(turn.publication?.status || "")) return "Esperando confirmación del resultado";
  const events = visibleStudyEvents(turn.events);
  return events.at(-1)?.message || (turn.status === "queued" || turn.status === "pending" ? "Esperando turno para comenzar" : "Esperando la siguiente señal de la IA");
}

export function responseSignature(turn?: ChatTurn): string {
  // Process events are not new answers. A saved result and a final answer are separate signals.
  return turn ? JSON.stringify([turn.job_id, turn.status, turn.publication?.status, turn.result]) : "";
}
