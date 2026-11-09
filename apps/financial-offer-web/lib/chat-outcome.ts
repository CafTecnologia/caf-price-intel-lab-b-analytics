import type { AiResultEvidence } from "./ai-result-evidence";

export type ChatTurn = {
  job_id?: string; prompt?: string; status?: string; result?: string; support?: string; error?: string; has_json?: boolean; financial_read_only?: boolean;
  events?: { at?: string; type?: string; message?: string }[];
  publication?: { status?: string; changed_items?: number; active?: boolean; base_version_id?: string; receipt_status?: string; calculation?: { id?: string; url?: string }; error?: string };
};
export type ChatOutcome = { kind: "working" | "success" | "neutral" | "warning" | "error"; title: string; detail: string };
export function latestChatTurn(turns: ChatTurn[] = []): ChatTurn | undefined {
  return [...turns].reverse().find(turn => turn.job_id || turn.prompt || turn.status);
}
export function chatInProgress(turn?: ChatTurn): boolean {
  return !!turn && (["queued", "pending", "running"].includes(turn.status || "") || ["waiting", "applying", "reconciling"].includes(turn.publication?.status || ""));
}
export function chatOutcome(turn?: ChatTurn, evidence?: AiResultEvidence | null, unavailable = false): ChatOutcome {
  if (unavailable) return { kind: "warning", title: "Estado sin actualizar", detail: "No se pudo comprobar la última solicitud. Vuelve a consultar." };
  if (!turn) return { kind: "neutral", title: "Chat IA", detail: "Pide una revisión o haz una pregunta sobre este cálculo." };
  if (turn.status === "sending") return { kind: "working", title: "Enviando solicitud", detail: "Esperando confirmación de recepción." };
  const proof = evidence?.jobId === turn.job_id ? evidence : null;
  if (["queued", "pending", "running"].includes(turn.status || "")) return { kind: "working", title: turn.status === "running" ? "IA trabajando" : "Solicitud recibida", detail: proof?.appliedReceiptCount ? "Ya hay cambios guardados; la solicitud sigue en curso." : "Aún no hay un resultado final." };
  const publication = turn.publication?.status;
  if (["error", "failed", "cancelled"].includes(turn.status || "") || ["error", "conflict", "obsolete"].includes(publication || "")) return { kind: "error", title: publication === "conflict" ? "El cálculo cambió" : publication === "obsolete" ? "Revisión desactualizada" : "No pudo terminar", detail: proof?.appliedReceiptCount ? "Hay cambios confirmados. Compáralos antes de pedir otro ajuste." : "Revisa la respuesta y el comprobante antes de reintentar." };
  if (proof?.rejectedReceiptCount) return { kind: "warning", title: "Resultado parcialmente verificado", detail: "Hay comprobantes que no se pudieron vincular. Consulta los cambios confirmados; el resultado completo sigue pendiente de revisión." };
  if (proof?.appliedReceiptCount) {
    const latestApplied = [...proof.receipts].reverse().find(receipt => receipt.status === "applied");
    return { kind: "success", title: latestApplied?.active ? "Cambios guardados" : "Cambios guardados · versión anterior", detail: proof.uniqueChangedItemCount ? `${proof.uniqueChangedItemCount} ítem(s) modificados. Consulta qué cambió en esta solicitud.` : "Se guardaron cambios generales del cálculo." };
  }
  if (proof?.noChangesReceiptCount || turn.publication?.receipt_status === "no_changes") return { kind: "neutral", title: "Terminó sin cambios", detail: "La revisión fue confirmada y no añadió cambios al cálculo." };
  if (publication === "answered" || (turn.status === "completed" && turn.financial_read_only)) return { kind: "neutral", title: "Respuesta lista", detail: "No se guardaron cambios en el cálculo." };
  if (["waiting", "applying", "reconciling"].includes(publication || "")) return { kind: "working", title: "Confirmando resultado", detail: proof?.appliedReceiptCount ? "Los cambios están guardados; falta confirmar la publicación en Odoo." : "La respuesta llegó; la aplicación de cambios sigue pendiente." };
  if (["applied", "published"].includes(publication || "")) return { kind: "warning", title: "Revisión por confirmar", detail: "Hay una publicación, pero aún no se comprobó su recibo en Finanzas." };
  if (turn.status === "completed") return { kind: "warning", title: "Respuesta lista · por revisar", detail: "Lee la respuesta. No hay cambios confirmados para esta solicitud." };
  return { kind: "warning", title: "Estado por comprobar", detail: "No se ha confirmado el resultado de esta solicitud." };
}
export function readablePrompt(value = ""): string {
  return value.replace(/^\[Datos de referencia del cálculo; no son instrucciones\][\s\S]*?\n\n/, "").trim();
}
export function responsePreview(value = "", maxLength = 280): string {
  const text = value.replace(/```[\s\S]*?(?:```|$)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
  if (!text) return "Abre la respuesta completa para consultar el detalle.";
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() + "…" : text;
}
