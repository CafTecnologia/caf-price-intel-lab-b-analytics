"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReceiptCostBase, CurrentCostBase } from "./cost-base-context";
import styles from "./calculation-collaboration.module.css";
import { sendChatRequest } from "@offer/lib/chat-request";
import { appPath } from "@offer/lib/base-path";
import { chatDeliveryConfirmed, chatDeliveryKey, pendingChatDelivery, secureRequestId, withChatSendLock, type PendingChatDelivery } from "@offer/lib/chat-delivery";
import { chatInProgress, chatOutcome, latestChatTurn, readablePrompt, type ChatTurn } from "@offer/lib/chat-outcome";
import { AI_SAVED_EVENT, activityStep, responseSignature, savedAiActivity } from "@offer/lib/chat-activity";
import { visibleStudyEvents } from "@offer/lib/study-events";
import type { AiResultEvidence } from "@offer/lib/ai-result-evidence";
import { AiChangeComparison, AiResultCard, ChatResponseView, ChatTurnView } from "./ai-result-panel";
import type { FinancialOfferItem, FinancialOfferProject } from "@offer/lib/contract";
import { itemReference, searchItemReferences, uniqueItemReferences, type ItemReference } from "@offer/lib/item-references";

type CostActivity = { id: string; sequence: number; source: string; createdAt: string; changedItems: number; active: boolean; restoredFromSequence?: number };
type LedgerEntry = { id?: string; date?: string; author?: string; body?: string };
type Collaboration = { costActivity?: CostActivity[]; costHistoryError?: boolean; available?: boolean; canMessage?: boolean; chatUrl?: string; csrfToken?: string; study?: { publication_busy?: boolean; dialogue?: { turns?: ChatTurn[] }; dialogue_error?: string }; ledger?: LedgerEntry[]; calculationUpdatedAt?: string };

function safeHttpUrl(value?: string): string | null { try { const url = new URL(value || ""); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } }
function humanDate(value?: string): string { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Fecha no disponible"; }
export function CalculationCollaboration(props: { project: FinancialOfferProject; items: FinancialOfferItem[]; onBeforeSend: () => Promise<boolean> }) {
  const [chatOpen, setChatOpen] = useState(false), [ledgerOpen, setLedgerOpen] = useState(false), [data, setData] = useState<Collaboration | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [references, setReferences] = useState<ItemReference[]>([]), [suggestionIndex, setSuggestionIndex] = useState(0), [sending, setSending] = useState(false), [pendingDelivery, setPendingDelivery] = useState<PendingChatDelivery | null>(null);
  const dataRef = useRef<Collaboration | null>(null), chatOpenRef = useRef(false), ledgerOpenRef = useRef(false), sendingRef = useRef(false), pendingDeliveryRef = useRef<PendingChatDelivery | null>(null);
  const [evidence, setEvidence] = useState<AiResultEvidence | null>(null), [evidenceError, setEvidenceError] = useState(false), [comparisonOpen, setComparisonOpen] = useState(false), [newResponse, setNewResponse] = useState(false);
  const [responseSection, setResponseSection] = useState<"answer" | "support" | null>(null);
  const [unread, setUnread] = useState(false), [expanded, setExpanded] = useState(false);
  const [acceptedTurn, setAcceptedTurn] = useState<ChatTurn | null>(null);
  const acceptedTurnRef = useRef<ChatTurn | null>(null);
  const seenReceiptsRef = useRef<Set<string> | null>(null), seenResponseRef = useRef<string | null>(null);
  const turnsRef = useRef<HTMLDivElement>(null), followLatestRef = useRef(true), requestRef = useRef(0), requestBusyRef = useRef(false), aliveRef = useRef(true);
  const clearPrivateData = useCallback(() => { acceptedTurnRef.current = null; setAcceptedTurn(null); dataRef.current = null; seenReceiptsRef.current = null; seenResponseRef.current = null; setUnread(false); setData(null); setEvidence(null); setMessage(""); setReferences([]); pendingDeliveryRef.current = null; setPendingDelivery(null); setComparisonOpen(false); setResponseSection(null); setNewResponse(false); setEvidenceError(false); window.dispatchEvent(new CustomEvent("caf:financial-ai-request-changed", { detail: { projectId: props.project.id } })); }, [props.project.id]);
  const load = useCallback(async (view?: "ledger") => {
    const requestId = ++requestRef.current;
    requestBusyRef.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(appPath(`/api/projects/${props.project.id}/collaboration${view ? "?view=ledger" : ""}`), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const next = await response.json() as Collaboration & { error?: string };
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status) && requestId === requestRef.current && aliveRef.current) { clearPrivateData(); }
        throw new Error(next.error || "No se pudo consultar la colaboración.");
      }
      if (view === "ledger" && response.ok) {
        try {
          const costs = await fetch(appPath(`/api/projects/${props.project.id}`), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
          if (!costs.ok) throw new Error("Historial no disponible");
          next.costActivity = (await costs.json()).costVersions;
          next.costHistoryError = false;
        } catch { next.costHistoryError = true; }
      }
      if (!aliveRef.current || requestId !== requestRef.current) return null;
      const previousJobId = latestChatTurn(dataRef.current?.study?.dialogue?.turns)?.job_id;
      dataRef.current = { ...dataRef.current, ...next }; setData(dataRef.current); setError("");
      const latest = latestChatTurn(next.study?.dialogue?.turns);
      if (acceptedTurnRef.current && (next.study?.dialogue?.turns?.some(turn => turn.job_id === acceptedTurnRef.current?.job_id) || (latest?.job_id !== previousJobId && readablePrompt(latest?.prompt) === acceptedTurnRef.current?.prompt))) { acceptedTurnRef.current = null; setAcceptedTurn(null); }
      if (latest?.job_id) {
        try {
          const receiptResponse = await fetch(appPath(`/api/projects/${props.project.id}/ai-result?jobId=${encodeURIComponent(latest.job_id)}`), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
          const receiptBody = await receiptResponse.json() as { evidence?: AiResultEvidence };
          if (!receiptResponse.ok || !receiptBody.evidence) throw new Error("Comprobante no disponible");
          if (aliveRef.current && requestId === requestRef.current) { setEvidence(receiptBody.evidence); setEvidenceError(false); }
          if (next.study?.publication_busy && latest.status === "completed" && receiptBody.evidence.receiptCount > 0 && !receiptBody.evidence.rejectedReceiptCount) {
            const confirmation = await fetch(appPath(`/api/projects/${props.project.id}/ai-result`), {
              method: "POST", credentials: "same-origin", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({jobId:latest.job_id}), signal:controller.signal,
            });
            const result = await confirmation.json();
            if (confirmation.ok && result.confirmed) {
              const settled = await fetch(appPath(`/api/projects/${props.project.id}/collaboration`), {credentials:"same-origin",cache:"no-store",signal:controller.signal});
              if (settled.ok && aliveRef.current && requestId === requestRef.current) {
                dataRef.current = {...dataRef.current,...await settled.json()}; setData(dataRef.current);
              }
            }
          }

        } catch {
          if (aliveRef.current && requestId === requestRef.current) { setEvidence(null); setEvidenceError(true); }
        }
      } else { setEvidence(null); setEvidenceError(false); }
      return dataRef.current;
    } catch (reason) {
      if (aliveRef.current && requestId === requestRef.current) { setError(reason instanceof Error ? reason.message : "No se pudo consultar la colaboración."); setEvidence(null); }
      return null;
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestRef.current) requestBusyRef.current = false;
    }
  }, [props.project.id, clearPrivateData]);
  useEffect(() => { aliveRef.current = true; void load(); return () => { aliveRef.current = false; requestRef.current++; }; }, [load]);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) void load(); }, [chatOpen, load]);
  useEffect(() => { ledgerOpenRef.current = ledgerOpen; if (ledgerOpen) void load("ledger"); }, [ledgerOpen, load]);
  useEffect(() => { if (!chatOpen || !data?.canMessage) return; const timer = window.setTimeout(() => document.getElementById("financial-chat-composer-" + props.project.id)?.focus(), 0); return () => window.clearTimeout(timer); }, [chatOpen, data?.canMessage, props.project.id]);
  const latest = latestChatTurn(data?.study?.dialogue?.turns);
  useEffect(() => {
    setComparisonOpen(false); setResponseSection(null);
    window.dispatchEvent(new CustomEvent("caf:financial-ai-request-changed", { detail: { projectId: props.project.id } }));
  }, [latest?.job_id, props.project.id]);
  const activeJob = !!acceptedTurn || chatInProgress(latest) || !!data?.study?.publication_busy;
  const presentationTurn: ChatTurn | undefined = sending ? { status: "sending" } : acceptedTurn ? acceptedTurn : data?.study?.publication_busy && !chatInProgress(latest) ? { ...latest, status: latest?.status || "completed", publication: { ...latest?.publication, status: "reconciling" } } : latest;
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !requestBusyRef.current) void load(ledgerOpenRef.current ? "ledger" : undefined); }, activeJob ? 3_000 : 30_000);
    const resume = () => { if (document.visibilityState === "visible" && !requestBusyRef.current) void load(ledgerOpenRef.current ? "ledger" : undefined); };
    document.addEventListener("visibilitychange", resume);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [activeJob, load]);
  const outcome = chatOutcome(presentationTurn, evidence, !!error || !!data?.study?.dialogue_error);
  const responseKey = responseSignature(latest);
  const step = activityStep(presentationTurn);
  useEffect(() => {
    if (!data) return;
    if (seenResponseRef.current !== null && seenResponseRef.current !== responseKey && outcome.kind !== "working" && latest?.job_id && !chatOpen) setUnread(true);
    seenResponseRef.current = responseKey;
    if (chatOpen) setUnread(false);
  }, [data, responseKey, outcome.kind, latest?.job_id, chatOpen]);
  useEffect(() => {
    if (!evidence || evidence.jobId !== latest?.job_id || evidence.calculationId !== props.project.id) return;
    const seen = seenReceiptsRef.current;
    if (seen) {
      const activity = savedAiActivity(props.project.id, latest, evidence, seen);
      if (activity) {
        window.dispatchEvent(new CustomEvent(AI_SAVED_EVENT, { detail: activity }));
        if (!chatOpenRef.current) setUnread(true);
      }
    }
    seenReceiptsRef.current = new Set([...(seen || []), ...evidence.receipts.map(receipt => receipt.operationId)]);
  }, [evidence, latest, props.project.id]);
  const scrollToLatest = () => {
    const pane = turnsRef.current;
    if (pane) { pane.scrollTop = pane.scrollHeight; followLatestRef.current = true; setNewResponse(false); }
  };
  useEffect(() => {
    if (!chatOpen || comparisonOpen) return;
    const frame = window.requestAnimationFrame(() => { if (followLatestRef.current) scrollToLatest(); else if (latest?.result && outcome.kind !== "working") setNewResponse(true); });
    return () => window.cancelAnimationFrame(frame);
  }, [chatOpen, comparisonOpen, responseKey, outcome.kind, latest?.result]);
  const showResponse = () => { setComparisonOpen(false); setResponseSection("answer"); setNewResponse(false); };
  const closeResponse = () => { setResponseSection(null); window.requestAnimationFrame(() => document.getElementById("financial-view-response")?.focus()); };
  useEffect(() => { const quote = (event: Event) => { const itemId = (event as CustomEvent<{ itemId?: string }>).detail?.itemId; const index = props.items.findIndex((item) => item.id === itemId); if (index < 0) return; setReferences((current) => uniqueItemReferences([...current, itemReference(props.items[index]!, index)])); setLedgerOpen(false); setChatOpen(true); window.setTimeout(() => document.getElementById("financial-chat-composer-" + props.project.id)?.focus(), 0); }; window.addEventListener("caf:quote-financial-item", quote); return () => window.removeEventListener("caf:quote-financial-item", quote); }, [props.items]);
  const atQuery = /(?:^|\s)@([^\s@]*)$/.exec(message)?.[1] ?? null;
  const suggestions = useMemo(() => atQuery === null ? [] : searchItemReferences(props.items, atQuery).filter((candidate) => !references.some((reference) => reference.itemId === candidate.itemId)).slice(0, 8), [atQuery, props.items, references]);
  useEffect(() => setSuggestionIndex(0), [atQuery, suggestions.length]);
  const addReference = (reference: ItemReference) => {
    setReferences((current) => uniqueItemReferences([...current, reference]));
    setMessage(current => current.replace(/(^|\s)@([^\s@]*)$/, "$1"));
    setSuggestionIndex(0);
  };
  async function send() { const body = message.trim(); const itemIds = references.map(({ itemId }) => itemId); if (!body || activeJob || sendingRef.current || !data?.canMessage) return; sendingRef.current = true; setSending(true); setError(""); try { await withChatSendLock(async () => { const delivery = pendingChatDelivery(pendingDeliveryRef.current, body, itemIds, secureRequestId); pendingDeliveryRef.current = delivery; setPendingDelivery(delivery); if (!await props.onBeforeSend()) return; const context = await fetch(appPath(`/api/projects/${props.project.id}/collaboration?accessOnly=1`), { credentials: "same-origin", cache: "no-store" }); const refreshed = context.ok ? await context.json() as Collaboration : null; if (!refreshed?.canMessage) throw new Error("No tienes una sesión con permiso para enviar indicaciones."); const response = await sendChatRequest(appPath(`/api/projects/${props.project.id}/collaboration`), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", ...(refreshed.csrfToken ? { "X-CSRF-Token": refreshed.csrfToken } : {}) }, body: JSON.stringify({ message: body, requestId: delivery.requestId, references: itemIds.map((itemId) => ({ itemId })), expectedUpdatedAt: refreshed.calculationUpdatedAt || props.project.updatedAt }) }); const result = response.body as { queued?: boolean; error?: string; id?: string; appliedJobId?: string }; if (!response.ok) { if ([401, 403, 404].includes(response.status)) clearPrivateData(); throw new Error(result.error || "No se pudo enviar la indicación."); } if (!chatDeliveryConfirmed(result, props.project.id)) throw new Error("No se confirmó la recepción. Reintenta sin cambiar la indicación."); const accepted: ChatTurn = { job_id: result.id || result.appliedJobId || delivery.requestId, prompt: body, status: "queued" }; acceptedTurnRef.current = accepted; setAcceptedTurn(accepted); pendingDeliveryRef.current = null; setPendingDelivery(null); setMessage(""); setReferences([]); followLatestRef.current = true; setComparisonOpen(false); void load(); }, () => { sendingRef.current = false; setSending(false); }); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo enviar la indicación."); } }
  const calculationChanged = !!data?.calculationUpdatedAt && data.calculationUpdatedAt !== props.project.updatedAt, chatUrl = /^\/caf\/ia\/tasks\/\d+\/chat$/.test(data?.chatUrl || "") ? data!.chatUrl! : safeHttpUrl(data?.chatUrl);
  const retryPending = pendingDelivery?.key === chatDeliveryKey(message, references.map(({ itemId }) => itemId));
  useEffect(() => {
    const showChanges = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId !== props.project.id) return;
      setLedgerOpen(false); setChatOpen(true); setComparisonOpen(true);
    };
    window.addEventListener("caf:show-ai-changes", showChanges);
    return () => window.removeEventListener("caf:show-ai-changes", showChanges);
  }, [props.project.id]);
  const closeChat = () => { setChatOpen(false); window.setTimeout(() => document.getElementById("financial-chat-launcher-" + props.project.id)?.focus(), 0); };
  return <section className={styles.collaboration} aria-label="Colaboración del cálculo">
    <div className={styles.dockControls} aria-label="IA y bitácora"><button id={"financial-chat-launcher-" + props.project.id} className={styles.chatLauncher} data-tone={outcome.kind} data-working={outcome.kind === "working"} data-unread={unread} title={step || outcome.detail} type="button" aria-expanded={chatOpen} aria-controls={"financial-chat-" + props.project.id} onClick={() => { setLedgerOpen(false); setChatOpen(current => !current); followLatestRef.current = true; }}><span className={styles.activityIcon} aria-hidden="true">{outcome.kind === "working" ? "◌" : unread ? "●" : "✦"}</span><span>Chat IA{unread ? <b className={styles.unreadBadge}>Nuevo</b> : null}<small role="status" aria-live="polite">{data || error ? outcome.title : "Consultando estado…"}</small></span></button><button id={"financial-ledger-toggle-" + props.project.id} className={styles.ledgerToggle} type="button" aria-expanded={ledgerOpen} aria-controls={"financial-ledger-" + props.project.id} onClick={() => { setChatOpen(false); setLedgerOpen((current) => !current); }}>◷ Bitácora{outcome.kind === "working" ? <span className={styles.liveDot} aria-label="Actividad en curso" /> : unread ? <span className={styles.unreadDot} aria-label="Hay novedades" /> : null}</button></div>
    {chatOpen ? <section className={styles.chatWindow} data-expanded={expanded} id={"financial-chat-" + props.project.id} role="dialog" aria-modal="false" aria-label="Chat IA del estudio" onKeyDown={(event) => { if (event.key === "Escape") closeChat(); }}>
      <header className={styles.panelHeader}><div><strong>Conversación con CAF</strong><small title={props.project.name}>{props.project.name} · {props.items.length} ítems</small></div><div className={styles.headerActions}><button className={styles.expandButton} type="button" aria-label={expanded ? "Reducir conversación" : "Ampliar conversación"} aria-pressed={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? "↙" : "↗"}</button>{chatUrl ? <a className={styles.popoutLink} href={chatUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir conversación en otra pestaña" title="Abrir conversación completa en otra pestaña">↗</a> : null}<button className={styles.closeButton} type="button" aria-label="Cerrar Chat IA" onClick={closeChat}>×</button></div></header>
      <div className={styles.body}>
        <div className={styles.statusLine} hidden={outcome.kind === "neutral" || outcome.kind === "success"} data-tone={outcome.kind} role="status" aria-live="polite"><span>{outcome.title}</span><button type="button" onClick={() => { setChatOpen(false); setLedgerOpen(true); }}>Bitácora ↗</button></div>
        {step && outcome.kind === "working" ? <div className={styles.liveActivity} role="status"><span className={styles.liveDot} aria-hidden="true" /><span>{step}</span></div> : null}
        <div className={styles.turns} ref={turnsRef} onScroll={() => { const pane = turnsRef.current; if (pane) { followLatestRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100; if (followLatestRef.current) setNewResponse(false); } }}>
        {calculationChanged ? <p className={styles.notice}>El cálculo cambió desde que abriste esta página. Conserva tus ediciones antes de actualizar.</p> : null}
        {error ? <details className={styles.process}><summary>No se pudo consultar el estado</summary><p>{error}</p></details> : null}
        {evidenceError ? <p className={styles.notice}>No se pudo consultar el comprobante. El resultado de cambios sigue sin verificar.</p> : null}
        {data?.available === false ? <p className={styles.empty}>Este cálculo no tiene un estudio IA asociado.</p> : null}
        {data && !data.canMessage ? <p className={styles.empty}>Necesitas una sesión Odoo con acceso al estudio para enviar indicaciones.</p> : null}
          {responseSection && latest ? <ChatResponseView turn={latest} evidence={evidence} section={responseSection} onClose={closeResponse} /> : comparisonOpen && evidence && evidence.jobId === latest?.job_id ? <AiChangeComparison evidence={evidence} onClose={() => setComparisonOpen(false)} /> :
            data?.study?.dialogue?.turns?.length ? data.study.dialogue.turns.map((turn, index) => <ChatTurnView key={turn.job_id || index} turn={turn} index={index} latest={turn === latest} evidence={turn === latest ? evidence : undefined} />) : <p className={styles.empty}>{data ? "Aún no hay indicaciones en este estudio." : error ? "No se pudo cargar la conversación. Vuelve a consultar el estado." : "Consultando el estudio…"}</p>}
          {acceptedTurn ? <article className={styles.turn} aria-label="Mensaje recibido"><div className={styles.userMessage}><p>{acceptedTurn.prompt}</p><small>✓ Recibido · La IA está preparando la respuesta. Puedes seguir usando el cálculo.</small></div></article> : null}
          {sending && message.trim() ? <article className={styles.turn} aria-label="Mensaje enviándose"><div className={styles.userMessage}><p>{message}</p><small>Enviando · recepción pendiente</small></div></article> : null}
          {!responseSection && !comparisonOpen && latest && outcome.kind !== "working" ? <><AiResultCard turn={presentationTurn} evidence={evidence} unavailable={!!error || !!data?.study?.dialogue_error} pendingCount={props.items.filter(item => item.costBasisStatus === "pending").length} onCompare={() => setComparisonOpen(true)} onResponse={showResponse} onSupport={() => { setComparisonOpen(false); setResponseSection("support"); }} onLedger={() => { setChatOpen(false); setLedgerOpen(true); }} onRefresh={() => void load()} /></> : null}
        </div>
        {newResponse && !responseSection && !comparisonOpen ? <button className={styles.newResponse} type="button" onClick={showResponse}>Respuesta lista · Ver</button> : null}
      <div className={styles.composer}>{suggestions.length ? <div className={styles.suggestions} role="listbox" aria-label="Ítems para citar">{suggestions.map((suggestion, index) => <button className={`${styles.suggestion} ${index === suggestionIndex ? styles.suggestionActive : ""}`} type="button" role="option" aria-selected={index === suggestionIndex} key={suggestion.itemId} onMouseDown={(event) => event.preventDefault()} disabled={sending} onClick={() => addReference(suggestion)}>{suggestion.label}</button>)}</div> : null}{references.length ? <div className={styles.references} aria-label="Ítems citados">{references.map((reference) => <span className={styles.chip} key={reference.itemId}><span className={styles.chipLabel}>{reference.label}</span><button type="button" aria-label={`Quitar ${reference.label}`} disabled={sending} onClick={() => setReferences((current) => current.filter((candidate) => candidate.itemId !== reference.itemId))}>×</button></span>)}</div> : null}<textarea id={"financial-chat-composer-" + props.project.id} value={message} disabled={!data?.canMessage || sending} aria-label="Mensaje para CAF" placeholder="Pregunta o pide un cambio… Usa @ para citar un ítem." onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (suggestions.length && event.key === "ArrowDown") { event.preventDefault(); setSuggestionIndex((current) => (current + 1) % suggestions.length); } else if (suggestions.length && event.key === "ArrowUp") { event.preventDefault(); setSuggestionIndex((current) => (current + suggestions.length - 1) % suggestions.length); } else if (suggestions.length && event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) { event.preventDefault(); addReference(suggestions[suggestionIndex]!); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } else if (event.key === "Escape") { event.preventDefault(); closeChat(); } }} /><div className={styles.composerFooter}><small>{references.length ? `${references.length} ítem(s) citado(s)` : "@ Citar ítems · Ctrl/⌘ + Enter para enviar"}</small><button className="button" type="button" disabled={!message.trim() || !data?.canMessage || sending || activeJob} onClick={() => void send()}>{sending ? "Enviando..." : activeJob ? (latest?.status === "completed" && !acceptedTurn ? "Cerrando registro…" : "IA trabajando…") : retryPending ? "Reintentar envío" : "Enviar ↑"}</button></div></div>
    </div></section> : null}
    <aside className={styles.ledgerDock}>{ledgerOpen ? <section className={styles.ledgerPanel} id={"financial-ledger-" + props.project.id} aria-label="Bitácora y comentarios de Odoo" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { setLedgerOpen(false); document.getElementById("financial-ledger-toggle-" + props.project.id)?.focus(); } }}><header className={styles.panelHeader}><div><strong>Bitácora</strong><small>Actividad de la IA y cambios confirmados</small></div><button className={styles.closeButton} type="button" aria-label="Cerrar bitácora" onClick={() => { setLedgerOpen(false); window.setTimeout(() => document.getElementById("financial-ledger-toggle-" + props.project.id)?.focus(), 0); }}>×</button></header><div className={styles.body}>
      {latest ? <section className={styles.ledgerActivity} aria-label="Actividad de la solicitud actual"><strong>{outcome.title}</strong><p>{outcome.detail}</p>
        <ol>{visibleStudyEvents(latest.events).map((event, index) => <li key={`${event.at}-${index}`}><span>{event.message}</span>{event.at ? <time>{humanDate(event.at)}</time> : null}</li>)}</ol>
        {evidence && evidence.jobId === latest.job_id ? evidence.receipts.map(receipt => <div className={styles.savedReceipt} key={receipt.operationId}><b>{receipt.status === "applied" ? "✓ Guardado confirmado" : "Sin cambios"}</b><span>{receipt.changedItemCount} {receipt.changedItemCount === 1 ? "ítem" : "ítems"} · {humanDate(receipt.createdAt)}</span><small><ReceiptCostBase id={receipt.baseVersionId} versions={data?.costActivity} unavailable={data?.costHistoryError} /></small></div>) : null}
        {evidence?.appliedReceiptCount ? <button type="button" onClick={() => { setLedgerOpen(false); setChatOpen(true); setComparisonOpen(true); }}>Ver qué cambió</button> : null}
      </section> : null}
      <section className={styles.ledgerActivity} aria-label="Historial de bases de costos"><h3 className={styles.ledgerTitle}>Bases de costos</h3>
        {data?.costHistoryError ? <p>No se pudo actualizar el historial de bases.</p> : data?.costActivity ? <>
          <CurrentCostBase versions={data.costActivity} />
          <ol>{data.costActivity.slice(0, 10).map(version => <li key={version.id}><strong>{version.restoredFromSequence ? `Se aplicó Base #${version.restoredFromSequence} · registro #${version.sequence}` : `${version.source === "ai" ? "IA guardó" : "Se guardó"} Base #${version.sequence}`}</strong><p>{humanDate(version.createdAt)} · {version.changedItems} ítem(s) modificados</p></li>)}</ol>
        </> : <p>Consultando los cambios de bases…</p>}
      </section>
      <h3 className={styles.ledgerTitle}>Registro de Odoo</h3>{data?.ledger?.length ? <div className={styles.ledger}>{data.ledger.map((entry, index) => <article className={styles.ledgerEntry} key={entry.id || `${entry.date}-${index}`}><span className={styles.avatar} aria-hidden="true">{(entry.author || "U").slice(0, 1).toUpperCase()}</span><div className={styles.entryContent}><div className={styles.meta}><strong>{entry.author || "Usuario"}</strong><span>{humanDate(entry.date)}</span></div><p>{entry.body || "Cambio registrado."}</p></div></article>)}</div> : <p className={styles.empty}>{data ? "No hay cambios registrados todavía." : "Abre la bitácora para consultar los cambios registrados en Odoo."}</p>}</div></section> : null}</aside>
  </section>;
}
