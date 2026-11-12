"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { appPath } from "../lib/base-path";
import { formatBogotaDateTime } from "../lib/date-format";
import type { SourceNote } from "../lib/odoo-project-sources";

export function OdooSourceNotes({ calculationId, linked }: { calculationId: string; linked: boolean }) {
  const [entries, setEntries] = useState<SourceNote[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState({ before: null as number | null, revision: 0 });
  useEffect(() => {
    if (!linked) { setEntries([]); setWarnings([]); setNext(null); setBusy(false); setError(""); return; }
    const abort = new AbortController(); setBusy(true); setError("");
    if (!query.before) { setEntries([]); setWarnings([]); setNext(null); }
    fetch(appPath(`/api/projects/${calculationId}/context/notes${query.before ? `?before=${query.before}` : ""}`), { cache: "no-store", signal: abort.signal })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudieron consultar las notas."); return d; })
      .then((d) => { if (abort.signal.aborted) return; setEntries((old) => [...(query.before ? old : []), ...d.entries].filter((n, i, all) => all.findIndex((a) => a.id === n.id) === i)); setNext(d.next); setWarnings((old) => [...new Set<string>([...(query.before ? old : []), ...d.warnings])]); })
      .catch((e) => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [calculationId, linked, query]);
  const groups = [...new Set(entries.map((n) => n.group))].sort((a, b) => {
    const source = (g: string) => entries.find((n) => n.group === g)!.source;
    return Number(!/Preparar documentos/i.test(source(a))) - Number(!/Preparar documentos/i.test(source(b))) || source(a).localeCompare(source(b), "es");
  });
  return <section className="odoo-source-notes" aria-label="Notas de Odoo" aria-busy={busy}>
    <div className="source-notes-heading"><strong>Notas de Odoo</strong>{linked ? <button type="button" disabled={busy} onClick={() => setQuery({ before: null, revision: query.revision + 1 })}><RefreshCw size={14} /> Actualizar</button> : null}</div>
    <p className="source-notes-help">{linked ? "Notas y comentarios de la macrotarea inmediatamente anterior a la oferta económica." : "Este cálculo no está vinculado con Odoo. Abre el análisis desde su proyecto de origen para consultar sus notas."}</p>
    {error ? <p role="status">{error} <button type="button" onClick={() => setQuery({ ...query, revision: query.revision + 1 })}>Reintentar</button></p> : null}
    {warnings.map((w) => <p role="status" key={w}>{w}</p>)}
    {busy ? <p role="status">Consultando notas de Odoo…</p> : linked && !error && !warnings.length && !entries.length ? <p>La macrotarea anterior no tiene notas visibles para tu usuario.</p> : null}
    {groups.map((group) => { const notes = entries.filter((n) => n.group === group); return <details key={group} open className="source-note-group"><summary>{notes[0].source} <small>({notes.length})</small></summary>{notes.map((n) => <article key={n.id}><header><strong>{n.title}</strong><span>{n.edited ? "Última edición: " : ""}{n.author || "Autor no disponible"}{n.date ? ` · ${formatBogotaDateTime(n.date.replace(" ", "T") + "Z")}` : ""}</span></header><p>{n.text}</p></article>)}</details>; })}
    {next ? <button type="button" disabled={busy} onClick={() => setQuery({ before: next, revision: query.revision + 1 })}>Ver comentarios anteriores</button> : null}
  </section>;
}
