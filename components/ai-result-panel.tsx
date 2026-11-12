"use client";
import React from "react";
import type { AiResultEvidence } from "../lib/ai-result-evidence";
import { chatOutcome, readablePrompt, type ChatTurn } from "../lib/chat-outcome";
import { visibleStudyEvents } from "../lib/study-events";
import styles from "./calculation-collaboration.module.css";

export function AiResultCard({ turn, evidence, unavailable, pendingCount, onCompare, onResponse, onSupport, onLedger, onRefresh }: {
  turn?: ChatTurn; evidence?: AiResultEvidence | null; unavailable: boolean; pendingCount: number;
  onCompare: () => void; onResponse: () => void; onSupport?: () => void; onLedger: () => void; onRefresh: () => void;
}) {
  const outcome = chatOutcome(turn, evidence, unavailable);
  const proof = evidence?.jobId === turn?.job_id ? evidence : null;
  return <section className={styles.outcome} data-tone={outcome.kind} aria-label="Resultado de la última solicitud">
    <div role="status" aria-live="polite"><strong>{outcome.title}</strong><p>{outcome.detail}</p></div>
    {pendingCount > 0 ? <p className={styles.pending}>Costos pendientes en este cálculo: {pendingCount}.</p> : null}
    <div className={styles.resultActions}>
      {turn?.result ? <button id="financial-view-response" type="button" onClick={onResponse}>Ver respuesta</button> : null}
      {(turn?.support?.trim() || proof?.receiptCount) && onSupport ? <button type="button" onClick={onSupport}>Ver soporte</button> : null}
      {proof?.receiptCount ? <button type="button" onClick={onCompare}>Comparar cambios ({proof.receiptCount})</button> : null}
      <button type="button" onClick={onLedger}>Bitácora</button>
      {unavailable ? <button type="button" onClick={onRefresh}>Volver a consultar</button> : null}
    </div>
  </section>;
}
const labels: Record<string, string> = { label: "Proveedor", name: "Nombre", description: "Descripción", unit_price: "Precio unitario", unitPrice: "Precio unitario", currency: "Moneda", url: "Fuente", notes: "Notas", quantity: "Cantidad", unit: "Unidad", amount: "Valor", category: "Tipo", review_status: "Revisión", reviewStatus: "Revisión", technical_description: "Ficha técnica", technicalDescription: "Ficha técnica", trm: "TRM", import_pct: "Importación", id: "Referencia", item: "Ítem", key: "Referencia", text: "Texto", document: "Documento", locator: "Ubicación", selectedCostMode: "Criterio de costo" };
function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Sin dato";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" && ({suggested: "Por revisar", included: "Incluido", excluded: "Excluido", pending: "Pendiente", product: "Producto", service: "Servicio", comparable_scenario: "Escenario comparable", partial: "Parcial", conforming: "Conforme"} as Record<string, string>)[value]) return ({suggested: "Por revisar", included: "Incluido", excluded: "Excluido", pending: "Pendiente", product: "Producto", service: "Servicio", comparable_scenario: "Escenario comparable", partial: "Parcial", conforming: "Conforme"} as Record<string, string>)[value]!;
  if (typeof value === "number") return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 8 }).format(value);
  if (Array.isArray(value)) return value.length ? value.map(readableValue).join("\n\n") : "Sin registros";
  if (typeof value === "object") return Object.entries(value).filter(([key]) => key !== "id").map(([key, entry]) => `${labels[key] || key}: ${readableValue(entry)}`).join("\n");
  return String(value);
}
function ComparisonValue({ value }: { value: unknown }) {
  const text = readableValue(value);
  return text.length > 360 ? <details><summary>{text.slice(0, 180)}… Ver completo</summary><p>{text}</p></details> : <p>{text}</p>;
}
export function AiChangeComparison({ evidence, onClose }: { evidence: AiResultEvidence; onClose: () => void }) {
  return <section className={styles.comparison} aria-label="Comparación de cambios de IA">
    <div className={styles.comparisonHeading}><h3>Cambios de esta solicitud</h3><button type="button" onClick={onClose}>Volver al chat</button></div>
    <p>Antes y después al aplicar cada operación. Consultar esta comparación no cambia la base ni la oferta.</p>
    {evidence.rejectedReceiptCount ? <p className={styles.notice}>Hay {evidence.rejectedReceiptCount} comprobante(s) sin verificar. Esta vista muestra sólo los cambios confirmados.</p> : null}
    {evidence.receipts.map(receipt => <article key={receipt.operationId}>
      <h4>{receipt.status === "no_changes" ? "Operación sin cambios" : receipt.changedItemCount ? `${receipt.changedItemCount} ítem(s) modificados` : "Cambios generales del cálculo"}</h4>
      <p>{receipt.active ? "La base coincide con la vigente." : "Base histórica: el cálculo actual puede ser distinto."}</p>
      {receipt.comparison.diffs.length ? <div className={styles.comparisonRows}>{receipt.comparison.diffs.map((change, index) => <section className={styles.changeRow} key={`${receipt.operationId}-${index}`}>
        <h5>{change.item && !["manual_reference_total", "general_cost"].includes(change.field) ? `Ítem ${change.item} · ` : ""}{change.fieldLabel}</h5>
        <div className={styles.changeValues}><div><b>Antes</b><ComparisonValue value={change.before} /></div><div><b>Después</b><ComparisonValue value={change.after} /></div></div>
      </section>)}</div> : <p>{receipt.status === "no_changes" ? "No se añadieron modificaciones." : "El comprobante no incluye un detalle comparable."}</p>}
      <details className={styles.process}><summary>Comprobante y versión</summary><dl><dt>Operación</dt><dd>{receipt.operationId}</dd><dt>Base de costos</dt><dd>{receipt.baseVersionId}</dd><dt>Fecha</dt><dd>{receipt.createdAt}</dd></dl></details>
    </article>)}
  </section>;
}
// React escapes content. Only explicit HTTP(S) sources become links; private work paths never do.
function sourceUrl(value: string): string | null {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function inlineText(text: string): React.ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) { const href = sourceUrl(link[2]!); return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a> : <span key={index} title="Archivo interno; consulta los adjuntos disponibles del estudio">{link[1]} (archivo interno)</span>; }
    return part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part;
  });
}
function tableCells(line: string): string[] { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim()); }
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function confirmedSupport(turn: ChatTurn, evidence?: AiResultEvidence | null): string {
  if (turn.support?.trim()) return turn.support;
  if (!turn.job_id || evidence?.jobId !== turn.job_id || !evidence.receiptCount) return "";
  const sourceValue = (value: unknown) => Array.isArray(value) ? value.map(entry => {
    if (!entry || typeof entry !== "object") return readableValue(entry);
    const source = entry as Record<string, unknown>;
    const href = typeof source.url === "string" ? sourceUrl(source.url) : null;
    return `${readableValue(source.label)}: ${readableValue(source.unitPrice)} ${readableValue(source.currency)}${href ? ` · [Fuente](${href})` : ""}\n${readableValue(source.notes)}`;
  }).join("\n\n") : readableValue(value);
  return "# Soporte de cambios confirmados\n\nEste soporte procede de los cambios guardados y sus fuentes. Las limitaciones de la investigación se explican en la respuesta.\n\n" + evidence.receipts.map(receipt =>
    `Fecha: ${receipt.createdAt}\n\n${receipt.comparison.diffs.map(change => `## ${change.item ? `Ítem ${change.item} · ` : ""}${change.fieldLabel}\n\nAntes: ${readableValue(change.before)}\n\nDespués: ${["price_sources", "priceSources"].includes(change.field) ? sourceValue(change.after) : readableValue(change.after)}`).join("\n\n") || "Operación confirmada sin modificaciones."}`
  ).join("\n\n");
}
export function ChatResponseView({ turn, section = "answer", evidence, onClose }: { turn: ChatTurn; section?: "answer" | "support"; evidence?: AiResultEvidence | null; onClose: () => void }) {
  const support = confirmedSupport(turn, evidence);
  const target = React.useRef<HTMLElement>(null);
  React.useEffect(() => { target.current?.focus(); }, [turn.job_id, section]);
  return <section className={styles.responseView} ref={target} tabIndex={-1} aria-label={section === "support" ? "Soporte del estudio" : "Respuesta completa"}>
    <div className={styles.comparisonHeading}><h3>{section === "support" ? "Soporte del estudio" : "Respuesta completa"}</h3><button type="button" onClick={onClose}>Volver al chat</button></div>
    {section === "answer" ? <><ChatMessage text={turn.result || turn.error || "La respuesta aún no está disponible."} />{support ? <details className={styles.fullAnswer}><summary>Ver soporte del estudio</summary><ChatMessage text={support} /><button type="button" onClick={() => downloadText(support, "soporte-estudio.md")}>Descargar soporte</button></details> : null}</> : support ? <><ChatMessage text={support} /><button type="button" onClick={() => downloadText(support, "soporte-estudio.md")}>Descargar soporte</button></> : <p>Esta solicitud no tiene un soporte separado. Las fuentes disponibles están en la respuesta.</p>}
  </section>;
}
export function ChatMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push(<details className={styles.codeBlock} key={i}><summary>Ver bloque de código o datos</summary><pre><code>{code.join("\n")}</code></pre></details>);
    } else if (line.includes("|") && i + 1 < lines.length && /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[i + 1]!.trim())) {
      const headers = tableCells(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(tableCells(lines[i++]!));
      blocks.push(<div className={styles.sourceTable} key={i} tabIndex={0} role="region" aria-label="Tabla del soporte"><table><thead><tr>{headers.map((cell, j) => <th key={j}>{inlineText(cell)}</th>)}</tr></thead><tbody>{rows.map((row, j) => <tr key={j}>{headers.map((_, k) => <td key={k}>{inlineText(row[k] || "")}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h4 key={i++}>{inlineText(line.replace(/^#{1,6}\s+/, ""))}</h4>);
    } else if (/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items: React.ReactNode[] = [];
      const start = ordered ? Number(line.trim().match(/^\d+/)?.[0] || 1) : 1;
      while (i < lines.length && pattern.test(lines[i]!)) {
        items.push(<li key={i}>{inlineText(lines[i++]!.replace(pattern, ""))}</li>);
      }
      blocks.push(ordered ? <ol start={start} key={i}>{items}</ol> : <ul key={i}>{items}</ul>);
    } else {
      const paragraph: string[] = [line]; i++;
      while (i < lines.length && lines[i]!.trim() && !/^\s*(?:#{1,6}\s|```|[-*]\s|\d+[.)]\s)/.test(lines[i]!)) paragraph.push(lines[i++]!);
      blocks.push(<p key={i}>{inlineText(paragraph.join("\n"))}</p>);
    }
  }
  return <div className={styles.messageText}>{blocks}</div>;
}
export function ChatTurnView({ turn, index, latest, evidence, compact = false }: { turn: ChatTurn; index: number; latest: boolean; evidence?: AiResultEvidence | null; compact?: boolean }) {
  const events = visibleStudyEvents(turn.events);
  const outcome = chatOutcome(turn, evidence);
  const longAnswer = (turn.result?.length || 0) > (compact ? 500 : 6000);
  const preview = compact && longAnswer ? turn.result!.slice(0, 280).replace(/\s+\S*$/, "") + "…" : null;
  return <article className={styles.turn} id={`financial-turn-${turn.job_id || index}`} tabIndex={-1}>
    {turn.prompt ? <div className={styles.userMessage} aria-label="Tu mensaje"><p>{readablePrompt(turn.prompt)}</p></div> : null}
    {events.length ? <details className={styles.process}><summary>Actividad de esta solicitud · {events.length} pasos</summary><ul>{events.map((event, eventIndex) => <li key={`${event.at || ""}-${eventIndex}`}><p>{event.message}</p></li>)}</ul></details> : null}
    <div className={styles.answerHeading} id={`financial-answer-${turn.job_id || index}`} tabIndex={-1}><b>✦ CAF</b><span>{!latest && turn.status === "completed" ? "Respuesta anterior" : ["working", "warning", "error"].includes(outcome.kind) ? outcome.title : ""}</span></div>
    {preview ? <ChatMessage text={preview} /> : null}
    {!turn.result && outcome.kind === "working" ? <div className={styles.typing} role="status" aria-label="La IA está trabajando"><i /><i /><i /><span>La respuesta aparecerá aquí</span></div> : null}
    {turn.error ? <p className={styles.notice}>{turn.error}</p> : null}
    {turn.result ? longAnswer ? <details className={styles.fullAnswer}><summary>Leer respuesta completa</summary><ChatMessage text={turn.result} /></details> : <ChatMessage text={turn.result} /> : outcome.kind !== "working" ? <p>{outcome.detail}</p> : null}
    {turn.support?.trim() ? <details className={styles.fullAnswer}><summary>Ver soporte del estudio</summary><ChatMessage text={turn.support} /><button type="button" onClick={() => downloadText(turn.support!, "soporte-estudio.md")}>Descargar soporte</button></details> : null}
  </article>;
}
