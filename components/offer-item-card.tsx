import React from "react";
import type { OfferPresentationRow } from "../lib/financial-engine";
import { formatCop, formatPercent } from "../lib/financial-engine";

/** Misma fila calculada que Excel/PC; sólo cambia la presentación. */
export function OfferItemCard({ row, itemLabel, quantityAssumed, provisionalUtility, statusLabel }: {
  row: OfferPresentationRow; itemLabel: string; quantityAssumed: boolean;
  provisionalUtility: number | null; statusLabel: string;
}) {
  const money = (value: number | null) => value === null ? "Pendiente" : formatCop(value);
  const utility = provisionalUtility ?? row.utilityValue;
  const field = (label: string, value: string, danger = false) => <div className={danger ? "metric-danger" : ""} key={label}><dt>{label}</dt><dd>{value}</dd></div>;
  return <article className="offer-item-card" aria-label={`Ítem ${itemLabel}: ${row.description || "Sin descripción"}`}>
    <header><span>Ítem {itemLabel}</span><span className={`status-pill ${row.status}`}>{statusLabel}</span></header>
    <h3 className="offer-item-description">{row.description || "Sin descripción"}</h3>
    <h4>Oferta económica</h4>
    <dl className="offer-item-chips" aria-label="Campos de la oferta">
      {field("Cantidad", `${row.quantity === null ? "Pendiente" : row.quantity.toLocaleString("es-CO", { maximumFractionDigits: 20 })} ${row.unit}`)}
      {field("Unitario sin IVA", money(row.unitPriceWithoutVat))}
      {field("Total sin IVA", money(row.totalWithoutVat))}
      {field("IVA %", formatPercent(row.vatRatePct))}
      {field("IVA unitario", money(row.vatUnitValue))}
      {field("IVA total", money(row.totalVatValue))}
      {field("Unitario con IVA", money(row.unitPriceWithVat))}
      {field("Total con IVA", money(row.totalWithVat))}
    </dl>
    {quantityAssumed ? <p className="offer-item-notice">Asumida · confirmar pliego</p> : null}
    <details className="offer-item-details">
      <summary aria-label={`Ver detalles del ítem ${itemLabel}`}>Ver detalles</summary>
      <p className="offer-item-full-description">{row.description || "Sin descripción"}</p>
      <h4>Análisis interno</h4><dl className="offer-item-chips" aria-label="Campos del análisis interno">
      {field("Techo unitario", money(row.referenceUnit))}
      {field("Techo total", money(row.referenceTotal))}
      {field("Diferencia vs. techo", money(row.differenceVsReferenceTotal), row.differenceVsReferenceTotal !== null && row.differenceVsReferenceTotal < 0)}
      {field("Costo unitario", money(row.costUnit))}
      {field("Costo total", money(row.costTotal))}
      {field(provisionalUtility !== null ? "Utilidad provisional" : "Utilidad", money(utility), utility !== null && utility < 0)}
      {field("Margen sobre costo", row.marginPctOnCost === null ? "Pendiente" : formatPercent(row.marginPctOnCost), row.marginPctOnCost !== null && row.marginPctOnCost < 0)}
    </dl>{provisionalUtility !== null ? <p className="offer-item-notice">Antes de los costos asociados pendientes.</p> : null}
    </details>
    {row.warnings.length ? <ul className="offer-item-warnings">{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
  </article>;
}
