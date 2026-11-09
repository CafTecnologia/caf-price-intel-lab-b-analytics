"use client";

import { originalForItem } from "../lib/offer-presentation";
import React, { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { QuickCostEditor } from "./quick-cost-editor";
import { TechnicalAnnexViewer } from "./technical-annex-viewer";
import type { AdditionalCostCategory, FinancialItemAdditionalCost, FinancialOfferItem } from "../lib/contract";
import { associatedCostNeedsReview, manualBaseCostInputForRow, provisionalUtilityForRow, type SimulationRow } from "../lib/financial-engine";

function Fold(props: { compact: boolean; title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <details key={props.compact ? "compact" : "wide"} className={`unified-fold ${props.className ?? ""}`} open={!props.compact}>
      <summary aria-label={[props.title, props.hint].filter(Boolean).join(" · ")}><span className="unified-fold-label">{props.title}<small className="unified-fold-hint">{props.hint}</small></span><span className="unified-fold-chevron" aria-hidden="true">⌄</span></summary>
      {props.children}
    </details>
  );
}

function PrimarySection(props: { title: string; className: string; preview: React.ReactNode; children: React.ReactNode }) {
  return <details className={`unified-primary-section ${props.className}`}>
    <summary><span className="unified-primary-title">{props.title}<span aria-hidden="true">⌄</span></span><span className="unified-primary-preview">{props.preview}</span></summary>
    <div className="unified-primary-content">{props.children}</div>
  </details>;
}

// En el detalle se muestran los valores exactos (con centavos).
function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Pendiente"
    : new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value);
}

function webHref(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function domainOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

const categoryLabels: Record<AdditionalCostCategory, string> = {
  service: "Servicio",
  logistics: "Logística",
  other: "Otro",
};

// En PC (≥641px) el detalle usa la distribución de la v5 (27/10); en móvil sigue igual.
// Se decide antes de pintar para que no parpadee la versión móvil al abrir.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
function useDesktopLayout(forced?: boolean): boolean {
  const [desktop, setDesktop] = useState(false);
  useBeforePaint(() => {
    const query = window.matchMedia("(min-width: 641px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return forced ?? desktop;
}

// Ventana superpuesta del detalle en PC: Esc y las flechas la atienden a ella antes que a la tabla.
function DeskOverlay(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.stopImmediatePropagation();
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="unified-desk-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="unified-desk-window" role="dialog" aria-modal="true" aria-label={props.title}>
        <header><strong>{props.title}</strong><button type="button" onClick={onClose} aria-label="Cerrar ventana">×</button></header>
        <div className="unified-desk-window-body">{props.children}</div>
      </div>
    </div>
  );
}

function perUnit(total: number | null | undefined, quantity: number | null): number | null {
  return total === null || total === undefined || quantity === null || quantity <= 0 ? null : total / quantity;
}

// Margen = resultado ÷ oferta, con un decimal.
function marginOf(result: number | null, offer: number | null): string {
  if (result === null || offer === null || offer === 0) return "–";
  const pct = (result / offer) * 100;
  if (pct !== 0 && Math.abs(pct) < 0.05) return "<0,1 %";
  return `${new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pct).replace("-", "−")} %`;
}

// Con cantidad 1 el unitario es el total: un solo valor.
export function unitAndTotal(unit: number | null, total: number | null, quantity: number | null): string {
  if (quantity === 1 || unit === null || total === null) return money(total ?? unit);
  return `${money(unit)} c/u · ${money(total)}`;
}

export function UnifiedItemDetail(props: {
  item: FinancialOfferItem;
  row: SimulationRow;
  index: number;
  count: number;
  onClose: () => void;
  onEdit: () => void;
  onAddCost: () => void;
  onSetManualCost: (amount: number) => void;
  onSetAdditionalCost: (costIndex: number, amount: number) => void;
  onUpdateAdditionalCost: (costIndex: number, patch: Partial<FinancialItemAdditionalCost>) => void;
  onRemoveAdditionalCost: (costIndex: number) => void;
  onNavigate: (index: number) => void;
  onAdjustOffer?: () => void;
  desktop?: boolean;
}) {
  const { item, row, index } = props;
  const desktop = useDesktopLayout(props.desktop);
  const quantity = item.quantity;
  const costCount = item.additionalCosts?.length ?? 0;
  const literal = item.dataOrganization?.original_capture === "literal" ? item.dataOrganization.original_row : undefined;
  const original = originalForItem(item);
  const hasOriginal = Boolean(literal || (original && Object.values(original).some((value) => value.trim())));
  const provisionalUtility = provisionalUtilityForRow(row);
  const [quickCostId, setQuickCostId] = useState<string | null>(null);
  const [deskPanel, setDeskPanel] = useState<string | null>(null);
  useEffect(() => setDeskPanel(null), [index]);
  const [editingCost, setEditingCost] = useState<FinancialItemAdditionalCost | null>(null);
  const [editingCostIndex, setEditingCostIndex] = useState<number | null>(null);
  const compact = true;
  const sourceCount = row.costBreakdown.sources.length;
  const productUnit = row.productCostTotal !== null && row.quantity !== null && row.quantity > 0
    ? row.productCostTotal / row.quantity : null;
  const result = provisionalUtility ?? row.utilityValue;
  const resultLabel = result !== null && result < 0 ? "Pérdida bruta" : "Utilidad bruta";
  const resultIsPreliminary = row.hasPendingAssociatedCosts || item.costBasisStatus === "partial" || item.costBasisStatus === "comparable_scenario";

  const originalBody = (
    <>
      <p>{original?.document || "Documento sin identificar"}{original?.locator ? ` · ${original.locator}` : " · sin localizador; verificar en el expediente"}</p>
      <dl className="unified-input-fields">
        {literal ? literal.columns.map((cell) => <div key={cell.id} className="unified-input-main-field"><dt>{cell.header}</dt><dd>{cell.value === null ? "Celda vacía" : String(cell.value)}</dd></div>) : <>
{original?.description ? <div className="unified-input-main-field"><dt>Descripción original</dt><dd>{original.description}</dd></div> : null}
        {original?.technical_description ? <div className="unified-input-main-field"><dt>Ficha técnica original</dt><dd>{original.technical_description}</dd></div> : null}
        {original?.quantity ? <div><dt>Cantidad original</dt><dd>{original.quantity}</dd></div> : null}
        {original?.unit ? <div><dt>Unidad original</dt><dd>{original.unit}</dd></div> : null}
        {original?.ceiling_unit_price ? <div><dt>Techo original</dt><dd>{original.ceiling_unit_price}</dd></div> : null}
</>}
      </dl>
    </>
  );
  const originalSource = hasOriginal ? (
    <details className="unified-original-source">
      <summary>Ver transcripción y ubicación en el pliego</summary>
      {originalBody}
    </details>
  ) :<p className="unified-origin-warning">Origen documental no aportado para este ítem.</p>;
  const annex = item.technicalAnnex?.length ? <TechnicalAnnexViewer excerpts={item.technicalAnnex} itemName={item.description || `Ítem ${item.item}`} /> : null;
  const usedData = (
    <dl className="unified-input-fields">
      <div><dt>Ítem</dt><dd>{item.item || index + 1}</dd></div>
      <div className="unified-input-main-field"><dt>Descripción registrada</dt><dd>{item.description || "Sin descripción registrada."}</dd></div>
      {item.technicalDescription ? <div className="unified-input-main-field"><dt>Ficha técnica registrada</dt><dd>{item.technicalDescription}</dd></div> : null}
      <div><dt>Cantidad</dt><dd>{item.quantity === null ? "No indicada" : new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(item.quantity)}{row.quantityAssumed ? <small>El cálculo usa 1 unidad asumida.</small> : null}</dd></div>
      <div><dt>Unidad</dt><dd>{item.unit || "No indicada"}</dd></div>
      <div><dt>Techo unitario registrado</dt><dd>{item.referenceUnit == null ? "Sin techo unitario registrado" : `COP ${money(item.referenceUnit)}`}</dd></div>
    </dl>
  );
  const manualCostEditor = quickCostId === "manual" ? <QuickCostEditor label="Costo base del producto por unidad" value={manualBaseCostInputForRow(row)} explanation="Al guardar se usará como costo manual del producto; los servicios se suman aparte." onSave={(amount) => { props.onSetManualCost(amount); setQuickCostId(null); }} onCancel={() => setQuickCostId(null)} /> : null;
  const toggleManualCost = () => setQuickCostId((current) => current === "manual" ? null : "manual");
  const notes = <p className="unified-detail-note">{item.notes || "Sin notas de investigación registradas."}</p>;
  const sourceList = row.costBreakdown.sources.length ? (
    <div className="unified-source-list">
      {row.costBreakdown.sources.map((source, sourceIndex) => {
        const href = webHref(source.url);
        const chosen = item.selectedCostMode === "source" && item.selectedPriceSourceId === source.id;
        const showComparable = source.normalizedUnit !== null && (source.currency !== "COP" || source.unitPrice === null || Math.abs((source.unitPrice ?? 0) - source.normalizedUnit) >= 1);
        return (
          <div className={`unified-source-row ${chosen ? "is-chosen" : ""}`} key={source.id || sourceIndex}>
            <strong>{source.label || `Fuente ${sourceIndex + 1}`}{chosen ? <small>Elegida</small> : null}</strong>
            <span>{source.unitPrice === null || source.unitPrice <= 0 ? "Precio pendiente" : `${source.currency} ${money(source.unitPrice)}`}</span>
            {showComparable ? <span>Comparable: <b>COP {money(source.normalizedUnit)}</b></span> : <span />}
            {source.url ? <p>{href ? <a href={href} target="_blank" rel="noopener noreferrer" title={source.url}>Ver en {domainOf(href)} ↗</a> : source.url}</p> : null}
            {source.notes ? <p className="unified-source-notes">{source.notes}</p> : null}
            {source.warning ? <p className="unified-source-warning">{source.warning}</p> : null}
          </div>
        );
      })}
    </div>
  ) : <p>Sin fuentes registradas.</p>;
  const associatedList = costCount ? <ul className="unified-associated-list">
    {item.additionalCosts.map((cost, costIndex) => <li key={`${cost.id}-${costIndex}`}>
      <span><strong>{cost.name}</strong><small>{cost.mode === "per_unit" ? "Por unidad" : "Fijo"} · {categoryLabels[cost.category]}</small><small>{cost.reviewStatus === "suggested" ? "Sugerido · no sumado" : cost.reviewStatus === "excluded" ? "No aplica · no sumado" : "Aplicado al cálculo"}</small>{cost.notes ? <small>{cost.notes}</small> : null}</span>
      <div className="unified-associated-price"><b>{associatedCostNeedsReview(cost) ? `Sin valorar${cost.amount !== null ? ` · COP ${money(cost.amount)} registrado` : ""}` : `COP ${money(cost.amount)}`}</b>{(cost.reviewStatus ?? "included") !== "included" && <button type="button" onClick={() => props.onUpdateAdditionalCost(costIndex, { reviewStatus: "included" })}>Aplicar</button>}{cost.reviewStatus !== "excluded" && <button type="button" onClick={() => props.onUpdateAdditionalCost(costIndex, { reviewStatus: "excluded" })}>No aplica</button>}<button type="button" onClick={() => setQuickCostId((current) => current === `cost-${costIndex}` ? null : `cost-${costIndex}`)}>{associatedCostNeedsReview(cost) ? "Agregar precio" : "Editar precio"}</button><button type="button" onClick={() => { setEditingCost({ ...cost }); setEditingCostIndex(costIndex); }}>Editar datos</button><button type="button" className="unified-remove-cost" onClick={() => props.onRemoveAdditionalCost(costIndex)}>Eliminar</button></div>
      {quickCostId === `cost-${costIndex}` ? <QuickCostEditor label={`Precio de ${cost.name}`} value={cost.amount} explanation={cost.mode === "per_unit" ? "Se aplicará por cada unidad del ítem." : "Se sumará una sola vez a este ítem."} onSave={(amount) => { props.onSetAdditionalCost(costIndex, amount); setQuickCostId(null); }} onCancel={() => setQuickCostId(null)} /> : null}
      {editingCostIndex === costIndex && editingCost ? <div className="unified-associated-editor" role="group" aria-label={`Editar ${cost.name}`}>
        <label>Concepto<input value={editingCost.name} onChange={(event) => setEditingCost({ ...editingCost, name: event.target.value })} /></label>
        <label>Tipo<select value={editingCost.category} onChange={(event) => setEditingCost({ ...editingCost, category: event.target.value as AdditionalCostCategory })}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Aplicación<select value={editingCost.mode} onChange={(event) => setEditingCost({ ...editingCost, mode: event.target.value as FinancialItemAdditionalCost["mode"] })}><option value="per_unit">Por unidad</option><option value="fixed">Una vez</option></select></label>
        <label>Nota<input value={editingCost.notes} onChange={(event) => setEditingCost({ ...editingCost, notes: event.target.value })} /></label>
        <div className="unified-associated-editor-actions"><button type="button" onClick={() => { if (editingCost.name.trim()) props.onUpdateAdditionalCost(costIndex, { name: editingCost.name.trim(), category: editingCost.category, mode: editingCost.mode, notes: editingCost.notes }); setEditingCost(null); setEditingCostIndex(null); }}>Guardar</button><button type="button" onClick={() => { setEditingCost(null); setEditingCostIndex(null); }}>Cancelar</button></div>
      </div> : null}
    </li>)}
  </ul> : <p>Sin costos asociados separados.</p>;
  const detailActions = (
    <div className="unified-detail-actions">
      <button type="button" onClick={props.onAddCost}>+ Añadir costo al ítem</button>
      <button type="button" onClick={props.onEdit}>Editar datos, fuentes y costos</button>
    </div>
  );

  if (desktop) {
    const qty = row.quantity;
    const included = (item.additionalCosts ?? []).filter((cost) => (cost.reviewStatus ?? "included") === "included");
    const signals = (item.additionalCosts ?? []).filter((cost) => cost.reviewStatus === "suggested" || ((cost.reviewStatus ?? "included") === "included" && associatedCostNeedsReview(cost))).length;
    const usedCost = row.costTotal ?? row.knownCostTotal;
    const marketTotal = row.baseCostUnit !== null && qty !== null ? row.baseCostUnit * qty : null;
    const ofCeiling = (value: number | null) => value !== null && row.referenceTotal ? `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format((value / row.referenceTotal) * 100)} % del techo` : "";
    // Proveedor a la vista: dominio de la página o, sin enlace, el nombre registrado de la fuente.
    const sources = row.costBreakdown.sources;
    const providerOf = (source: (typeof sources)[number]) => { const href = source.url ? webHref(source.url) : null; return href ? domainOf(href) : source.label || ""; };
    const chosenSource = row.costModeUsed === "source" ? sources.find((source) => source.id === item.selectedPriceSourceId) : undefined;
    // Fuente que define el costo: la elegida o, si no, la de precio más cercano al costo usado.
    const productHref = (source: (typeof sources)[number] | undefined) => { const href = webHref(source?.url); return href && new URL(href).pathname.length > 1 ? href : null; };
    const definingSource = chosenSource ?? [...sources].sort((a, b) => (productHref(a) ? 0 : 1) - (productHref(b) ? 0 : 1) || Math.abs((a.normalizedUnit ?? Infinity) - (row.baseCostUnit ?? 0)) - Math.abs((b.normalizedUnit ?? Infinity) - (row.baseCostUnit ?? 0)))[0];
    const providerText = definingSource ? `${providerOf(definingSource)}${!chosenSource && sources.length > 1 ? ` +${sources.length - 1}` : ""}` : "";
    const providerTitle = sources.map(providerOf).filter(Boolean).join(" · ");
    // El proveedor a la vista lleva a la URL que usó esa fuente; si solo guardó la portada, a la portada.
    const providerHref = webHref(definingSource?.url);
    // Cómo sale el costo: de dónde viene el precio base y qué se le suma.
    const manualBasis = row.costModeUsed === "manual" || row.costModeUsed === "manual_priority";
    const statistic: Record<string, string> = { optimistic: "mínimo", moderate: "promedio", weighted: "moderado" };
    const basisNote = manualBasis ? (item.manualCostAssumption ? "supuesto desde techo" : "")
      : row.baseCostUnit === null ? "pendiente"
      : chosenSource ? `cotización · ${providerText}`
      : sourceCount === 1 ? `1 fuente · ${providerText}`
      : sourceCount > 1 ? `${statistic[row.costModeUsed] ?? row.costSourceLabel.replace(/^Criterio aceptado: /, "")} de ${sourceCount} fuentes`
      : "";
    const productDelta = row.productCostTotal !== null && marketTotal !== null ? row.productCostTotal - marketTotal : null;
    const valued = included.filter((cost) => !associatedCostNeedsReview(cost)).length;
    const unvalued = included.length - valued;
    const suggested = (item.additionalCosts ?? []).filter((cost) => cost.reviewStatus === "suggested").length;
    const associatedNote = [valued ? `${valued} ${valued === 1 ? "sumado" : "sumados"}` : "", unvalued ? `${unvalued} sin valorar` : "", suggested ? `${suggested} ${suggested === 1 ? "sugerido" : "sugeridos"} sin sumar` : ""].filter(Boolean).join(" · ") || "ninguno aplica";
    const associatedMissing = !row.additionalCostTotal && unvalued > 0;
    const resultSign = result === null || result === 0 ? "" : result > 0 ? "is-pos" : "is-neg";
    const signed = (value: number | null) => value !== null && value < 0 ? `−${money(-value)}` : money(value);
    const spec = (literal ? original?.description : null) || item.technicalDescription || item.description || "";
    const panels: Record<string, { title: string; body: ReactNode }> = {
      spec: { title: "Especificación del ítem", body: <p className="unified-desk-pre">{spec}</p> },
      original: { title: "Transcripción y ubicación en el pliego", body: originalBody },
      annex: { title: "Anexo técnico", body: annex },
      used: { title: "Datos usados en el cálculo", body: usedData },
      sources: { title: `Fuentes de precio por unidad · ${sourceCount}`, body: sourceList },
      notes: { title: "Notas de investigación", body: notes },
      associated: { title: `Costos asociados · ${costCount ? `${included.length} de ${costCount} incluidos` : "ninguno"}`, body: <>{associatedList}<div className="unified-detail-actions"><button type="button" onClick={props.onAddCost}>+ Añadir costo al ítem</button></div></> },
    };
    // Decisión del ítem: costo, oferta y asociados con su estado y su acción; lo pendiente primero.
    const costPending = usedCost === null || row.baseCostUnit === null;
    const offerPending = row.offerTotal === null;
    const associatedPending = signals > 0 || associatedMissing;
    const decisionRows = [
      { key: "cost", label: "Costo", pending: costPending, state: costPending ? "Sin costo definido" : `${money(usedCost)}${basisNote ? ` · ${basisNote}` : manualBasis ? " · manual" : ""}`,
        action: <button type="button" className={costPending ? "is-primary" : undefined} aria-expanded={quickCostId === "manual"} onClick={toggleManualCost}>{costPending ? "Definir costo" : "Editar costo"}</button> },
      { key: "offer", label: "Oferta", pending: offerPending, state: offerPending ? "Sin oferta" : `${money(row.offerTotal)}${ofCeiling(row.offerTotal) ? ` · ${ofCeiling(row.offerTotal)}` : ""}`,
        action: props.onAdjustOffer ? <button type="button" className={offerPending ? "is-primary" : undefined} onClick={props.onAdjustOffer}>Ajustar oferta</button> : <span /> },
      { key: "associated", label: "Asociados", pending: associatedPending, state: costCount ? `${associatedNote}${signals ? ` · ${signals} ${signals === 1 ? "señal" : "señales"}` : ""}` : "Sin costos asociados",
        action: costCount ? <button type="button" className={associatedPending ? "is-primary" : undefined} onClick={() => open("associated")}>{associatedPending ? "Revisar" : "Ver"}</button> : <button type="button" onClick={props.onAddCost}>+ Añadir</button> },
    ].sort((a, b) => Number(b.pending) - Number(a.pending));
    const panel = deskPanel ? panels[deskPanel] : null;
    const open = (key: string) => setDeskPanel(key);
    return (
      <section className="unified-item-detail is-desk" aria-label={`Detalle del ítem ${item.item || index + 1}`}>
        <div className="unified-desk-nav">
          <button type="button" disabled={index === 0} onClick={() => props.onNavigate(index - 1)} aria-label="Ítem anterior">‹</button>
          <span className="unified-desk-title"><b>Ítem {index + 1} de {props.count}</b><small>{row.quantityAssumed ? "1 unidad asumida" : quantity !== null ? `${new Intl.NumberFormat("es-CO").format(quantity)} ${row.unit || "UND"}` : ""}{row.costTotal !== null && row.costModeUsed !== "weighted" ? ` · ${row.costSourceLabel}` : ""}</small></span>
          <button type="button" disabled={index >= props.count - 1} onClick={() => props.onNavigate(index + 1)} aria-label="Ítem siguiente">›</button>
          <span className="unified-desk-keys"><kbd>↑</kbd> <kbd>↓</kbd> cambiar · <kbd>Esc</kbd> cerrar</span>
          <button type="button" className="unified-desk-close" onClick={props.onClose}>Cerrar</button>
        </div>
        <div className="unified-desk-grid">
          <div className="unified-desk-main">
            <div className="unified-desk-two">
              <section className="unified-desk-sec unified-document-section">
                <h4>Documento original</h4>
                <div className="unified-desk-kv">
                  <span>Techo por unidad</span><span>{item.referenceUnit == null ? "Sin techo" : money(item.referenceUnit)}</span>
                  <span>Techo total</span><span>{row.referenceTotal == null ? "Sin techo" : money(row.referenceTotal)}</span>
                  <span>Cantidad</span><span>{row.quantityAssumed ? "1 asumida" : item.quantity === null ? "No indicada" : `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(item.quantity)} ${item.unit || "UND"}`}</span>
                </div>
                {spec ? <button type="button" className="unified-desk-spec" title="Ver especificación completa" onClick={() => open("spec")}>{spec}</button> : null}
                <div className="unified-desk-links">
                  {hasOriginal ? <button type="button" onClick={() => open("original")}>Transcripción ↗</button> : <span className="unified-origin-warning">Sin origen documental</span>}
                  {annex ? <button type="button" onClick={() => open("annex")}>Anexo ↗</button> : null}
                  <button type="button" onClick={() => open("used")}>Datos usados ↗</button>
                </div>
              </section>
              <section className="unified-desk-sec unified-market-section">
                <h4>Investigación de mercado</h4>
                <div className="unified-desk-kv">
                  <span>Costo de mercado por unidad</span><span>{money(row.baseCostUnit)}</span>
                  <span>Costo de mercado total</span><span>{money(marketTotal)}</span>
                  <span>Fuentes</span><span className="unified-desk-provider" title={providerTitle || undefined}>{sourceCount}{providerText ? " · " : ` ${sourceCount === 1 ? "fuente" : "fuentes"}`}{providerText && providerHref ? <a href={providerHref} target="_blank" rel="noopener noreferrer">{providerText}</a> : providerText}</span>
                </div>
                <div className="unified-desk-links">
                  <button type="button" onClick={() => open("sources")}>Fuentes · {sourceCount} ↗</button>
                  <button type="button" onClick={() => open("notes")}>{item.notes ? "Notas ↗" : "Sin notas"}</button>
                </div>
              </section>
            </div>
            <section className="unified-desk-sec unified-desk-associated">
              <button type="button" className="unified-desk-fold" onClick={() => open("associated")}>
                <b>Costos asociados</b>
                <span>{costCount ? `${included.length} de ${costCount} incluidos` : "Sin costos asociados"}</span>
                <span>{row.additionalCostTotal ? <>{money(perUnit(row.additionalCostTotal, qty))} /u · <strong>{money(row.additionalCostTotal)}</strong></> : null}</span>
                <span className="unified-desk-flag">{signals ? `${signals} ${signals === 1 ? "señal" : "señales"}` : row.hasPendingAssociatedCosts ? "Sin valorar" : ""}</span>
              </button>
            </section>
          </div>
          <section className="unified-desk-sec unified-results-section">
            <h4>Resultados · exacto al peso{resultIsPreliminary ? <small> · Provisional</small> : null}</h4>
            {item.costBasisStatus === "comparable_scenario" ? <p className="unified-basis-notice">El costo sale de un producto comparable, no del mismo ítem del pliego (no homologado).</p> : null}
            <div className="unified-decision" role="group" aria-label="Decisión del ítem">
              <b className="unified-decision-title">Decisión del ítem</b>
              {decisionRows.map((entry) => (
                <div className={`unified-decision-row ${entry.pending ? "is-pending" : "is-done"}`} key={entry.key}>
                  <span className="unified-decision-label">{entry.label}</span>
                  <span className="unified-decision-state">{entry.state}</span>
                  {entry.action}
                </div>
              ))}
            </div>
            {manualCostEditor}
            <table className="unified-desk-steps">
              <thead><tr><th>Cómo sale el costo</th><th>Por unidad</th><th>Total{qty !== null && qty !== 1 ? ` (${new Intl.NumberFormat("es-CO").format(qty)})` : ""}</th><th></th></tr></thead>
              <tbody>
                <tr><td>{manualBasis ? "Costo manual" : "Costo de mercado"}{basisNote ? <small title={providerTitle || undefined}> {basisNote}</small> : null}</td><td>{money(row.baseCostUnit)}</td><td>{money(marketTotal)}</td><td></td></tr>
                {productDelta ? <tr><td>{productDelta < 0 ? "− Descuento de escenario" : "+ Ajuste de escenario"}{row.costScenarioDiscountPct ? <small> {money(row.costScenarioDiscountPct)} %</small> : null}</td><td>{signed(perUnit(productDelta, qty))}</td><td>{signed(productDelta)}</td><td></td></tr> : null}
                {costCount ? <tr className={associatedMissing ? "is-missing" : undefined}><td>+ Costos asociados<small> {associatedNote}</small></td><td>{associatedMissing ? "–" : money(perUnit(row.additionalCostTotal, qty))}</td><td>{associatedMissing ? "sin valorar" : money(row.additionalCostTotal)}</td><td></td></tr> : null}
                <tr className="unified-desk-gap" aria-hidden="true"><td colSpan={4}></td></tr>
                <tr className="is-used"><td>= Costo usado</td><td>{money(perUnit(usedCost, qty))}</td><td>{money(usedCost)}</td><td><small>{ofCeiling(usedCost)}</small></td></tr>
                <tr className="is-offer"><td>Oferta</td><td>{money(row.offerUnit)}</td><td>{money(row.offerTotal)}</td><td><small>{ofCeiling(row.offerTotal)}</small></td></tr>
                <tr className={`is-result ${resultSign}`}><td>{resultLabel}</td><td>{signed(perUnit(result, qty))}</td><td>{signed(result)}</td><td>{marginOf(result, row.offerTotal)} margen</td></tr>
              </tbody>
            </table>
            <div className="unified-desk-acts">
              <button type="button" onClick={props.onEdit}>Editar datos, fuentes y costos</button>
            </div>
          </section>
        </div>
        {panel ? <DeskOverlay title={panel.title} onClose={() => setDeskPanel(null)}>{panel.body}</DeskOverlay> : null}
      </section>
    );
  }

  return (
    <section className="unified-item-detail" aria-label={`Detalle del ítem ${item.item || index + 1}`}>
      <div className="unified-detail-heading">
        <div className="unified-detail-identity"><strong>{item.description || "Sin descripción registrada"}</strong><small>Ítem {index + 1} de {props.count}{row.quantityAssumed ? " · 1 unidad asumida" : quantity !== null && quantity !== 1 ? ` · ${new Intl.NumberFormat("es-CO").format(quantity)} ${row.unit || "UND"}` : ""}{row.costTotal !== null && row.costModeUsed !== "weighted" ? ` · ${row.costSourceLabel}` : ""}</small></div>
        <div className="unified-detail-navigation">
          <button type="button" disabled={index === 0} onClick={() => props.onNavigate(index - 1)}>Anterior</button>
          <button type="button" disabled={index >= props.count - 1} onClick={() => props.onNavigate(index + 1)}>Siguiente</button>
          <button type="button" onClick={props.onClose}>Plegar</button>
        </div>
      </div>

      <div className="unified-detail-evidence">
        <PrimarySection title="Documento original" className="unified-document-section" preview={<><span>{original?.document || "Documento no identificado"}</span><span>{original?.quantity ? `${original.quantity} ${original.unit || "unidades"}` : "Cantidad no aportada"}{original?.ceiling_unit_price ? ` · Techo ${original.ceiling_unit_price}` : ""}</span></>}>
          {hasOriginal ? (
            <details className="unified-original-source">
              <summary>Ver transcripción y ubicación en el pliego</summary>
              <p>{original?.document || "Documento sin identificar"}{original?.locator ? ` · ${original.locator}` : " · sin localizador; verificar en el expediente"}</p>
              <dl className="unified-input-fields">
                {literal ? literal.columns.map((cell) => <div key={cell.id} className="unified-input-main-field"><dt>{cell.header}</dt><dd>{cell.value === null ? "Celda vacía" : String(cell.value)}</dd></div>) : <>
{original?.description ? <div className="unified-input-main-field"><dt>Descripción original</dt><dd>{original.description}</dd></div> : null}
                {original?.technical_description ? <div className="unified-input-main-field"><dt>Ficha técnica original</dt><dd>{original.technical_description}</dd></div> : null}
                {original?.quantity ? <div><dt>Cantidad original</dt><dd>{original.quantity}</dd></div> : null}
                {original?.unit ? <div><dt>Unidad original</dt><dd>{original.unit}</dd></div> : null}
                {original?.ceiling_unit_price ? <div><dt>Techo original</dt><dd>{original.ceiling_unit_price}</dd></div> : null}
</>}
              </dl>
            </details>
          ) : <p className="unified-origin-warning">Origen documental no aportado para este ítem.</p>}
          {item.technicalAnnex?.length ? <TechnicalAnnexViewer excerpts={item.technicalAnnex} itemName={item.description || `Ítem ${item.item}`} /> : null}
          <Fold compact={compact} className="unified-registered-fold" title="Datos usados en el cálculo" hint="Cantidad, unidad y techo">
          <dl className="unified-input-fields">
            <div><dt>Ítem</dt><dd>{item.item || index + 1}</dd></div>
            <div className="unified-input-main-field"><dt>Descripción registrada</dt><dd>{item.description || "Sin descripción registrada."}</dd></div>
            {item.technicalDescription ? <div className="unified-input-main-field"><dt>Ficha técnica registrada</dt><dd>{item.technicalDescription}</dd></div> : null}
            <div><dt>Cantidad</dt><dd>{item.quantity === null ? "No indicada" : new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(item.quantity)}{row.quantityAssumed ? <small>El cálculo usa 1 unidad asumida.</small> : null}</dd></div>
            <div><dt>Unidad</dt><dd>{item.unit || "No indicada"}</dd></div>
            <div><dt>Techo unitario registrado</dt><dd>{item.referenceUnit == null ? "Sin techo unitario registrado" : `COP ${money(item.referenceUnit)}`}</dd></div>
          </dl>
          </Fold>
        </PrimarySection>
        <PrimarySection title="Investigación de mercado" className="unified-market-section" preview={<><strong>COP {money(row.baseCostUnit)} <small>por unidad</small></strong><span>{sourceCount} {sourceCount === 1 ? "fuente" : "fuentes"}</span></>}>
          <div className="unified-working-cost">
            <div><small>Producto base · por unidad</small><strong>{money(row.baseCostUnit)}</strong><span>{row.costSourceLabel || "Costo pendiente"}</span>{row.costScenarioDiscountPct != null ? <span>Descuento de escenario: {money(row.costScenarioDiscountPct)} %</span> : null}</div>
            <button type="button" onClick={() => setQuickCostId((current) => current === "manual" ? null : "manual")}>Editar costo</button>
            {quickCostId === "manual" ? <QuickCostEditor label="Costo base del producto por unidad" value={manualBaseCostInputForRow(row)} explanation="Al guardar se usará como costo manual del producto; los servicios se suman aparte." onSave={(amount) => { props.onSetManualCost(amount); setQuickCostId(null); }} onCancel={() => setQuickCostId(null)} /> : null}
          </div>
          <Fold compact={compact} className="unified-research-block" title="Notas de investigación" hint={item.notes ? "Ver notas" : "Sin notas"}>
            <p className="unified-detail-note">{item.notes || "Sin notas de investigación registradas."}</p>
          </Fold>
          <Fold compact={compact} className="unified-research-block" title="Fuentes de precio por unidad" hint={`${sourceCount} ${sourceCount === 1 ? "fuente" : "fuentes"}`}>
            {row.costBreakdown.sources.length ? (
              <div className="unified-source-list">
                {row.costBreakdown.sources.map((source, sourceIndex) => {
                  const href = webHref(source.url);
                  const chosen = item.selectedCostMode === "source" && item.selectedPriceSourceId === source.id;
                  const showComparable = source.normalizedUnit !== null && (source.currency !== "COP" || source.unitPrice === null || Math.abs((source.unitPrice ?? 0) - source.normalizedUnit) >= 1);
                  return (
                    <div className={`unified-source-row ${chosen ? "is-chosen" : ""}`} key={source.id || sourceIndex}>
                      <strong>{source.label || `Fuente ${sourceIndex + 1}`}{chosen ? <small>Elegida</small> : null}</strong>
                      <span>{source.unitPrice === null || source.unitPrice <= 0 ? "Precio pendiente" : `${source.currency} ${money(source.unitPrice)}`}</span>
                      {showComparable ? <span>Comparable: <b>COP {money(source.normalizedUnit)}</b></span> : <span />}
                      {source.url ? <p>{href ? <a href={href} target="_blank" rel="noopener noreferrer" title={source.url}>Ver en {domainOf(href)} ↗</a> : source.url}</p> : null}
                      {source.notes ? <p className="unified-source-notes">{source.notes}</p> : null}
                      {source.warning ? <p className="unified-source-warning">{source.warning}</p> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p>Sin fuentes registradas.</p>}
          </Fold>
          <Fold compact={compact} className="unified-research-block" title="Servicios y costos asociados" hint={`${costCount} ${costCount === 1 ? "costo" : "costos"}`}>
            {costCount ? <ul className="unified-associated-list">
              {item.additionalCosts.map((cost, costIndex) => <li key={`${cost.id}-${costIndex}`}>
                <span><strong>{cost.name}</strong><small>{cost.mode === "per_unit" ? "Por unidad" : "Fijo"} · {categoryLabels[cost.category]}</small><small>{cost.reviewStatus === "suggested" ? "Sugerido · no sumado" : cost.reviewStatus === "excluded" ? "No aplica · no sumado" : "Aplicado al cálculo"}</small>{cost.notes ? <small>{cost.notes}</small> : null}</span>
                <div className="unified-associated-price"><b>{associatedCostNeedsReview(cost) ? `Sin valorar${cost.amount !== null ? ` · COP ${money(cost.amount)} registrado` : ""}` : `COP ${money(cost.amount)}`}</b>{(cost.reviewStatus ?? "included") !== "included" && <button type="button" onClick={() => props.onUpdateAdditionalCost(costIndex, { reviewStatus: "included" })}>Aplicar</button>}{cost.reviewStatus !== "excluded" && <button type="button" onClick={() => props.onUpdateAdditionalCost(costIndex, { reviewStatus: "excluded" })}>No aplica</button>}<button type="button" onClick={() => setQuickCostId((current) => current === `cost-${costIndex}` ? null : `cost-${costIndex}`)}>{associatedCostNeedsReview(cost) ? "Agregar precio" : "Editar precio"}</button><button type="button" onClick={() => { setEditingCost({ ...cost }); setEditingCostIndex(costIndex); }}>Editar datos</button><button type="button" className="unified-remove-cost" onClick={() => props.onRemoveAdditionalCost(costIndex)}>Eliminar</button></div>
                {quickCostId === `cost-${costIndex}` ? <QuickCostEditor label={`Precio de ${cost.name}`} value={cost.amount} explanation={cost.mode === "per_unit" ? "Se aplicará por cada unidad del ítem." : "Se sumará una sola vez a este ítem."} onSave={(amount) => { props.onSetAdditionalCost(costIndex, amount); setQuickCostId(null); }} onCancel={() => setQuickCostId(null)} /> : null}
                {editingCostIndex === costIndex && editingCost ? <div className="unified-associated-editor" role="group" aria-label={`Editar ${cost.name}`}>
                  <label>Concepto<input value={editingCost.name} onChange={(event) => setEditingCost({ ...editingCost, name: event.target.value })} /></label>
                  <label>Tipo<select value={editingCost.category} onChange={(event) => setEditingCost({ ...editingCost, category: event.target.value as AdditionalCostCategory })}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label>Aplicación<select value={editingCost.mode} onChange={(event) => setEditingCost({ ...editingCost, mode: event.target.value as FinancialItemAdditionalCost["mode"] })}><option value="per_unit">Por unidad</option><option value="fixed">Una vez</option></select></label>
                  <label>Nota<input value={editingCost.notes} onChange={(event) => setEditingCost({ ...editingCost, notes: event.target.value })} /></label>
                  <div className="unified-associated-editor-actions"><button type="button" onClick={() => { if (editingCost.name.trim()) props.onUpdateAdditionalCost(costIndex, { name: editingCost.name.trim(), category: editingCost.category, mode: editingCost.mode, notes: editingCost.notes }); setEditingCost(null); setEditingCostIndex(null); }}>Guardar</button><button type="button" onClick={() => { setEditingCost(null); setEditingCostIndex(null); }}>Cancelar</button></div>
                </div> : null}
              </li>)}
            </ul> : <p>Sin costos asociados separados.</p>}
          </Fold>
        </PrimarySection>
        <PrimarySection title="Resultados" className="unified-results-section" preview={<><span className="unified-preview-values"><span>Costo conocido <b>{money(row.knownCostTotal)}</b></span><span>Oferta <b>{money(row.offerTotal)}</b></span><span>{resultLabel} <b>{money(result)}</b></span></span><span>COP{resultIsPreliminary ? " · Provisional" : ""}</span></>}>
          <Fold compact title="Detalle de costos" hint={`COP ${money(row.knownCostTotal)}`}>
          <section className="unified-financial-section" aria-label="Costos del ítem">
          <h5 className="unified-totals-heading">Costos <small>COP</small></h5>
          <dl className="unified-research-totals unified-cost-breakdown" aria-label="Costos totales del ítem en pesos colombianos">
            <div><dt>Producto · total<small>{money(productUnit)} por unidad</small></dt><dd>{money(row.productCostTotal)}</dd></div>
            <div><dt>Costos asociados</dt><dd>{money(row.additionalCostTotal)}</dd></div>
            <div className="is-total"><dt>Costo conocido</dt><dd>{money(row.knownCostTotal)}</dd></div>
          </dl>
          {row.hasPendingAssociatedCosts ? <p className="unified-calculation-caution">Costos asociados sin valorar</p> : null}
          </section>
          </Fold>
          <section className="unified-financial-section unified-offer-section" aria-label="Oferta y utilidad del ítem">
          <h5 className="unified-totals-heading">Oferta y utilidad <small>COP</small></h5>
          <dl className="unified-research-totals unified-result-breakdown" aria-label="Resultado del ítem en pesos colombianos">
            <div><dt>Oferta · total</dt><dd>{money(row.offerTotal)}</dd></div>
            <div className={`is-total ${result !== null && result < 0 ? "is-loss" : ""}`}><dt>{resultLabel}{resultIsPreliminary ? <small>Provisional</small> : null}</dt><dd>{money(result)}</dd></div>
          </dl>
          </section>
        </PrimarySection>
      </div>

      <div className="unified-detail-actions">
        <button type="button" onClick={props.onAddCost}>+ Añadir costo al ítem</button>
        <button type="button" onClick={props.onEdit}>Editar datos, fuentes y costos</button>
      </div>
    </section>
  );
}
