"use client";
import React from "react";
import type { OfferDisplay } from "../lib/offer-presentation";
export function OfferDisplayControls({ value, original, showItem, showUnit, notice, onChange }: {
  value: OfferDisplay; original: boolean; showItem: boolean; showUnit: boolean; notice: string; onChange: (patch: OfferDisplay) => void;
}) {
  return <details className="offer-display-controls"><summary>Presentación de la oferta</summary>
    <div className="offer-display-options">
      <label><input type="checkbox" checked={original} onChange={e => onChange({original:e.target.checked})} /> Usar campos originales</label>
      <label>Nombre y descripción <select aria-label="Nombre y descripción en la oferta" value={value.text ?? "auto"} onChange={e => onChange({text:e.target.value as OfferDisplay["text"]})}>
        <option value="auto">Como en el original</option><option value="combined">Juntos</option><option value="separate">Separados</option><option value="name">Solo nombre</option>
      </select></label>
      <label><input type="checkbox" checked={showItem} onChange={e => onChange({showItem:e.target.checked})} /> Mostrar ítem</label>
      <label><input type="checkbox" checked={showUnit} onChange={e => onChange({showUnit:e.target.checked})} /> Mostrar unidad</label>
    </div><p>{notice} Esta presentación se guarda y se usa también en el Excel.</p>
  </details>;
}
