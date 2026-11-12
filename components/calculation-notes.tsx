"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";

import { appPath } from "@offer/lib/base-path";
import type { FinancialOfferNotesDocument } from "@offer/lib/contract";

import { OdooSourceNotes } from "./odoo-source-notes";

type SaveState = "idle" | "saving" | "saved" | "error";
const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

function toDocument(value: FinancialOfferNotesDocument): JSONContent {
  return value as JSONContent;
}

async function compressImage(file: File): Promise<File> {
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("La imagen supera 15 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No pude preparar la imagen.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
  if (!blob) throw new Error("No pude comprimir la imagen.");
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("La imagen comprimida sigue siendo demasiado pesada.");
  return new File([blob], (file.name.replace(/\.[^.]+$/, "") || "imagen") + ".jpg", { type: "image/jpeg" });
}

export function CalculationNotes(props: { embedded?: boolean; linkedToOdoo?: boolean; calculationId: string; initialDocument: FinancialOfferNotesDocument }) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(!!props.embedded);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  const saveDocument = useCallback(async (document: JSONContent) => {
    setSaveState("saving");
    try {
      const response = await fetch(appPath("/api/projects/" + props.calculationId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notesDocument: document }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No pude guardar las notas.");
      setSaveState("saved");
      window.setTimeout(() => setSaveState((current) => (current === "saved" ? "idle" : current)), 1800);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "No pude guardar las notas.");
    }
  }, [props.calculationId]);

  const queueSave = useCallback((document: JSONContent) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveDocument(document), 900);
  }, [saveDocument]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: true }), Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, Image.configure({ allowBase64: false })],
    content: toDocument(props.initialDocument),
    editorProps: { attributes: { class: "calculation-notes-editor", "aria-label": "Notas del analisis" } },
    onUpdate: ({ editor: nextEditor }) => {
      setMessage("");
      queueSave(nextEditor.getJSON());
    },
  });

  const uploadImage = useCallback(async (sourceFile: File) => {
    const activeEditor = editor;
    if (!activeEditor) return;
    setMessage("Comprimiendo imagen...");
    try {
      const file = await compressImage(sourceFile);
      setMessage("Subiendo imagen comprimida...");
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(appPath("/api/projects/" + props.calculationId + "/notes-assets"), { method: "POST", body: formData });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "No pude subir la imagen.");
      activeEditor!.chain().focus().setImage({ src: data.url, alt: sourceFile.name }).run();
      setMessage("Imagen optimizada y agregada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude agregar la imagen.");
    }
  }, [editor, props.calculationId]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const activeEditor = editor;
  if (!activeEditor) return null;

  function addLink() {
    const href = window.prompt("Pega el enlace");
    if (!href) return;
    const normalized = /^https?:\/\//i.test(href) ? href : "https://" + href;
    activeEditor!.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
  }

  return (
    <section className={"calculation-notes " + (open ? "is-open" : "")}>
      {!props.embedded ? <button className="calculation-notes-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="notes-toggle-marker" aria-hidden="true">{open ? "-" : "+"}</span>
        <span><strong>Notas</strong> <small>Odoo y este análisis</small></span>
        <em>{saveState === "saving" ? "Guardando..." : saveState === "saved" ? "Guardado" : ""}</em>
      </button> : <div className="context-notes-heading"><strong>Notas</strong><span role="status">{saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Guardado" : ""}</span></div>}
      {open ? (
        <div className="calculation-notes-body">
          <OdooSourceNotes key={props.calculationId} calculationId={props.calculationId} linked={!!props.linkedToOdoo} />
          <strong className="analysis-notes-label">Notas de este análisis</strong>
          <div className="notes-toolbar" role="toolbar" aria-label="Formato de notas">
            <button className={editor.isActive("bold") ? "active" : ""} type="button" onClick={() => editor.chain().focus().toggleBold().run()} title="Negrilla"><b>B</b></button>
            <button className={editor.isActive("italic") ? "active" : ""} type="button" onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva"><i>I</i></button>
            <button className={editor.isActive("heading", { level: 2 }) ? "active" : ""} type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Titulo">Titulo</button>
            <button className={editor.isActive("bulletList") ? "active" : ""} type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">Lista</button>
            <button className={editor.isActive("orderedList") ? "active" : ""} type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">1.</button>
            <button type="button" onClick={addLink} title="Agregar enlace">Enlace</button>
            <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Agregar tabla">Tabla</button>
            <button type="button" onClick={() => uploadInputRef.current?.click()} title="Agregar imagen">Imagen</button>
            <span className="notes-toolbar-spacer" />
            <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Deshacer">Deshacer</button>
            <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Rehacer">Rehacer</button>
          </div>
          <EditorContent editor={editor} />
          <input ref={uploadInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file);
            event.target.value = "";
          }} />
          {message ? <div className={"notes-footer " + (saveState === "error" ? "error" : "")}><span>{message}</span></div> : null}
        </div>
      ) : null}
    </section>
  );
}
