"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { appPath } from "../lib/base-path";
import type { OdooProjectContextData } from "../lib/odoo-project-context";
import { formatBogotaDateTime } from "../lib/date-format";

export function OdooProjectContext({ calculationId, projectId, process, entity, href, children }: {
  calculationId: string; projectId?: string | null; process?: string | null; entity?: string | null; href?: string | null; children?: ReactNode;
}) {
  const [data, setData] = useState<OdooProjectContextData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [activated, setActivated] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById("calculation-topbar-context")); }, []);
  useEffect(() => {
    if (!projectId) { setLoading(false); setData(null); setError(""); return; }
    const controller = new AbortController();
    // #97: show this tab's last reading at once and refresh it from Odoo behind; any failure discards it.
    const cacheKey = `odoo-context:${calculationId}:${projectId}`;
    let cached: OdooProjectContextData | null = null;
    try { cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); } catch { cached = null; }
    setLoading(!cached); setError(""); setData(cached);
    fetch(appPath(`/api/projects/${calculationId}/context`), { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result.project; })
      .then((project) => { setData(project); try { sessionStorage.setItem(cacheKey, JSON.stringify(project)); } catch { /* optional cache */ } })
      .catch((e) => {
        if (controller.signal.aborted) return;
        try { sessionStorage.removeItem(cacheKey); } catch { /* optional cache */ }
        setData(null); setError(e.message || "No se pudo consultar Odoo.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [calculationId, projectId, retry]);
  const missing = !projectId ? "Sin vínculo con Odoo" : loading ? "Consultando…" : error ? "No disponible" : "Sin dato en Odoo";
  const budget = data?.budget != null ? new Intl.NumberFormat("es-CO", { style: "currency", currency: data.currency || "COP", maximumFractionDigits: 0 }).format(data.budget) : missing;
  const deadline = data?.deadline ? formatBogotaDateTime(data.deadline.replace(" ", "T") + (/[Z+-]\d/.test(data.deadline.slice(10)) || data.deadline.endsWith("Z") ? "" : "Z")) : "Sin fecha en Odoo";
  const bodyId = `project-context-${calculationId}`;
  return <section className="project-context" aria-label="Contexto del proyecto">
    {host ? createPortal(<div className="project-context-overview">
      <dl className="project-context-facts" aria-label="Datos esenciales del proyecto" aria-busy={loading}>
        {[["Entidad", data?.entity || entity || missing], ["Ubicación", data?.location || missing], ["Presupuesto oficial", budget]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}
      </dl>
      <button type="button" className="project-context-toggle" aria-label="Contexto del proyecto" title="Contexto del proyecto: datos, notas y carpeta financiera" aria-expanded={expanded} aria-controls={bodyId} onClick={() => { setExpanded(!expanded); setActivated(true); }}>
        <span>Contexto</span><ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>, host) : null}
    <div id={bodyId} className="project-context-body" hidden={!expanded}>
      <div className="project-context-body-heading"><strong>Datos originales de Odoo</strong>{href ? <a href={href} target="_top"><ArrowLeft size={14} /> Ver proyecto</a> : null}<button type="button" aria-label="Plegar contexto del proyecto" onClick={() => setExpanded(false)}>Plegar <ChevronDown size={14} /></button></div>
      {!projectId ? <p>Abre el análisis desde su proyecto de origen para ver sus datos, archivos y notas de Odoo.</p> : loading ? <p role="status">Consultando datos de Odoo…</p> : error ? <p role="status">{error} <button type="button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={14} /> Reintentar</button></p> : data ? <div className="project-context-original">
        <p><strong>Objeto</strong> {data.objective || "Sin dato en Odoo"}</p>
        <dl>{[["Entidad", data.entity || entity], ["Proceso", data.process || process], ["Proyecto", data.name], ["Modalidad", data.modality], ["Cierre", deadline], ["Etapa actual", data.stage], ["Responsable", data.manager]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Sin dato en Odoo"}</dd></div>)}</dl>
        {data.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">Ver proceso original <ExternalLink size={13} /></a> : null}
      </div> : null}
      {/* Keep editors mounted when folded so pending autosaves can finish. */}
      {activated ? <div className="project-context-sources">{children}</div> : null}
    </div>
  </section>;
}
