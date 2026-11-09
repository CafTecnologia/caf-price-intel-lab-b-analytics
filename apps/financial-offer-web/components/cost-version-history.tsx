"use client";
import { AI_SAVED_EVENT, type SavedAiActivity } from "@offer/lib/chat-activity";
import { Database, ChevronDown, Save } from "lucide-react";
import { startVisiblePoll } from "../lib/visible-poll";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AnchoredPopover } from "./anchored-popover";
import { appPath } from "@offer/lib/base-path";
import { formatBogotaDateTime } from "@offer/lib/date-format";
import { postVersionAction } from "@offer/lib/version-action-client";
import styles from "./cost-version-history.module.css";

type CostVersion = {
  id: string;
  sequence: number;
  restoredFromSequence?: number;
  createdAt: string;
  source: "initial" | "ai" | "manual" | "restore";
  changedItems: number;
  itemCount?: number;
  jobId?: string | null;
  pricedItems?: number;
  lostPricedItems?: number;
  removedItems?: number;
  active: boolean;
  identityDigest: string;
};

const sourceName: Record<CostVersion["source"], string> = {
  initial: "Base inicial",
  ai: "Investigación IA",
  manual: "Ajuste manual",
  restore: "Base recuperada",
};

export type CostVersionHistoryHandle = { save: () => Promise<boolean>; close: () => void };
export const CostVersionHistory = forwardRef<CostVersionHistoryHandle, {
  projectId: string;
  linkedToOdoo: boolean;
  onBeforeSnapshot: () => Promise<string | null>;
  runExclusive: (task: () => Promise<boolean>, label: string) => Promise<boolean>;
  globalBusy: boolean;
  onOpen?: () => void;
  onSaveRequest?: () => void;
  onActionSaved: (updatedAt: string) => void;
  onError: (message: string) => void;
}>(function CostVersionHistory({ projectId, linkedToOdoo, onBeforeSnapshot, runExclusive, globalBusy, onOpen, onSaveRequest, onActionSaved, onError }, ref) {
  const [versions, setVersions] = useState<CostVersion[]>([]);
  const seenVersionIds = useRef<Set<string> | null>(null);
  const [newVersionIds, setNewVersionIds] = useState<string[]>([]);
  function receiveVersions(next: CostVersion[]) {
    const seen = seenVersionIds.current;
    if (seen) setNewVersionIds(current => [...new Set([...current, ...next.filter(version => !seen.has(version.id) && version.source === "ai").map(version => version.id)])]);
    seenVersionIds.current = new Set(next.map(version => version.id));
    setVersions(next);
  }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const versionsRequest = useRef(0);
  const versionsAlive = useRef(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState("");
  const displayVersions = versions;
  const noticeKey = `caf:cost-action:${projectId}`;
  useEffect(() => {
    const notice = sessionStorage.getItem(noticeKey);
    if (notice) { sessionStorage.removeItem(noticeKey); setMessage(notice); onError(notice); }
  }, [noticeKey]);
  const activeVersion = displayVersions.find(version => version.active);
  async function loadVersions() {
    const requestId = ++versionsRequest.current;
    const response = await fetch(appPath(`/api/projects/${projectId}`), { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo leer el historial de costos.");
    const body = await response.json();
    if (!versionsAlive.current || requestId !== versionsRequest.current) return;
    receiveVersions(body.costVersions ?? []);
    setError("");
    setLoading(false);
  }
  async function act(action: "save" | "restore", versionId?: string): Promise<boolean> {
    return runExclusive(async () => {
      setBusy(true);
      setMessage(action === "save" ? "Guardando base de costos..." : "Aplicando base de costos...");
      try {
        const expectedUpdatedAt = await onBeforeSnapshot();
        if (!expectedUpdatedAt) throw new Error("Termina o cancela la edición actual y guarda el cálculo antes de continuar.");
        let allowCostLoss = false;
        if (action === "restore") {
          const response = await fetch(appPath(`/api/projects/${projectId}`), { cache: "no-store" });
          if (!response.ok) throw new Error("No se pudo comprobar la versión antes de restaurar.");
          const fresh = await response.json();
          if (fresh.project.updatedAt !== expectedUpdatedAt) throw new Error("El cálculo cambió. Recarga antes de restaurar.");
          const target = (fresh.costVersions as CostVersion[]).find((version) => version.id === versionId);
          if (!target) throw new Error("Versión no encontrada.");
          const loss = target.lostPricedItems ?? 0, removed = target.removedItems ?? 0;
          const detail = loss || removed ? `Quitarás ${loss} costos ya registrados y ${removed} filas. ` : "";
          if (!window.confirm(`${detail}Restaurarás los costos y fuentes de esta versión. ¿Continuar?`)) { setMessage("Cambio de base cancelado."); onError("Cambio de base cancelado."); return false; }
          allowCostLoss = loss > 0 || removed > 0;
        }
        const operationId = crypto.randomUUID();
        const result = await postVersionAction(appPath(`/api/projects/${projectId}/price-bases/actions`),
          { action, expectedUpdatedAt, operationId, ...(versionId ? { versionId, allowCostLoss } : {}) });
        if (action === "restore") {
          const selected = versions.find(version => version.id === versionId);
          sessionStorage.setItem(noticeKey, `Base #${selected?.sequence ?? "seleccionada"} aplicada en esta acción. Se conservaron los precios de oferta.`);
          setOpen(false);
          window.location.reload();
          return true;
        }
        onActionSaved(result.updatedAt);
        setMessage(result.status === "no_changes" ? "La base de costos ya estaba guardada." : "Base de costos guardada.");
        setOpen(false);
        await loadVersions();
        return true;
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : "No se pudo aplicar la acción de costos.";
        setMessage(detail);
        onError(detail);
        return false;
      } finally {
        setBusy(false);
      }
    }, action === "save" ? "Guardando base de costos..." : "Aplicando base de costos...");
  }
  useImperativeHandle(ref, () => ({ save: () => act("save"), close: () => setOpen(false) }));
  useEffect(() => {
    let alive = true;
    versionsAlive.current = true;
    async function refresh(signal: AbortSignal) {
      const requestId = ++versionsRequest.current;
      try {
        const response = await fetch(appPath(`/api/projects/${projectId}`), { cache: "no-store", signal });
        if (!response.ok) throw new Error("No se pudo leer el historial de costos.");
        const body = await response.json();
        if (alive && !signal.aborted && requestId === versionsRequest.current) { receiveVersions(body.costVersions ?? []); setError(""); setLoading(false); }
      } catch {
        if (alive && !signal.aborted && requestId === versionsRequest.current) { setError("Historial de costos no disponible."); setLoading(false); }
      }
    }
    const stopPolling = startVisiblePoll(refresh, 30000, true);
    const controller = new AbortController();
    const saved = (event: Event) => { if ((event as CustomEvent<SavedAiActivity>).detail?.projectId === projectId) void refresh(controller.signal); };
    window.addEventListener(AI_SAVED_EVENT, saved);
    return () => { alive = false; versionsAlive.current = false; versionsRequest.current++; controller.abort(); window.removeEventListener(AI_SAVED_EVENT, saved); stopPolling(); };
  }, [projectId]);

  return (
    <div className={styles.container}>
      <button ref={triggerRef} className={styles.trigger} type="button"
        aria-expanded={open} aria-controls="cost-version-options"
        title={`Cambiar base de costos · ${displayVersions.length} guardadas`} disabled={busy || globalBusy}
        onClick={() => { if (!open) onOpen?.(); setOpen((current) => !current); setNewVersionIds([]); void loadVersions().catch(() => setError("Historial de costos no disponible.")); }}>
        <Database size={16} aria-hidden="true" /><span>Base de costos</span>{newVersionIds.length ? <span className={styles.newBadge} role="status">Nueva base IA</span> : null}<ChevronDown size={14} aria-hidden="true" />
      </button>
      <AnchoredPopover open={open} anchorRef={triggerRef} id="cost-version-options" ariaLabel="Base de costos"
        className={styles.list} width={380} onClose={() => setOpen(false)}>
        <strong>Bases de costos e investigaciones</strong>
        <p>Más reciente arriba · consecutivo de creación.</p>
        <p role="status">{loading ? "Consultando la base en uso…" : activeVersion ? `En uso: Base #${activeVersion.sequence}` : "Los costos actuales tienen cambios sin guardar como base."}</p>
        {onSaveRequest ? (
          <button className={styles.save} type="button" disabled={busy || globalBusy || !linkedToOdoo}
            title={linkedToOdoo ? "Guardar costos, fuentes y referencias actuales como una base nueva" : "Disponible para cálculos vinculados con Odoo"}
            onClick={() => { setOpen(false); onSaveRequest(); }}>
            <Save size={14} aria-hidden="true" /><span>Guardar costos actuales como base</span>
          </button>
        ) : null}
        {error ? <p role="alert">{error}</p> : loading ? <p>Cargando bases...</p> : displayVersions.length ? (
          <ol aria-label="Bases, de más reciente a más antigua" style={{ listStyle: "none", paddingLeft: 0 }}>
            {displayVersions.map((version, index) => (
              <li key={version.id}>
                <button className={styles.version} type="button" disabled={busy || globalBusy || !linkedToOdoo || version.active}
                  aria-current={version.active ? "true" : undefined}
                  aria-label={`Base #${version.sequence} · ${sourceName[version.source]}${version.active ? " · En uso" : " · Aplicar"}`}
                  onClick={() => void act("restore", version.id)}>
                  <b>Base #{version.sequence} · {version.restoredFromSequence ? `Copia al aplicar Base #${version.restoredFromSequence}` : sourceName[version.source] ?? "Versión de costos"}{version.active ? " · En uso ✓" : ""}</b>
                  <span>{formatBogotaDateTime(version.createdAt)}{index === 0 ? " · Más reciente" : index === displayVersions.length - 1 ? " · Más antigua" : ""}</span>
                  <span>{version.itemCount !== undefined ? `${version.itemCount} ítems · ` : ""}{version.pricedItems !== undefined ? `${version.pricedItems} con precio · ` : ""}{version.changedItems} modificados</span>
                  {version.lostPricedItems || version.removedItems ? <span>Al restaurar: {version.lostPricedItems ?? 0} costos menos · {version.removedItems ?? 0} filas menos</span> : null}
                </button>
              </li>
            ))}
          </ol>
        ) : <p>Las bases aparecerán aquí cuando se guarden o se apliquen desde la IA.</p>}
        {!linkedToOdoo ? <small>Guardar y activar bases requiere un cálculo vinculado con Odoo.</small> : <small>Al elegir una base cambian sus costos y fuentes; la oferta permanece.</small>}
        {message ? <p role="status">{message}</p> : null}
      </AnchoredPopover>
    </div>
  );
});
