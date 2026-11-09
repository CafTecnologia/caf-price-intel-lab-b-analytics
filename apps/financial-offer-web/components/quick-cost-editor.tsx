"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoneyDraft } from "../lib/money-draft";

export function parseQuickCost(raw: string): number | null {
  const value = raw.trim().replace(/\s/g, "").replace(/^\$/, "");
  if (!/^\d[\d.,]*$/.test(value)) return null;
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  let normalized = value;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = value.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    normalized = value.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function QuickCostEditor(props: {
  label: string;
  value: number | null;
  explanation: string;
  onSave: (amount: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.value === null ? "" : new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(props.value));
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  return createPortal(
    <div className="quick-cost-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onCancel(); }}>
    <form className="quick-cost-editor" role="dialog" aria-modal="true" aria-label={props.label} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); props.onCancel(); } }}
      onSubmit={(event) => {
        event.preventDefault();
        const amount = parseQuickCost(draft);
        if (amount === null) { setError("Escribe un valor válido de cero o más."); return; }
        props.onSave(amount);
      }}>
      <strong>{props.label}</strong>
      <small>{props.explanation}</small>
      <label>Precio en COP
        <input ref={inputRef} inputMode="decimal" value={draft} onChange={(event) => { setDraft(formatMoneyDraft(event.target.value)); setError(""); }} placeholder="Ej. 450.000" aria-invalid={Boolean(error)} />
      </label>
      {error ? <span className="quick-cost-error" role="alert">{error}</span> : null}
      <div className="quick-cost-actions"><button type="button" onClick={props.onCancel}>Cancelar</button><button className="button" type="submit">Guardar precio</button></div>
    </form>
    </div>,
    document.body,
  );
}
