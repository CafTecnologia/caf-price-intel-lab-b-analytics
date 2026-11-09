import React from "react";
import type { FinancialOfferItem } from "../lib/contract";

export function OriginalRowDetail({item}: {item: FinancialOfferItem}) {
  const data = item.dataOrganization;
  if (!data) return null;
  const row = data.original_row;
  const fieldLabels = {item:"Ítem",name:"Nombre",description:"Descripción",quantity:"Cantidad",unit:"Unidad",ceiling_unit_price:"Techo unitario"};
  if (!row) return <p className="unified-detail-note">Entrega antigua: se conservan los campos originales recibidos. Los encabezados completos de la tabla no venían en el JSON.</p>;
  return <details className="unified-original-source">
    <summary>Ver fila con sus encabezados originales</summary>
    <p>{row.document} · {row.locator}</p>
    <dl className="unified-input-fields">{row.columns.map(c => <div key={c.id}>
      <dt style={{whiteSpace:"pre-wrap"}}>{c.header_path?.length ? c.header_path.join(" / ") + " / " : ""}{c.header}</dt>
      <dd style={{whiteSpace:"pre-wrap"}}>{c.value === null ? "Celda vacía" : String(c.value)}</dd>
    </div>)}</dl>
    {data.normalization.length ? <details><summary>Cómo se organizaron estos datos</summary>
      <ul>{data.normalization.map((m,i) => <li key={i}>{fieldLabels[m.field]} ← {m.column_ids.map(id => row.columns.find(c => c.id === id)?.header).join(" + ")}: {m.note}</li>)}</ul>
    </details> : null}
  </details>;
}
export function CompositionDetail({item}: {item: FinancialOfferItem}) {
  const parts = item.dataOrganization?.components;
  if (!parts) return null;
  return <details className="unified-fold unified-research-block">
    <summary><span className="unified-fold-label">Composición del entregable<small className="unified-fold-hint">{item.deliverableType === "service" ? "Servicio principal" : item.deliverableType === "product" ? "Producto principal" : "Concepto principal pendiente"}</small></span></summary>
    <p>Un solo entregable contractual. Las fuentes de precio siguen siendo alternativas del entregable completo.</p>
    {parts.length ? <ul className="unified-associated-list">{parts.map(c => {
      const cost = item.additionalCosts.find(cost => cost.id === c.additional_cost_id);
      return <li key={c.id}><span><strong>{c.name}</strong><small>{c.type === "service" ? "Servicio" : "Producto"} · {c.quantity_per_deliverable} por entregable · {c.relationship === "included" ? "Incluido" : c.relationship === "separate" ? "Separado" : "Por revisar"}</small>
        {c.factory_bundle ? <small>Conjunto de fábrica: {c.included_parts.join(", ")}</small> : null}
        <small>{c.reason}</small>
        {cost ? <small>Costo vinculado: {cost.name} · {cost.reviewStatus === "suggested" ? "Sugerido, no sumado" : cost.reviewStatus === "excluded" ? "Excluido, no sumado" : "Se aplica una sola vez por el cálculo existente"}</small> : c.relationship === "separate" ? <small>Sin costo independiente vinculado; esta descripción no añade importes.</small> : null}
      </span></li>;
    })}</ul> : <p>Esta entrega antigua no declaró componentes. Se conserva el entregable completo.</p>}
  </details>;
}
