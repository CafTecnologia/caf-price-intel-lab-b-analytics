"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FinancialItemTechnicalAnnexExcerpt } from "../lib/contract";

export function annexPreviewText(excerpts: FinancialItemTechnicalAnnexExcerpt[], limit = 185): string {
  const section = excerpts.find((entry) => /(?:ÍTEM|ITEM)\s+\d/i.test(entry.text)) ?? excerpts[0];
  const text = (section?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

export function TechnicalAnnexViewer(props: {
  excerpts: FinancialItemTechnicalAnnexExcerpt[];
  itemName: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!props.excerpts.length) return null;

  return (
    <div className="technical-annex-viewer">
      <div className="technical-annex-preview">
        <div className="technical-annex-preview-heading">
          <strong>Ficha técnica anexa</strong>
          <span>{props.excerpts.length} {props.excerpts.length === 1 ? "fragmento" : "fragmentos"} del documento</span>
        </div>
        <p>{annexPreviewText(props.excerpts)}</p>
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Ver ficha completa</button>
      </div>
      {open && createPortal(
        <dialog
          ref={dialogRef}
          className="technical-annex-dialog"
          aria-label={`Ficha técnica anexa de ${props.itemName}`}
          onClose={() => setOpen(false)}
          onCancel={(event) => { event.stopPropagation(); setOpen(false); }}
          onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
        >
          <header className="technical-annex-dialog-head">
            <div><small>Texto íntegro del documento</small><h2>{props.itemName}</h2></div>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Cerrar ficha anexa">Cerrar</button>
          </header>
          <div className="technical-annex-dialog-body">
            {props.excerpts.map((entry, index) => (
              <section className="technical-annex-document" key={`${entry.document}-${entry.locator}-${index}`}>
                <h3>{entry.document}</h3>
                <small>{entry.locator}</small>
                <p>{entry.text}</p>
              </section>
            ))}
          </div>
        </dialog>,
        document.body,
      )}
    </div>
  );
}
