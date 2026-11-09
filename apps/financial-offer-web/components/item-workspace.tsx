"use client";

import { groupedProcurementIndexes } from "@offer/lib/procurement-lots";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";

import type {
  AdditionalCostCategory,
  CostMode,
  FinancialGeneralCost,
  FinancialItemAdditionalCost,
  FinancialOfferItem,
  ItemCostMode,
} from "@offer/lib/contract";
import type { OfferControl, OfferMode, QuoteLink, SimulationRow } from "@offer/lib/financial-engine";
import { formatMoneyDraft } from "../lib/money-draft";
import { QuoteLinkButton } from "@offer/components/quote-link-button";

const categoryLabels: Record<AdditionalCostCategory, string> = {
  service: "Servicio",
  logistics: "Logística",
  other: "Otro",
};

const costModeLabels: Record<CostMode, string> = {
  optimistic: "Menor costo",
  moderate: "Costo medio",
  weighted: "Costo ponderado",
  manual: "Costo manual",
  source: "Cotización elegida",
};

function formatCop(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function PriceSummary(props: {
  label: string;
  unit: number | null;
  total: number | null;
  quantity: number | null;
  missing: string;
  context?: string;
}) {
  const pendingQuantity = props.quantity === null || props.quantity <= 0;
  const repeats = props.quantity === 1 && props.unit !== null && props.total !== null && Math.abs(props.unit - props.total) < 0.01;
  const main = props.unit === null && props.total === null ? props.missing : pendingQuantity ? "Cantidad pendiente" : props.total === null ? "Total pendiente" : formatCop(props.total);
  return (
    <span className="item-price-pair" title={props.unit !== null && props.total !== null ? `Unitario: ${formatCop(props.unit)} · Total: ${pendingQuantity ? "provisional" : formatCop(props.total)}` : props.missing}>
      <small>{props.label}</small>
      <strong>{main}</strong>
      <em>{props.unit === null ? props.total === null ? "" : "Unit. pendiente" : repeats ? "Unit. = total" : `Unit. ${formatCop(props.unit)}`}</em>
      {props.context && (props.unit !== null || props.total !== null) ? <small className="item-price-context">{props.context}</small> : null}
    </span>
  );
}

function parseLocaleNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(/\$/g, "").replace(/\./g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function CurrencyEditor(props: {
  value: number | null;
  onChange: (value: number | null) => void;
  ariaLabel: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(props.value === null ? "" : formatCop(props.value));
  const [editing, setEditing] = useState(false);
  const initialValueRef = useRef<number | null>(props.value);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!editing) setText(props.value === null ? "" : formatCop(props.value));
  }, [editing, props.value]);

  return (
    <input
      className="item-currency-input"
      inputMode="decimal"
      aria-label={props.ariaLabel}
      value={text}
      placeholder="$ 0"
      onFocus={(event) => {
        initialValueRef.current = props.value;
        dirtyRef.current = false;
        setEditing(true);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        dirtyRef.current = true;
        setText(formatMoneyDraft(event.target.value));
      }}
      onBlur={() => {
        if (!dirtyRef.current) {
          setText(initialValueRef.current === null ? "" : formatCop(initialValueRef.current));
          setEditing(false);
          return;
        }
        const parsed = parseLocaleNumber(text);
        const safeValue = parsed === null ? (props.allowEmpty ? null : 0) : Math.max(0, parsed);
        props.onChange(safeValue);
        setText(safeValue === null ? "" : formatCop(safeValue));
        setEditing(false);
      }}
    />
  );
}

function statusLabel(row: SimulationRow): string {
  if (row.status === "loss") return "Pérdida";
  if (row.status === "over_ceiling") return "Sobre techo";
  if (row.status === "incomplete") return "Incompleto";
  if (row.status === "tight") return "Margen estrecho";
  if (row.status === "no_ceiling") return "Sin techo";
  return "Viable";
}

export function AdditionalCostRows(props: {
  costs: FinancialItemAdditionalCost[];
  onChange: (costs: FinancialItemAdditionalCost[]) => void;
}) {
  function update(index: number, patch: Partial<FinancialItemAdditionalCost>) {
    props.onChange(props.costs.map((cost, current) => (current === index ? { ...cost, ...patch } : cost)));
  }

  return (
    <div className="additional-cost-editor">
      <div className="item-section-heading">
        <div>
          <span>Servicios y costos asociados</span>
          <small>Se suman únicamente a este ítem.</small>
        </div>
        <button
          className="icon-text-button"
          type="button"
          onClick={() => props.onChange([
            ...props.costs,
            { id: makeId("item-cost"), name: "Nuevo servicio", category: "service", mode: "fixed", amount: null, notes: "", reviewStatus: "included" },
          ])}
        >
          <Plus size={16} aria-hidden="true" /> Agregar
        </button>
      </div>
      {props.costs.length ? (
        <div className="cost-lines">
          {props.costs.map((cost, index) => (
            <div className="cost-line item-cost-line" key={cost.id}>
              <input value={cost.name} aria-label="Nombre del costo asociado" placeholder="Ej. instalación" onChange={(event) => update(index, { name: event.target.value })} onBlur={() => { if (!cost.name.trim()) update(index, { name: "Costo asociado" }); }} />
              <select value={cost.category} aria-label="Categoría del costo" onChange={(event) => update(index, { category: event.target.value as AdditionalCostCategory })}>
                {Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <select value={cost.mode} aria-label="Forma de aplicar el costo" onChange={(event) => update(index, { mode: event.target.value as ItemCostMode })}>
                <option value="per_unit">Por unidad</option>
                <option value="fixed">Una vez</option>
              </select>
              <CurrencyEditor value={cost.amount} allowEmpty ariaLabel={`Valor de ${cost.name || "costo asociado"}`} onChange={(amount) => update(index, { amount })} />
              <select value={cost.reviewStatus ?? "included"} aria-label={`Aplicación de ${cost.name || "costo asociado"}`} onChange={(event) => update(index, { reviewStatus: event.target.value as FinancialItemAdditionalCost["reviewStatus"] })}>
                <option value="suggested">Por decidir</option>
                <option value="included">Aplicar</option>
                <option value="excluded">No aplica</option>
              </select>
              <button className="icon-button danger-icon" type="button" title="Eliminar costo" aria-label="Eliminar costo" onClick={() => props.onChange(props.costs.filter((_, current) => current !== index))}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-cost-line">Este ítem no tiene servicios ni costos adicionales.</p>
      )}
    </div>
  );
}

export function GeneralCostsPanel(props: {
  costs: FinancialGeneralCost[];
  total: number;
  open: boolean;
  onToggle: () => void;
  onChange: (costs: FinancialGeneralCost[]) => void;
}) {
  function update(index: number, patch: Partial<FinancialGeneralCost>) {
    props.onChange(props.costs.map((cost, current) => (current === index ? { ...cost, ...patch } : cost)));
  }

  function add() {
    if (!props.open) props.onToggle();
    props.onChange([...props.costs, { id: makeId("general-cost"), name: "Nuevo costo general", category: "other", amount: 0, notes: "" }]);
  }

  return (
    <section className={`general-costs-panel ${props.open ? "is-open" : ""}`} aria-labelledby="general-costs-title">
      <div className="general-costs-summary">
        <button className="disclosure-button" type="button" aria-expanded={props.open} onClick={props.onToggle}>
          {props.open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          <span>
            <strong id="general-costs-title">Costos generales</strong>
            <small>Pólizas, transporte global u otros costos del cálculo.</small>
          </span>
        </button>
        <strong>{formatCop(props.total)}</strong>
        <button className="icon-text-button" type="button" onClick={add}><Plus size={16} aria-hidden="true" /> Agregar</button>
      </div>
      {props.open ? (
        <div className="general-costs-body">
          {props.costs.length ? props.costs.map((cost, index) => (
            <div className="cost-line general-cost-line" key={cost.id}>
              <input value={cost.name} aria-label="Nombre del costo general" placeholder="Ej. póliza de cumplimiento" onChange={(event) => update(index, { name: event.target.value })} onBlur={() => { if (!cost.name.trim()) update(index, { name: "Costo general" }); }} />
              <select value={cost.category} aria-label="Categoría del costo general" onChange={(event) => update(index, { category: event.target.value as AdditionalCostCategory })}>
                {Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <CurrencyEditor value={cost.amount} ariaLabel={`Valor de ${cost.name || "costo general"}`} onChange={(amount) => update(index, { amount: amount ?? 0 })} />
              <input value={cost.notes} aria-label="Nota del costo general" placeholder="Nota opcional" onChange={(event) => update(index, { notes: event.target.value })} />
              <button className="icon-button danger-icon" type="button" title="Eliminar costo" aria-label="Eliminar costo" onClick={() => props.onChange(props.costs.filter((_, current) => current !== index))}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          )) : <p className="empty-cost-line">Todavía no hay costos generales.</p>}
        </div>
      ) : null}
    </section>
  );
}

export function ItemWorkspace(props: {
  items: FinancialOfferItem[];
  rows: SimulationRow[];
  quoteLinks: QuoteLink[][];
  selectedRowKeys: Set<string>;
  onToggleRowSelection: (rowKey: string, checked: boolean) => void;
  onToggleAllRows: (checked: boolean) => void;
  onUpdateItem: (index: number, patch: Partial<FinancialOfferItem>) => void;
  onUpdateControl: (rowKey: string, patch: Partial<OfferControl>, index: number) => void;
  onSwitchOfferMode: (row: SimulationRow, index: number, mode: OfferMode) => void;
  onOpenDetail: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const indexes = groupedProcurementIndexes(props.items);
  const hasContractLots = props.items.some((item) => item.procurementLot != null);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="item-workspace" aria-label="Vista por ítem">
      <div className="item-workspace-heading">
        <div>
          <h2>Ítems de la oferta</h2>
          <p>{props.items.length} {props.items.length === 1 ? "ítem" : "ítems"}</p>
        </div>
        <label className="item-select-all"><input type="checkbox" checked={props.rows.length > 0 && props.rows.every((row) => props.selectedRowKeys.has(row.rowKey))} onChange={(event) => props.onToggleAllRows(event.target.checked)} /> Seleccionar todos</label>
        <button className="icon-text-button" type="button" onClick={() => setExpanded(props.items.every((item) => expanded.has(item.id)) ? new Set() : new Set(props.items.map((item) => item.id)))}>
          <PackagePlus size={16} aria-hidden="true" /> {props.items.length > 0 && props.items.every((item) => expanded.has(item.id)) ? "Plegar todos" : "Desplegar todos"}
        </button>
      </div>
      <div className="item-list">
        {indexes.map((index, position) => {
          const row = props.rows[index]!;
          const item = props.items[index];
          if (!item) return null;
          const isOpen = expanded.has(item.id);
          const adjustmentValue = row.control.mode === "discount"
            ? row.control.discountPct
            : row.control.mode === "profit"
              ? row.control.profitPct
              : row.control.manualOfferUnit;
          return (
            <Fragment key={item.id}>
            {hasContractLots && (position === 0 || props.items[indexes[position - 1]!]!.procurementLot?.id !== item.procurementLot?.id) ? <h3 className="contract-lot-heading">{item.procurementLot?.label ?? "Sin lote asignado"}</h3> : null}
            <article className={`item-sheet ${isOpen ? "is-open" : ""} ${props.selectedRowKeys.has(row.rowKey) ? "is-selected" : ""}`} key={item.id}>
              <div className="item-sheet-row">
                <input className="item-sheet-select" type="checkbox" checked={props.selectedRowKeys.has(row.rowKey)} onChange={(event) => props.onToggleRowSelection(row.rowKey, event.target.checked)} aria-label={`Seleccionar ítem ${item.item || index + 1}`} />
                <div className="item-sheet-title">
                  <button className="item-sheet-toggle" type="button" aria-expanded={isOpen} onClick={() => toggle(item.id)}>
                    {isOpen ? <ChevronDown size={19} aria-hidden="true" /> : <ChevronRight size={19} aria-hidden="true" />}
                    <span className="item-sheet-code">Ítem {item.item || index + 1}</span>
                    <strong>{item.description || "Ítem sin descripción"}</strong>
                  </button>
                  <QuoteLinkButton links={props.quoteLinks[index] ?? []} />
                </div>
                <span className="item-sheet-quantity" title={item.quantity === null ? "Cantidad pendiente; cálculo provisional para 1" : undefined}>{item.quantity ?? "Pendiente"} {item.quantity === null ? "· 1 implícita" : item.unit || "UND"}</span>
                <PriceSummary label="Techo · COP" unit={row.referenceUnit} total={row.referenceTotal} quantity={item.quantity} missing="Sin techo" />
                <PriceSummary label="Costo · COP" unit={row.costUnit} total={row.costTotal} quantity={item.quantity} missing="Costo pendiente" context={row.costTotal === null ? undefined : costModeLabels[item.selectedCostMode]} />
                <PriceSummary label="Oferta · COP" unit={row.offerUnit} total={row.offerTotal} quantity={item.quantity} missing="Oferta pendiente" context={row.utilityValue === null ? undefined : `Utilidad ${formatCop(row.utilityValue)}`} />
                <span className={`item-status status-${row.status}`}>{statusLabel(row)}</span>
              </div>
              {isOpen ? (
                <div className="item-sheet-body">
                  <section className="item-decision-context" aria-label="Descripción y fuentes del ítem">
                    <div className="item-context-description">
                      <h3>Descripción y ficha</h3>
                      <strong>{item.description || "Ítem sin descripción"}</strong>
                      <p>{item.technicalDescription || "Sin ficha técnica registrada."}</p>
                    </div>
                    <div className="item-context-sources">
                      <h3>Fuentes de precio <small>· valores unitarios</small></h3>
                      {row.costBreakdown.sources.length ? (
                        <div className="item-source-list">
                          {row.costBreakdown.sources.map((source, sourceIndex) => (
                            <div className={`item-source-card ${item.selectedCostMode === "source" && item.selectedPriceSourceId === source.id ? "is-chosen" : ""}`} key={source.id || sourceIndex}>
                              <div><strong>{source.label || `Fuente ${sourceIndex + 1}`}</strong>{item.selectedCostMode === "source" && item.selectedPriceSourceId === source.id ? <small>Elegida</small> : null}</div>
                              <span>{source.unitPrice === null ? "Sin precio" : `${source.currency} ${new Intl.NumberFormat("es-CO").format(source.unitPrice)}`}</span>
                              <span>Comparable: <strong>{formatCop(source.normalizedUnit)}</strong></span>
                              {source.url ? <p>Origen: {source.url}</p> : null}
                              {source.notes ? <p>{source.notes}</p> : null}
                              {source.warning ? <p className="item-source-warning">{source.warning}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : <p>Este ítem aún no tiene fuentes de precio.</p>}
                    </div>
                  </section>
                  <section className="item-financial-fields" aria-label="Datos financieros del ítem">
                    <label>Cantidad<input inputMode="decimal" value={item.quantity ?? ""} onChange={(event) => props.onUpdateItem(index, { quantity: parseLocaleNumber(event.target.value) })} /></label>
                    <label>Unidad<input value={item.unit} onChange={(event) => props.onUpdateItem(index, { unit: event.target.value })} /></label>
                    <label>Techo unitario<CurrencyEditor value={item.referenceUnit} allowEmpty ariaLabel="Precio techo unitario" onChange={(referenceUnit) => props.onUpdateItem(index, { referenceUnit })} /></label>
                    <label>Costo a usar<select value={item.selectedCostMode} onChange={(event) => props.onUpdateItem(index, { selectedCostMode: event.target.value as CostMode })}>{Object.entries(costModeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                    {item.selectedCostMode === "source" ? <label>Fuente elegida<select value={item.selectedPriceSourceId ?? ""} onChange={(event) => props.onUpdateItem(index, { selectedPriceSourceId: event.target.value || null })}>
                      <option value="">Elige una cotización</option>
                      {row.costBreakdown.sources.filter((source) => source.normalizedUnit !== null).map((source) => <option value={source.id} key={source.id}>{source.label}</option>)}
                    </select></label> : null}
                    <label>Costo manual<CurrencyEditor value={item.manualUnitCost} allowEmpty ariaLabel="Costo manual unitario" onChange={(manualUnitCost) => props.onUpdateItem(index, { manualUnitCost })} /></label>
                    <label>Modo de oferta<select value={row.control.mode} onChange={(event) => props.onSwitchOfferMode(row, index, event.target.value as OfferMode)}><option value="discount">Descuento</option><option value="profit">Utilidad objetivo</option><option value="manual">Manual</option></select></label>
                    <label>{row.control.mode === "manual" ? "Oferta unitaria" : row.control.mode === "discount" ? "Descuento %" : "Utilidad %"}
                      {row.control.mode === "manual" ? (
                        <CurrencyEditor value={adjustmentValue} allowEmpty ariaLabel="Oferta unitaria manual" onChange={(manualOfferUnit) => props.onUpdateControl(row.rowKey, { manualOfferUnit }, index)} />
                      ) : (
                        <input inputMode="decimal" value={adjustmentValue ?? ""} onChange={(event) => props.onUpdateControl(row.rowKey, row.control.mode === "discount" ? { discountPct: parseLocaleNumber(event.target.value) ?? 0 } : { profitPct: parseLocaleNumber(event.target.value) ?? 0 }, index)} />
                      )}
                    </label>
                  </section>

                  <section className="item-cost-breakdown" aria-label="Composición del costo">
                    <div><span>Producto base</span><strong>{formatCop(row.productCostTotal)}</strong></div>
                    <div><span>Servicios y asociados</span><strong>{formatCop(row.additionalCostTotal)}</strong></div>
                    <div className="item-cost-total"><span>Costo completo</span><strong>{formatCop(row.costTotal)}</strong></div>
                    {row.warnings.length ? <p><CircleAlert size={15} aria-hidden="true" /> {row.warnings[0]}</p> : null}
                  </section>

                  <AdditionalCostRows costs={item.additionalCosts ?? []} onChange={(additionalCosts) => props.onUpdateItem(index, { additionalCosts })} />

                  <div className="item-sheet-actions">
                    <button className="icon-text-button" type="button" onClick={() => setExpanded(new Set([item.id]))}>Enfocar este ítem</button>
                    <button className="icon-text-button" type="button" onClick={() => props.onOpenDetail(index)}><ExternalLink size={16} aria-hidden="true" /> Editar fuentes y ficha</button>
                  </div>
                </div>
              ) : null}
            </article>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
