"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, FileText, Folder, RefreshCw, X } from "lucide-react";
import { appPath } from "@offer/lib/base-path";
import styles from "./study-documents.module.css";

import { OdooAttachments } from "./odoo-attachments";

type DriveFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string };
type Listing = { root: { id: string; name: string }; folder: { id: string; name: string }; files: DriveFile[]; nextPage?: string };
type WordBlock = { type: "paragraph"; text: string } | { type: "table"; rows: string[][] } | { type: "image"; source: string; alt: string };
type Sheet = { name: string; rows: string[][] };
type Preview = { kind: "image" | "pdf"; url: string } | { kind: "word"; blocks: WordBlock[]; note: string } | { kind: "excel"; sheets: Sheet[] };
const FOLDER = "application/vnd.google-apps.folder";

export function StudyDocuments({ calculationId, linked = true, embedded = false }: { calculationId: string; linked?: boolean; embedded?: boolean }) {
  const [expanded, setExpanded] = useState(embedded);
  const [listing, setListing] = useState<Listing | null>(null);
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DriveFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const listAbort = useRef<AbortController | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const blobUrl = useRef<string | null>(null);
  const frameCleanup = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const endpoint = appPath(`/api/projects/${encodeURIComponent(calculationId)}/documents`);

  const close = useCallback(() => {
    previewAbort.current?.abort();
    frameCleanup.current?.();
    frameCleanup.current = null;
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = null;
    dialog.current?.close();
    if (trigger.current?.isConnected) trigger.current.focus();
    setSelected(null);
    setPreview(null);
    setPreviewError("");
  }, []);

  async function load(folder?: string, page?: string, append = false, nextTrail?: Array<{ id: string; name: string }>) {
    if (!linked) return;
    listAbort.current?.abort();
    const abort = new AbortController();
    listAbort.current = abort;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams();
      if (folder) query.set("folder", folder);
      if (page) query.set("page", page);
      const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron consultar los archivos.");
      if (abort.signal.aborted) return;
      setListing((current) => append && current && current.folder.id === data.folder.id
        ? { ...data, files: [...current.files, ...data.files].filter((file: DriveFile, index: number, all: DriveFile[]) => all.findIndex((other) => other.id === file.id) === index) }
        : data);
      if (nextTrail) setTrail(nextTrail);
      else if (!folder) setTrail([data.root]);
    } catch (cause) {
      if (!abort.signal.aborted) { setListing(null); close(); setError(cause instanceof Error ? cause.message : "No se pudo consultar Drive."); }
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }

  useEffect(() => {
    setListing(null); setTrail([]); setExpanded(embedded); setBusy(false); setError(""); close();
    if (embedded && linked) void load();
    return () => { listAbort.current?.abort(); previewAbort.current?.abort(); frameCleanup.current?.(); if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); };
    // A new calculation always discards the previous folder and pending requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculationId, embedded, linked]);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selected]);

  async function open(file: DriveFile, button: HTMLElement) {
    close();
    trigger.current = button;
    const abort = new AbortController();
    previewAbort.current = abort;
    setSelected(file); setSheetIndex(0); setRowPage(0); setImageZoom(1);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(file.id)}`, { cache: "no-store", signal: abort.signal });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "No se pudo abrir el archivo."); }
      const mime = response.headers.get("content-type") || "";
      if (mime.includes("application/json")) {
        const data = await response.json();
        if (data.kind !== "word") throw new Error("El archivo no tiene una vista previa compatible.");
        if (!abort.signal.aborted) setPreview(data);
      } else if (mime.includes("spreadsheet") || mime.includes("ms-excel") || /\.(xlsx|xls)$/i.test(file.name)) {
        const bytes = await response.arrayBuffer();
        if (abort.signal.aborted) return;
        const sheets = await new Promise<Sheet[]>((resolve, reject) => {
          const worker = new Worker(new URL("../lib/study-spreadsheet.worker.ts", import.meta.url));
          const stop = () => { worker.terminate(); clearTimeout(timer); abort.signal.removeEventListener("abort", cancel); };
          const cancel = () => { stop(); reject(new Error("Lectura cancelada.")); };
          const timer = setTimeout(() => { stop(); reject(new Error("Este Excel tardó demasiado en abrir. Prueba con un archivo más pequeño.")); }, 20000);
          abort.signal.addEventListener("abort", cancel, { once: true });
          worker.onmessage = (event: MessageEvent<{ sheets?: Sheet[]; error?: string }>) => { stop(); event.data.sheets ? resolve(event.data.sheets) : reject(new Error(event.data.error || "No se pudo leer el Excel.")); };
          worker.onerror = () => { stop(); reject(new Error("No se pudo leer el Excel.")); };
          worker.postMessage(bytes, [bytes]);
        });
        if (!abort.signal.aborted) setPreview({ kind: "excel", sheets });
      } else if (mime.startsWith("image/") || mime.includes("application/pdf")) {
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        blobUrl.current = url;
        setPreview({ kind: mime.includes("application/pdf") ? "pdf" : "image", url });
      } else throw new Error("Este formato todavía no tiene vista previa.");
    } catch (cause) { if (!abort.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : "No se pudo abrir el archivo."); }
  }

  function bindPdfEscape(frame: HTMLIFrameElement) {
    frameCleanup.current?.();
    try {
      const document = frame.contentDocument;
      const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
      document?.addEventListener("keydown", escape, true);
      frameCleanup.current = () => document?.removeEventListener("keydown", escape, true);
    } catch { /* The close button remains available if the host blocks frame access. */ }
  }

  const currentSheet = preview?.kind === "excel" ? preview.sheets[sheetIndex] : null;
  return <>
    <section className={`${styles.panel} ${embedded ? styles.embedded : ""}`} aria-label="Archivos y Drive">
      <div className={styles.heading}>{embedded ? <strong><Folder size={16} aria-hidden="true" />Archivos y Drive</strong> : <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={`study-files-${calculationId}`} onClick={() => { setExpanded(!expanded); if (!expanded && !listing && !busy) void load(); }}><Folder size={16} aria-hidden="true" /><strong>Archivos y Drive</strong><ChevronDown className={styles.chevron} size={16} aria-hidden="true" /></button>}{expanded && linked ? <button type="button" className="ghost-button" disabled={busy} onClick={() => void load(listing?.folder.id)} aria-label="Actualizar archivos"><RefreshCw size={15} /></button> : null}</div>
      <div id={`study-files-${calculationId}`} hidden={!expanded}>
      {!linked ? <p>Este cálculo no está vinculado con Odoo. Abre el análisis desde su proyecto de origen para consultar los adjuntos y la carpeta del estudio.</p> : <><strong className="source-section-label">Carpeta financiera de Drive</strong>
      <nav className={styles.trail} aria-label="Carpeta del estudio">{trail.map((folder, index) => <button type="button" key={folder.id} disabled={busy || index === trail.length - 1} onClick={() => void load(folder.id, undefined, false, trail.slice(0, index + 1))}>{folder.name}{index < trail.length - 1 ? " /" : ""}</button>)}</nav>
      {error ? <p role="status">{error}</p> : null}
      {busy && !listing ? <p role="status">Consultando archivos…</p> : null}
      <div className={styles.files} aria-busy={busy}>{listing?.files.map((file) => <button type="button" key={file.id} disabled={busy} className={styles.file} onClick={(event) => file.mimeType === FOLDER ? void load(file.id, undefined, false, [...trail, { id: file.id, name: file.name }]) : void open(file, event.currentTarget)}>
        {file.mimeType === FOLDER ? <Folder size={17} /> : <FileText size={17} />}<span>{file.name}</span><small>{file.mimeType === FOLDER ? "Carpeta" : file.size ? `${Math.ceil(Number(file.size) / 1024)} KB` : "Ver archivo"}</small>
      </button>)}</div>
      {listing && !listing.files.length && !busy ? <p>Esta carpeta está vacía.</p> : null}
      {listing?.nextPage ? <button className="ghost-button" type="button" disabled={busy} onClick={() => void load(listing.folder.id, listing.nextPage, true)}>Ver más archivos</button> : null}
      </>}
      {expanded && linked ? <OdooAttachments key={calculationId} calculationId={calculationId} /> : null}
      </div>
    </section>
    {selected ? <dialog ref={dialog} className={styles.dialog} aria-label={`Vista previa: ${selected.name}`} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <header className={styles.viewerHeading}><strong>{selected.name}</strong><a className="ghost-button" href={`https://drive.google.com/open?id=${encodeURIComponent(selected.id)}`} target="_blank" rel="noreferrer" title="Abrir el archivo original en Google Drive"><ExternalLink size={16} aria-hidden="true" /> Abrir en Drive</a><button type="button" className="ghost-button" aria-label="Cerrar visor" onClick={close}><X size={22} /></button></header>
      <div className={styles.content}>
        {previewError ? <p role="alert">{previewError}</p> : !preview ? <p role="status">Abriendo archivo…</p> : null}
        {preview?.kind === "image" ? <><div className={styles.sheetTools}><button type="button" className="ghost-button" aria-label="Reducir imagen" disabled={imageZoom <= .5} onClick={() => setImageZoom(imageZoom - .25)}>−</button><span>{Math.round(imageZoom * 100)} %</span><button type="button" className="ghost-button" aria-label="Ampliar imagen" disabled={imageZoom >= 3} onClick={() => setImageZoom(imageZoom + .25)}>+</button></div><div className={styles.image}><img alt={selected.name} src={preview.url} style={{ width: imageZoom === 1 ? undefined : `${imageZoom * 100}%`, maxWidth: imageZoom === 1 ? "100%" : "none", maxHeight: imageZoom === 1 ? "100%" : "none" }} onError={() => setPreviewError("El navegador no pudo mostrar esta imagen.")} /></div></> : null}
        {preview?.kind === "pdf" ? <iframe title={selected.name} sandbox="allow-scripts allow-same-origin allow-downloads" src={`/web/static/lib/pdfjs/web/viewer.html?file=${encodeURIComponent(preview.url)}`} onLoad={(event) => bindPdfEscape(event.currentTarget)} /> : null}
        {preview?.kind === "word" ? <article className={styles.word}><p className={styles.notice}>{preview.note}</p>{preview.blocks.map((block, index) => block.type === "paragraph" ? <p key={index}>{block.text || "\u00a0"}</p> : block.type === "image" ? <img key={index} src={block.source} alt={block.alt} /> : <div className={styles.tableScroll} key={index}><table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>)}</article> : null}
        {currentSheet ? <div className={styles.excel}><div className={styles.sheetTools}><label>Hoja <select aria-label="Hoja del Excel" value={sheetIndex} onChange={(event) => { setSheetIndex(Number(event.target.value)); setRowPage(0); }}>{preview?.kind === "excel" ? preview.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>) : null}</select></label><small>Valores guardados en el archivo; las fórmulas no se ejecutan.</small></div><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Contenido del Excel"><table><tbody>{currentSheet.rows.slice(rowPage * 100, rowPage * 100 + 100).map((row, r) => <tr key={r}><th scope="row">{rowPage * 100 + r + 1}</th>{row.map((cell, c) => <td key={c}>{String(cell)}</td>)}</tr>)}</tbody></table></div><div className={styles.sheetTools}><button type="button" className="ghost-button" disabled={!rowPage} onClick={() => setRowPage(rowPage - 1)}>Anterior</button><span>Filas {currentSheet.rows.length ? rowPage * 100 + 1 : 0}–{Math.min(currentSheet.rows.length, rowPage * 100 + 100)} de {currentSheet.rows.length}</span><button type="button" className="ghost-button" disabled={(rowPage + 1) * 100 >= currentSheet.rows.length} onClick={() => setRowPage(rowPage + 1)}>Siguiente</button></div></div> : null}
      </div>
    </dialog> : null}
  </>;
}
