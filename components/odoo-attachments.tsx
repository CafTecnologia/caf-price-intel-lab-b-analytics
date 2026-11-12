"use client";
import { useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { appPath } from "../lib/base-path";
type File = { id: number; name: string; source: string; size: number };
export function OdooAttachments({ calculationId }: { calculationId: string }) {
  const [files, setFiles] = useState<File[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(true); const [revision, setRevision] = useState(0); const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setFiles([]); setWarnings([]); setError("");
    fetch(appPath(`/api/projects/${calculationId}/context/attachments`), { cache: "no-store", signal: abort.signal }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudieron consultar los adjuntos."); return d; }).then((d) => { if (!abort.signal.aborted) { setFiles(d.files); setWarnings(d.warnings); } }).catch((e) => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [calculationId, revision]);
  return <section className="odoo-attachments" aria-label="Adjuntos de Odoo" aria-busy={busy}><div className="source-notes-heading"><strong>Adjuntos de Odoo</strong><button type="button" disabled={busy} aria-label="Actualizar adjuntos de Odoo" onClick={() => setRevision(revision + 1)}><RefreshCw size={14} /></button></div><p className="source-notes-help">Archivos del proyecto y sus tareas financieras. Se descargan desde Odoo.</p>{error ? <p role="status">{error}</p> : busy ? <p role="status">Consultando adjuntos…</p> : !files.length ? <p>No hay adjuntos visibles para tu usuario en estas fuentes.</p> : <ul>{files.map((f) => <li key={f.id}><a href={appPath(`/api/projects/${calculationId}/context/attachments/${f.id}`)} download><FileText size={15} /><span>{f.name}<small>{f.source}{f.size ? ` · ${Math.ceil(f.size / 1024)} KB` : ""}</small></span></a></li>)}</ul>}{warnings.map((w) => <p role="status" key={w}>{w}</p>)}</section>;
}
