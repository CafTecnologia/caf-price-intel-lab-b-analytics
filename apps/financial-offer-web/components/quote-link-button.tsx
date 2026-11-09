"use client";

import React, { useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import type { QuoteLink } from "@offer/lib/financial-engine";

export function QuoteLinkButton({ links }: { links: QuoteLink[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (links.length === 1) return (
    <a className="quote-link-button" href={links[0]!.href} target="_blank" rel="noopener noreferrer" title={`Abrir cotización: ${links[0]!.label}`} aria-label={`Abrir cotización: ${links[0]!.label}`} onClick={(event) => event.stopPropagation()}>
      <ExternalLink size={18} aria-hidden="true" />
    </a>
  );
  if (!links.length) return (
    <button className="quote-link-button" type="button" disabled title="Sin enlaces de cotización" aria-label="Sin enlaces de cotización">
      <ExternalLink size={18} aria-hidden="true" />
    </button>
  );
  return (
    <>
      <button className="quote-link-button" type="button" title={`Ver ${links.length} enlaces de cotización`} aria-label={`Ver ${links.length} enlaces de cotización`} onClick={(event) => { event.stopPropagation(); dialogRef.current?.showModal(); }}>
        <ExternalLink size={18} aria-hidden="true" />
      </button>
      <dialog ref={dialogRef} className="quote-links-dialog" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
        <div className="quote-links-heading">
          <strong>Enlaces de cotización</strong>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Cerrar enlaces"><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="quote-links-list">
          {links.map((link) => (
            <a key={`${link.label}-${link.href}`} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => dialogRef.current?.close()}>
              <span>{link.label}{!link.isBasis ? <small>Referencia</small> : null}</span>
              <ExternalLink size={17} aria-hidden="true" />
            </a>
          ))}
        </div>
      </dialog>
    </>
  );
}
