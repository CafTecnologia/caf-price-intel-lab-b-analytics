"use client";

import activityStyles from "./ai-workspace-activity.module.css";
import { LotSelection } from "./lot-selection";
import { rowFilters as decisionFilters, type RowFilterKey as DecisionFilterKey } from "../lib/row-filters";
import { groupProcurementLots, groupedProcurementIndexes } from "@offer/lib/procurement-lots";

import * as React from "react";
import { coNumberFormat } from "../lib/co-number-format";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Search, CircleDollarSign, MessageSquareQuote } from "lucide-react";
import { QuoteLinkButton } from "./quote-link-button";
import { AnchoredPopover } from "./anchored-popover";
import { UnifiedItemDetail } from "./unified-item-detail";
import type { FinancialItemAdditionalCost, FinancialOfferItem } from "@offer/lib/contract";
import { associatedCostNeedsReview, manualBaseCostInputForRow, provisionalUtilityForRow, selectedQuoteLinks, type SimulationRow } from "../lib/financial-engine";
import { formatMoneyDraft } from "../lib/money-draft";

// En la mesa los pesos van sin centavos; el valor exacto queda en el título
// (al pasar el cursor) y en el detalle del ítem.
function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : coNumberFormat(0).format(value);
}

function exactMoney(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : coNumberFormat(2).format(value);
}

function decimal(value: number, digits = 1): string {
  return coNumberFormat(digits).format(value);
}

function itemNumber(raw: string | null | undefined, index: number): string {
  // "1.0" → "1": el ".0" no aporta cuando no hay subítems.
  return String(raw || index + 1).replace(/\.0+$/, "");
}

// Unidad por fila (Carlos, 26/10): si algún total de la fila llega a 1.000.000,
// toda la fila va en millones (totales con 2 decimales, unitarios con 3); lo
// menor de 10.000 queda en pesos. El signo lo da el color; solo la pérdida lleva «−».
function rowInMillions(row: SimulationRow): boolean {
  return [row.referenceTotal, row.costTotal, row.offerTotal].some(value => value !== null && Math.abs(value) >= 1_000_000);
}

function scaledMoney(value: number | null | undefined, inMillions: boolean, unit: boolean): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const sign = value < 0 && Math.round(abs) > 0 ? "−" : "";
  if (!inMillions || abs < 10_000) return sign + money(abs);
  const digits = unit ? 3 : 2;
  return `${sign}${coNumberFormat(digits, true).format(abs / 1_000_000)} M`;
}

// Margen = resultado ÷ oferta, con un decimal. En PC la tabla muestra la utilidad
// (Carlos, 27/10); el margen solo se conserva para el móvil, donde la CSS lo muestra.
function marginText(result: number | null, offer: number | null): string {
  if (result === null || !offer) return "–";
  const pct = (result / offer) * 100;
  if (pct !== 0 && Math.abs(pct) < 0.1) return "<0,1 %";
  return `${pct < 0 ? "−" : ""}${decimal(Math.abs(pct))} %`;
}

function amount(
  unit: number | null,
  total: number | null,
  quantity: number | null,
  missing: string,
  inMillions: boolean,
) {
  const pendingQuantity = quantity === null || quantity <= 0;
  return {
    unit: quantity === 1 ? "–" : unit === null ? "" : scaledMoney(unit, inMillions, true),
    total: unit === null && total === null ? missing : pendingQuantity || total === null ? "Total pendiente" : scaledMoney(total, inMillions, false),
    full: `Unitario: ${unit === null ? missing : exactMoney(unit)} COP con IVA. Total: ${pendingQuantity || total === null ? "pendiente o provisional" : exactMoney(total)} COP con IVA.`,
  };
}

function statusLabel(status: SimulationRow["status"]): string {
  if (status === "loss") return "Pérdida";
  if (status === "over_ceiling") return "Sobre techo";
  if (status === "incomplete") return "Incompleto";
  if (status === "tight") return "Margen estrecho";
  if (status === "no_ceiling") return "Sin techo";
  return "Viable";
}

// Resultado como las demás celdas: unitario arriba, total abajo y el margen a la
// derecha; debajo, solo el estado cuando no es viable.
function resultView(row: SimulationRow, inMillions: boolean): { unit: string; main: string; margin: string; sign: "pos" | "neg" | ""; detail: string; title: string } {
  const utility = row.utilityValue;
  const pct = utility !== null && row.offerTotal ? (utility / row.offerTotal) * 100 : null;
  const pctText = pct === null ? "" : `${decimal(pct)} %`;
  const gap = row.referenceTotal !== null && row.offerTotal !== null ? row.referenceTotal - row.offerTotal : null;
  const gapText = gap === null ? "" : gap < 0 ? `${exactMoney(Math.abs(gap))} sobre el techo` : gap === 0 ? "oferta igual al techo" : `${exactMoney(gap)} bajo el techo`;
  const unitOf = (value: number) => row.quantity === 1 ? "–" : row.quantity && row.quantity > 0 ? scaledMoney(value / row.quantity, inMillions, true) : "";
  const view = (value: number, detail: string, title: string) => ({
    unit: unitOf(value), main: scaledMoney(value, inMillions, false), margin: marginText(value, row.offerTotal),
    sign: value > 0 ? "pos" as const : value < 0 ? "neg" as const : "" as const, detail, title,
  });
  const title = [statusLabel(row.status), utility === null ? "Utilidad pendiente" : `Utilidad ${exactMoney(utility)} COP`, pctText && `${pctText} de la oferta`, gapText].filter(Boolean).join(". ");
  if (row.status === "incomplete") {
    const provisional = provisionalUtilityForRow(row);
    if (provisional !== null) return view(provisional, "Utilidad provisional · costos pendientes",
      `Utilidad provisional ${exactMoney(provisional)} COP antes de costos asociados pendientes. Revisar servicios sin valorar.`);
    return { unit: "", main: row.hasPendingAssociatedCosts ? "Costo parcial" : row.costTotal === null ? "Sin costo" : "Faltan datos", margin: "", sign: "", detail: row.costTotal === null ? "" : row.warnings?.[0] ?? "Revisar datos del ítem", title };
  }
  if (utility === null) return { unit: "", main: statusLabel(row.status), margin: "", sign: "", detail: "", title };
  if (row.status === "loss") {
    const costOverCeiling = row.costTotal !== null && row.referenceTotal !== null && row.costTotal > row.referenceTotal;
    return view(utility, costOverCeiling ? "Pérdida · el costo supera el techo" : "Pérdida", title);
  }
  if (row.status === "over_ceiling") return view(utility, gap !== null ? `Sobre techo por ${scaledMoney(Math.abs(gap), inMillions, false)}` : "Sobre techo", title);
  if (row.status === "tight") return view(utility, "Margen estrecho", title);
  // La columna Techo ya dice «Sin techo»: no se repite en Resultados.
  if (row.status === "no_ceiling") return view(utility, "", title);
  return view(utility, "", title);
}

// Etiqueta compacta del ajuste: modo y valor; el control completo se abre al tocarla.
function adjustChip(row: SimulationRow): { label: string; value: string } {
  const mode = row.control?.mode ?? "discount";
  if (mode === "manual") return { label: "Manual", value: money(row.offerUnit) || "—" };
  if (mode === "discount") {
    const pct = row.referenceUnit && row.offerUnit !== null ? 100 - (row.offerUnit / row.referenceUnit) * 100 : row.control?.discountPct ?? 0;
    const rounded = Math.round(pct * 10) / 10;
    return { label: "", value: `${rounded > 0 ? "−" : rounded < 0 ? "+" : ""}${decimal(Math.abs(rounded))} %` };
  }
  const pct = row.costUnit && row.offerUnit !== null ? (row.offerUnit / row.costUnit - 1) * 100 : row.control?.profitPct ?? 0;
  const rounded = Math.round(pct * 10) / 10;
  return { label: "Utilidad", value: `${rounded < 0 ? "−" : "+"}${decimal(Math.abs(rounded))} %` };
}

function riskClass(status: SimulationRow["status"]): string {
  if (status === "loss" || status === "over_ceiling") return "risk-danger";
  if (status === "tight") return "risk-warning";
  if (status === "incomplete") return "risk-muted";
  return "risk-ok";
}

const COMPARABLE_BASIS = "Comparable exploratorio · no homologado";
const COMPARABLE_NOTICE = "El costo sale de un producto comparable, no del mismo ítem del pliego (no homologado).";

function MoneyCell(props: { data: ReturnType<typeof amount>; accent?: boolean; labeled?: boolean; context?: string; contextClass?: string }) {
  return (
    <span className={`decision-amount ${props.accent ? "is-accent" : ""}`} title={props.data.full}>
      <small className="decision-amount-unit">{props.labeled && props.data.unit && props.data.unit !== "–" ? <span className="decision-amount-label">Unit. </span> : null}{props.data.unit || " "}</small>
      <strong>{props.labeled && /[0-9]/.test(props.data.total) ? <span className="decision-amount-label">Total </span> : null}{props.data.total}</strong>
      {props.context ? <small className={`decision-amount-context ${props.contextClass ?? ""}`.trim()} title={props.context}>{props.context}</small> : null}
    </span>
  );
}

type DecisionColumnKey = "select" | "description" | "quantity" | "reference" | "costUnit" | "offerUnit" | "offerAdjust" | "status";
// Resultado va junto a Oferta: es la columna que decide y no debe quedar
// cortada en pantallas de laptop.
const decisionColumns: Array<{ key: DecisionColumnKey; className: string; defaultWidth: number }> = [
  { key: "select", className: "decision-col-select", defaultWidth: 34 },
  { key: "description", className: "decision-col-description", defaultWidth: 220 },
  { key: "quantity", className: "decision-col-quantity", defaultWidth: 58 },
  { key: "reference", className: "decision-col-money", defaultWidth: 100 },
  { key: "costUnit", className: "decision-col-money", defaultWidth: 100 },
  { key: "offerUnit", className: "decision-col-money", defaultWidth: 100 },
  { key: "status", className: "decision-col-result", defaultWidth: 128 },
  { key: "offerAdjust", className: "decision-col-adjust", defaultWidth: 176 },
];

type DecisionSortDirection = "asc" | "desc";


function decisionSortValue(row: SimulationRow, key: DecisionColumnKey): string | number | null {
  if (key === "description") return row.description ?? "";
  if (key === "quantity") return row.quantity;
  if (key === "reference") return row.referenceTotal;
  if (key === "costUnit") return row.costTotal;
  if (key === "offerUnit") return row.offerTotal;
  if (key === "offerAdjust") {
    const control = row.control;
    if (!control) return null;
    return control.mode === "manual" ? control.manualOfferUnit : control.mode === "discount" ? control.discountPct : control.profitPct;
  }
  if (key === "status") return row.utilityValue ?? statusLabel(row.status);
  return null;
}

export function sortedDecisionIndexes(rows: SimulationRow[], key: DecisionColumnKey, direction: DecisionSortDirection): number[] {
  const indexes = rows.map((_, index) => index);
  if (key === "select") return indexes;
  return indexes.sort((left, right) => {
    const a = decisionSortValue(rows[left]!, key);
    const b = decisionSortValue(rows[right]!, key);
    if (a === null && b === null) return left - right;
    if (a === null) return 1;
    if (b === null) return -1;
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
    return (direction === "asc" ? comparison : -comparison) || left - right;
  });
}

// Precio de un costo asociado escrito en la misma línea: Enter o salir del campo guarda; Esc descarta.
function AssociatedCostPrice(props: { cost: FinancialItemAdditionalCost; onSave: (amount: number) => void }) {
  const initial = props.cost.amount === null || associatedCostNeedsReview(props.cost) ? "" : money(props.cost.amount);
  const [draft, setDraft] = useState(initial);
  const discard = useRef(false);
  const commit = () => {
    const clean = formatMoneyDraft(draft);
    const amount = Number(clean.replace(/\./g, "").replace(",", "."));
    if (discard.current || !clean || !Number.isFinite(amount) || amount === props.cost.amount) { discard.current = false; setDraft(initial); return; }
    props.onSave(amount);
  };
  return (
    <span className="decision-associated-price">
      <input inputMode="decimal" value={draft} placeholder="Precio" aria-label={`Precio de ${props.cost.name}`}
        onChange={(event) => setDraft(formatMoneyDraft(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { discard.current = true; event.currentTarget.blur(); }
        }} />
      {props.cost.mode === "per_unit" ? <small>/u</small> : null}
    </span>
  );
}

function decisionRowPresentation(row: SimulationRow, item: FinancialOfferItem, index: number) {
          const number = itemNumber(item.item, index);
          const inMillions = rowInMillions(row);
          const ceiling = amount(row.referenceUnit, row.referenceTotal, row.quantity, "Sin techo", inMillions);
          const noCeiling = !/[0-9]/.test(ceiling.total);
          const cost = amount(row.costUnit, row.costTotal, row.quantity, "Pendiente", inMillions);
          if (row.additionalCostTotal !== null && row.additionalCostTotal > 0) cost.full += ` Total producto base ${exactMoney(row.productCostTotal)} COP; total asociados ${exactMoney(row.additionalCostTotal)} COP.`;
          const offer = amount(row.offerUnit, row.offerTotal, row.quantity, "Pendiente", inMillions);
          const result = resultView(row, inMillions);
          const provisionalBasis = item.costBasisStatus === "partial" ? "Costo parcial · utilidad de escenario"
            : item.costBasisStatus === "comparable_scenario" ? COMPARABLE_BASIS : null;
          // Comparable: en PC solo un punto con explicación; el texto corto queda para el móvil.
          const comparableBasis = provisionalBasis === COMPARABLE_BASIS && row.costUnit !== null;
          if (provisionalBasis && row.costUnit !== null) {
            if (!comparableBasis) result.detail = [result.detail, provisionalBasis].filter(Boolean).join(" · ");
            result.title += `. ${provisionalBasis}; confirmar alcance antes de ofertar.`;
          }
          if (row.hasPendingAssociatedCosts) {
            result.detail = [result.detail, "Costos por revisar"].filter(Boolean).join(" · ");
            result.title += ". Hay costos asociados sin valorar; la utilidad usa costos conocidos.";
          }
          if (row.hasSuggestedAssociatedCosts) {
            result.detail = [result.detail, "Sugerencias por decidir"].filter(Boolean).join(" · ");
            result.title += ". Hay costos sugeridos sin aplicar.";
          }
          const chip = adjustChip(row);
          const links = selectedQuoteLinks(row, item);
          // "Costo moderado" es el modo por defecto: solo se nombra cuando es otro.
          const costContext = row.additionalCostTotal !== null && row.additionalCostTotal > 0
            ? `Base unit. ${money(row.quantity && row.productCostTotal !== null ? row.productCostTotal / row.quantity : null)}`
              : provisionalBasis && row.costUnit !== null ? provisionalBasis
              : row.costTotal !== null && item.selectedCostMode === "manual" && item.manualCostAssumption
                ? `Supuesto · techo −${coNumberFormat(8).format(item.manualCostAssumption.discountPct)} %`
                : row.costTotal !== null && row.costModeUsed !== "weighted" && row.costSourceLabel !== "Costo único" ? row.costSourceLabel : undefined;
  return { number, ceiling, noCeiling, cost, offer, result, provisionalBasis, comparableBasis, chip, links, costContext, quantityText: item.quantity === null ? "Pendiente" : decimal(item.quantity, 2) };
}

export function DecisionTable(props: {
  highlightedItemIds?: ReadonlySet<string>;
  filterKey: DecisionFilterKey;
  filterTest?: (row: SimulationRow) => boolean;
  adjustmentTags?: Map<string, Array<{ key: string; label: string }>>;
  collapsedLots: Set<string>;
  onToggleLot: (key: string) => void;
  onSelectLot: (indexes: number[], checked: boolean) => void;
  items: FinancialOfferItem[];
  rows: SimulationRow[];
  selectedRowKeys: Set<string>;
  onToggleRowSelection: (rowKey: string, checked: boolean) => void;
  onToggleAllRows: (checked: boolean) => void;
  onOpenDetail: (index: number) => void;
  onAddCost: (index: number) => void;
  onSetManualCost: (index: number, amount: number) => void;
  onSetAdditionalCost: (index: number, costIndex: number, amount: number) => void;
  onUpdateAdditionalCost: (index: number, costIndex: number, patch: Partial<FinancialItemAdditionalCost>) => void;
  onRemoveAdditionalCost: (index: number, costIndex: number) => void;
  onDeliverableTypeChange?: (index: number, value: "product" | "service" | null) => void;
  onManualCostChange: (index: number, value: string) => boolean | void;
  onManualCostEditingChange?: (editing: boolean) => void;
  expandedAll: boolean;
  onExpandedAllChange: (expanded: boolean) => void;
  editingIndex: number | null;
  onSearch: (index: number) => void | Promise<void>;
  renderOfferAdjustment: (row: SimulationRow, index: number) => ReactNode;
  columnPrefs?: Partial<Record<DecisionColumnKey, { visible: boolean; width: number }>>;
  onResizeStart?: (key: DecisionColumnKey, event: React.MouseEvent<HTMLButtonElement>) => void;
  onResizeBy?: (key: DecisionColumnKey, delta: number) => void;
  previewIndex: number | null;
  onPreviewChange: (index: number | null) => void;
}) {
  const previewIndex = props.previewIndex;
  // Selection, menus and local drafts do not change financial presentation.
  const rowPresentations = useMemo(() => props.rows.map((row, index) => props.items[index] ? decisionRowPresentation(row, props.items[index]!, index) : null), [props.rows, props.items]);
  const [collapsedAllRows, setCollapsedAllRows] = useState<Set<number>>(() => new Set());
  const [sortState, setSortState] = useState<{ key: DecisionColumnKey; direction: DecisionSortDirection } | null>(null);
  // La acción conserva su fila y el panel se sitúa fuera del contenedor de la tabla.
  const [adjustOpen, setAdjustOpen] = useState<{ index: number; kind: "adjust" | "manual" } | null>(null);
  const adjustAnchorRef = useRef<HTMLElement | null>(null);
  const [manualCostDraft, setManualCostDraft] = useState("");
  const [manualCostError, setManualCostError] = useState("");
  useEffect(() => {
    props.onManualCostEditingChange?.(adjustOpen?.kind === "manual");
    return () => props.onManualCostEditingChange?.(false);
  }, [adjustOpen?.kind]);
  const filterKey = props.filterKey;
  const activeFilter = decisionFilters.find((filter) => filter.key === filterKey) ?? decisionFilters[0]!;
  const activeTest = props.filterTest ?? activeFilter.test;
  useEffect(() => setCollapsedAllRows(new Set()), [props.expandedAll]);
  function toggleExpanded(index: number) {
    if (props.expandedAll) {
      setCollapsedAllRows((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      if (props.editingIndex === index || previewIndex === index) props.onPreviewChange(null);
      return;
    }
    props.onPreviewChange(previewIndex === index ? null : index);
  }
  function toggleAdjust(index: number, event: React.MouseEvent<HTMLButtonElement> | null, kind: "adjust" | "manual" = "adjust") {
    if (adjustOpen?.index === index && adjustOpen.kind === kind) {
      setAdjustOpen(null);
      return;
    }
    // Desde el detalle de PC el ancla es el chip de Ajuste de la misma fila.
    adjustAnchorRef.current = event?.currentTarget ?? document.querySelector<HTMLButtonElement>(`[data-decision-row-index="${index}"] .decision-adjust-chip`);
    if (kind === "manual") {
      setManualCostDraft(exactMoney(manualBaseCostInputForRow(props.rows[index]!)));
      setManualCostError("");
    }
    setAdjustOpen({ index, kind });
  }
  function confirmManualCost() {
    if (!adjustOpen || adjustOpen.kind !== "manual") return;
    if (props.onManualCostChange(adjustOpen.index, manualCostDraft) === false) {
      setManualCostError("Escribe un costo válido, igual o mayor a cero.");
      return;
    }
    setAdjustOpen(null);
  }
  const visible = (key: DecisionColumnKey) => props.columnPrefs?.[key]?.visible !== false;
  const shownColumns = decisionColumns.filter((column) => visible(column.key));
  const preferredWidth = props.columnPrefs
    ? shownColumns.reduce((sum, column) => sum + (props.columnPrefs?.[column.key]?.width ?? column.defaultWidth), 0)
    : null;
  const effectiveSort = sortState && visible(sortState.key) ? sortState : null;
  const orderedIndexes = useMemo(() => {
    const ordered = effectiveSort ? sortedDecisionIndexes(props.rows, effectiveSort.key, effectiveSort.direction) : props.rows.map((_, index) => index);
    return groupedProcurementIndexes(props.items, filterKey === "all" ? ordered : ordered.filter((index) => activeTest(props.rows[index]!)));
  }, [props.items, props.rows, effectiveSort, filterKey, activeTest]);
  const lotGroups = groupProcurementLots(props.items);
  const hasContractLots = lotGroups.length > 1 && props.items.some(item => item.procurementLot != null);
  const filterCounts = useMemo(
    () => Object.fromEntries(decisionFilters.map((filter) => [filter.key, props.rows.filter(filter.test).length])) as Record<DecisionFilterKey, number>,
    [props.rows],
  );
  function toggleSort(key: DecisionColumnKey) {
    setSortState((current) => current?.key !== key
      ? { key, direction: "asc" }
      : current.direction === "asc"
        ? { key, direction: "desc" }
        : null);
  }
  function header(key: DecisionColumnKey, label: ReactNode, name: string, className = "") {
    const active = effectiveSort?.key === key ? effectiveSort.direction : null;
    return (
      <th hidden={!visible(key)} className={className || undefined} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}>
        <div className="decision-header-content">
          <span className="decision-header-label">{label}</span>
          <button className={`decision-sort-button ${active ? "is-active" : ""}`} type="button" onClick={() => toggleSort(key)}
            title={`Ordenar ${name}: ${active === "asc" ? "de mayor a menor" : active === "desc" ? "quitar orden" : "de menor a mayor"}`}
            aria-label={`Ordenar ${name}: ${active === "asc" ? "de mayor a menor" : active === "desc" ? "quitar orden" : "de menor a mayor"}`}>
            {active === "asc" ? "↑" : active === "desc" ? "↓" : "↕"}
          </button>
          {props.onResizeStart ? <button className="decision-resize-handle" type="button"
            onMouseDown={(event) => props.onResizeStart?.(key, event)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                props.onResizeBy?.(key, event.key === "ArrowRight" ? 10 : -10);
              }
            }}
            title={`Arrastra para ensanchar o angostar ${name}; con teclado usa las flechas`} aria-label={`Ajustar ancho de ${name}`} /> : null}
        </div>
      </th>
    );
  }
  const visibleRows = orderedIndexes.map((index) => props.rows[index]!).filter(Boolean);
  const allSelected = visibleRows.length > 0 && visibleRows.every((row) => props.selectedRowKeys.has(row.rowKey));
  function toggleVisibleRows(checked: boolean) {
    if (filterKey === "all") {
      props.onToggleAllRows(checked);
      return;
    }
    for (const row of visibleRows) props.onToggleRowSelection(row.rowKey, checked);
  }
  useEffect(() => {
    if (previewIndex === null && !props.expandedAll && !adjustOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (adjustOpen) {
          setAdjustOpen(null);
          return;
        }
        props.onExpandedAllChange(false);
        props.onPreviewChange(null);
        return;
      }
      // ↑ ↓ cambian el ítem abierto (detalle de PC), salvo mientras se escribe o hay un ajuste abierto.
      if ((event.key === "ArrowUp" || event.key === "ArrowDown") && previewIndex !== null && !props.expandedAll && !adjustOpen) {
        const target = event.target;
        if (target instanceof Element && target.closest("input, select, textarea, [contenteditable='true']")) return;
        const position = orderedIndexes.indexOf(previewIndex);
        const next = orderedIndexes[position + (event.key === "ArrowDown" ? 1 : -1)];
        if (position < 0 || next === undefined) return;
        event.preventDefault();
        props.onPreviewChange(next);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewIndex, props.expandedAll, props.onExpandedAllChange, props.onPreviewChange, adjustOpen, orderedIndexes]);
  // En PC, al dejar atrás el ítem abierto (hacia arriba o abajo) la tabla vuelve a verse normal sin cerrarlo.
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [openReleased, setOpenReleased] = useState(false);
  useEffect(() => {
    setOpenReleased(false);
    if (previewIndex === null || props.expandedAll || !window.matchMedia("(min-width: 641px)").matches) return;
    let frame = 0;
    function measure() {
      frame = 0;
      const table = tableRef.current;
      const row = table?.querySelector<HTMLElement>(`tr[data-decision-row-index="${previewIndex}"]`);
      const detail = table?.querySelector<HTMLElement>(`#decision-item-detail-${previewIndex}`);
      const head = table?.querySelector<HTMLElement>("thead th:not([hidden])");
      if (!row || !detail || !head) return;
      const box = detail.getBoundingClientRect();
      setOpenReleased(box.bottom < head.getBoundingClientRect().bottom + row.offsetHeight || box.top > window.innerHeight - 1);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [previewIndex, props.expandedAll]);
  const adjustRow = adjustOpen ? props.rows[adjustOpen.index] : undefined;
  const adjustItem = adjustOpen ? props.items[adjustOpen.index] : undefined;
  return (
    <>
    <table ref={tableRef} className={`decision-table ${previewIndex !== null && !props.expandedAll && !openReleased ? "has-open" : ""}`} aria-label="Comparación de ítems de la oferta" style={preferredWidth === null ? undefined : { minWidth: `${preferredWidth}px` }}>
      <colgroup>
        {shownColumns.map((column) => (
          <col key={column.key} className={column.className} style={props.columnPrefs ? { width: `${props.columnPrefs[column.key]?.width ?? column.defaultWidth}px` } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th hidden={!visible("select")}><input type="checkbox" checked={allSelected} onChange={(event) => toggleVisibleRows(event.target.checked)} aria-label={filterKey === "all" ? "Seleccionar todos los ítems" : `Seleccionar los ${visibleRows.length} ítems filtrados`} /></th>
          {header("description", "Ítem", "descripción")}
          {header("quantity", "Cant. / Und.", "cantidad y unidad de medida", "decision-th-number")}
          {header("reference", <>Techo <small>con IVA</small></>, "techo", "decision-th-number")}
          {header("costUnit", <>Costo <small>con IVA</small></>, "costo elegido", "decision-th-number")}
          {header("offerUnit", <>Oferta <small>con IVA</small></>, "oferta", "decision-th-number")}
          {header("status", "Resultado", "resultado")}
          {header("offerAdjust", "Ajuste", "ajuste de precio")}
        </tr>
      </thead>
      {orderedIndexes.map((index, position) => {
          const row = props.rows[index];
          const item = props.items[index];
          if (!item || !row) return null;
          const lot = lotGroups.find(group => group.indexes.includes(index))!;
          const collapsed = hasContractLots && props.collapsedLots.has(lot.key);
          const { number, ceiling, noCeiling, cost, offer, result, provisionalBasis, comparableBasis, chip, links, costContext, quantityText } = rowPresentations[index]!;
          const isExpanded = (props.expandedAll && !collapsedAllRows.has(index)) || previewIndex === index;
          return (
            <tbody key={row.rowKey} className="decision-item-group" aria-label={`Ítem ${number}: ${item.description || "Sin descripción"}`}>
            {hasContractLots && (position === 0 || props.items[orderedIndexes[position - 1]!]!.procurementLot?.id !== item.procurementLot?.id) ? <tr className="contract-lot-row"><th colSpan={shownColumns.length} scope="rowgroup">
              <div className="lot-table-header"><LotSelection label={lot.label} keys={lot.indexes.map(i => props.rows[i]!.rowKey)} selected={props.selectedRowKeys} onChange={checked => props.onSelectLot(lot.indexes, checked)} />
              <button type="button" onClick={() => props.onToggleLot(lot.key)} aria-expanded={!collapsed}>{collapsed ? "▸" : "▾"} {lot.label} · {lot.indexes.length} ítems</button></div>
            </th></tr> : null}
            {!collapsed ? <><tr className={`decision-row ${props.highlightedItemIds?.has(item.id) ? `${activityStyles.changedRow} ` : ""}${row.quantity === 1 ? "is-single-quantity " : ""}${filterKey === "associated" ? "is-associated-ref " : ""}${props.selectedRowKeys.has(row.rowKey) ? "is-selected" : ""} ${row.status === "viable" && !row.hasPendingAssociatedCosts && !row.hasSuggestedAssociatedCosts && !provisionalBasis ? "" : "needs-review"} ${row.status === "loss" ? "is-loss" : ""} ${isExpanded ? "is-expanded" : ""}`} data-decision-row-index={index} data-ai-changed={props.highlightedItemIds?.has(item.id) || undefined}>
              <td hidden={!visible("select")} className="decision-select-cell"><input type="checkbox" checked={props.selectedRowKeys.has(row.rowKey)} onChange={(event) => props.onToggleRowSelection(row.rowKey, event.target.checked)} aria-label={`Seleccionar ítem ${number}`} /></td>
              <td hidden={!visible("description")} className="decision-description-cell">
                <button id={`decision-item-heading-${index}`} aria-controls={isExpanded ? `decision-item-detail-${index}` : undefined} className="decision-description" type="button" onClick={() => toggleExpanded(index)} aria-expanded={isExpanded} title={isExpanded ? "Plegar ítem" : "Ver ficha, fuentes y costos"} aria-label={`${isExpanded ? "Plegar" : "Desplegar"} el ítem ${number}`}>
                  <span className={`decision-chevron ${isExpanded ? "is-open" : ""}`} aria-hidden="true"><ChevronRight size={15} /></span>
                  <span className="decision-description-text">
                    <strong><span className="decision-item-number"><span className="decision-item-word">Ítem </span>{number}</span>{" "}<span className="decision-item-sep" aria-hidden="true">· </span><span className="decision-item-name">{item.description || "Ítem sin descripción"}</span></strong>
                    {props.adjustmentTags?.get(row.rowKey)?.length ? <span className="decision-adjust-tags">{props.adjustmentTags.get(row.rowKey)!.map((tag) => <span key={tag.key} className="decision-adjust-tag">{tag.label}</span>)}</span> : null}
                    {item.technicalDescription ? <small>{item.technicalDescription}</small> : null}
                    <span className="decision-detail-toggle">{isExpanded ? "Ocultar detalles" : "Ver detalles"}</span>
                  </span>
                </button>
                {props.onDeliverableTypeChange ? <select className="deliverable-type-select" aria-label={`Tipo de entregable del ítem ${number}`} value={item.deliverableType ?? ""} onChange={(event) => props.onDeliverableTypeChange?.(index, event.target.value === "product" ? "product" : event.target.value === "service" ? "service" : null)}>
                  <option value="">Sin clasificar</option><option value="product">Producto</option><option value="service">Servicio</option>
                </select> : null}
              </td>
              <td hidden={!visible("quantity")} data-label="Cant." className="decision-quantity decision-number" title={row.quantityAssumed ? "Cantidad no indicada en el pliego: cálculo con 1 unidad asumida" : item.quantity !== null && item.quantity <= 0 ? "Ingrese una cantidad mayor que cero para calcular totales" : undefined}>{row.quantityAssumed ? "1 asumida" : quantityText} <small>{row.unit || "UND"}</small></td>
              <td hidden={!visible("reference")} data-label="Techo con IVA" className={`decision-number ${noCeiling ? "is-no-ceiling" : ""}`}><MoneyCell data={ceiling} labeled /></td>
              <td hidden={!visible("costUnit")} data-label="Costo con IVA" className="decision-number"><MoneyCell data={cost} labeled context={costContext} contextClass={costContext === COMPARABLE_BASIS ? "decision-basis-text" : undefined} /></td>
              <td hidden={!visible("offerUnit")} data-label="Oferta con IVA" className="decision-number"><MoneyCell data={offer} accent labeled /></td>
              <td hidden={!visible("status")} data-label="Resultado" className="decision-status-cell">
                <span className={`decision-result status-${row.status} ${result.sign ? `is-${result.sign}` : ""}`} title={result.title}>
                  <small className="decision-amount-unit">{result.unit && result.unit !== "–" ? <span className="decision-amount-label">Unit. </span> : null}{result.unit || " "}</small>
                  <strong>{result.unit ? <span className="decision-amount-label">Total </span> : null}{result.main}{comparableBasis ? <span className="decision-basis-dot" role="img" title={COMPARABLE_NOTICE} aria-label={COMPARABLE_NOTICE} /> : null}{result.margin ? <span className="decision-margin">{result.margin}</span> : null}</strong>
                  {result.detail ? <small>{result.detail}</small> : null}
                  {comparableBasis ? <small className="decision-basis-text">{COMPARABLE_BASIS}</small> : null}
                </span>
              </td>
              <td hidden={!visible("offerAdjust")} data-label="Ajuste" className="decision-adjust">
                <div className="decision-item-actions" aria-label={`Acciones del ítem ${number}`}>
                  <button className={`decision-adjust-chip ${riskClass(row.status)}`} type="button" aria-expanded={adjustOpen?.index === index && adjustOpen.kind === "adjust"}
                    onClick={(event) => toggleAdjust(index, event)} title="Ajustar precio" aria-label={`Ajustar precio del ítem ${number}: ${chip.label || "Descuento"} ${chip.value}`}>
                    {chip.label ? <span>{chip.label}</span> : null}<strong>{chip.value}</strong>
                  </button>
                  <QuoteLinkButton links={links} />
                  <button className="decision-action-control decision-manual-cost-trigger" type="button" aria-expanded={adjustOpen?.index === index && adjustOpen.kind === "manual"}
                    onClick={(event) => toggleAdjust(index, event, "manual")} data-tip="Cambiar costo de referencia por unidad" aria-label={`Cambiar costo de referencia por unidad del ítem ${number}`}><CircleDollarSign size={16} aria-hidden="true" /></button>
                  <button className="decision-action-control" type="button" onClick={() => window.dispatchEvent(new CustomEvent("caf:quote-financial-item", { detail: { itemId: item.id } }))}
                    data-tip="Citar en el chat IA" aria-label={`Citar el ítem ${number} en el chat IA`}><MessageSquareQuote size={15} aria-hidden="true" /></button>
                  <button className="decision-action-control" type="button" onClick={() => void props.onSearch(index)}
                    data-tip="Buscar precio en Google" aria-label={`Buscar precio del ítem ${number} en Google`}><Search size={15} aria-hidden="true" /></button>
                </div>
              </td>
            </tr>
            {filterKey === "associated" && (item.additionalCosts ?? []).length ? (
              // Con el chip «Costos asociados» se decide sobre cada costo (incluirlo o no y su precio); el ítem queda como referencia.
              <tr className="decision-associated-row">
                <td colSpan={Math.max(1, shownColumns.length)}>
                  <ul className="decision-associated-list" aria-label={`Costos asociados del ítem ${number}`}>
                    {(item.additionalCosts ?? []).map((cost, costIndex) => {
                      const status = cost.reviewStatus ?? "included";
                      const unvalued = associatedCostNeedsReview(cost);
                      return (
                        <li key={cost.id} className={`is-${status}${unvalued ? " is-pending" : ""}`}>
                          <label>
                            <input type="checkbox" checked={status === "included"} aria-label={`Incluir ${cost.name} en el proyecto`}
                              onChange={(event) => props.onUpdateAdditionalCost(index, costIndex, { reviewStatus: event.target.checked ? "included" : "excluded" })} />
                            <span>{cost.name}</span>
                          </label>
                          <small>{status === "suggested" ? "Sugerido · no suma" : status === "excluded" ? "No aplica" : unvalued ? "Incluido · sin precio" : "Incluido"} · {cost.mode === "per_unit" ? "por unidad" : "fijo"}</small>
                          <AssociatedCostPrice key={`${cost.id}-${cost.amount ?? ""}`} cost={cost} onSave={(amount) => props.onSetAdditionalCost(index, costIndex, amount)} />
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            ) : null}
            {isExpanded ? (
              <tr className="unified-detail-row" id={`decision-item-detail-${index}`} aria-labelledby={`decision-item-heading-${index}`}>
                <td colSpan={Math.max(1, shownColumns.length)}>
                  <UnifiedItemDetail
                    item={item}
                    row={row}
                    index={position}
                    count={orderedIndexes.length}
                    onAdjustOffer={() => toggleAdjust(index, null)}
                    onClose={() => toggleExpanded(index)}
                    onEdit={() => props.onOpenDetail(index)}
                    onAddCost={() => props.onAddCost(index)}
                    onSetManualCost={(amount) => props.onSetManualCost(index, amount)}
                    onSetAdditionalCost={(costIndex, amount) => props.onSetAdditionalCost(index, costIndex, amount)}
                    onUpdateAdditionalCost={(costIndex, patch) => props.onUpdateAdditionalCost(index, costIndex, patch)}
                    onRemoveAdditionalCost={(costIndex) => props.onRemoveAdditionalCost(index, costIndex)}
                    onNavigate={(nextPosition) => { props.onExpandedAllChange(false); props.onPreviewChange(orderedIndexes[nextPosition] ?? null); }}
                  />
                </td>
              </tr>
            ) : null}
            </> : null}
            </tbody>
          );
        })}
    </table>
    {adjustOpen && adjustRow && adjustItem ? (
      <AnchoredPopover open anchorRef={adjustAnchorRef} id="item-price-action" className="decision-adjust-popover decision-adjust"
        width={340} minTop={56} showClose={false} onClose={() => setAdjustOpen(null)}
        ariaLabel={`${adjustOpen.kind === "manual" ? "Costo manual" : "Ajustar precio"} del ítem ${itemNumber(adjustItem.item, adjustOpen.index)}`}>
        <div className="decision-adjust-popover-head">
          <strong>{itemNumber(adjustItem.item, adjustOpen.index)} · {adjustItem.description || "Ítem"}</strong>
          {adjustOpen.kind === "manual" ? <>
            <button type="button" onClick={() => setAdjustOpen(null)}>Cancelar</button>
            <button type="button" onClick={confirmManualCost}>Listo</button>
          </> : <button type="button" onClick={() => setAdjustOpen(null)}>Listo</button>}
        </div>
        {adjustOpen.kind === "manual" ? <label className="decision-manual-cost">Costo unitario (COP)
          <input autoFocus inputMode="decimal" value={manualCostDraft}
            onChange={(event) => { setManualCostDraft(formatMoneyDraft(event.target.value)); setManualCostError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter") confirmManualCost(); if (event.key === "Escape") setAdjustOpen(null); }}
            aria-invalid={Boolean(manualCostError)} placeholder="0" />
          {manualCostError ? <small role="alert">{manualCostError}</small> : null}
        </label> : props.renderOfferAdjustment(adjustRow, adjustOpen.index)}
      </AnchoredPopover>
    ) : null}
    </>
  );
}
