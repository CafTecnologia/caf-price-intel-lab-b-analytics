"use client";

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import Link from "next/link";

import { TableWorkspace } from "@offer/components/table-workspace";
import { TrmCalculator } from "@offer/components/trm-calculator";
import type { CostMode, FinancialOfferItem, FinancialOfferPriceSource, FinancialOfferProject, PriceSourceCurrency, VatMode } from "@offer/lib/contract";
import { formatBogotaDateTime } from "@offer/lib/date-format";
import {
  buildInitialOfferControls,
  buildOfferPresentation,
  buildRowKey,
  buildSimulation,
  buildVatControls,
  convertOfferControlMode,
  formatCop,
  formatNumber,
  formatPercent,
  type OfferControl,
  type OfferMode,
  type VatControl,
} from "@offer/lib/financial-engine";

type Tab = "simulator" | "offer";
type SortDirection = "asc" | "desc";
type SortState = { key: SimulatorColumnKey; direction: SortDirection } | null;

type SimulatorColumnKey =
  | "item"
  | "description"
  | "detail"
  | "quantity"
  | "costMode"
  | "optimistic"
  | "average"
  | "weighted"
  | "manual"
  | "costUnit"
  | "costSource"
  | "vat"
  | "reference"
  | "offerMode"
  | "offerAdjust"
  | "offerUnit"
  | "offerTotal"
  | "utility"
  | "status"
  | "warnings"
  | "actions";

type ColumnDef = {
  key: SimulatorColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
};

type ColumnPrefs = Record<SimulatorColumnKey, { visible: boolean; width: number }>;

const SIMULATOR_COLUMNS: ColumnDef[] = [
  { key: "item", label: "Item", defaultWidth: 82, minWidth: 68 },
  { key: "description", label: "Descripcion / ficha", defaultWidth: 330, minWidth: 230 },
  { key: "quantity", label: "Cantidad", defaultWidth: 180, minWidth: 150 },
  { key: "manual", label: "Costo manual", defaultWidth: 142, minWidth: 124 },
  { key: "reference", label: "Techo unit.", defaultWidth: 130, minWidth: 112 },
  { key: "costUnit", label: "Costo aplicado", defaultWidth: 190, minWidth: 164 },
  { key: "vat", label: "IVA", defaultWidth: 145, minWidth: 124 },
  { key: "offerAdjust", label: "Ajuste oferta", defaultWidth: 300, minWidth: 240 },
  { key: "offerUnit", label: "Oferta unit.", defaultWidth: 130, minWidth: 112 },
  { key: "offerTotal", label: "Total oferta", defaultWidth: 135, minWidth: 118 },
  { key: "utility", label: "Utilidad", defaultWidth: 150, minWidth: 126 },
  { key: "status", label: "Estado / alertas", defaultWidth: 230, minWidth: 170 },
  { key: "costMode", label: "Costo a usar", defaultWidth: 150, minWidth: 130 },
  { key: "optimistic", label: "Costo minimo", defaultWidth: 150, minWidth: 130 },
  { key: "average", label: "Costo promedio", defaultWidth: 150, minWidth: 130 },
  { key: "weighted", label: "Costo moderado", defaultWidth: 150, minWidth: 130 },
];

const COST_DETAIL_COLUMNS = new Set<SimulatorColumnKey>(["costMode", "optimistic", "average", "weighted", "costSource", "offerMode", "warnings"]);
const COST_MODES_FOR_UI: CostMode[] = ["weighted", "moderate", "optimistic", "manual"];
const SOURCE_CURRENCIES: PriceSourceCurrency[] = ["COP", "USD"];

function defaultColumnPrefs(): ColumnPrefs {
  return Object.fromEntries(
    SIMULATOR_COLUMNS.map((column) => [column.key, { visible: true, width: column.defaultWidth }]),
  ) as ColumnPrefs;
}

function normalizeColumnPrefs(value: unknown): ColumnPrefs {
  const defaults = defaultColumnPrefs();
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Partial<Record<SimulatorColumnKey, Partial<{ visible: boolean; width: number }>>>;
  return Object.fromEntries(
    SIMULATOR_COLUMNS.map((column) => {
      const current = raw[column.key];
      const width = typeof current?.width === "number" ? Math.max(column.minWidth, Math.min(520, current.width)) : column.defaultWidth;
      return [column.key, { visible: current?.visible !== false, width }];
    }),
  ) as ColumnPrefs;
}

function cloneProject(
  project: FinancialOfferProject,
  items: FinancialOfferItem[],
  settings: Pick<FinancialOfferProject["settings"], "manualCostPriority" | "usdToCopRate" | "usdImportPct">,
): FinancialOfferProject {
  return { ...project, settings: { ...project.settings, ...settings }, items };
}

function updateNumeric(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function labelForMode(mode: CostMode): string {
  if (mode === "optimistic") return "Costo minimo";
  if (mode === "moderate") return "Costo promedio";
  if (mode === "manual") return "Costo manual";
  return "Costo moderado";
}

function shortLabelForMode(mode: CostMode): string {
  if (mode === "optimistic") return "Minimo";
  if (mode === "moderate") return "Promedio";
  if (mode === "manual") return "Manual";
  return "Moderado";
}

function labelForOfferMode(mode: OfferMode): string {
  if (mode === "discount") return "Descuento";
  if (mode === "profit") return "Utilidad objetivo";
  return "Manual";
}

function statusLabel(status: string): string {
  if (status === "viable" || status === "within_ceiling") return "OK";
  if (status === "tight") return "Ajustado";
  if (status === "over_ceiling" || status === "above_ceiling") return "Sobre techo";
  if (status === "loss") return "Perdida";
  if (status === "no_ceiling") return "Sin techo";
  return "Incompleto";
}

function summaryValue(value: number | null, isAvailable: boolean): string {
  return isAvailable ? formatCop(value) : "N/D";
}

function healthClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "metric-muted";
  if (value < 10) return "metric-danger";
  if (value < 15) return "metric-warning";
  return "metric-healthy";
}

function compositionPercent(total: number | null, cost: number | null): { costPct: number; utilityPct: number } {
  if (!total || total <= 0 || cost === null || cost < 0) {
    return { costPct: 50, utilityPct: 50 };
  }
  const costPct = Math.min(100, Math.max(0, (cost / total) * 100));
  return { costPct, utilityPct: Math.max(0, 100 - costPct) };
}

function hasCompositionAmounts(total: number | null, cost: number | null): boolean {
  return (total ?? 0) > 0 && (cost ?? 0) > 0;
}

function percentOf(part: number | null | undefined, total: number | null | undefined): number | null {
  if (part === null || part === undefined || total === null || total === undefined || total === 0) return null;
  return (part / total) * 100;
}

function makeManualItem(index: number, vatRate: number): FinancialOfferItem {
  return {
    id: `manual-${Date.now()}-${index}`,
    item: String(index),
    description: `Item manual ${index}`,
    technicalDescription: "",
    quantity: null,
    unit: "UND",
    referenceUnit: null,
    costOptimistic: null,
    costModerate: null,
    costWeightedUnit: null,
    manualUnitCost: null,
    selectedCostMode: "manual",
    priceSources: [],
    offerMode: "discount",
    discountPct: 0,
    profitPct: null,
    manualOfferUnit: null,
    vatMode: "included",
    vatRate,
    source1: "",
    source2: "",
    source3: "",
    notes: "",
  };
}

function emptyPriceSource(index: number): FinancialOfferPriceSource {
  return {
    id: `source-${index + 1}`,
    label: `Fuente ${index + 1}`,
    unitPrice: null,
    currency: "COP",
    url: "",
    notes: "",
    trm: null,
    importPct: null,
  };
}

function sourceAt(item: FinancialOfferItem | undefined, index: number): FinancialOfferPriceSource {
  return item?.priceSources?.[index] ?? emptyPriceSource(index);
}

function costValueForMode(row: ReturnType<typeof buildSimulation>["rows"][number], item: FinancialOfferItem | undefined, mode: CostMode): number | null {
  if (mode === "manual") return item?.manualUnitCost ?? null;
  if (mode === "optimistic") return row.costBreakdown.minimum;
  if (mode === "moderate") return row.costBreakdown.average;
  return row.costBreakdown.moderate;
}

function modeIsAvailable(row: ReturnType<typeof buildSimulation>["rows"][number], item: FinancialOfferItem | undefined, mode: CostMode): boolean {
  return costValueForMode(row, item, mode) !== null;
}

function ColumnControls(props: {
  columns: ColumnDef[];
  prefs: ColumnPrefs;
  onToggle: (key: SimulatorColumnKey, visible: boolean) => void;
  onWidth: (key: SimulatorColumnKey, width: number) => void;
  onReset: () => void;
}) {
  const hiddenColumns = props.columns.filter((column) => !props.prefs[column.key]?.visible);

  return (
    <div className="column-controls-wrap">
      {hiddenColumns.length ? (
        <div className="hidden-column-strip" aria-label="Columnas ocultas">
          {hiddenColumns.map((column) => (
            <button className="column-chip" type="button" key={column.key} onClick={() => props.onToggle(column.key, true)}>
              + {column.label || "Acciones"}
            </button>
          ))}
        </div>
      ) : null}
      <details className="column-controls">
        <summary>Columnas{hiddenColumns.length ? ` (${hiddenColumns.length} ocultas)` : ""}</summary>
        <div className="column-controls-panel">
          <div className="column-controls-head">
            <span>Mostrar, ocultar y ajustar ancho</span>
            <button className="ghost-button compact-button" type="button" onClick={props.onReset}>
              Restablecer
            </button>
          </div>
          <div className="column-list">
            {props.columns.map((column) => {
              const pref = props.prefs[column.key];
              return (
                <label className="column-row" key={column.key}>
                  <input
                    type="checkbox"
                    checked={pref?.visible !== false}
                    onChange={(event) => props.onToggle(column.key, event.target.checked)}
                  />
                  <span>{column.label || "Acciones"}</span>
                  <input
                    type="range"
                    min={column.minWidth}
                    max="520"
                    step="10"
                    value={pref?.width ?? column.defaultWidth}
                    onChange={(event) => props.onWidth(column.key, Number(event.target.value))}
                  />
                </label>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}

export function ProjectWorkspace(props: { project: FinancialOfferProject }) {
  const [tab, setTab] = useState<Tab>("simulator");
  const [items, setItems] = useState(props.project.items);
  const [manualCostPriority, setManualCostPriority] = useState(props.project.settings.manualCostPriority);
  const [usdToCopRate, setUsdToCopRate] = useState<number | null>(props.project.settings.usdToCopRate ?? null);
  const [usdImportPct, setUsdImportPct] = useState(props.project.settings.usdImportPct ?? 30);
  const [name, setName] = useState(props.project.name);
  const [columnPrefs, setColumnPrefs] = useState<ColumnPrefs>(() => defaultColumnPrefs());
  const [showCostDetails, setShowCostDetails] = useState(false);
  const [sortState, setSortState] = useState<SortState>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [detailRowIndex, setDetailRowIndex] = useState<number | null>(null);
  const [editingDescriptionIndex, setEditingDescriptionIndex] = useState<number | null>(null);
  const [openRowMenuIndex, setOpenRowMenuIndex] = useState<number | null>(null);
  const project = useMemo(
    () => cloneProject(props.project, items, { manualCostPriority, usdToCopRate, usdImportPct }),
    [props.project, items, manualCostPriority, usdToCopRate, usdImportPct],
  );
  const visibleProject = useMemo(() => ({ ...project, name }), [project, name]);
  const [controls, setControls] = useState<Record<string, OfferControl>>(() => buildInitialOfferControls(project));
  const [vatControls, setVatControls] = useState<Record<string, VatControl>>(() => buildVatControls(project));
  const simulation = useMemo(() => buildSimulation(project, controls), [project, controls]);
  const offer = useMemo(() => buildOfferPresentation(simulation, vatControls), [simulation, vatControls]);
  const visibleSimulatorColumns = useMemo(
    () => SIMULATOR_COLUMNS.filter((column) => columnPrefs[column.key]?.visible !== false && (showCostDetails || !COST_DETAIL_COLUMNS.has(column.key))),
    [columnPrefs, showCostDetails],
  );
  const simulatorTableWidth = useMemo(
    () => visibleSimulatorColumns.reduce((total, column) => total + (columnPrefs[column.key]?.width ?? column.defaultWidth), 0),
    [columnPrefs, visibleSimulatorColumns],
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`financial-offer-columns:${props.project.id}`);
      if (stored) {
        setColumnPrefs(normalizeColumnPrefs(JSON.parse(stored)));
      }
    } catch {
      setColumnPrefs(defaultColumnPrefs());
    }
  }, [props.project.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`financial-offer-columns:${props.project.id}`, JSON.stringify(columnPrefs));
    } catch {
      // Local storage is a convenience for visual preferences. The app can work without it.
    }
  }, [columnPrefs, props.project.id]);

  function updateItem(index: number, patch: Partial<FinancialOfferItem>) {
    setItems((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
  }

  function updatePriceSource(index: number, sourceIndex: number, patch: Partial<FinancialOfferPriceSource>) {
    setItems((current) =>
      current.map((item, currentIndex) => {
        if (currentIndex !== index) return item;
        const sources = [...(item.priceSources ?? [])];
        while (sources.length <= sourceIndex) sources.push(emptyPriceSource(sources.length));
        sources[sourceIndex] = { ...sources[sourceIndex]!, ...patch };
        return { ...item, priceSources: sources };
      }),
    );
    setSaveStatus("idle");
  }

  function updateControl(rowKey: string, patch: Partial<OfferControl>, index?: number) {
    setControls((current) => ({ ...current, [rowKey]: { ...current[rowKey], ...patch } }));
    if (index !== undefined) {
      setItems((current) =>
        current.map((item, currentIndex) =>
          currentIndex === index
            ? {
                ...item,
                offerMode: patch.mode ?? item.offerMode,
                discountPct: patch.discountPct ?? item.discountPct,
                profitPct: patch.profitPct ?? item.profitPct,
                manualOfferUnit: patch.manualOfferUnit === undefined ? item.manualOfferUnit : patch.manualOfferUnit,
              }
            : item,
        ),
      );
    }
  }

  function switchOfferMode(row: ReturnType<typeof buildSimulation>["rows"][number], index: number, mode: OfferMode) {
    const nextControl = convertOfferControlMode(row.control, mode, {
      costUnit: row.costUnit,
      referenceUnit: row.referenceUnit,
      offerUnit: row.offerUnit,
    });
    updateControl(row.rowKey, nextControl, index);
  }

  function updateVat(rowKey: string, patch: Partial<VatControl>, index?: number) {
    setVatControls((current) => ({ ...current, [rowKey]: { ...current[rowKey], ...patch } }));
    if (index !== undefined) {
      setItems((current) =>
        current.map((item, currentIndex) =>
          currentIndex === index ? { ...item, vatMode: patch.mode ?? item.vatMode, vatRate: patch.ratePct ?? item.vatRate } : item,
        ),
      );
    }
  }

  function applyCostModeToAll(mode: CostMode) {
    setItems((current) => current.map((item) => ({ ...item, selectedCostMode: mode })));
  }

  function applyCostModeFromSelect(value: string) {
    if (!value) return;
    applyCostModeToAll(value as CostMode);
  }

  function setColumnVisible(key: SimulatorColumnKey, visible: boolean) {
    setColumnPrefs((current) => ({ ...current, [key]: { ...current[key], visible } }));
  }

  function setColumnWidth(key: SimulatorColumnKey, width: number) {
    const column = SIMULATOR_COLUMNS.find((candidate) => candidate.key === key);
    setColumnPrefs((current) => ({
      ...current,
      [key]: {
        ...current[key],
        width: Math.max(column?.minWidth ?? 80, Math.min(520, width)),
      },
    }));
  }

  function addRowsFromSelect(value: string) {
    if (!value) return;
    addManualRows(Number(value));
  }

  function addManualRows(count = 1) {
    const firstNewIndex = items.length;
    setItems((current) => [
      ...current,
      ...Array.from({ length: count }, (_, offset) => makeManualItem(current.length + offset + 1, visibleProject.settings.vatRate)),
    ]);
    if (count === 1) {
      setEditingDescriptionIndex(firstNewIndex);
    }
    setSaveStatus("idle");
  }

  function removeItem(index: number) {
    setItems((current) => {
      if (current.length <= 1) {
        return [makeManualItem(1, visibleProject.settings.vatRate)];
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
    setDetailRowIndex(null);
    setEditingDescriptionIndex(null);
    setOpenRowMenuIndex(null);
    setSaveStatus("idle");
  }

  function requestRemoveItem(index: number) {
    if (window.confirm("Vas a eliminar esta fila del cálculo. ¿Querés continuar?")) {
      removeItem(index);
    }
  }

  function itemsWithUiState(): FinancialOfferItem[] {
    return items.map((item, index) => {
      const rowKey = buildRowKey(item, index);
      const control = controls[rowKey];
      const vat = vatControls[rowKey];
      return {
        ...item,
        offerMode: control?.mode ?? item.offerMode,
        discountPct: control?.discountPct ?? item.discountPct,
        profitPct: control?.profitPct ?? item.profitPct,
        manualOfferUnit: control?.manualOfferUnit === undefined ? item.manualOfferUnit : control.manualOfferUnit,
        vatMode: vat?.mode ?? item.vatMode,
        vatRate: vat?.ratePct ?? item.vatRate,
      };
    });
  }

  async function persistCalculation() {
    setSaveStatus("saving");
    try {
      const nextItems = itemsWithUiState();
      const response = await fetch(`/api/projects/${props.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          settings: { ...visibleProject.settings, manualCostPriority, usdToCopRate, usdImportPct },
          items: nextItems,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "No se pudo guardar.");
      }
      setItems(nextItems);
      setSaveStatus("saved");
      return true;
    } catch {
      setSaveStatus("error");
      return false;
    }
  }

  async function saveCalculation() {
    await persistCalculation();
  }

  async function saveAndExport(format: "json" | "csv") {
    const ok = await persistCalculation();
    if (ok) {
      window.open(`/api/projects/${project.id}/export?format=${format}`, "_blank", "noopener,noreferrer");
    }
  }

  const totalComplete = simulation.summary.total.isComplete;
  const totalScope = simulation.summary.total;
  const partialScope = simulation.summary.partial;
  const totalHasMetrics = totalComplete && totalScope.evaluableCount > 0;
  const partialHasMetrics = !totalComplete && partialScope.evaluableCount > 0;
  const partialComposition = compositionPercent(partialScope.totalOffer, partialScope.totalCost);
  const totalComposition = compositionPercent(totalScope.totalOffer, totalScope.totalCost);
  const partialHasAmounts = hasCompositionAmounts(partialScope.totalOffer, partialScope.totalCost);
  const partialCompositionActive = partialHasMetrics && partialHasAmounts;
  const totalHasAmounts = totalComplete && hasCompositionAmounts(totalScope.totalOffer, totalScope.totalCost);
  const totalHasKnownReference = simulation.summary.referenceKnownTotal !== null && simulation.summary.referenceKnownCount > 0;
  const missingTotalParts = [
    simulation.summary.missingQuantityCount ? `${simulation.summary.missingQuantityCount} sin cantidad` : null,
    simulation.summary.missingCostCount ? `${simulation.summary.missingCostCount} sin costo` : null,
    simulation.summary.missingReferenceCount ? `${simulation.summary.missingReferenceCount} sin techo` : null,
    simulation.summary.missingOfferCount ? `${simulation.summary.missingOfferCount} sin oferta` : null,
  ].filter(Boolean);
  const totalPendingMessage = missingTotalParts.length
    ? `Faltan ${missingTotalParts.join(", ")} para cerrar el total financiero.`
    : "Completa los datos pendientes para cerrar el total financiero.";
  const sortedSimulatorRows = useMemo(() => {
    const indexedRows = simulation.rows.map((row, index) => ({ row, index }));
    if (!sortState) return indexedRows;

    function valueFor(column: SimulatorColumnKey, row: (typeof simulation.rows)[number], index: number): string | number {
      const item = items[index];
      const control = row.control;
      if (column === "item") return row.item;
      if (column === "description") return row.description;
      if (column === "quantity") return row.quantity ?? Number.NEGATIVE_INFINITY;
      if (column === "costMode") return labelForMode(item?.selectedCostMode ?? "weighted");
      if (column === "optimistic") return row.costBreakdown.minimum ?? Number.NEGATIVE_INFINITY;
      if (column === "average") return row.costBreakdown.average ?? Number.NEGATIVE_INFINITY;
      if (column === "weighted") return row.costBreakdown.moderate ?? Number.NEGATIVE_INFINITY;
      if (column === "manual") return item?.manualUnitCost ?? Number.NEGATIVE_INFINITY;
      if (column === "costUnit") return row.costUnit ?? Number.NEGATIVE_INFINITY;
      if (column === "costSource") return row.costSourceLabel;
      if (column === "vat") return `${row.vatMode}-${row.vatRatePct}`;
      if (column === "reference") return row.referenceUnit ?? Number.NEGATIVE_INFINITY;
      if (column === "offerMode") return labelForOfferMode(control.mode);
      if (column === "offerAdjust") {
        if (control.mode === "manual") return control.manualOfferUnit ?? Number.NEGATIVE_INFINITY;
        return control.mode === "discount" ? control.discountPct : control.profitPct;
      }
      if (column === "offerUnit") return row.offerUnit ?? Number.NEGATIVE_INFINITY;
      if (column === "offerTotal") return row.offerTotal ?? Number.NEGATIVE_INFINITY;
      if (column === "utility") return row.utilityValue ?? Number.NEGATIVE_INFINITY;
      if (column === "status") return statusLabel(row.status);
      if (column === "warnings") return row.warnings.join(" ");
      return "";
    }

    return [...indexedRows].sort((left, right) => {
      const leftValue = valueFor(sortState.key, left.row, left.index);
      const rightValue = valueFor(sortState.key, right.row, right.index);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "es", { numeric: true, sensitivity: "base" });
      return sortState.direction === "asc" ? result : -result;
    });
  }, [items, simulation, sortState]);

  function toggleSort(key: SimulatorColumnKey) {
    setSortState((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  function sortLabel(key: SimulatorColumnKey): string {
    if (sortState?.key !== key) return "↑↓";
    return sortState.direction === "asc" ? "↑" : "↓";
  }

  function startColumnResize(key: SimulatorColumnKey, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnPrefs[key]?.width ?? SIMULATOR_COLUMNS.find((column) => column.key === key)?.defaultWidth ?? 120;

    function onMove(moveEvent: MouseEvent) {
      setColumnWidth(key, startWidth + moveEvent.clientX - startX);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function renderHeader(column: ColumnDef): ReactNode {
    const isSorted = sortState?.key === column.key;
    return (
      <th key={column.key}>
        <div className="th-content">
          <span>{column.label}</span>
          {column.key !== "actions" ? (
            <span className={`th-tools ${isSorted ? "active" : ""}`}>
              <button
                className={`column-sort-button ${isSorted ? "active" : ""}`}
                type="button"
                onClick={() => toggleSort(column.key)}
                title={`Ordenar ${column.label || "columna"}`}
                aria-label={`Ordenar ${column.label || "columna"}`}
              >
                {sortLabel(column.key)}
              </button>
              <button
                className="column-resize-handle"
                type="button"
                onMouseDown={(event) => startColumnResize(column.key, event)}
                title={`Arrastra para ajustar ${column.label || "columna"}`}
              />
            </span>
          ) : null}
        </div>
      </th>
    );
  }

  function renderSimulatorCell(column: SimulatorColumnKey, row: (typeof simulation.rows)[number], index: number): ReactNode {
    if (column === "item") {
      return (
        <td className="editable-cell" key={column}>
          <input
            className="table-input item-code-input"
            value={items[index]?.item ?? ""}
            onChange={(event) => updateItem(index, { item: event.target.value })}
          />
        </td>
      );
    }
    if (column === "description") {
      const item = items[index];
      const isEditingName = editingDescriptionIndex === index || !(item?.description ?? "").trim();
      return (
        <td className="description-cell editable-cell" key={column}>
          <div className="item-name-row">
            <button className="row-delete-inline" type="button" onClick={() => requestRemoveItem(index)} title="Eliminar item">
              X
            </button>
            <div className="item-name-main">
              {isEditingName ? (
                <input
                  className="table-input description-input"
                  value={item?.description ?? ""}
                  autoFocus={editingDescriptionIndex === index}
                  onChange={(event) => updateItem(index, { description: event.target.value })}
                  onBlur={() => setEditingDescriptionIndex(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Nombre del item"
                />
              ) : (
                <button
                  className="item-name-display"
                  type="button"
                  onDoubleClick={() => setEditingDescriptionIndex(index)}
                  title="Doble clic para editar o usa el menu"
                >
                  {item?.description || "Sin nombre"}
                </button>
              )}
            </div>
            <div className="row-action-menu">
              <button
                className="row-menu-trigger"
                type="button"
                onClick={() => setOpenRowMenuIndex((current) => (current === index ? null : index))}
                aria-expanded={openRowMenuIndex === index}
                title="Opciones del item"
              >
                ...
              </button>
              {openRowMenuIndex === index ? (
                <div className="row-menu-panel">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDescriptionIndex(index);
                      setOpenRowMenuIndex(null);
                    }}
                  >
                    Editar nombre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailRowIndex(index);
                      setOpenRowMenuIndex(null);
                    }}
                  >
                    Ver detalles
                  </button>
                  <button
                    className="danger-menu-action"
                    type="button"
                    onClick={() => {
                      setOpenRowMenuIndex(null);
                      requestRemoveItem(index);
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <details className="inline-details">
            <summary>Ficha tecnica</summary>
            <textarea
              value={item?.technicalDescription ?? ""}
              onChange={(event) => updateItem(index, { technicalDescription: event.target.value })}
              placeholder="Sin ficha tecnica"
            />
          </details>
        </td>
      );
    }
    if (column === "quantity") {
      return (
        <td className="editable-cell" key={column}>
          <div className="quantity-inputs">
            <input
              className="table-input compact-input"
              inputMode="decimal"
              value={items[index]?.quantity ?? ""}
              onChange={(event) => updateItem(index, { quantity: updateNumeric(event.target.value) })}
              placeholder="Cant."
            />
            <input
              className="table-input unit-input"
              value={items[index]?.unit ?? ""}
              onChange={(event) => updateItem(index, { unit: event.target.value })}
              placeholder="UND"
            />
          </div>
        </td>
      );
    }
    if (column === "costMode") {
      return (
        <td className="editable-cell" key={column}>
          <select
            value={items[index]?.selectedCostMode ?? "weighted"}
            onChange={(event) => updateItem(index, { selectedCostMode: event.target.value as CostMode })}
          >
            {(["weighted", "moderate", "optimistic", "manual"] as CostMode[]).map((mode) => (
              <option value={mode} key={mode}>
                {labelForMode(mode)}
              </option>
            ))}
          </select>
        </td>
      );
    }
    if (column === "optimistic") {
      return <td className={`calculated-cell money ${items[index]?.selectedCostMode === "optimistic" ? "active-cost-cell" : ""}`} key={column}>{formatCop(row.costBreakdown.minimum)}</td>;
    }
    if (column === "average") {
      return <td className={`calculated-cell money ${items[index]?.selectedCostMode === "moderate" ? "active-cost-cell" : ""}`} key={column}>{formatCop(row.costBreakdown.average)}</td>;
    }
    if (column === "weighted") {
      return <td className={`calculated-cell money ${items[index]?.selectedCostMode === "weighted" ? "active-cost-cell" : ""}`} key={column}>{formatCop(row.costBreakdown.moderate)}</td>;
    }
    if (column === "manual") {
      return (
        <td className={`editable-cell ${items[index]?.selectedCostMode === "manual" || manualCostPriority ? "active-cost-cell" : ""}`} key={column}>
          <input
            className="table-input compact-input"
            inputMode="numeric"
            value={items[index]?.manualUnitCost ?? ""}
            onChange={(event) => updateItem(index, { manualUnitCost: updateNumeric(event.target.value) })}
            placeholder="COP"
          />
        </td>
      );
    }
    if (column === "costUnit") {
      const item = items[index];
      return (
        <td className="money calculated-cell cost-applied-cell" key={column}>
          <strong>{formatCop(row.costUnit)}</strong>
          <span className="cost-source-tag">{row.costSourceLabel}</span>
          <select
            className="cost-mode-select"
            value={item?.selectedCostMode ?? "weighted"}
            onChange={(event) => updateItem(index, { selectedCostMode: event.target.value as CostMode })}
          >
            {COST_MODES_FOR_UI.map((mode) => {
              const available = modeIsAvailable(row, item, mode);
              return (
                <option value={mode} key={mode} disabled={!available}>
                  {shortLabelForMode(mode)}{available ? "" : " (sin dato)"}
                </option>
              );
            })}
          </select>
        </td>
      );
    }
    if (column === "costSource") return <td className="calculated-cell" key={column}>{row.costSourceLabel}</td>;
    if (column === "vat") {
      return (
        <td className="editable-cell" key={column}>
          <select
            value={vatControls[row.rowKey]?.mode ?? row.vatMode}
            onChange={(event) => updateVat(row.rowKey, { mode: event.target.value as VatMode }, index)}
          >
            <option value="included">Incluido</option>
            <option value="excluded">Por sumar</option>
            <option value="exempt">Exento</option>
          </select>
          <input
            className="compact-input"
            inputMode="decimal"
            value={vatControls[row.rowKey]?.ratePct ?? row.vatRatePct}
            onChange={(event) => updateVat(row.rowKey, { ratePct: updateNumeric(event.target.value) ?? 0 }, index)}
          />
        </td>
      );
    }
    if (column === "reference") {
      return (
        <td className="editable-cell" key={column}>
          <input
            className="table-input compact-input"
            inputMode="numeric"
            value={items[index]?.referenceUnit ?? ""}
            onChange={(event) => updateItem(index, { referenceUnit: updateNumeric(event.target.value) })}
            placeholder="COP"
          />
        </td>
      );
    }
    if (column === "offerMode") {
      return (
        <td className="editable-cell" key={column}>
          <select value={row.control.mode} onChange={(event) => switchOfferMode(row, index, event.target.value as OfferMode)}>
            {(["discount", "profit", "manual"] as OfferMode[]).map((mode) => (
              <option value={mode} key={mode}>
                {labelForOfferMode(mode)}
              </option>
            ))}
          </select>
        </td>
      );
    }
    if (column === "offerAdjust") {
      return (
        <td className="editable-cell offer-adjust-cell" key={column}>
          <select value={row.control.mode} onChange={(event) => switchOfferMode(row, index, event.target.value as OfferMode)}>
            {(["discount", "profit", "manual"] as OfferMode[]).map((mode) => (
              <option value={mode} key={mode}>
                {labelForOfferMode(mode)}
              </option>
            ))}
          </select>
          {row.control.mode === "discount" ? (
            <>
              <input
                className="wide-range"
                type="range"
                min="-100"
                max="100"
                step="0.5"
                value={row.control.discountPct}
                onChange={(event) => updateControl(row.rowKey, { discountPct: Number(event.target.value) }, index)}
              />
              <span>{formatPercent(row.control.discountPct)}</span>
            </>
          ) : row.control.mode === "profit" ? (
            <>
              <input
                className="wide-range"
                type="range"
                min="-100"
                max="100"
                step="0.5"
                value={row.control.profitPct}
                onChange={(event) => updateControl(row.rowKey, { profitPct: Number(event.target.value) }, index)}
              />
              <span>{formatPercent(row.control.profitPct)}</span>
            </>
          ) : (
            <input
              className="compact-input"
              inputMode="numeric"
              value={row.control.manualOfferUnit ?? ""}
              onChange={(event) => updateControl(row.rowKey, { manualOfferUnit: updateNumeric(event.target.value) }, index)}
              placeholder="COP"
            />
          )}
        </td>
      );
    }
    if (column === "offerUnit") return <td className="money calculated-cell" key={column}>{formatCop(row.offerUnit)}</td>;
    if (column === "offerTotal") return <td className="money calculated-cell" key={column}>{formatCop(row.offerTotal)}</td>;
    if (column === "utility") {
      return (
        <td className="money calculated-cell utility-cell" key={column}>
          <strong>{formatCop(row.utilityValue)}</strong>
          <span>{formatPercent(row.marginPctOnCost)}</span>
        </td>
      );
    }
    if (column === "status") {
      return (
        <td className="calculated-cell status-alert-cell" key={column}>
          <span className={`status-pill ${row.status}`}>{statusLabel(row.status)}</span>
          {row.warnings.length ? (
            <details className="warning-details">
              <summary>{row.warnings.length} alerta(s)</summary>
              <ul className="warning-list">
                {row.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : (
            <span className="muted">Sin alertas</span>
          )}
        </td>
      );
    }
    if (column === "warnings") {
      return (
        <td className="calculated-cell" key={column}>
          {row.warnings.length ? (
            <ul className="warning-list">
              {row.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <span className="muted">Sin alertas</span>
          )}
        </td>
      );
    }
    return (
      <td className="action-cell" key={column}>
        <button
          className="icon-button danger-button"
          type="button"
          onClick={() => requestRemoveItem(index)}
          title="Eliminar item"
        >
          X
        </button>
      </td>
    );
  }

  function renderDetailModal(): ReactNode {
    if (detailRowIndex === null) return null;
    const item = items[detailRowIndex];
    const row = simulation.rows[detailRowIndex];
    if (!item || !row) return null;

    return (
      <div
        className="item-detail-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del item"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setDetailRowIndex(null);
          }
        }}
      >
        <div className="item-detail-modal">
          <div className="item-detail-head">
            <div>
              <span className="modal-eyebrow">Detalle del item</span>
              <h2>{item.description || row.description || "Sin nombre"}</h2>
              <p>{item.item ? `Item ${item.item}` : "Item sin codigo"}</p>
            </div>
            <button className="modal-close-button" type="button" onClick={() => setDetailRowIndex(null)} aria-label="Cerrar detalle">
              X
            </button>
          </div>

          <div className="details-body modal-details-body">
            <div className="detail-metrics">
              <span>Minimo: <strong>{formatCop(row.costBreakdown.minimum)}</strong></span>
              <span>Promedio: <strong>{formatCop(row.costBreakdown.average)}</strong></span>
              <span>Moderado: <strong>{formatCop(row.costBreakdown.moderate)}</strong></span>
            </div>
            <label>
              Ficha tecnica
              <textarea
                value={item.technicalDescription ?? ""}
                onChange={(event) => updateItem(detailRowIndex, { technicalDescription: event.target.value })}
                placeholder="Sin ficha tecnica"
              />
            </label>
            {[0, 1, 2].map((sourceIndex) => {
              const source = sourceAt(item, sourceIndex);
              const normalized = row.costBreakdown.sources[sourceIndex];
              return (
                <fieldset className="source-fieldset" key={source.id || sourceIndex}>
                  <legend>Fuente {sourceIndex + 1}</legend>
                  <div className="edit-grid source-grid">
                    <label>
                      Nombre
                      <input value={source.label} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { label: event.target.value })} />
                    </label>
                    <label>
                      Precio
                      <input
                        inputMode="numeric"
                        value={source.unitPrice ?? ""}
                        onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { unitPrice: updateNumeric(event.target.value) })}
                        placeholder="Valor unitario"
                      />
                    </label>
                    <label>
                      Moneda
                      <select
                        value={source.currency}
                        onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { currency: event.target.value as PriceSourceCurrency })}
                      >
                        {SOURCE_CURRENCIES.map((currency) => (
                          <option value={currency} key={currency}>
                            {currency}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      TRM
                      <input
                        inputMode="numeric"
                        value={source.trm ?? ""}
                        onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { trm: updateNumeric(event.target.value) })}
                        placeholder="Usa global"
                      />
                    </label>
                    <label>
                      Importacion %
                      <input
                        inputMode="decimal"
                        value={source.importPct ?? ""}
                        onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { importPct: updateNumeric(event.target.value) })}
                        placeholder="Usa global"
                      />
                    </label>
                    <label>
                      URL
                      <input value={source.url} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { url: event.target.value })} />
                    </label>
                  </div>
                  <div className="source-normalized">
                    Normalizado COP: <strong>{formatCop(normalized?.normalizedUnit ?? null)}</strong>
                    {normalized?.warning ? <span>{normalized.warning}</span> : null}
                  </div>
                </fieldset>
              );
            })}
            <label>
              Notas
              <textarea value={item.notes ?? ""} onChange={(event) => updateItem(detailRowIndex, { notes: event.target.value })} />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="calculation-workspace">
      {renderDetailModal()}
      <section className="calculation-header">
        <div className="title-stack">
          <input
            aria-label="Nombre del cálculo"
            className="title-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="metadata-line">
            <span>{formatNumber(project.items.length)} items</span>
            <span>{project.currency}</span>
            <span>Act: {formatBogotaDateTime(project.updatedAt)}</span>
            {project.entity ? <span>{project.entity}</span> : <span>Borrador sin entidad</span>}
          </div>
        </div>
        <div className="header-actions">
          <button className="button" type="button" onClick={saveCalculation} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Guardando..." : "Guardar"}
          </button>
          <button className="ghost-button" type="button" onClick={() => saveAndExport("json")} disabled={saveStatus === "saving"}>
            JSON
          </button>
          <button className="ghost-button" type="button" onClick={() => saveAndExport("csv")} disabled={saveStatus === "saving"}>
            CSV
          </button>
          <Link className="ghost-button" href="/">
            Volver
          </Link>
          <TrmCalculator />
        </div>
        {saveStatus === "saved" ? <div className="status-line success compact-status">Cambios guardados.</div> : null}
        {saveStatus === "error" ? <div className="status-line error compact-status">No se pudo guardar el cálculo.</div> : null}
      </section>

      <section className="panel workspace-panel">
        <div className="panel-header">
          <div className="tabs">
            <button className={`tab ${tab === "simulator" ? "active" : ""}`} type="button" onClick={() => setTab("simulator")}>
              Simulador Financiero
            </button>
            <button className={`tab ${tab === "offer" ? "active" : ""}`} type="button" onClick={() => setTab("offer")}>
              Oferta económica
            </button>
          </div>
        </div>

        {tab === "simulator" ? (
          <div className="simulator-view">
            <div className="summary-section results-panel">
              <div className={`summary-block result-lane result-total ${totalComplete ? "is-complete" : "is-empty"}`}>
                <div className="summary-block-head">
                  <h2 className="section-title">Resumen total</h2>
                  <div className="result-head-actions">
                    {totalHasKnownReference ? (
                      <span className="summary-ceiling-chip">
                        <small>Precio techo</small>
                        <strong>{formatCop(simulation.summary.referenceKnownTotal)}</strong>
                        <em>{simulation.summary.referenceKnownCount}/{simulation.summary.itemCount} items</em>
                      </span>
                    ) : null}
                    {!totalComplete ? (
                      <span
                        className="info-dot"
                        title={`Faltan datos para cerrar el total: ${simulation.summary.missingCostCount} sin costo, ${simulation.summary.missingReferenceCount} sin techo, ${simulation.summary.missingOfferCount} sin oferta.`}
                      >
                        i
                      </span>
                    ) : null}
                    <span className={`status-pill ${totalComplete ? "viable" : "incomplete"}`}>
                      {totalScope.evaluableCount}/{simulation.summary.itemCount} items
                    </span>
                  </div>
                </div>
                {totalHasMetrics ? (
                  <div className="summary-financial-head">
                    <div className="summary-card summary-offer-card">
                      <small>Oferta</small>
                      <strong>{summaryValue(totalScope.totalOffer, totalComplete)}</strong>
                    </div>
                    <div className="summary-card summary-margin-card">
                      <small>Margen</small>
                      <strong className={healthClass(totalScope.marginPctOnCost)}>{formatPercent(totalScope.marginPctOnCost)}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="summary-empty-state summary-empty-state-compact">
                    <strong>{totalHasKnownReference ? "Total financiero pendiente" : "Pendiente de datos completos"}</strong>
                    <span>{totalPendingMessage}</span>
                  </div>
                )}
                <div
                  className={`composition-bar composition-bar-total ${totalHasAmounts ? "" : "composition-empty"}`}
                  aria-label="Composicion total costo utilidad"
                >
                  <div className="composition-segment composition-total-cost" style={{ width: `${totalComposition.costPct}%` }}>
                    <span>Costo</span>
                    <strong>{totalHasAmounts ? formatCop(totalScope.totalCost) : "Pendiente"}</strong>
                    {totalHasAmounts ? <em>{formatPercent(percentOf(totalScope.totalCost, totalScope.totalOffer))}</em> : null}
                  </div>
                  <div className="composition-segment composition-total-utility" style={{ width: `${totalComposition.utilityPct}%` }}>
                    <span>Utilidad</span>
                    <strong>{totalHasAmounts ? formatCop(totalScope.totalMargin) : "Pendiente"}</strong>
                    {totalHasAmounts ? <em>{formatPercent(percentOf(totalScope.totalMargin, totalScope.totalOffer))}</em> : null}
                  </div>
                </div>
              </div>

              <div className={`summary-block result-lane result-partial ${totalComplete ? "is-secondary" : ""}`}>
                <div className="summary-block-head">
                  <h2 className="section-title">Resumen parcial evaluable</h2>
                  <div className="result-head-actions">
                    {partialHasMetrics ? (
                      <span className="summary-ceiling-chip summary-ceiling-chip-partial">
                        <small>Techo parcial</small>
                        <strong>{formatCop(partialScope.totalReference)}</strong>
                        <em>{partialScope.evaluableCount}/{simulation.summary.itemCount} items</em>
                      </span>
                    ) : null}
                    <span className="status-pill no_ceiling">
                      {simulation.summary.partial.evaluableCount}/{simulation.summary.itemCount} items
                    </span>
                  </div>
                </div>
                {totalComplete ? (
                  <div className="summary-empty-state">
                    <strong>Total completo disponible</strong>
                    <span>Este parcial ya no aporta una lectura distinta. Revisa el resumen total.</span>
                  </div>
                ) : partialHasMetrics ? (
                  <div className="summary-financial-head">
                    <div className="summary-card summary-offer-card">
                      <small>Oferta</small>
                      <strong>{formatCop(partialScope.totalOffer)}</strong>
                    </div>
                    <div className="summary-card summary-margin-card">
                      <small>Margen</small>
                      <strong className={healthClass(partialScope.marginPctOnCost)}>{formatPercent(partialScope.marginPctOnCost)}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="summary-empty-state">
                    <strong>Sin items evaluables todavia</strong>
                    <span>Cuando haya al menos un item completo, veras aqui la lectura parcial.</span>
                  </div>
                )}
                <div className={`composition-bar composition-bar-partial ${partialCompositionActive ? "" : "composition-empty"}`} aria-label="Composición parcial costo utilidad">
                  <div className="composition-segment composition-cost" style={{ width: `${partialComposition.costPct}%` }}>
                    <span>Costo</span>
                    <strong>{partialCompositionActive ? formatCop(partialScope.totalCost) : totalComplete ? "Ver total" : "Pendiente"}</strong>
                    {partialCompositionActive ? <em>{formatPercent(percentOf(partialScope.totalCost, partialScope.totalOffer))}</em> : null}
                  </div>
                  <div className="composition-segment composition-utility" style={{ width: `${partialComposition.utilityPct}%` }}>
                    <span>Utilidad</span>
                    <strong>{partialCompositionActive ? formatCop(partialScope.totalMargin) : totalComplete ? "Resumen total" : "Pendiente"}</strong>
                    {partialCompositionActive ? <em>{formatPercent(percentOf(partialScope.totalMargin, partialScope.totalOffer))}</em> : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="toolbar-line compact-toolbar">
              <div className="toolbar-group">
                <label className="toolbar-select">
                  Filas
                  <select value="" onChange={(event) => addRowsFromSelect(event.target.value)}>
                    <option value="">Agregar...</option>
                    <option value="1">Agregar 1 item</option>
                    <option value="5">Agregar 5 filas</option>
                  </select>
                </label>
                <label className="toolbar-select">
                  Costo a usar
                  <select value="" onChange={(event) => applyCostModeFromSelect(event.target.value)}>
                    <option value="">Aplicar...</option>
                    {(["weighted", "moderate", "optimistic", "manual"] as CostMode[]).map((mode) => (
                      <option value={mode} key={mode}>
                        {labelForMode(mode)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={manualCostPriority} onChange={(event) => setManualCostPriority(event.target.checked)} />
                  Priorizar manual si existe
                </label>
                <label className="toolbar-input">
                  TRM USD
                  <input
                    inputMode="numeric"
                    value={usdToCopRate ?? ""}
                    onChange={(event) => setUsdToCopRate(updateNumeric(event.target.value))}
                    placeholder="Opcional"
                  />
                </label>
                <label className="toolbar-input">
                  Importacion USD %
                  <input
                    inputMode="decimal"
                    value={usdImportPct}
                    onChange={(event) => setUsdImportPct(updateNumeric(event.target.value) ?? 30)}
                  />
                </label>
                <button className="cost-toggle-button" type="button" onClick={() => setShowCostDetails((current) => !current)}>
                  {showCostDetails ? "Ocultar cálculos de costo" : "+ Ver cálculos de costo"}
                </button>
              </div>
              <ColumnControls
                columns={SIMULATOR_COLUMNS}
                prefs={columnPrefs}
                onToggle={setColumnVisible}
                onWidth={setColumnWidth}
                onReset={() => setColumnPrefs(defaultColumnPrefs())}
              />
            </div>
            <TableWorkspace compactNote="La tabla tiene scroll propio y encabezados fijos.">
              <table className="financial-table" style={{ minWidth: `${simulatorTableWidth}px`, width: `${simulatorTableWidth}px` }}>
                <colgroup>
                  {visibleSimulatorColumns.map((column) => (
                    <col key={column.key} style={{ width: `${columnPrefs[column.key]?.width ?? column.defaultWidth}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>{visibleSimulatorColumns.map(renderHeader)}</tr>
                </thead>
                <tbody>
                  {sortedSimulatorRows.map(({ row, index }) => (
                    <tr key={row.rowKey}>{visibleSimulatorColumns.map((column) => renderSimulatorCell(column.key, row, index))}</tr>
                  ))}
                </tbody>
              </table>
            </TableWorkspace>
          </div>
        ) : (
          <div className="offer-view">
            {!totalComplete ? (
              <div className="status-line compact-warning">
                La oferta económica se muestra con datos parciales mientras completás costos, cantidades, techo y oferta por ítem.
              </div>
            ) : null}
            <div className="summary-grid">
              <div className="summary-card">
                <small>Total sin IVA</small>
                <strong>{totalComplete ? formatCop(offer.summary.totalOfferWithoutVat) : "N/D"}</strong>
              </div>
              <div className="summary-card">
                <small>IVA</small>
                <strong>{totalComplete ? formatCop(offer.summary.totalVat) : "N/D"}</strong>
              </div>
              <div className="summary-card">
                <small>Total final</small>
                <strong>{totalComplete ? formatCop(offer.summary.totalOfferWithVat) : "N/D"}</strong>
              </div>
              <div className="summary-card">
                <small>Utilidad estimada</small>
                <strong>{totalComplete ? formatCop(offer.summary.estimatedUtility) : "N/D"}</strong>
              </div>
              <div className="summary-card">
                <small>Sobre techo</small>
                <strong>{formatNumber(offer.summary.rowsAboveCeiling)} items</strong>
              </div>
            </div>
            <TableWorkspace compactNote="Vista de oferta con scroll interno y encabezado fijo.">
              <table className="offer-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Descripcion</th>
                    <th>Cantidad</th>
                    <th>Unit. sin IVA</th>
                    <th>IVA</th>
                    <th>Unit. final</th>
                    <th>Total final</th>
                    <th>Techo</th>
                    <th>Costo</th>
                    <th>Utilidad</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {offer.rows.map((row, index) => (
                    <tr key={row.rowKey}>
                      <td>{row.item}</td>
                      <td className="description-cell">{row.description}</td>
                      <td>{formatNumber(row.quantity)}</td>
                      <td className="money">{formatCop(row.unitPriceWithoutVat)}</td>
                      <td>
                        <label>
                          <span className="muted">Modo</span>
                          <select
                            value={vatControls[row.rowKey]?.mode ?? row.vatMode}
                            onChange={(event) => updateVat(row.rowKey, { mode: event.target.value as VatMode }, index)}
                          >
                            <option value="included">Incluido</option>
                            <option value="excluded">Por sumar</option>
                            <option value="exempt">Exento</option>
                          </select>
                        </label>
                        <input
                          className="compact-input"
                          inputMode="decimal"
                          value={vatControls[row.rowKey]?.ratePct ?? 19}
                          onChange={(event) => updateVat(row.rowKey, { ratePct: updateNumeric(event.target.value) ?? 0 }, index)}
                        />
                      </td>
                      <td className="money">{formatCop(row.unitPriceWithVat)}</td>
                      <td className="money">{formatCop(row.totalWithVat)}</td>
                      <td className="money">{formatCop(row.referenceUnit)}</td>
                      <td className="money">{formatCop(row.costUnit)}</td>
                      <td className="money">{formatCop(row.utilityValue)}</td>
                      <td>
                        <span className={`status-pill ${row.status}`}>{statusLabel(row.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWorkspace>
          </div>
        )}
      </section>
    </div>
  );
}
