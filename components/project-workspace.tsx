"use client";
import { buildOfferScreen } from "../lib/offer-presentation";
import { startVisiblePoll } from "../lib/visible-poll";
import { openSearchWindow } from "../lib/search-window";

import { Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { CalculationNotes } from "@offer/components/calculation-notes";
import { StudyDocuments } from "./study-documents";
import { AI_SAVED_EVENT, type SavedAiActivity } from "@offer/lib/chat-activity";
import { AiWorkspaceActivity } from "./ai-workspace-activity";
import { OdooProjectContext } from "./odoo-project-context";
import { CalculationCollaboration } from "@offer/components/calculation-collaboration";
import { ScenarioManager, type ScenarioManagerHandle } from "@offer/components/scenario-manager";
import { CostVersionHistory, type CostVersionHistoryHandle } from "@offer/components/cost-version-history";
import { ApplicationSettings } from "./application-settings";
import { AnchoredPopover } from "@offer/components/anchored-popover";
import { DecimalRateInput } from "@offer/components/decimal-rate-input";
import { SourcePreviewLink } from "@offer/components/source-preview-link";
import { QuoteLinkButton } from "@offer/components/quote-link-button";
import { BudgetLimitStatus } from "./budget-limit-status";
import { LotSelection } from "./lot-selection";
import { adjustmentTagsFor, estimateCostFromCeiling, rememberOfferAdjustment, removeItemAdjustment, adjustmentRemovalDetail } from "../lib/item-adjustments";
import { rowFilters, type RowFilterKey } from "../lib/row-filters";
import { costOptions, costModePatch } from "../lib/cost-options";
import { mergeWorkspace, workspaceDataKey, type WorkspaceData } from "../lib/workspace-merge";
import { downloadExport } from "../lib/client-download";
import { QUICK_EDIT_COLUMNS } from "../lib/quick-edit-columns";
import { isOriginalGridField } from "@offer/lib/quick-edit-sheet";
import { CalculationMenu } from "@offer/components/calculation-menu";
import { CalculationCostHistory, CalculationCostTarget, CalculationMenuSlot, CalculationModeSlot, CalculationBars, CalculationActionBar, CalculationActionDock, CalculationTableRibbon, createFlagStore } from "@offer/components/calculation-command-bars";
import dynamic from "next/dynamic";
import type { QuickEditPatch, QuickEditRow } from "@offer/components/quick-edit-grid";
const QuickEditGrid = dynamic(() => import("@offer/components/quick-edit-grid").then(module => module.QuickEditGrid), { loading: () => <div role="status">Abriendo tabla…</div> });
import { TableWorkspace } from "@offer/components/table-workspace";
import { TrmCalculator } from "@offer/components/trm-calculator";
import { AdditionalCostRows, GeneralCostsPanel, ItemWorkspace } from "@offer/components/item-workspace";
import { OfferItemCard } from "./offer-item-card";
import { DecisionTable } from "@offer/components/decision-table";
import { QuickCostEditor } from "@offer/components/quick-cost-editor";
import { TechnicalAnnexViewer } from "@offer/components/technical-annex-viewer";
import { OfferCompositionBar, OfferReferenceSummary } from "@offer/components/offer-composition-bar";
import { ArrowLeft, BarChart3, ChevronDown, Columns3, Download, Eye, EyeOff, Layers, ListFilter, Redo2, RotateCcw, Rows3, Save, SlidersHorizontal, Table2, Trash2, Undo2, Upload } from "lucide-react";
import { groupProcurementLots, groupedProcurementIndexes, procurementLotTotals } from "@offer/lib/procurement-lots";
import { appPath } from "@offer/lib/base-path";
import type { CostMode, CostScenarioMode, FinancialGeneralCost, FinancialOfferItem, FinancialOfferPriceSource, FinancialOfferProject, PriceSourceCurrency, VatMode, WithholdingBase } from "@offer/lib/contract";
import { spreadsheetAccept } from "@offer/lib/import-file-types";
import type { PastedItemPatch, PastedUpdateField } from "@offer/lib/client-ingest";
import { formatBogotaDateTime } from "@offer/lib/date-format";
import { externalRevisionDecision } from "@offer/lib/workspace-revision";
import { globalOfferCeilingComparison } from "@offer/lib/financial-composition";
import {
  buildInitialOfferControls,
  buildOfferPresentation,
  buildRowKey,
  buildSimulation,
  buildVatControls,
  convertOfferControlMode,
  formatCop as formatCopValue,
  formatNumber as formatNumberValue,
  formatPercent as formatPercentValue,
  manualBaseCostInputForRow,
  offerControlWithProfitPct,
  provisionalUtilityForRow,
  selectedQuoteLinks,
  type OfferControl,
  type OfferMode,
  type VatControl,
} from "@offer/lib/financial-engine";

const subscribeMobile = (notify: () => void) => {
  const media = window.matchMedia("(max-width: 640px)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const getMobileSnapshot = () => window.matchMedia("(max-width: 640px)").matches;
const getServerMobileSnapshot = () => false;

type Tab = "simulator" | "quick-edit" | "items" | "offer";
type SimulationRow = ReturnType<typeof buildSimulation>["rows"][number];
type SortDirection = "asc" | "desc";
type SortState = { key: SimulatorColumnKey; direction: SortDirection } | null;
type LockedFieldKey = "item" | "quantity" | "unit" | "reference";
type GlobalDiscountStrategy = "global" | "protect-loss" | "extremes" | "weighted-total" | "utility-cushion";
type BatchToolbarPopover = "import" | "cost" | "offer" | "scenarios" | null;
type ReviewIssueKind = "loss" | "over_ceiling" | "incomplete" | "margin_low" | "source";
type ReviewIssue = {
  kind: ReviewIssueKind;
  label: string;
  message: string;
};

type WorkspaceSnapshot = {
  excludedProcurementLotIds?: string[];
  items: FinancialOfferItem[];
  generalCosts: FinancialGeneralCost[];
  controls: Record<string, OfferControl>;
  vatControls: Record<string, VatControl>;
  name: string;
  usdToCopRate: number | null;
  manualReferenceTotal: number | null;
  settlement: SettlementState;
};

type SettlementState = Pick<
  FinancialOfferProject["settings"],
  | "applyReteFuente"
  | "reteFuenteRate"
  | "reteFuenteBase"
  | "applyReteIva"
  | "reteIvaRate"
  | "reteIvaBase"
  | "applyReteIca"
  | "reteIcaRate"
  | "reteIcaBase"
  | "stampTaxRate"
>;

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

const EMPTY_CELL = "--";

type SimulatorColumnKey =
  | "select"
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
  | "costTotal"
  | "costSource"
  | "reference"
  | "referenceTotal"
  | "offerMode"
  | "offerAdjust"
  | "offerUnit"
  | "offerTotal"
  | "utility"
  | "status"
  | "warnings"
  | "actions";

type ColumnGroup = "item" | "reference" | "cost" | "offer" | "result";

type ColumnDef = {
  key: SimulatorColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
  group: ColumnGroup;
};

type ColumnPrefs = Record<SimulatorColumnKey, { visible: boolean; width: number }>;

type TrmResponse = {
  ok: boolean;
  value?: number;
};

const GLOBAL_DISCOUNT_STRATEGIES: Array<{ value: GlobalDiscountStrategy; label: string }> = [
  { value: "global", label: "Global" },
  { value: "protect-loss", label: "Global protegido" },
  { value: "extremes", label: "Por extremos" },
  { value: "weighted-total", label: "Por peso total" },
  { value: "utility-cushion", label: "Por utilidad disponible" },
];

const SIMULATOR_COLUMNS: ColumnDef[] = [
  { key: "select", label: "Selección", defaultWidth: 38, minWidth: 28, group: "item" },
  { key: "item", label: "Item", defaultWidth: 64, minWidth: 34, group: "item" },
  { key: "description", label: "Descripción / ficha", defaultWidth: 480, minWidth: 240, group: "item" },
  { key: "reference", label: "Precio techo", defaultWidth: 154, minWidth: 94, group: "reference" },
  { key: "referenceTotal", label: "Precio techo total", defaultWidth: 138, minWidth: 84, group: "reference" },
  { key: "status", label: "Notas / Alertas", defaultWidth: 210, minWidth: 120, group: "reference" },
  { key: "quantity", label: "Cantidad", defaultWidth: 92, minWidth: 54, group: "reference" },
  { key: "manual", label: "Costo manual", defaultWidth: 124, minWidth: 86, group: "cost" },
  { key: "costUnit", label: "Costo", defaultWidth: 206, minWidth: 104, group: "cost" },
  { key: "costTotal", label: "Costo total", defaultWidth: 138, minWidth: 82, group: "cost" },
  { key: "offerAdjust", label: "Ajuste oferta", defaultWidth: 330, minWidth: 184, group: "cost" },
  { key: "offerUnit", label: "Oferta", defaultWidth: 150, minWidth: 92, group: "offer" },
  { key: "offerTotal", label: "Total oferta", defaultWidth: 138, minWidth: 86, group: "offer" },
  { key: "utility", label: "Utilidad", defaultWidth: 134, minWidth: 86, group: "offer" },
  { key: "costMode", label: "Costo a usar", defaultWidth: 150, minWidth: 96, group: "cost" },
  { key: "optimistic", label: "Costo minimo", defaultWidth: 150, minWidth: 92, group: "cost" },
  { key: "average", label: "Costo promedio", defaultWidth: 150, minWidth: 96, group: "cost" },
  { key: "weighted", label: "Costo moderado", defaultWidth: 150, minWidth: 96, group: "cost" },
];

const DECISION_COLUMNS: ColumnDef[] = [
  { key: "select", label: "Selección", defaultWidth: 34, minWidth: 28, group: "item" },
  { key: "description", label: "Ítem / descripción", defaultWidth: 220, minWidth: 210, group: "item" },
  { key: "quantity", label: "Cantidad", defaultWidth: 58, minWidth: 58, group: "reference" },
  { key: "reference", label: "Techo", defaultWidth: 100, minWidth: 95, group: "reference" },
  { key: "costUnit", label: "Costo", defaultWidth: 100, minWidth: 100, group: "cost" },
  { key: "offerUnit", label: "Oferta", defaultWidth: 100, minWidth: 100, group: "offer" },
  { key: "status", label: "Resultado", defaultWidth: 128, minWidth: 125, group: "result" },
  { key: "offerAdjust", label: "Ajuste", defaultWidth: 176, minWidth: 176, group: "offer" },
];

const COST_DETAIL_COLUMNS = new Set<SimulatorColumnKey>(["costMode", "optimistic", "average", "weighted", "costSource", "offerMode", "warnings"]);
const COST_MODES_FOR_UI: CostMode[] = ["weighted", "moderate", "optimistic", "manual", "source"];
const SOURCE_CURRENCIES: PriceSourceCurrency[] = ["COP", "USD"];
const FROZEN_SIMULATOR_COLUMNS = new Set<SimulatorColumnKey>(["select", "item", "description", "reference"]);
const COLUMN_PREFS_VERSION = "v3";

const AUTO_COLUMN_IDEAL_WIDTHS: Partial<Record<SimulatorColumnKey, number>> = {
  select: 30,
  item: 48,
  description: 400,
  reference: 132,
  status: 168,
  quantity: 82,
  costUnit: 156,
  manual: 116,
  offerAdjust: 270,
  offerUnit: 136,
  utility: 116,
  referenceTotal: 118,
  costTotal: 112,
  offerTotal: 118,
  costMode: 112,
  optimistic: 118,
  average: 122,
  weighted: 122,
};

const AUTO_COLUMN_MAX_WIDTHS: Partial<Record<SimulatorColumnKey, number>> = {
  select: 38,
  item: 64,
  description: 560,
  reference: 158,
  status: 260,
  quantity: 96,
  costUnit: 184,
  manual: 132,
  offerAdjust: 340,
  offerUnit: 152,
  utility: 138,
  referenceTotal: 138,
  costTotal: 130,
  offerTotal: 138,
  costMode: 140,
  optimistic: 145,
  average: 150,
  weighted: 150,
};

const AUTO_COLUMN_FLEX_WEIGHTS: Partial<Record<SimulatorColumnKey, number>> = {
  description: 5,
  offerAdjust: 3,
  status: 2,
  costUnit: 1.2,
  reference: 1,
  offerUnit: 0.8,
};

function defaultColumnPrefs(): ColumnPrefs {
  return Object.fromEntries(
    SIMULATOR_COLUMNS.map((column) => [
      column.key,
      { visible: !["referenceTotal", "costTotal", "offerTotal", "actions"].includes(column.key), width: column.defaultWidth },
    ]),
  ) as ColumnPrefs;
}

function defaultDecisionColumnPrefs(): ColumnPrefs {
  const prefs = defaultColumnPrefs();
  for (const column of DECISION_COLUMNS) prefs[column.key] = { visible: true, width: column.defaultWidth };
  return prefs;
}

function normalizeDecisionColumnPrefs(value: unknown): ColumnPrefs {
  const prefs = defaultDecisionColumnPrefs();
  if (!value || typeof value !== "object") return prefs;
  const raw = value as Partial<Record<SimulatorColumnKey, Partial<{ visible: boolean; width: number }>>>;
  for (const column of DECISION_COLUMNS) {
    const current = raw[column.key];
    prefs[column.key] = {
      visible: current?.visible !== false,
      width: typeof current?.width === "number" ? Math.max(column.minWidth, Math.min(520, current.width)) : column.defaultWidth,
    };
  }
  return prefs;
}

function normalizeColumnPrefs(value: unknown): ColumnPrefs {
  const defaults = defaultColumnPrefs();
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Partial<Record<SimulatorColumnKey, Partial<{ visible: boolean; width: number }>>>;
  return Object.fromEntries(
    SIMULATOR_COLUMNS.map((column) => {
      const current = raw[column.key];
      const width = typeof current?.width === "number" ? Math.max(column.minWidth, Math.min(520, current.width)) : column.defaultWidth;
      return [column.key, { visible: current?.visible ?? defaults[column.key].visible, width }];
    }),
  ) as ColumnPrefs;
}

function autoFitColumnPrefs(basePrefs: ColumnPrefs, availableWidth: number, showCostDetails: boolean): ColumnPrefs {
  const next = { ...basePrefs };
  const visibleColumns = SIMULATOR_COLUMNS.filter((column) => next[column.key]?.visible !== false && (showCostDetails || !COST_DETAIL_COLUMNS.has(column.key)));
  const usableWidth = Math.max(320, Math.floor(availableWidth) - 6);
  const widthByKey = new Map<SimulatorColumnKey, number>();

  for (const column of SIMULATOR_COLUMNS) {
    const ideal = AUTO_COLUMN_IDEAL_WIDTHS[column.key] ?? column.defaultWidth;
    const max = AUTO_COLUMN_MAX_WIDTHS[column.key] ?? column.defaultWidth;
    widthByKey.set(column.key, Math.max(column.minWidth, Math.min(max, ideal)));
  }

  function visibleWidth() {
    return visibleColumns.reduce((total, column) => total + (widthByKey.get(column.key) ?? column.defaultWidth), 0);
  }

  const currentWidth = visibleWidth();
  if (currentWidth > usableWidth) {
    const shrinkOrder: SimulatorColumnKey[] = ["description", "status", "offerAdjust", "costUnit", "reference", "manual", "offerUnit", "utility", "quantity", "item"];
    let overflow = currentWidth - usableWidth;
    for (const key of shrinkOrder) {
      if (overflow <= 0) break;
      const column = visibleColumns.find((candidate) => candidate.key === key);
      if (!column) continue;
      const width = widthByKey.get(key) ?? column.defaultWidth;
      const reducible = Math.max(0, width - column.minWidth);
      const reduction = Math.min(reducible, overflow);
      widthByKey.set(key, width - reduction);
      overflow -= reduction;
    }
  } else if (currentWidth < usableWidth) {
    const flexEntries = visibleColumns
      .map((column) => ({ column, weight: AUTO_COLUMN_FLEX_WEIGHTS[column.key] ?? 0 }))
      .filter((entry) => entry.weight > 0);
    let extra = usableWidth - currentWidth;
    while (extra > 1 && flexEntries.length) {
      const totalWeight = flexEntries.reduce((sum, entry) => sum + entry.weight, 0);
      let used = 0;
      for (const entry of flexEntries) {
        const key = entry.column.key;
        const width = widthByKey.get(key) ?? entry.column.defaultWidth;
        const max = AUTO_COLUMN_MAX_WIDTHS[key] ?? entry.column.defaultWidth;
        const room = Math.max(0, max - width);
        if (!room) continue;
        const addition = Math.min(room, Math.max(1, Math.floor((extra * entry.weight) / totalWeight)));
        widthByKey.set(key, width + addition);
        used += addition;
      }
      if (!used) break;
      extra -= used;
    }
  }

  for (const column of SIMULATOR_COLUMNS) {
    next[column.key] = {
      ...next[column.key],
      width: Math.max(column.minWidth, Math.min(520, Math.round(widthByKey.get(column.key) ?? column.defaultWidth))),
    };
  }
  return next;
}

function cloneProject(
  project: FinancialOfferProject,
  items: FinancialOfferItem[],
  generalCosts: FinancialGeneralCost[],
  settings: Partial<FinancialOfferProject["settings"]>,
): FinancialOfferProject {
  return { ...project, settings: { ...project.settings, ...settings }, items, generalCosts };
}

const WITHHOLDING_BASE_LABELS: Record<WithholdingBase, string> = {
  pre_vat: "Valor antes de IVA",
  vat: "Valor del IVA",
  total: "Valor total",
};

function WithholdingControl(props: {
  label: string;
  enabled: boolean;
  rate: number;
  base: WithholdingBase;
  onChange: (patch: { enabled?: boolean; rate?: number; base?: WithholdingBase }) => void;
}) {
  return (
    <div className="withholding-control">
      <label className="withholding-switch">
        <input type="checkbox" checked={props.enabled} onChange={(event) => props.onChange({ enabled: event.target.checked })} />
        <strong>{props.label}</strong>
      </label>
      <label>
        <span>Tasa</span>
        <DecimalRateInput
          value={props.rate}
          onValueChange={(rate) => props.onChange({ rate })}
          ariaLabel={`Tasa ${props.label}`}
        />
        <em>%</em>
      </label>
      <label>
        <span>Base</span>
        <select value={props.base} onChange={(event) => props.onChange({ base: event.target.value as WithholdingBase })}>
          {Object.entries(WITHHOLDING_BASE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}


function updateNumeric(value: string): number | null {
  const textValue = value
    .replace(/ /g, " ")
    .replace(/COP|COL\$|\$|USD/gi, " ")
    .trim();
  if (!textValue || /^(n\/d|nd|na|null|sin dato|-+)$/i.test(textValue)) return null;
  const match = textValue.match(/-?\d[\d.,\s]*/);
  if (!match) return null;

  let numberText = match[0].replace(/\s/g, "");
  const commaIndex = numberText.lastIndexOf(",");
  const dotIndex = numberText.lastIndexOf(".");
  if (commaIndex >= 0 && dotIndex >= 0) {
    numberText = commaIndex > dotIndex ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    const decimals = numberText.length - commaIndex - 1;
    numberText = decimals > 0 && decimals <= 2 ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (dotIndex >= 0) {
    const decimals = numberText.length - dotIndex - 1;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(numberText) || decimals > 2) {
      numberText = numberText.replace(/\./g, "");
    }
  }
  const parsed = Number(numberText);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasDisplayNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function formatNumber(value: number | null | undefined, decimals = 0, emptyValue = EMPTY_CELL): string {
  return hasDisplayNumber(value) ? formatNumberValue(value, decimals) : emptyValue;
}

function formatCop(value: number | null | undefined, emptyValue = EMPTY_CELL): string {
  return hasDisplayNumber(value) ? formatCopValue(value) : emptyValue;
}

function formatPercent(value: number | null | undefined, decimals = 1, emptyValue = EMPTY_CELL): string {
  return hasDisplayNumber(value) ? formatPercentValue(value, decimals) : emptyValue;
}

function optionalCellText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function displayCostSource(row: SimulationRow): string {
  return row.costUnit === null ? "" : optionalCellText(row.costSourceLabel);
}

// Odoo 17+ ya no abre los enlaces antiguos "/web#id=…&model=…" (llevan al inicio): se arma la ruta actual del proyecto.
function odooProjectHref(project: { odooProjectId?: string | null; odooReturnUrl?: string | null }): string | null {
  if (!project.odooProjectId) return project.odooReturnUrl || null;
  const path = `/odoo/project.project/${encodeURIComponent(project.odooProjectId)}`;
  try {
    if (project.odooReturnUrl) {
      const url = new URL(project.odooReturnUrl);
      const db = url.searchParams.get("db");
      return `${url.origin}${path}${db ? `?db=${encodeURIComponent(db)}` : ""}`;
    }
  } catch {
    // Enlace guardado inválido: se usa la ruta en el mismo dominio.
  }
  return path;
}

function displayItemNumber(value: string | null | undefined): string {
  return String(value ?? "").replace(/^(\d+)\.0+$/, "$1");
}

function formatInputNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const raw = String(value);
  const decimals = raw.includes(".") ? Math.min(4, raw.split(".")[1]?.length ?? 0) : 0;
  return formatNumber(value, decimals);
}

function labelForMode(mode: CostMode): string {
  if (mode === "optimistic") return "Costo minimo";
  if (mode === "moderate") return "Costo promedio";
  if (mode === "manual") return "Costo manual";
  if (mode === "source") return "Cotización elegida";
  return "Costo moderado";
}

function labelForCostScenarioMode(mode: CostScenarioMode | null | undefined): string {
  return mode === "lot" ? "Lote" : "Unit.";
}

function shortLabelForMode(mode: CostMode): string {
  if (mode === "optimistic") return "Minimo";
  if (mode === "moderate") return "Promedio";
  if (mode === "manual") return "Manual";
  if (mode === "source") return "Cotización elegida";
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

function compactText(value: string | null | undefined, maxLength = 98): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Sin descripcion";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}

function reviewIssuesFor(row: SimulationRow): ReviewIssue[] {
  const warnings = row.warnings;
  const emptyItemWarning = warnings.find((warning) => warning.toLowerCase().includes("item incompleto"));
  if (emptyItemWarning) {
    return [{ kind: "incomplete", label: "Incompleto", message: emptyItemWarning.replace(/\.$/, "") }];
  }

  const issues: ReviewIssue[] = [];
  if (row.status === "loss") {
    issues.push({ kind: "loss", label: "Pérdida", message: "La oferta queda por debajo del costo." });
  } else if (row.status === "over_ceiling") {
    issues.push({ kind: "over_ceiling", label: "Sobre techo", message: "La oferta supera el precio techo." });
  } else if (row.status === "incomplete") {
    const missing = warnings.find((warning) => /falta|no hay costo/i.test(warning));
    issues.push({ kind: "incomplete", label: "Incompleto", message: (missing ?? "Faltan datos para calcular el ítem.").replace(/\.$/, "") });
  }

  if (row.status === "tight" || warnings.some((warning) => warning.toLowerCase().includes("margen bajo"))) {
    issues.push({ kind: "margin_low", label: "Margen bajo", message: "La utilidad está entre 0 % y 10 % sobre el costo." });
  }

  const sourceWarning = warnings.find((warning) => /usd|trm|importaci.n|fuente/i.test(warning));
  if (sourceWarning) {
    issues.push({ kind: "source", label: "Fuente", message: sourceWarning.replace(/\.$/, "") });
  }
  return issues;
}

function reviewIssuePriority(issue: ReviewIssue): number {
  return ({ loss: 0, over_ceiling: 1, incomplete: 2, margin_low: 3, source: 4 } satisfies Record<ReviewIssueKind, number>)[issue.kind];
}

const REVIEW_FILTERS: Array<{ kind: ReviewIssueKind; label: string }> = [
  { kind: "loss", label: "Pérdida" },
  { kind: "over_ceiling", label: "Sobre techo" },
  { kind: "incomplete", label: "Incompletos" },
  { kind: "margin_low", label: "Margen bajo" },
  { kind: "source", label: "Fuentes" },
];

function reviewActionLabel(issue: ReviewIssue): string {
  if (issue.kind === "incomplete") return "Completar ítem";
  if (issue.kind === "source") return "Ver fuentes";
  return "Ajustar oferta";
}

function hasUsdPriceSources(items: FinancialOfferItem[]): boolean {
  return items.some((item) => item.priceSources.some((source) => source.currency === "USD" && source.unitPrice !== null));
}

function conciseWarning(warning: string): string {
  const normalized = warning.toLowerCase();
  if (normalized.includes("item incompleto")) return "Completar ítem";
  if (normalized.includes("supera el precio techo")) return "Sobre techo";
  if (normalized.includes("por debajo del costo")) return "Perdida";
  if (normalized.includes("margen bajo")) return "Margen bajo";
  if (normalized.includes("usd sin trm")) return "USD sin TRM";
  if (normalized.includes("falta precio techo") || normalized.includes("precio techo no disponible")) return "Sin techo";
  if (normalized.includes("falta oferta") || normalized.includes("oferta unitaria no disponible")) return "Sin oferta";
  if (normalized.includes("costo manual")) return "Falta costo manual";
  if (normalized.includes("costo unitario") || normalized.includes("costo moderado") || normalized.includes("costo promedio") || normalized.includes("costo minimo")) {
    return "Sin costo";
  }
  if (normalized.includes("cantidad")) return "Sin cantidad";
  return warning.replace(/\.$/, "");
}

function warningTone(warning: string): string {
  const normalized = warning.toLowerCase();
  if (normalized.includes("item incompleto")) return "info";
  if (normalized.includes("supera el precio techo")) return "over";
  if (normalized.includes("por debajo del costo")) return "loss";
  if (normalized.includes("margen bajo")) return "tight";
  return "info";
}

function isEmptyFieldWarning(warning: string): boolean {
  const normalized = warning.toLowerCase();
  return (
    normalized.includes("precio techo no disponible") ||
    normalized.includes("oferta unitaria no disponible") ||
    normalized.includes("costo unitario") ||
    normalized.includes("costo moderado") ||
    normalized.includes("costo promedio") ||
    normalized.includes("costo minimo") ||
    normalized.includes("no hay costo") ||
    normalized.includes("no hay valor manual") ||
    normalized.includes("cantidad")
  );
}

const ADJUSTMENT_MIN = -100;
const DEFAULT_PROFIT_MAX = 100;
const ADJUSTMENT_OVERFLOW_FACTOR = 1.25;
const ADJUSTMENT_STEP = 0.1;
const SAFE_ZONE_START = 33;
const SAFE_ZONE_END = 67;
const SAFE_ZONE_CENTER = (SAFE_ZONE_START + SAFE_ZONE_END) / 2;

type AdjustmentRisk = "safe" | "loss" | "over_ceiling" | "unknown";

type AdjustmentSafety = {
  safeStartPct: number | null;
  safeEndPct: number | null;
  safeStartValue: number | null;
  safeEndValue: number | null;
  label: string;
  risk: AdjustmentRisk;
};

type AdjustmentGate = {
  rowKey: string;
  mode: "discount" | "profit";
  side: "below" | "above";
  boundary: number;
};

function clampAdjustment(value: number): number {
  return Math.max(ADJUSTMENT_MIN, value);
}

function roundAdjustment(value: number): number {
  return Math.round(value / ADJUSTMENT_STEP) * ADJUSTMENT_STEP;
}

function mapAdjustmentRange(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  if (fromMax <= fromMin) return (toMin + toMax) / 2;
  const progress = Math.min(1, Math.max(0, (value - fromMin) / (fromMax - fromMin)));
  return toMin + (toMax - toMin) * progress;
}

function safeRangeLabel(start: number, end: number): string {
  return `Rango sin pérdida: ${formatPercent(start, 0)} a ${formatPercent(end, 0)}`;
}

function discountSafeRangeLabel(start: number, end: number): string {
  return `Rango sin pérdida: ${formatPercent(-end, 0)} a ${formatPercent(-start, 0)}`;
}

function adjustmentRiskLabel(risk: AdjustmentRisk): string | null {
  if (risk === "loss") return "Pérdida";
  if (risk === "over_ceiling") return "Sobre techo";
  return null;
}

function rawMaxSafeAdjustmentValue(row: ReturnType<typeof buildSimulation>["rows"][number], mode: "discount" | "profit"): number | null {
  if (mode === "discount") {
    if (!row.referenceUnit || row.referenceUnit <= 0 || row.costUnit === null) return null;
    return Math.max(0, (1 - row.costUnit / row.referenceUnit) * 100);
  }
  if (row.costUnit === null || row.costUnit <= 0) return null;
  return row.referenceUnit && row.referenceUnit > 0 ? Math.max(0, (row.referenceUnit / row.costUnit - 1) * 100) : null;
}

function discountValueForRow(row: ReturnType<typeof buildSimulation>["rows"][number]): number {
  if (!row.referenceUnit || row.referenceUnit === 0 || row.offerUnit === null) return row.control.discountPct;
  return 100 - (row.offerUnit / row.referenceUnit) * 100;
}

function profitValueForRow(row: ReturnType<typeof buildSimulation>["rows"][number]): number {
  if (row.costUnit === null || row.costUnit === 0 || row.offerUnit === null) return row.control.profitPct;
  return (row.offerUnit / row.costUnit - 1) * 100;
}

function offerUnitFromDiscount(row: ReturnType<typeof buildSimulation>["rows"][number], discountPct: number): number | null {
  return row.referenceUnit === null ? row.offerUnit : row.referenceUnit * (1 - discountPct / 100);
}

function offerUnitFromProfit(row: ReturnType<typeof buildSimulation>["rows"][number], profitPct: number): number | null {
  return row.costUnit === null ? row.offerUnit : row.costUnit * (1 + profitPct / 100);
}

function offerPatchFromUnit(row: ReturnType<typeof buildSimulation>["rows"][number], manualOfferUnit: number | null): Partial<OfferControl> {
  const discountPct = row.referenceUnit && manualOfferUnit !== null ? 100 - (manualOfferUnit / row.referenceUnit) * 100 : row.control.discountPct;
  const profitPct = row.costUnit && manualOfferUnit !== null ? (manualOfferUnit / row.costUnit - 1) * 100 : row.control.profitPct;
  // The existing contract field is called manualOfferUnit, but here it stores
  // the current calculated offer value. The selected mode only changes how
  // that same value is represented and edited.
  return { manualOfferUnit, discountPct, profitPct };
}

function adjustmentBounds(row: ReturnType<typeof buildSimulation>["rows"][number], mode: "discount" | "profit"): { min: number; max: number } {
  const safeMax = rawMaxSafeAdjustmentValue(row, mode);
  if (mode === "discount") {
    // Keep room on both sides: the user can deliberately offer above the
    // ceiling or below cost after crossing the corresponding safety gate.
    return { min: ADJUSTMENT_MIN, max: 100 };
  }
  const max = Math.max(DEFAULT_PROFIT_MAX, Math.ceil((safeMax ?? DEFAULT_PROFIT_MAX) * ADJUSTMENT_OVERFLOW_FACTOR));
  return { min: ADJUSTMENT_MIN, max };
}

function visualAdjustmentValue(
  row: ReturnType<typeof buildSimulation>["rows"][number],
  mode: "discount" | "profit",
  value: number,
): number {
  const bounds = adjustmentBounds(row, mode);
  const safeMax = rawMaxSafeAdjustmentValue(row, mode);
  const current = Math.min(bounds.max, Math.max(bounds.min, value));

  if (mode === "discount") {
    if (safeMax === null) return mapAdjustmentRange(current, bounds.min, bounds.max, 100, 0);
    if (safeMax <= 0) {
      if (current > 0) return mapAdjustmentRange(current, 0, bounds.max, SAFE_ZONE_CENTER, 0);
      if (current < 0) return mapAdjustmentRange(current, bounds.min, 0, 100, SAFE_ZONE_CENTER);
      return SAFE_ZONE_CENTER;
    }
    if (current >= safeMax) return mapAdjustmentRange(current, safeMax, bounds.max, SAFE_ZONE_START, 0);
    if (current >= 0) return mapAdjustmentRange(current, 0, safeMax, SAFE_ZONE_END, SAFE_ZONE_START);
    return mapAdjustmentRange(current, bounds.min, 0, 100, SAFE_ZONE_END);
  }

  if (safeMax === null) return mapAdjustmentRange(current, bounds.min, bounds.max, 0, 100);
  if (safeMax <= 0) {
    if (current < 0) return mapAdjustmentRange(current, bounds.min, 0, 0, SAFE_ZONE_CENTER);
    if (current > 0) return mapAdjustmentRange(current, 0, bounds.max, SAFE_ZONE_CENTER, 100);
    return SAFE_ZONE_CENTER;
  }
  if (current <= 0) return mapAdjustmentRange(current, bounds.min, 0, 0, SAFE_ZONE_START);
  if (current <= safeMax) return mapAdjustmentRange(current, 0, safeMax, SAFE_ZONE_START, SAFE_ZONE_END);
  return mapAdjustmentRange(current, safeMax, bounds.max, SAFE_ZONE_END, 100);
}

function adjustmentValueFromVisual(
  row: ReturnType<typeof buildSimulation>["rows"][number],
  mode: "discount" | "profit",
  visualValue: number,
): number {
  const bounds = adjustmentBounds(row, mode);
  const safeMax = rawMaxSafeAdjustmentValue(row, mode);
  const visual = Math.min(100, Math.max(0, visualValue));

  if (mode === "discount") {
    if (safeMax === null) return mapAdjustmentRange(visual, 0, 100, bounds.max, bounds.min);
    if (safeMax <= 0) {
      if (visual < SAFE_ZONE_CENTER) return mapAdjustmentRange(visual, 0, SAFE_ZONE_CENTER, bounds.max, 0);
      if (visual > SAFE_ZONE_CENTER) return mapAdjustmentRange(visual, SAFE_ZONE_CENTER, 100, 0, bounds.min);
      return 0;
    }
    if (visual <= SAFE_ZONE_START) return mapAdjustmentRange(visual, 0, SAFE_ZONE_START, bounds.max, safeMax);
    if (visual <= SAFE_ZONE_END) return mapAdjustmentRange(visual, SAFE_ZONE_START, SAFE_ZONE_END, safeMax, 0);
    return mapAdjustmentRange(visual, SAFE_ZONE_END, 100, 0, bounds.min);
  }

  if (safeMax === null) return mapAdjustmentRange(visual, 0, 100, bounds.min, bounds.max);
  if (safeMax <= 0) {
    if (visual < SAFE_ZONE_CENTER) return mapAdjustmentRange(visual, 0, SAFE_ZONE_CENTER, bounds.min, 0);
    if (visual > SAFE_ZONE_CENTER) return mapAdjustmentRange(visual, SAFE_ZONE_CENTER, 100, 0, bounds.max);
    return 0;
  }
  if (visual <= SAFE_ZONE_START) return mapAdjustmentRange(visual, 0, SAFE_ZONE_START, bounds.min, 0);
  if (visual <= SAFE_ZONE_END) return mapAdjustmentRange(visual, SAFE_ZONE_START, SAFE_ZONE_END, 0, safeMax);
  return mapAdjustmentRange(visual, SAFE_ZONE_END, 100, safeMax, bounds.max);
}

function adjustmentSafety(row: ReturnType<typeof buildSimulation>["rows"][number]): AdjustmentSafety {
  const mode = row.control.mode;
  const value = mode === "discount" ? discountValueForRow(row) : mode === "profit" ? profitValueForRow(row) : null;
  if (value === null || mode === "manual") {
    return { safeStartPct: null, safeEndPct: null, safeStartValue: null, safeEndValue: null, label: "Manual", risk: "unknown" };
  }

  if (mode === "discount") {
    if (!row.referenceUnit || row.referenceUnit <= 0 || row.costUnit === null) {
      return { safeStartPct: null, safeEndPct: null, safeStartValue: null, safeEndValue: null, label: "", risk: "unknown" };
    }
    const safeStart = 0;
    const safeEnd = Math.max(0, (1 - row.costUnit / row.referenceUnit) * 100);
    const risk = value < safeStart ? "over_ceiling" : value > safeEnd ? "loss" : "safe";
    return { safeStartPct: SAFE_ZONE_START, safeEndPct: SAFE_ZONE_END, safeStartValue: safeStart, safeEndValue: safeEnd, label: discountSafeRangeLabel(safeStart, safeEnd), risk };
  }

  if (row.costUnit === null || row.costUnit <= 0) {
    return { safeStartPct: null, safeEndPct: null, safeStartValue: null, safeEndValue: null, label: "", risk: "unknown" };
  }
  const safeStart = 0;
  const safeEnd = row.referenceUnit && row.referenceUnit > 0 ? Math.max(0, (row.referenceUnit / row.costUnit - 1) * 100) : DEFAULT_PROFIT_MAX;
  const risk = value < safeStart ? "loss" : row.referenceUnit && value > safeEnd ? "over_ceiling" : "safe";
  const label = row.referenceUnit ? safeRangeLabel(safeStart, safeEnd) : "Rango sin pérdida: utilidad positiva";
  return { safeStartPct: SAFE_ZONE_START, safeEndPct: SAFE_ZONE_END, safeStartValue: safeStart, safeEndValue: safeEnd, label, risk };
}

function makeManualItem(index: number, vatRate: number): FinancialOfferItem {
  return {
    id: `manual-${Date.now()}-${index}`,
    item: String(index),
    description: `Item manual ${index}`,
    deliverableType: null,
    technicalDescription: "",
    quantity: null,
    unit: "UND",
    referenceUnit: null,
    costOptimistic: null,
    costModerate: null,
    costWeightedUnit: null,
    manualUnitCost: null,
    selectedCostMode: "manual",
    costScenarioMode: null,
    costScenarioDiscountPct: null,
    priceSources: [],
    additionalCosts: [],
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

function sourceHref(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function costValueForMode(row: ReturnType<typeof buildSimulation>["rows"][number], item: FinancialOfferItem | undefined, mode: CostMode): number | null {
  if (mode === "manual") return item?.manualUnitCost ?? null;
  if (mode === "source") return row.costBreakdown.sources.find((source) => source.id === item?.selectedPriceSourceId)?.normalizedUnit ?? null;
  if (mode === "optimistic") return row.costBreakdown.minimum;
  if (mode === "moderate") return row.costBreakdown.average;
  return row.costBreakdown.moderate;
}

function modeIsAvailable(row: ReturnType<typeof buildSimulation>["rows"][number], item: FinancialOfferItem | undefined, mode: CostMode): boolean {
  return costValueForMode(row, item, mode) !== null;
}

function ColumnControls<Key extends string>(props: {
  columns: Array<{ key: Key; label: string; minWidth?: number; defaultWidth?: number }>;
  prefs: Partial<Record<Key, { visible: boolean; width?: number }>>;
  onToggle: (key: Key, visible: boolean) => void;
  onWidth?: (key: Key, width: number) => void;
  onReset: () => void;
  children?: ReactNode;
}) {
  const hiddenColumns = props.columns.filter((column) => props.prefs[column.key]?.visible === false);

  return (
    <div className="column-controls-wrap">
      <details className="column-controls">
        <summary title="Mostrar y organizar columnas" aria-label={`Columnas${hiddenColumns.length ? `, ${hiddenColumns.length} ocultas` : ""}`}><Columns3 size={17} aria-hidden="true" /><span>Columnas</span>{hiddenColumns.length ? <small>{hiddenColumns.length}</small> : null}</summary>
        <div className="column-controls-panel">
          <div className="column-controls-head">
            <span>{props.onWidth ? "Mostrar, ocultar y ajustar ancho" : "Mostrar u ocultar columnas"}</span>
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
                    aria-label={column.label || "Acciones"}
                    checked={pref?.visible !== false}
                    onChange={(event) => props.onToggle(column.key, event.target.checked)}
                  />
                  <span>{column.label || "Acciones"}</span>
                  {props.onWidth ? <input
                    aria-label={`Ancho de ${column.label}`}
                    type="range"
                    min={column.minWidth}
                    max="520"
                    step="1"
                    value={pref?.width ?? column.defaultWidth}
                    onChange={(event) => props.onWidth?.(column.key, Number(event.target.value))}
                  /> : null}
                </label>
              );
            })}
          </div>
          {props.children ? <div className="column-view-options" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.closest("details")?.removeAttribute("open"); }}>{props.children}</div> : null}
        </div>
      </details>
    </div>
  );
}

function calculationOriginLabel(project: FinancialOfferProject): string {
  if (!project.iaRunId && !project.sourceAnalysisId) return "Manual";
  const revision = /:revision:(\d+)$/.exec(project.iaRunId ?? "")?.[1];
  return revision ? `IA · revisión ${revision}` : "IA";
}

function odooLoginHref(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL("/web/login", window.location.origin);
  if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "18030") {
    url.port = "18069";
  }
  return url.toString();
}

export function ProjectWorkspace(props: { project: FinancialOfferProject }) {
  const appendFileInputRef = useRef<HTMLInputElement | null>(null);
  const simulatorTableShellRef = useRef<HTMLDivElement | null>(null);
  const tableCockpitRef = useRef<HTMLDivElement | null>(null);
  const batchToolbarRef = useRef<HTMLDivElement | null>(null);
  const importToolbarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const costToolbarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const offerToolbarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scenarioToolbarTriggerRef = useRef<HTMLButtonElement>(null);
  const summarySectionRef = useRef<HTMLDivElement | null>(null);
  const expandedSummaryRef = useRef<HTMLDivElement | null>(null);
  const generalCostsRef = useRef<HTMLDivElement | null>(null);
  const resetTriggerRef = useRef<HTMLElement | null>(null);
  const resetDialogRef = useRef<HTMLElement | null>(null);
  const resetCancelRef = useRef<HTMLButtonElement | null>(null);
  const resetInProgressRef = useRef(false);
  const [tab, setTab] = useState<Tab>("simulator");
  const mobileLayout = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerMobileSnapshot);
  // #98: en móvil la barra de herramientas y los filtros se abren como hoja desde la cinta.
  const [mobileSheet, setMobileSheet] = useState<"tools" | "filters" | null>(null);
  const [items, setItems] = useState(props.project.items);
  const [generalCosts, setGeneralCosts] = useState(props.project.generalCosts ?? []);
  const [generalCostsOpen, setGeneralCostsOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  // #113 (30/10): al pulsar «Ver resumen» la cinta se oculta al instante mientras sube la página; si no, convivía con el resumen grande y Edge dejaba restos al repintar.
  const [summaryJump, setSummaryJump] = useState(false);
  const [usdToCopRate, setUsdToCopRate] = useState<number | null>(props.project.settings.usdToCopRate ?? null);
  const [usdImportPct, setUsdImportPct] = useState(props.project.settings.usdImportPct ?? 30);
  const [manualReferenceTotal, setManualReferenceTotal] = useState<number | null>(props.project.settings.manualReferenceTotal ?? null);
  const [settlement, setSettlement] = useState<SettlementState>({
    applyReteFuente: props.project.settings.applyReteFuente ?? false,
    reteFuenteRate: props.project.settings.reteFuenteRate ?? 2.5,
    reteFuenteBase: props.project.settings.reteFuenteBase ?? "pre_vat",
    applyReteIva: props.project.settings.applyReteIva ?? false,
    reteIvaRate: props.project.settings.reteIvaRate ?? 15,
    reteIvaBase: props.project.settings.reteIvaBase ?? "vat",
    applyReteIca: props.project.settings.applyReteIca ?? false,
    reteIcaRate: props.project.settings.reteIcaRate ?? 0,
    reteIcaBase: props.project.settings.reteIcaBase ?? "pre_vat",
    stampTaxRate: props.project.settings.stampTaxRate ?? null,
  });
  const [name, setName] = useState(props.project.name);
  const [columnPrefs, setColumnPrefs] = useState<ColumnPrefs>(() => defaultColumnPrefs());
  const [quickHiddenColumns, setQuickHiddenColumns] = useState<string[]>([]);
  const [columnPrefsReady, setColumnPrefsReady] = useState(false);
  const [decisionColumnPrefs, setDecisionColumnPrefs] = useState<ColumnPrefs>(() => defaultDecisionColumnPrefs());
  const [decisionColumnPrefsReady, setDecisionColumnPrefsReady] = useState(false);
  const [columnPrefsUserOwned, setColumnPrefsUserOwned] = useState(false);
  const [showCostDetails, setShowCostDetails] = useState(false);
  const [analysisView, setAnalysisView] = useState<"decide" | "edit">("decide");
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [sortState, setSortState] = useState<SortState>(null);
  const [sortRowIndexes, setSortRowIndexes] = useState<number[] | null>(null);
  const [adjustmentGate, setAdjustmentGate] = useState<AdjustmentGate | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [headerActionMessage, setHeaderActionMessage] = useState("");
  const [versionActionBusy, setVersionActionBusy] = useState(false);
  const versionActionBusyRef = useRef(false);
  const manualCostEditingRef = useRef(false);
  const saveMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const scenarioManagerRef = useRef<ScenarioManagerHandle>(null);
  const costVersionRef = useRef<CostVersionHistoryHandle>(null);
  const [undoStack, setUndoStack] = useState<WorkspaceSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<WorkspaceSnapshot[]>([]);
  const lastHistoryKeyRef = useRef("");
  const skipNextHistoryRef = useRef(false);
  const autoSaveReadyRef = useRef(false);
  const latestProjectUpdatedAtRef = useRef(props.project.updatedAt);
  const latestProjectItemIdsRef = useRef(props.project.items.map((item) => item.id));
  const adoptingRemoteRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const [externalRevisionPending, setExternalRevisionPending] = useState(false);
  const [savedCalculationUpdatedAt, setSavedCalculationUpdatedAt] = useState(props.project.updatedAt);
  const [detailRowIndex, setDetailRowIndex] = useState<number | null>(null);
  const [detailEditSection, setDetailEditSection] = useState<"base" | "technical" | "notes" | null>(null);
  type DetailSection = "base" | "cost" | "additional" | "technical" | "annex" | "sources" | "notes";
  const [detailOpenSections, setDetailOpenSections] = useState<Set<DetailSection>>(() => new Set(["base", "technical", "sources"]));
  const [detailQuickCostOpen, setDetailQuickCostOpen] = useState(false);
  const detailAdditionalRef = useRef<HTMLDetailsElement | null>(null);
  function toggleDetailOpenSection(section: DetailSection) {
    setDetailOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }
  useEffect(() => {
    if (detailRowIndex === null) { setDetailEditSection(null); setDetailOpenSections(new Set()); setDetailQuickCostOpen(false); return; }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (detailAdditionalRef.current?.open) detailAdditionalRef.current.scrollIntoView({ block: "start" });
    });
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailRowIndex(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.cancelAnimationFrame(frame); document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [detailRowIndex]);
  const [decisionPreviewIndex, setDecisionPreviewIndex] = useState<number | null>(null);
  const [expandAllItems, setExpandAllItems] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewIssueKind | "all">("all");
  const [editingDescriptionIndex, setEditingDescriptionIndex] = useState<number | null>(null);
  const [editingTechnicalIndex, setEditingTechnicalIndex] = useState<number | null>(null);
  const [technicalPreviewExpandedIndex, setTechnicalPreviewExpandedIndex] = useState<number | null>(null);
  const [technicalModalIndex, setTechnicalModalIndex] = useState<number | null>(null);
  const [editingLockedCell, setEditingLockedCell] = useState<string | null>(null);
  const [openCostSourcesIndex, setOpenCostSourcesIndex] = useState<number | null>(null);
  const [baseProjectSettings, setBaseProjectSettings] = useState(props.project.settings);
  const [rowFilter, setRowFilter] = useState<RowFilterKey | `adj:${string}`>("all");
  const [collapsedLots, setCollapsedLots] = useState<Set<string>>(new Set());
  const [excludedProcurementLotIds, setExcludedProcurementLotIds] = useState<string[]>(props.project.settings.excludedProcurementLotIds ?? []);
  const [exportBusy, setExportBusy] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  // Último grupo trabajado en bloque: sigue disponible aunque sus filas salgan del filtro tras el ajuste (Carlos, 29/10).
  const [workGroupKeys, setWorkGroupKeys] = useState<Set<string>>(() => new Set());
  const [budgetActionsOpen, setBudgetActionsOpen] = useState(false);
  const budgetActionsRef = useRef<HTMLButtonElement>(null);
  const [adjustmentRemovalOpen, setAdjustmentRemovalOpen] = useState(false);
  const adjustmentRemovalRef = useRef<HTMLButtonElement>(null);
  const [activeBatchToolbarPopover, setActiveBatchToolbarPopover] = useState<BatchToolbarPopover>(null);
  const [costLotDiscountPct, setCostLotDiscountPct] = useState("");
  const [costScenarioPct, setCostScenarioPct] = useState("");
  const [appendPanelOpen, setAppendPanelOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetStatus, setResetStatus] = useState<"idle" | "loading" | "error">("idle");
  const [resetError, setResetError] = useState("");
  const [appendMode, setAppendMode] = useState<"append" | "update">("append");
  const [appendText, setAppendText] = useState("");
  const [pasteUpdateField, setPasteUpdateField] = useState<PastedUpdateField>("auto");
  const [appendStatus, setAppendStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [appendMessage, setAppendMessage] = useState("");
  const [searchFeedback, setSearchFeedback] = useState("");

  useEffect(() => {
    if (!searchFeedback) return;
    const timeout = window.setTimeout(() => setSearchFeedback(""), 8000);
    return () => window.clearTimeout(timeout);
  }, [searchFeedback]);
  const [globalStrategy, setGlobalStrategy] = useState<GlobalDiscountStrategy>("utility-cushion");
  const [discountPanelMode, setDiscountPanelMode] = useState<OfferMode>("discount");
  const [globalDiscountPct, setGlobalDiscountPct] = useState("5");
  const [globalProfitPct, setGlobalProfitPct] = useState("20");
  const [strategyMessage, setStrategyMessage] = useState("");
  const [compactHeader] = useState(createFlagStore);
  const compactHeaderActive = compactHeader.get();
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const scrollRibbonRef = useRef<HTMLDivElement | null>(null);
  const tableChipsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!settlementOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettlementOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [settlementOpen]);

  useEffect(() => {
    if (!resetOpen) return;
    const previousOverflow = document.body.style.overflow;
    const dialog = resetDialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !resetInProgressRef.current) {
        setResetOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => resetCancelRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      resetTriggerRef.current?.focus();
    };
  }, [resetOpen]);
  const project = useMemo(
    () => ({ ...cloneProject({ ...props.project, settings: baseProjectSettings }, items, generalCosts, { manualCostPriority: false, usdToCopRate, usdImportPct, manualReferenceTotal, excludedProcurementLotIds, ...settlement }), updatedAt: savedCalculationUpdatedAt }),
    [props.project, baseProjectSettings, items, generalCosts, usdToCopRate, usdImportPct, manualReferenceTotal, excludedProcurementLotIds, settlement, savedCalculationUpdatedAt],
  );
  const visibleProject = useMemo(() => ({ ...project, name }), [project, name]);
  const projectSettingsRef = useRef(project.settings);
  projectSettingsRef.current = project.settings;
  const [controls, setControls] = useState<Record<string, OfferControl>>(() => buildInitialOfferControls(project));
  const [vatControls, setVatControls] = useState<Record<string, VatControl>>(() => buildVatControls(project));
  const simulation = useMemo(() => buildSimulation(project, controls), [project, controls]);
  const quoteLinks = useMemo(() => simulation.rows.map((row, index) => selectedQuoteLinks(row, items[index]!)), [simulation, items]);
  const offer = useMemo(() => buildOfferPresentation(simulation, vatControls, settlement), [simulation, vatControls, settlement]);
  const offerScreen = useMemo(() => buildOfferScreen({ items, settings: baseProjectSettings }, offer), [items, baseProjectSettings, offer]);
  const procurementGroups = useMemo(() => groupProcurementLots(items), [items]);
  const hasContractLots = procurementGroups.length > 1 && items.some((item) => item.procurementLot != null);
  const workGroupTest = (row: { rowKey: string }) => workGroupKeys.has(row.rowKey);
  const rowAdjustmentTags = useMemo(() => new Map(simulation.rows.map((row, index) => [row.rowKey, items[index] ? adjustmentTagsFor(items[index]!, row) : []])), [simulation, items]);
  // Los ajustes siguen disponibles incluso cuando queda un solo ítem en el grupo.
  const adjustmentFilters = useMemo(() => {
    const groups = new Map<string, { key: `adj:${string}`; label: string; count: number }>();
    for (const tags of rowAdjustmentTags.values()) for (const tag of tags) {
      const current = groups.get(tag.key);
      if (current) current.count += 1; else groups.set(tag.key, { key: tag.key as `adj:${string}`, label: tag.label, count: 1 });
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [rowAdjustmentTags]);
  const adjustmentTest = (row: { rowKey: string }) => Boolean(rowAdjustmentTags.get(row.rowKey)?.some((tag) => tag.key === rowFilter));
  const matchesRowFilter = rowFilter === "group" ? workGroupTest : rowFilter.startsWith("adj:") ? adjustmentTest : (rowFilters.find(filter => filter.key === rowFilter) ?? rowFilters[0]!).test;
  const filteredIndexes = simulation.rows.flatMap((row, index) => matchesRowFilter(row) ? [index] : []);
  const filteredProcurementGroups = groupProcurementLots(items, filteredIndexes);
  const procurementIndexes = useMemo(() => groupedProcurementIndexes(items), [items]);
  const partialOffer = useMemo(() => {
    const evaluableRows = simulation.rows.filter((row) => row.includedInOffer !== false && row.isFinanciallyEvaluable);
    return evaluableRows.length
      ? buildOfferPresentation({ ...simulation, rows: evaluableRows }, vatControls, settlement)
      : null;
  }, [simulation, vatControls, settlement]);
  const provisionalOffer = useMemo(() => {
    const pendingRows = simulation.rows.filter((row) => row.includedInOffer !== false && provisionalUtilityForRow(row) !== null);
    if (!pendingRows.length) return null;
    const coveredRows = simulation.rows.filter((row) => row.isFinanciallyEvaluable || provisionalUtilityForRow(row) !== null);
    const presentation = buildOfferPresentation({ ...simulation, rows: coveredRows }, vatControls, settlement);
    const knownItemCosts = coveredRows.reduce((total, row) => total + (row.knownCostTotal ?? 0), 0);
    return {
      utility: presentation.summary.expectedNetCollection - knownItemCosts - simulation.summary.total.generalCostsTotal,
      coveredCount: coveredRows.length,
      pendingCount: pendingRows.length,
    };
  }, [simulation, vatControls, settlement]);
  const quickEditRows = useMemo<QuickEditRow[]>(
    () =>
      simulation.rows.map((row, index) => {
        const item = items[index];
        const status =
          row.status === "loss"
            ? "Perdida"
            : row.status === "over_ceiling"
              ? "Sobre techo"
              : row.warnings.filter((warning) => !isEmptyFieldWarning(warning)).length
                ? "Revisar"
                : "OK";
        return {
          id: row.rowKey,
          itemId: item?.id ?? "",
          index,
          item: item?.item ?? "",
          description: item?.description ?? "",
          quantity: formatInputNumber(item?.quantity),
          unit: item?.unit ?? "",
          referenceUnit: formatInputNumber(item?.referenceUnit),
          referenceTotal: formatCop(row.referenceTotal),
          manualUnitCost: formatInputNumber(item?.manualUnitCost),
          selectedCostMode: item?.selectedCostMode ?? "weighted",
          costOptions: item ? costOptions(item, project.settings).map(option => ({ ...option, label: option.mode === "manual" && item.manualCostAssumption ? `Techo −${formatNumber(item.manualCostAssumption.discountPct)} %` : option.label })) : [],
          costUnit: formatCop(row.costUnit),
          costTotal: formatCop(row.costTotal),
          associatedCosts: item?.additionalCosts?.length ? `${item.additionalCosts.length} costo(s)${item.additionalCosts.some((cost) => cost.amount === null) ? " · pendiente" : ""}` : "",
          selectedPriceSourceId: item?.selectedPriceSourceId ?? null,
          sourceOptions: row.costBreakdown.sources.filter((source) => source.normalizedUnit !== null).map((source) => ({ id: source.id, label: source.label })),
          quoteLinks: quoteLinks[index] ?? [],
          offerUnit: formatInputNumber(row.offerUnit),
          offerTotal: formatCop(row.offerTotal),
          utility: formatCop(row.utilityValue),
          margin: formatPercent(row.marginPctOnCost),
          notes: item?.notes ?? "",
          status,
        };
      }),
    [items, simulation.rows, quoteLinks],
  );
  const workspaceHistoryKey = useMemo(() => workspaceSnapshotKey(), [items, generalCosts, controls, vatControls, name, usdToCopRate, manualReferenceTotal, excludedProcurementLotIds, settlement]);
  const workspaceSaveKey = useMemo(() => persistedWorkspaceKey(), [items, generalCosts, controls, vatControls, name, usdToCopRate, usdImportPct, manualReferenceTotal, settlement, visibleProject.settings]);
  const lastPersistedKeyRef = useRef(workspaceSaveKey);
  const workspaceSaveData = useMemo<WorkspaceData>(() => JSON.parse(workspaceSaveKey), [workspaceSaveKey]);
  const latestWorkspaceDataRef = useRef<WorkspaceData>(workspaceSaveData);
  latestWorkspaceDataRef.current = workspaceSaveData;
  const savedWorkspaceDataRef = useRef<WorkspaceData>(latestWorkspaceDataRef.current);
  const autoSaveFailuresRef = useRef(0);
  const blockedSaveKeyRef = useRef<string | null>(null);
  const saveConflictRef = useRef<{ base: WorkspaceData; remote: WorkspaceData; revision: string; ids: string[]; fields: string[] } | null>(null);
  const postSaveConflictRef = useRef<{ submitted: WorkspaceData; saved: WorkspaceData } | null>(null);
  const workspaceSaveKeyRef = useRef(workspaceSaveKey);
  workspaceSaveKeyRef.current = workspaceSaveKey;
  const columnStorageKey = useMemo(() => `financial-offer-columns:${COLUMN_PREFS_VERSION}:${props.project.id}`, [props.project.id]);
  const decisionColumnStorageKey = useMemo(() => `financial-offer-decision-columns:v2:${props.project.id}`, [props.project.id]);
  const visibleSimulatorColumns = useMemo(
    () => SIMULATOR_COLUMNS.filter((column) => columnPrefs[column.key]?.visible !== false && (showCostDetails || !COST_DETAIL_COLUMNS.has(column.key))),
    [columnPrefs, showCostDetails],
  );
  const simulatorTableWidth = useMemo(
    () => visibleSimulatorColumns.reduce((total, column) => total + (columnPrefs[column.key]?.width ?? column.defaultWidth), 0),
    [columnPrefs, visibleSimulatorColumns],
  );
  const allSimulatorRowKeys = useMemo(() => simulation.rows.map((row) => row.rowKey), [simulation.rows]);
  const allRowsSelected = allSimulatorRowKeys.length > 0 && allSimulatorRowKeys.every((rowKey) => selectedRowKeys.has(rowKey));
  const selectedRowsCount = allSimulatorRowKeys.filter((rowKey) => selectedRowKeys.has(rowKey)).length;
  // Sin selección, el bloque actúa sobre lo visible en el filtro activo, no sobre todo el estudio.
  const rowFilterLabel = rowFilter === "group" ? "Último grupo" : rowFilter.startsWith("adj:") ? (adjustmentFilters.find(filter => filter.key === rowFilter)?.label ?? "Ajuste") : (rowFilters.find(filter => filter.key === rowFilter)?.label ?? "Todos");
  const activeBulkScopeLabel = selectedRowsCount ? "seleccionadas" : rowFilter === "all" ? "todas" : `visibles en «${rowFilterLabel}»`;
  const bulkScopeLabel = selectedRowsCount ? `${formatNumber(selectedRowsCount)} seleccionadas` : rowFilter === "all" ? "todas las filas" : `las visibles en «${rowFilterLabel}»`;
  const activeBulkIndexes = selectedRowsCount
    ? simulation.rows.flatMap((row, index) => (selectedRowKeys.has(row.rowKey) ? [index] : []))
    : filteredIndexes;
  const activeBulkRowsCount = activeBulkIndexes.length;
  const workGroupCount = simulation.rows.filter(workGroupTest).length;
  const adjustmentFilterGone = rowFilter.startsWith("adj:") && !adjustmentFilters.some((filter) => filter.key === rowFilter);
  useEffect(() => {
    if (adjustmentFilterGone) setRowFilter(workGroupCount ? "group" : "all");
  }, [adjustmentFilterGone, workGroupCount]);
  const activeBulkCostModes = new Set(activeBulkIndexes.map((index) => items[index]?.selectedCostMode).filter(Boolean));
  const activeBulkOfferModes = new Set(activeBulkIndexes.map((index) => simulation.rows[index]?.control.mode).filter(Boolean));
  const activeBulkCostOptions = new Map<string, string>();
  for (const index of activeBulkIndexes) for (const option of costOptions(items[index]!, project.settings)) activeBulkCostOptions.set(option.label === "Costo único" ? "unique" : option.mode, option.label);
  const allActiveCostsUnique = activeBulkIndexes.length > 0 && activeBulkIndexes.every(index => items[index]!.selectedCostMode !== "manual" && costOptions(items[index]!, project.settings).some(option => option.label === "Costo único"));
  const activeBulkCostMode = allActiveCostsUnique ? "unique" : activeBulkCostModes.size === 1 ? ([...activeBulkCostModes][0] as CostMode) : "";
  const activeBulkOfferMode = activeBulkOfferModes.size === 1 ? ([...activeBulkOfferModes][0] as OfferMode) : "";
  const activeBulkCostReadyCount = activeBulkIndexes.filter((index) => simulation.rows[index]?.costUnit !== null).length;
  const activeBulkReferenceCount = activeBulkIndexes.filter((index) => simulation.rows[index]?.referenceUnit !== null).length;
  const bulkCostPct = updateNumeric(costLotDiscountPct.trim() || "0");
  const bulkCostPctValid = bulkCostPct !== null && bulkCostPct >= 0 && bulkCostPct <= 100;
  const costScenarioPctValue = updateNumeric(costScenarioPct);
  const costScenarioPctValid = costScenarioPctValue !== null && costScenarioPctValue >= 0 && costScenarioPctValue <= 100;
  const bulkProfitPct = updateNumeric(globalProfitPct);
  const bulkProfitPctValid = bulkProfitPct !== null && bulkProfitPct >= 0;
  const activeBulkTypedCostCount = activeBulkIndexes.filter((index) => items[index]?.manualUnitCost != null && items[index]?.manualCostAssumption?.base !== "reference").length;
  const activeBulkManualOfferCount = activeBulkIndexes.filter((index) => simulation.rows[index]?.control.mode === "manual").length;
  const hasUsdSources = useMemo(() => hasUsdPriceSources(items), [items]);
  const reviewEntries = useMemo(
    () =>
      simulation.rows
        .map((row, index) => ({ row, index, item: items[index], issues: reviewIssuesFor(row) }))
        .filter((entry) => entry.issues.length)
        .sort((left, right) => {
          const priorityDiff = reviewIssuePriority(left.issues[0]!) - reviewIssuePriority(right.issues[0]!);
          if (priorityDiff !== 0) return priorityDiff;
          return Math.abs(right.row.utilityValue ?? 0) - Math.abs(left.row.utilityValue ?? 0);
        }),
    [items, simulation.rows],
  );
  const reviewStats = useMemo(
    () => ({
      loss: reviewEntries.filter((entry) => entry.issues.some((issue) => issue.kind === "loss")).length,
      over_ceiling: reviewEntries.filter((entry) => entry.issues.some((issue) => issue.kind === "over_ceiling")).length,
      incomplete: reviewEntries.filter((entry) => entry.issues.some((issue) => issue.kind === "incomplete")).length,
      margin_low: reviewEntries.filter((entry) => entry.issues.some((issue) => issue.kind === "margin_low")).length,
      source: reviewEntries.filter((entry) => entry.issues.some((issue) => issue.kind === "source")).length,
    }),
    [reviewEntries],
  );
  const filteredReviewEntries = useMemo(
    () => reviewFilter === "all" ? reviewEntries : reviewEntries.filter((entry) => entry.issues.some((issue) => issue.kind === reviewFilter)),
    [reviewEntries, reviewFilter],
  );

  useEffect(() => {
    if (reviewFilter !== "all" && reviewStats[reviewFilter] === 0) setReviewFilter("all");
  }, [reviewFilter, reviewStats]);

  useEffect(() => {
    setColumnPrefsReady(false);
    try {
      const stored = window.localStorage.getItem(columnStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { prefs?: unknown } | unknown;
        setColumnPrefs(normalizeColumnPrefs(typeof parsed === "object" && parsed && "prefs" in parsed ? parsed.prefs : parsed));
        setColumnPrefsUserOwned(true);
      } else {
        setColumnPrefs(defaultColumnPrefs());
        setColumnPrefsUserOwned(false);
      }
    } catch {
      setColumnPrefs(defaultColumnPrefs());
      setColumnPrefsUserOwned(false);
    }
    setColumnPrefsReady(true);
  }, [columnStorageKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(decisionColumnStorageKey);
      const parsed = stored ? JSON.parse(stored) as { prefs?: unknown } | unknown : null;
      setDecisionColumnPrefs(normalizeDecisionColumnPrefs(typeof parsed === "object" && parsed && "prefs" in parsed ? parsed.prefs : parsed));
    } catch {
      setDecisionColumnPrefs(defaultDecisionColumnPrefs());
    }
    setDecisionColumnPrefsReady(true);
  }, [decisionColumnStorageKey]);

  useEffect(() => {
    if (!decisionColumnPrefsReady) return;
    try {
      window.localStorage.setItem(decisionColumnStorageKey, JSON.stringify({ prefs: decisionColumnPrefs }));
    } catch {
      // Column choices remain available for this visit.
    }
  }, [decisionColumnPrefs, decisionColumnPrefsReady, decisionColumnStorageKey]);

  useEffect(() => {
    if (usdToCopRate !== null || !hasUsdSources) return;
    let cancelled = false;

    async function loadDefaultTrm() {
      try {
        const response = await fetch(appPath("/api/trm"), { cache: "no-store" });
        const data = (await response.json()) as TrmResponse;
        if (!cancelled && data.ok && typeof data.value === "number" && Number.isFinite(data.value) && data.value > 0) {
          setUsdToCopRate(data.value);
        }
      } catch {
        // If the TRM service is unavailable, USD sources keep their warning instead of blocking the app.
      }
    }

    void loadDefaultTrm();
    return () => {
      cancelled = true;
    };
  }, [hasUsdSources, usdToCopRate]);

  useEffect(() => {
    if (!columnPrefsReady || !columnPrefsUserOwned) return;
    try {
      window.localStorage.setItem(columnStorageKey, JSON.stringify({ prefs: columnPrefs }));
    } catch {
      // Local storage is a convenience for visual preferences. The app can work without it.
    }
  }, [columnPrefs, columnPrefsReady, columnPrefsUserOwned, columnStorageKey]);

  useEffect(() => {
    if (!columnPrefsReady || columnPrefsUserOwned || tab !== "simulator") return;

    function fitColumns() {
      const availableWidth = simulatorTableShellRef.current?.clientWidth ?? window.innerWidth - 64;
      setColumnPrefs((current) => autoFitColumnPrefs(current, availableWidth, showCostDetails));
    }

    fitColumns();
    window.addEventListener("resize", fitColumns);
    return () => window.removeEventListener("resize", fitColumns);
  }, [columnPrefsReady, columnPrefsUserOwned, showCostDetails, tab]);

  useEffect(() => {
    if (tab === "offer") {
      compactHeader.set(false);
      return;
    }

    let frame = 0;
    function updateCompactHeader() {
      frame = 0;
      const summaryElement = summarySectionRef.current;
      if (!summaryElement) {
        compactHeader.set(false);
        return;
      }
      // Entra a 96 px y sale pasados 160 px: el cambio de alturas al compactar no lo hace oscilar.
      const bottom = summaryElement.getBoundingClientRect().bottom;
      compactHeader.set(bottom <= (compactHeader.get() ? 160 : 96));
    }
    function scheduleCompactHeader() {
      if (!frame) frame = requestAnimationFrame(updateCompactHeader);
    }

    updateCompactHeader();
    window.addEventListener("scroll", scheduleCompactHeader, { passive: true });
    window.addEventListener("resize", scheduleCompactHeader);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleCompactHeader);
      window.removeEventListener("resize", scheduleCompactHeader);
    };
  }, [compactHeader, tab]);

  // Bloque 2 (27/10): en la Mesa de PC la clase queda fija (no se alterna al desplazarse, así no se
  // recalculan los estilos de toda la página); en móvil y en otras vistas sigue al estado compacto.
  // #17 (28/10): el estado compacto solo alterna estas clases; volver a pintar el cálculo costaba ~600 ms.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 641px)");
    const sync = () => {
      const active = compactHeader.get();
      workspaceRootRef.current?.classList.toggle("is-table-focus", active && (tab === "simulator" || tab === "quick-edit"));
      tableCockpitRef.current?.classList.toggle("is-compact-sticky", active);
      batchToolbarRef.current?.classList.toggle("is-compact-sticky", active);
      const ribbon = scrollRibbonRef.current;
      if (ribbon) {
        const hidden = summaryExpanded && (!active || summaryJump);
        ribbon.classList.toggle("is-ribbon-hidden", hidden);
        ribbon.classList.toggle("is-ribbon-instant", summaryJump);
        // El salto termina al llegar arriba (sin estado compacto); el temporizador del botón solo cubre un desplazamiento interrumpido.
        if (summaryJump && !active) setSummaryJump(false);
        if (hidden) ribbon.setAttribute("aria-hidden", "true");
        else ribbon.removeAttribute("aria-hidden");
      }
      const want = (tab === "simulator" || tab === "quick-edit") && (active || (desktop.matches && (tab === "quick-edit" || analysisView === "decide")));
      if (document.body.classList.contains("table-focus-mode") !== want) document.body.classList.toggle("table-focus-mode", want);
    };
    sync();
    desktop.addEventListener("change", sync);
    const unsubscribe = compactHeader.subscribe(sync);
    return () => {
      desktop.removeEventListener("change", sync);
      unsubscribe();
    };
  }, [analysisView, compactHeader, summaryExpanded, summaryJump, tab]);

  useEffect(() => () => document.body.classList.remove("table-focus-mode"), []);

  // Las alturas de la barra fija y de los chips se escriben como variables CSS directamente en el
  // contenedor de la tabla: así la transición de la barra no vuelve a pintar todo el cálculo en cada fotograma.
  useEffect(() => {
    const shell = simulatorTableShellRef.current;
    if (tab === "offer" || !shell) {
      shell?.style.removeProperty("--table-cockpit-height");
      shell?.style.removeProperty("--table-chips-height");
      return;
    }
    const cockpit = tableCockpitRef.current;
    const chips = tableChipsRef.current;

    function updateHeights() {
      if (!shell) return;
      shell.style.setProperty("--table-cockpit-height", `${cockpit ? Math.ceil(cockpit.getBoundingClientRect().height) : 0}px`);
      shell.style.setProperty("--table-chips-height", `${chips ? Math.ceil(chips.getBoundingClientRect().height) : 0}px`);
    }

    updateHeights();
    const observer = new ResizeObserver(updateHeights);
    if (cockpit) observer.observe(cockpit);
    if (chips) observer.observe(chips);
    window.addEventListener("resize", updateHeights);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeights);
    };
  }, [appendMessage, appendPanelOpen, selectedRowsCount, showCostDetails, tab]);

  useEffect(() => {
    setSelectedRowKeys((current) => {
      const valid = new Set(allSimulatorRowKeys);
      const next = new Set([...current].filter((rowKey) => valid.has(rowKey)));
      return next.size === current.size ? current : next;
    });
  }, [allSimulatorRowKeys]);

  useEffect(() => {
    if (!activeBatchToolbarPopover) return;

    const returnFocus = () => {
      const trigger =
        activeBatchToolbarPopover === "import"
          ? importToolbarTriggerRef.current
          : activeBatchToolbarPopover === "cost"
            ? costToolbarTriggerRef.current
            : offerToolbarTriggerRef.current;
      trigger?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (batchToolbarRef.current?.contains(event.target as Node)) return;
      if (document.getElementById(`batch-${activeBatchToolbarPopover}-menu`)?.contains(event.target as Node)) return;
      setActiveBatchToolbarPopover(null);
      window.requestAnimationFrame(returnFocus);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActiveBatchToolbarPopover(null);
      window.requestAnimationFrame(returnFocus);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeBatchToolbarPopover]);


  useEffect(() => {
    if (!lastHistoryKeyRef.current) {
      lastHistoryKeyRef.current = workspaceHistoryKey;
      return;
    }
    if (skipNextHistoryRef.current) {
      skipNextHistoryRef.current = false;
      lastHistoryKeyRef.current = workspaceHistoryKey;
      return;
    }
    if (lastHistoryKeyRef.current === workspaceHistoryKey) return;

    const previousKey = lastHistoryKeyRef.current;
    const timer = window.setTimeout(() => {
      if (lastHistoryKeyRef.current === workspaceHistoryKey) return;
      try {
        const previousSnapshot = JSON.parse(previousKey) as WorkspaceSnapshot;
        setUndoStack((current) => [...current.slice(-49), previousSnapshot]);
        setRedoStack([]);
        lastHistoryKeyRef.current = workspaceHistoryKey;
      } catch {
        lastHistoryKeyRef.current = workspaceHistoryKey;
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [workspaceHistoryKey]);

  useEffect(() => {
    if (adoptingRemoteRef.current) {
      adoptingRemoteRef.current = false;
      autoSaveReadyRef.current = true;
      lastPersistedKeyRef.current = workspaceSaveKey;
      return;
    }
    if (!autoSaveReadyRef.current) {
      autoSaveReadyRef.current = true;
      lastPersistedKeyRef.current = workspaceSaveKey;
      return;
    }
    if (saveStatus === "saving" || workspaceSaveKey === lastPersistedKeyRef.current || blockedSaveKeyRef.current === workspaceSaveKey) return;

    const timer = window.setTimeout(() => {
      if (workspaceSaveKey !== lastPersistedKeyRef.current) {
        void persistCalculation();
      }
    }, Math.min(30_000, 800 * 2 ** Math.min(autoSaveFailuresRef.current, 5)));

    return () => window.clearTimeout(timer);
  }, [workspaceSaveKey, saveStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (saveStatus !== "saving" && workspaceSaveKey !== lastPersistedKeyRef.current && blockedSaveKeyRef.current !== workspaceSaveKey) {
        void persistCalculation();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [workspaceSaveKey, saveStatus]);

  useEffect(() => {
    const protectUnsavedEdits = (event: BeforeUnloadEvent) => {
      if (resetInProgressRef.current || adoptingRemoteRef.current || workspaceSaveKeyRef.current === lastPersistedKeyRef.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedEdits);
    return () => window.removeEventListener("beforeunload", protectUnsavedEdits);
  }, []);

  const [aiSavedActivity, setAiSavedActivity] = useState<SavedAiActivity | null>(null);
  const [aiActivityReady, setAiActivityReady] = useState(false);
  const [aiActivityHistorical, setAiActivityHistorical] = useState(false);
  const aiSavedActivityRef = useRef<SavedAiActivity | null>(null);
  useEffect(() => {
    const changed = (event: Event) => {
      const activity = (event as CustomEvent<SavedAiActivity>).detail;
      if (activity?.projectId === props.project.id) {
        aiSavedActivityRef.current = activity;
        setAiActivityReady(false); setAiActivityHistorical(false);
        setAiSavedActivity(current => ({ ...activity, itemIds: [...new Set([...(current?.itemIds || []), ...activity.itemIds])] }));
      }
    };
    const reset = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId !== props.project.id) return;
      aiSavedActivityRef.current = null; setAiSavedActivity(null); setAiActivityReady(false); setAiActivityHistorical(false);
    };
    window.addEventListener(AI_SAVED_EVENT, changed);
    window.addEventListener("caf:financial-ai-request-changed", reset);
    return () => { window.removeEventListener(AI_SAVED_EVENT, changed); window.removeEventListener("caf:financial-ai-request-changed", reset); };
  }, [props.project.id]);
  useEffect(() => {
    let cancelled = false;
    let revisionRequest = 0;
    async function pollExternalFacts(signal: AbortSignal) {
      if (cancelled || signal.aborted || saveInFlightRef.current) return;
      const requestId = ++revisionRequest;
      try {
        const response = await fetch(appPath(`/api/projects/${props.project.id}`), { cache: "no-store", signal });
        if (!response.ok) return;
        const data = (await response.json()) as { project?: FinancialOfferProject; calculation?: FinancialOfferProject; costVersions?: { id: string; active: boolean }[] };
        const remoteProject = data.project ?? data.calculation;
        if (cancelled || signal.aborted || requestId !== revisionRequest || !remoteProject) return;
        const decision = externalRevisionDecision({
          incoming: remoteProject, currentUpdatedAt: latestProjectUpdatedAtRef.current,
          dirty: workspaceSaveKeyRef.current !== lastPersistedKeyRef.current,
          saving: saveInFlightRef.current,
        });
        const activity = aiSavedActivityRef.current;
        const matchingBase = activity?.baseVersionIds.some(id => data.costVersions?.some(version => version.id === id && version.active));
        if (activity && data.costVersions) {
          setAiActivityHistorical(!matchingBase && activity.baseVersionIds.some(id => data.costVersions!.some(version => version.id === id)));
          if (!matchingBase) setAiActivityReady(false);
        }
        if (decision === "ignore") {
          if (matchingBase && workspaceSaveKeyRef.current === lastPersistedKeyRef.current) setAiActivityReady(true);
          return;
        }
        if (decision === "defer") { setExternalRevisionPending(true); return; }
        // Adopt the complete saved revision. Never acknowledge a version while
        // retaining an older item list, or autosave can remove newly added rows.
        adoptingRemoteRef.current = true;
        skipNextHistoryRef.current = true;
        setBaseProjectSettings(remoteProject.settings);
        savedWorkspaceDataRef.current = workspaceDataFor(remoteProject);
        blockedSaveKeyRef.current = null;
        setItems(remoteProject.items);
        setGeneralCosts(remoteProject.generalCosts ?? []);
        setControls(buildInitialOfferControls(remoteProject));
        setVatControls(buildVatControls(remoteProject));
        setName(remoteProject.name);
        setUsdToCopRate(remoteProject.settings.usdToCopRate ?? null);
        setUsdImportPct(remoteProject.settings.usdImportPct ?? 30);
        setManualReferenceTotal(remoteProject.settings.manualReferenceTotal ?? null);
        setExcludedProcurementLotIds(remoteProject.settings.excludedProcurementLotIds ?? []);
        setSettlement({
          applyReteFuente: remoteProject.settings.applyReteFuente ?? false,
          reteFuenteRate: remoteProject.settings.reteFuenteRate ?? 2.5,
          reteFuenteBase: remoteProject.settings.reteFuenteBase ?? "pre_vat",
          applyReteIva: remoteProject.settings.applyReteIva ?? false,
          reteIvaRate: remoteProject.settings.reteIvaRate ?? 15,
          reteIvaBase: remoteProject.settings.reteIvaBase ?? "vat",
          applyReteIca: remoteProject.settings.applyReteIca ?? false,
          reteIcaRate: remoteProject.settings.reteIcaRate ?? 0,
          reteIcaBase: remoteProject.settings.reteIcaBase ?? "pre_vat",
          stampTaxRate: remoteProject.settings.stampTaxRate ?? null,
        });
        setSelectedRowKeys(new Set()); clearWorkGroup(); setSortRowIndexes(null); setDetailRowIndex(null);
        setUndoStack([]); setRedoStack([]);
        latestProjectUpdatedAtRef.current = remoteProject.updatedAt;
        latestProjectItemIdsRef.current = remoteProject.items.map((item) => item.id);
        setSavedCalculationUpdatedAt(remoteProject.updatedAt);
        setExternalRevisionPending(false); setSaveError(""); setSaveWarning(""); setSaveStatus("saved");
        if (matchingBase) setAiActivityReady(true);
      } catch {
        // External updates are opportunistic; the normal editor keeps working if polling fails.
      }
    }

    const stopPolling = startVisiblePoll(pollExternalFacts, 5000);
    const refreshController = new AbortController();
    const refreshAfterSave = (event: Event) => { if ((event as CustomEvent<SavedAiActivity>).detail?.projectId === props.project.id) void pollExternalFacts(refreshController.signal); };
    window.addEventListener(AI_SAVED_EVENT, refreshAfterSave);
    return () => {
      cancelled = true;
      refreshController.abort();
      window.removeEventListener(AI_SAVED_EVENT, refreshAfterSave);
      stopPolling();
    };
  }, [props.project.id]);

  useEffect(() => {
    function handleUndoRedo(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isTextEditingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoWorkspaceChange();
        else undoWorkspaceChange();
      }
      if (key === "y") {
        event.preventDefault();
        redoWorkspaceChange();
      }
    }

    window.addEventListener("keydown", handleUndoRedo);
    return () => window.removeEventListener("keydown", handleUndoRedo);
  }, [undoStack, redoStack, items, generalCosts, controls, vatControls, name, usdToCopRate, manualReferenceTotal, settlement]);

  function workspaceSnapshot(): WorkspaceSnapshot {
    return {
      items,
      generalCosts,
      controls,
      vatControls,
      excludedProcurementLotIds,
      name,
      usdToCopRate,
      manualReferenceTotal,
      settlement,
    };
  }

  function workspaceSnapshotKey(snapshot: WorkspaceSnapshot = workspaceSnapshot()): string {
    return JSON.stringify(snapshot);
  }

  function persistedWorkspaceKey(nextItems: FinancialOfferItem[] = itemsWithUiState()): string {
    return workspaceDataKey({
      name,
      settings: { ...visibleProject.settings, manualCostPriority: false, usdToCopRate, usdImportPct, manualReferenceTotal, ...settlement },
      items: nextItems,
      generalCosts,
    });
  }

  function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
    skipNextHistoryRef.current = true;
    lastHistoryKeyRef.current = workspaceSnapshotKey(snapshot);
    setItems(snapshot.items);
    setGeneralCosts(snapshot.generalCosts ?? []);
    setControls(snapshot.controls);
    setVatControls(snapshot.vatControls);
    setExcludedProcurementLotIds(snapshot.excludedProcurementLotIds ?? []);
    setName(snapshot.name);
    setUsdToCopRate(snapshot.usdToCopRate);
    setManualReferenceTotal(snapshot.manualReferenceTotal);
    setSettlement(snapshot.settlement);
    setSaveStatus("idle");
  }

  function undoWorkspaceChange() {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    const current = workspaceSnapshot();
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [current, ...stack].slice(0, 50));
    restoreWorkspaceSnapshot(previous);
  }

  function redoWorkspaceChange() {
    const next = redoStack[0];
    if (!next) return;
    const current = workspaceSnapshot();
    setRedoStack((stack) => stack.slice(1));
    setUndoStack((stack) => [...stack.slice(-49), current]);
    restoreWorkspaceSnapshot(next);
  }

  function pushUndoSnapshot(snapshot: WorkspaceSnapshot = workspaceSnapshot()) {
    const snapshotKey = workspaceSnapshotKey(snapshot);
    skipNextHistoryRef.current = true;
    setUndoStack((stack) => {
      const last = stack[stack.length - 1];
      if (last && workspaceSnapshotKey(last) === snapshotKey) return stack;
      return [...stack.slice(-49), snapshot];
    });
    setRedoStack([]);
  }

  function updateItem(index: number, patch: Partial<FinancialOfferItem>) {
    if (Object.hasOwn(patch, "manualUnitCost") && !Object.hasOwn(patch, "manualCostAssumption")) patch = { ...patch, manualCostAssumption: null, analysisCostStatistic: null };
    setItems((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
    setSaveStatus("idle");
  }

  function updateGeneralCosts(nextCosts: FinancialGeneralCost[]) {
    setGeneralCosts(nextCosts);
    setSaveStatus("idle");
  }

  function openGeneralCosts() {
    setGeneralCostsOpen(true);
    requestAnimationFrame(() => generalCostsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  // Alcance del bloque: seleccionadas o, sin selección, las visibles del filtro. Queda como «Último grupo».
  function bulkTargetIndexes(): Set<number> {
    const targets = new Set(activeBulkIndexes);
    if (targets.size) setWorkGroupKeys(new Set([...targets].map((index) => simulation.rows[index]!.rowKey)));
    return targets;
  }

  function clearWorkGroup() {
    setWorkGroupKeys(new Set());
    setRowFilter((current) => (current === "group" ? "all" : current));
  }

  function selectedTargetIndexes(): Set<number> {
    return new Set(simulation.rows.flatMap((row, index) => (selectedRowKeys.has(row.rowKey) ? [index] : [])));
  }

  // Ítems sobre los que actúan «Incluir todos / Excluir todos» del chip Costos asociados: los seleccionados entre los visibles o, si no hay, todos los visibles.
  function associatedBulkIndexes(): number[] {
    const selected = filteredIndexes.filter((index) => selectedRowKeys.has(simulation.rows[index]!.rowKey));
    return selected.length ? selected : filteredIndexes;
  }

  function setAssociatedCostsStatus(status: "included" | "excluded") {
    const targets = new Set(associatedBulkIndexes());
    if (![...targets].some((index) => (items[index]?.additionalCosts ?? []).some((cost) => (cost.reviewStatus ?? "included") !== status))) return;
    pushUndoSnapshot();
    setItems((current) => current.map((item, index) => targets.has(index) && item.additionalCosts?.length ? { ...item, additionalCosts: item.additionalCosts.map((cost) => ({ ...cost, reviewStatus: status })) } : item));
    setSaveStatus("idle");
  }

  function selectIndexes(indexes: number[], checked: boolean) {
    setSelectedRowKeys(current => { const next = new Set(current); for (const index of indexes) { const key = simulation.rows[index]!.rowKey; if (checked) next.add(key); else next.delete(key); } return next; });
  }
  function toggleLot(key: string) { setCollapsedLots(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }

  function toggleRowSelection(rowKey: string, checked: boolean) {
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }

  function toggleAllRows(checked: boolean) {
    selectIndexes(filteredIndexes, checked);
  }

  function updateManualUnitCost(index: number, value: number | null) {
    if (value !== null && value < 0) return;
    setItems((current) =>
      current.map((item, currentIndex) => {
        if (currentIndex !== index) return item;
        const shouldAutoSelectManual = value !== null && (item.manualUnitCost === null || item.selectedCostMode === "manual");
        return {
          ...item,
          manualUnitCost: value,
          selectedCostMode: shouldAutoSelectManual ? "manual" : item.selectedCostMode,
        };
      }),
    );
    setSaveStatus("idle");
  }
  function applyQuickEditPatches(patches: QuickEditPatch[]) {
    const validPatches = patches.filter((patch) => patch.index >= 0 && patch.index < items.length && isOriginalGridField(patch.field));
    if (!validPatches.length) return;

    const itemPatches = new Map<number, Partial<FinancialOfferItem>>();
    const controlPatches = new Map<string, OfferControl>();
    const itemWithPendingPatch = (index: number) => ({ ...items[index], ...(itemPatches.get(index) ?? {}) });
    const setItemPatch = (index: number, patch: Partial<FinancialOfferItem>) => {
      itemPatches.set(index, { ...(itemPatches.get(index) ?? {}), ...patch });
    };

    for (const patch of validPatches) {
      const item = itemWithPendingPatch(patch.index);
      if (patch.field === "item") setItemPatch(patch.index, { item: patch.value });
      if (patch.field === "description") setItemPatch(patch.index, { description: patch.value });
      if (patch.field === "notes") setItemPatch(patch.index, { notes: patch.value });
      if (patch.field === "unit") setItemPatch(patch.index, { unit: patch.value });
      if (patch.field === "quantity") setItemPatch(patch.index, { quantity: updateNumeric(patch.value) });
      if (patch.field === "referenceUnit") setItemPatch(patch.index, { referenceUnit: updateNumeric(patch.value) });
      if (patch.field === "manualUnitCost") {
        const manualUnitCost = updateNumeric(patch.value);
        if (manualUnitCost !== null && manualUnitCost < 0) continue;
        setItemPatch(patch.index, {
          manualUnitCost,
          manualCostAssumption: null,
          analysisCostStatistic: null,
          selectedCostMode: manualUnitCost === null ? item.selectedCostMode : "manual",
        });
      }
      if (patch.field === "selectedCostMode") {
        const mode = patch.value.trim().toLowerCase() as CostMode;
        if (COST_MODES_FOR_UI.includes(mode)) { const next = costModePatch(items[patch.index]!, project.settings, mode); if (next) setItemPatch(patch.index, next); }
      }
      if (patch.field === "offerUnit") {
        const row = simulation.rows[patch.index];
        if (!row) continue;
        const manualOfferUnit = updateNumeric(patch.value);
        const control = { ...controls[row.rowKey], ...offerPatchFromUnit(row, manualOfferUnit), mode: "manual" as OfferMode };
        controlPatches.set(row.rowKey, control);
        setItemPatch(patch.index, {
          offerMode: control.mode,
          discountPct: control.discountPct,
          profitPct: control.profitPct,
          manualOfferUnit: control.manualOfferUnit,
        });
      }
    }

    const nextItems = items.map((item, index) => (itemPatches.has(index) ? { ...item, ...itemPatches.get(index) } : item));
    const nextControls = controlPatches.size ? { ...controls, ...Object.fromEntries(controlPatches) } : controls;
    if (JSON.stringify(nextItems) === JSON.stringify(items) && JSON.stringify(nextControls) === JSON.stringify(controls)) return;
    pushUndoSnapshot();
    setItems(nextItems);
    if (controlPatches.size) setControls(nextControls);
    setSaveStatus("idle");
  }

  function updateCostScenario(index: number, patch: Partial<Pick<FinancialOfferItem, "costScenarioMode" | "costScenarioDiscountPct">>) {
    if (patch.costScenarioDiscountPct !== undefined && patch.costScenarioDiscountPct !== null && (patch.costScenarioDiscountPct < 0 || patch.costScenarioDiscountPct > 100)) return;
    updateItem(index, {
      costScenarioMode: patch.costScenarioMode === undefined ? (items[index]?.costScenarioMode ?? "unit") : patch.costScenarioMode,
      costScenarioDiscountPct:
        patch.costScenarioDiscountPct === undefined ? (items[index]?.costScenarioDiscountPct ?? null) : patch.costScenarioDiscountPct,
    });
    setSaveStatus("idle");
  }

  function resetCostScenario(index: number) {
    updateItem(index, { costScenarioMode: null, costScenarioDiscountPct: null });
    setSaveStatus("idle");
  }

  function applyLotCostScenarioToSelected() {
    const discountPct = updateNumeric(costScenarioPct);
    const targetIndexes = bulkTargetIndexes();
    if (!targetIndexes.size || discountPct === null || !Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) return;
    setItems((current) =>
      current.map((item, index) =>
        targetIndexes.has(index)
          ? {
              ...item,
              costScenarioMode: "lot",
              costScenarioDiscountPct: discountPct,
            }
          : item,
      ),
    );
    setSaveStatus("idle");
  }

  function budgetControls() {
    return <div className="offer-summary-controls">
      <label className="global-ceiling-control"><span>Techo global</span><input inputMode="numeric" value={formatInputNumber(manualReferenceTotal)} onChange={(event) => { const value = updateNumeric(event.target.value); if (value !== null && value < 0) return; setManualReferenceTotal(value); setSaveStatus("idle"); }} placeholder="Opcional" /></label>
      <label className="global-ceiling-control stamp-tax-control"><span>Estampillas</span><input inputMode="decimal" value={formatInputNumber(settlement.stampTaxRate)} onChange={(event) => { setSettlement((current) => ({ ...current, stampTaxRate: updateNumeric(event.target.value) })); setSaveStatus("idle"); }} placeholder="0 %" aria-label="Porcentaje de estampillas sobre el valor total" /></label>
      <BudgetLimitStatus project={project} simulation={simulation} />
      <button className="settlement-config-trigger" type="button" onClick={() => { setBudgetActionsOpen(false); setSettlementOpen(true); }}>Configurar retenciones</button>
    </div>;
  }

  function removeActiveAdjustment() {
    if (!rowFilter.startsWith("adj:")) return;
    const targets = new Set(activeBulkIndexes.filter((index) => adjustmentTest(simulation.rows[index]!)));
    if (!targets.size) return;
    pushUndoSnapshot();
    const nextItems = items.map((item, index) => targets.has(index) ? removeItemAdjustment(item, rowFilter) : item);
    setItems(nextItems);
    if (rowFilter.startsWith("adj:offer-")) {
      const restored = buildInitialOfferControls({ ...project, items: nextItems });
      setControls((current) => ({ ...current, ...Object.fromEntries([...targets].map((index) => [simulation.rows[index]!.rowKey, restored[simulation.rows[index]!.rowKey]])) }));
    }
    setWorkGroupKeys(new Set([...targets].map((index) => simulation.rows[index]!.rowKey)));
    setSelectedRowKeys(new Set());
    setStrategyMessage(`Ajuste retirado de ${targets.size} ${targets.size === 1 ? "ítem" : "ítems"}. Los demás artículos conservan sus ajustes.`);
    setAdjustmentRemovalOpen(false); setSaveStatus("idle");
  }

  function resetLotCostScenarioForSelected() {
    const targetIndexes = bulkTargetIndexes();
    if (!targetIndexes.size) return;
    setItems((current) =>
      current.map((item, index) =>
        targetIndexes.has(index)
          ? {
              ...item,
              costScenarioMode: null,
              costScenarioDiscountPct: null,
            }
          : item,
      ),
    );
    setSaveStatus("idle");
  }


  function applyReferenceToManualCost() {
    const discountText = costLotDiscountPct.trim();
    const discountPct = discountText ? updateNumeric(discountText) : 0;
    if (discountPct === null || !Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      setStrategyMessage("Escribe un descuento de techo entre 0 y 100%.");
      return;
    }
    const targetIndexes = bulkTargetIndexes();
    if (!targetIndexes.size) { setStrategyMessage("No hay ítems visibles para aplicar el supuesto de costo."); return; }
    let affected = 0;
    let skipped = 0;
    let changed = false;
    const nextItems = items.map((item, index) => {
      if (!targetIndexes.has(index)) return item;
      const referenceUnit = simulation.rows[index]?.referenceUnit !== null ? item.referenceUnit : null;
      if (referenceUnit === null) {
        skipped += 1;
        return item;
      }
      const manualUnitCost = Math.max(0, referenceUnit * (1 - discountPct / 100));
      affected += 1;
      if (item.manualUnitCost !== manualUnitCost || item.selectedCostMode !== "manual" || item.manualCostAssumption?.discountPct !== discountPct || item.analysisCostStatistic != null || item.costScenarioMode != null || item.costScenarioDiscountPct != null) changed = true;
      return estimateCostFromCeiling(item, referenceUnit, discountPct);
    });
    if (!affected) {
      setStrategyMessage(skipped ? `${formatNumber(skipped)} items no tienen precio techo para copiar.` : "No hay items para actualizar.");
      return;
    }
    const affectedLabel = affected === 1 ? "1 costo manual" : `${formatNumber(affected)} costos manuales`;
    if (!changed) {
      setStrategyMessage(`${affectedLabel} ya ${affected === 1 ? "estaba alineado" : "estaban alineados"} con el techo${discountPct ? ` - ${formatNumber(discountPct, 1)}%` : ""}.`);
      return;
    }
    pushUndoSnapshot();
    setItems(nextItems);
    setStrategyMessage(
      `${affectedLabel} ${affected === 1 ? "actualizado" : "actualizados"} desde techo${discountPct ? ` - ${formatNumber(discountPct, 1)}%` : ""}. ${skipped ? `${formatNumber(skipped)} sin techo.` : ""}`.trim(),
    );
    setSaveStatus("idle");
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
    setSaveStatus("idle");
    if (index !== undefined) {
      setItems((current) =>
        current.map((item, currentIndex) =>
          currentIndex === index
            ? {
                ...item,
                offerAdjustment: null,
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

  function offerControlForMode(row: ReturnType<typeof buildSimulation>["rows"][number], mode: OfferMode): OfferControl {
    return convertOfferControlMode(row.control, mode, {
      costUnit: row.costUnit,
      referenceUnit: row.referenceUnit,
      offerUnit: row.offerUnit,
    });
  }

  function switchOfferMode(row: ReturnType<typeof buildSimulation>["rows"][number], index: number, mode: OfferMode) {
    updateControl(row.rowKey, offerControlForMode(row, mode), index);
  }

  function applyOfferModeToTargets(mode: OfferMode) {
    const targetIndexes = bulkTargetIndexes();
    const targetRows = simulation.rows.filter((_, index) => targetIndexes.has(index));
    const nextControls = Object.fromEntries(targetRows.map((row) => [row.rowKey, offerControlForMode(row, mode)]));
    setControls((current) => ({ ...current, ...nextControls }));
    setItems((current) =>
      current.map((item, index) => {
        if (!targetIndexes.has(index)) return item;
        const row = simulation.rows[index];
        const control = row ? nextControls[row.rowKey] : null;
        if (!control) return item;
        return {
          ...item,
          offerMode: control.mode,
          discountPct: control.discountPct,
          profitPct: control.profitPct,
          manualOfferUnit: control.manualOfferUnit,
        };
      }),
    );
    setSaveStatus("idle");
  }

  function applyOfferUnitPatches(patches: Array<{ rowKey: string; index: number; offerUnit: number | null }>, message: string, adjustmentKind?: "ceiling", mode?: OfferMode) {
    if (!patches.length) {
      setStrategyMessage("No hay filas con datos suficientes para aplicar la estrategia.");
      return;
    }
    const nextControls = Object.fromEntries(
      patches.map((patch) => {
        const row = simulation.rows[patch.index];
        return [patch.rowKey, row ? { ...controls[patch.rowKey], ...offerPatchFromUnit(row, patch.offerUnit), ...(mode ? { mode } : {}) } : controls[patch.rowKey]];
      }),
    );
    setControls((current) => ({ ...current, ...nextControls }));
    setItems((current) =>
      current.map((item, index) => {
        const patch = patches.find((candidate) => candidate.index === index);
        const row = patch ? simulation.rows[index] : null;
        const control = patch && row ? { ...controls[patch.rowKey], ...offerPatchFromUnit(row, patch.offerUnit), ...(mode ? { mode } : {}) } : null;
        return control
          ? {
              ...item,
              ...(mode ? { offerMode: mode } : {}),
              offerAdjustment: adjustmentKind ? rememberOfferAdjustment(item, adjustmentKind, control.discountPct, { offerMode: row!.control.mode, discountPct: row!.control.discountPct, profitPct: row!.control.profitPct, manualOfferUnit: row!.offerUnit }) : null,
              discountPct: control.discountPct,
              profitPct: control.profitPct,
              manualOfferUnit: control.manualOfferUnit,
            }
          : item;
      }),
    );
    setStrategyMessage(message);
    setSaveStatus("idle");
  }

  function resetOffersToCeiling() {
    if (!window.confirm("Esto volvera los items con precio techo a su valor maximo. Continuar?")) return;
    const targetIndexes = bulkTargetIndexes();
    const patches = simulation.rows.flatMap((row, index) =>
      targetIndexes.has(index) && row.referenceUnit !== null ? [{ rowKey: row.rowKey, index, offerUnit: row.referenceUnit }] : [],
    );
    applyOfferUnitPatches(patches, `${formatNumber(patches.length)} items volvieron al precio techo.`);
  }

  function applyProfitPctToTargets() {
    const requestedPct = updateNumeric(globalProfitPct);
    if (requestedPct === null || requestedPct < 0) {
      setStrategyMessage("Escribe una utilidad válida igual o mayor que cero.");
      return;
    }
    const targetIndexes = bulkTargetIndexes();
    const applicable = simulation.rows.flatMap((row, index) => {
      if (!targetIndexes.has(index)) return [];
      const control = offerControlWithProfitPct(row.control, requestedPct, {
        costUnit: row.costUnit,
        referenceUnit: row.referenceUnit,
        offerUnit: row.offerUnit,
      });
      return control ? [{ index, rowKey: row.rowKey, control }] : [];
    });
    if (!applicable.length) {
      setStrategyMessage("No hay costos disponibles en el alcance para calcular una oferta.");
      return;
    }
    const nextControls = Object.fromEntries(applicable.map(({ rowKey, control }) => [rowKey, control]));
    setControls((current) => ({ ...current, ...nextControls }));
    setItems((current) => current.map((item, index) => {
      const applied = applicable.find((candidate) => candidate.index === index);
      return applied ? { ...item, offerAdjustment: rememberOfferAdjustment(item, "profit", requestedPct, { offerMode: simulation.rows[index]!.control.mode, discountPct: simulation.rows[index]!.control.discountPct, profitPct: simulation.rows[index]!.control.profitPct, manualOfferUnit: simulation.rows[index]!.offerUnit }), offerMode: applied.control.mode, discountPct: applied.control.discountPct, profitPct: applied.control.profitPct, manualOfferUnit: applied.control.manualOfferUnit } : item;
    }));
    const skipped = targetIndexes.size - applicable.length;
    setStrategyMessage(`${formatNumber(applicable.length)} ofertas calculadas con ${formatNumber(requestedPct, 1)} % sobre el costo${skipped ? `; ${formatNumber(skipped)} sin costo disponible quedaron pendientes` : ""}.`);
    setSaveStatus("idle");
  }

  function applyGlobalDiscountStrategy() {
    const requestedPct = updateNumeric(globalDiscountPct);
    if (requestedPct === null || requestedPct < 0 || requestedPct > 100) {
      setStrategyMessage("Escribe un descuento entre 0 y 100 %.");
      return;
    }
    const targetIndexes = bulkTargetIndexes();
    const rows = simulation.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => targetIndexes.has(index) && row.referenceUnit !== null && row.offerUnit !== null);
    if (!rows.length) {
      setStrategyMessage("No hay filas con oferta y precio techo para descontar.");
      return;
    }
    const maxWeight = Math.max(1, ...rows.map(({ row }) => row.offerTotal ?? row.referenceTotal ?? row.offerUnit ?? 0));
    const maxSafeMargin = Math.max(1, ...rows.map(({ row }) => Math.max(0, (row.offerUnit ?? 0) - (row.costUnit ?? row.offerUnit ?? 0))));
    const totalProfitCushions = rows.map(({ row }) => {
      if (row.costUnit === null || row.offerUnit === null || row.offerUnit <= row.costUnit) return 0;
      return (row.offerUnit - row.costUnit) * (row.quantity ?? 1);
    });
    const maxProfitCushion = Math.max(1, ...totalProfitCushions);
    let affected = 0;
    let protectedRows = 0;
    const patches = rows.map(({ row, index }, rowIndex) => {
      const currentOffer = row.referenceUnit!;
      const unitFloor = row.costUnit ?? 0;
      const hasUnitProfit = row.costUnit !== null && currentOffer > row.costUnit;
      let factor = 1;
      if (globalStrategy === "protect-loss" && !hasUnitProfit) factor = 0;
      if (globalStrategy === "extremes") factor = hasUnitProfit ? Math.max(0.25, Math.min(1.8, ((currentOffer - (row.costUnit ?? currentOffer)) / maxSafeMargin) * 1.8)) : 0;
      if (globalStrategy === "weighted-total") {
        const weight = (row.offerTotal ?? row.referenceTotal ?? currentOffer) / maxWeight;
        factor = hasUnitProfit ? Math.max(0.35, Math.min(1.9, 0.45 + weight * 1.45)) : 0;
      }
      if (globalStrategy === "utility-cushion") {
        const cushionWeight = totalProfitCushions[rowIndex] / maxProfitCushion;
        factor = hasUnitProfit ? Math.max(0.2, Math.min(1.6, 0.25 + cushionWeight * 1.35)) : 0;
      }
      const rawOffer = currentOffer * (1 - (requestedPct * factor) / 100);
      const nextOffer = globalStrategy === "global" ? rawOffer : hasUnitProfit ? Math.max(unitFloor, rawOffer) : currentOffer;
      if (nextOffer === currentOffer) protectedRows += 1;
      else affected += 1;
      return { rowKey: row.rowKey, index, offerUnit: nextOffer };
    });
    applyOfferUnitPatches(patches, `${affected} items ajustados. ${protectedRows} protegidos.`, "ceiling", discountPanelMode);
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

  function applyCostModeToAll(mode: CostMode | "unique") {
    const targetIndexes = bulkTargetIndexes();
    let applied = 0;
    const next = items.map((item, index) => {
      if (!targetIndexes.has(index)) return item;
      const patch = costModePatch(item, project.settings, mode);
      if (!patch) return item;
      applied += 1; return { ...item, ...patch };
    });
    if (applied) { pushUndoSnapshot(); setItems(next); setSaveStatus("idle"); }
    setStrategyMessage(`${applied} ítems actualizados · ${targetIndexes.size - applied} sin esa opción, conservados.`);
  }

  function setColumnVisible(key: SimulatorColumnKey, visible: boolean) {
    setColumnPrefsUserOwned(true);
    setColumnPrefs((current) => ({ ...current, [key]: { ...current[key], visible } }));
  }

  function setColumnWidth(key: SimulatorColumnKey, width: number) {
    const column = SIMULATOR_COLUMNS.find((candidate) => candidate.key === key);
    setColumnPrefsUserOwned(true);
    setColumnPrefs((current) => ({
      ...current,
      [key]: {
        ...current[key],
        width: Math.max(column?.minWidth ?? 80, Math.min(520, width)),
      },
    }));
  }

  function setDecisionColumnVisible(key: SimulatorColumnKey, visible: boolean) {
    if (!DECISION_COLUMNS.some((column) => column.key === key)) return;
    setDecisionColumnPrefs((current) => ({ ...current, [key]: { ...current[key], visible } }));
  }

  function setDecisionColumnWidth(key: SimulatorColumnKey, width: number) {
    const column = DECISION_COLUMNS.find((candidate) => candidate.key === key);
    if (!column) return;
    setDecisionColumnPrefs((current) => ({
      ...current,
      [key]: { ...current[key], width: Math.max(column.minWidth, Math.min(520, width)) },
    }));
  }

  function startDecisionColumnResize(key: SimulatorColumnKey, event: ReactMouseEvent<HTMLButtonElement>) {
    const column = DECISION_COLUMNS.find((candidate) => candidate.key === key);
    if (!column) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = decisionColumnPrefs[key]?.width ?? column.defaultWidth;

    function onMove(moveEvent: MouseEvent) {
      setDecisionColumnWidth(key, startWidth + moveEvent.clientX - startX);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function resetDecisionColumnPreferences() {
    setDecisionColumnPrefs(defaultDecisionColumnPrefs());
    try {
      window.localStorage.removeItem(decisionColumnStorageKey);
    } catch {
      // The defaults are already applied in this visit.
    }
  }

  function resetColumnPreferences() {
    try {
      window.localStorage.removeItem(columnStorageKey);
    } catch {
      // The auto-fit fallback still works if local storage is unavailable.
    }
    setColumnPrefs(defaultColumnPrefs());
    setColumnPrefsUserOwned(false);
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
    pushUndoSnapshot();
    const retainedItems = itemsWithUiState().filter((_, currentIndex) => currentIndex !== index);
    const nextItems = retainedItems.length ? retainedItems : [makeManualItem(1, visibleProject.settings.vatRate)];
    const nextProject = { ...project, items: nextItems };
    setItems(nextItems);
    setControls(buildInitialOfferControls(nextProject));
    setVatControls(buildVatControls(nextProject));
    setSelectedRowKeys(new Set());
    clearWorkGroup();
    setSortRowIndexes(null);
    setDetailRowIndex(null);
    setEditingDescriptionIndex(null);
    setSaveStatus("idle");
  }

  function requestRemoveItem(index: number) {
    if (window.confirm("Vas a eliminar esta fila del calculo. Continuar?")) {
      removeItem(index);
    }
  }

  function removeSelectedItems() {
    const targetIndexes = selectedTargetIndexes();
    if (!targetIndexes.size) return;
    const count = targetIndexes.size;
    const noun = count === 1 ? "elemento seleccionado" : "elementos seleccionados";
    if (!window.confirm(`Vas a eliminar ${formatNumber(count)} ${noun}. Podras deshacer el cambio desde el historial. Continuar?`)) return;

    pushUndoSnapshot();
    const retainedItems = itemsWithUiState().filter((_, index) => !targetIndexes.has(index));
    const nextItems = retainedItems.length ? retainedItems : [makeManualItem(1, visibleProject.settings.vatRate)];
    const nextProject = { ...project, items: nextItems };
    setItems(nextItems);
    setControls(buildInitialOfferControls(nextProject));
    setVatControls(buildVatControls(nextProject));
    setSelectedRowKeys(new Set());
    clearWorkGroup();
    setSortRowIndexes(null);
    setDetailRowIndex(null);
    setEditingDescriptionIndex(null);
    setSaveStatus("idle");
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

  function workspaceDataFor(saved: FinancialOfferProject): WorkspaceData {
    const rowControls = buildInitialOfferControls(saved);
    const rowVat = buildVatControls(saved);
    return { name: saved.name, settings: { ...saved.settings, manualCostPriority: false, excludedProcurementLotIds: saved.settings.excludedProcurementLotIds ?? [] }, generalCosts: saved.generalCosts ?? [], items: saved.items.map((item, index) => {
      const key = buildRowKey(item, index); const control = rowControls[key]; const vat = rowVat[key];
      return { ...item, offerMode: control?.mode ?? item.offerMode, discountPct: control?.discountPct ?? item.discountPct, profitPct: control?.profitPct ?? item.profitPct, manualOfferUnit: control?.manualOfferUnit ?? item.manualOfferUnit, vatMode: vat?.mode ?? item.vatMode, vatRate: vat?.ratePct ?? item.vatRate };
    }) };
  }

  function adoptMergedWorkspace(data: WorkspaceData, revision: string, clearHistory = false) {
    const mergedProject = { ...props.project, ...data, updatedAt: revision };
    const oldItems = latestWorkspaceDataRef.current.items;
    const selectedIds = new Set(oldItems.filter((item, index) => selectedRowKeys.has(buildRowKey(item, index))).map(item => item.id));
    setSelectedRowKeys(new Set(data.items.flatMap((item, index) => selectedIds.has(item.id) ? [buildRowKey(item, index)] : [])));
    const groupIds = new Set(oldItems.filter((item, index) => workGroupKeys.has(buildRowKey(item, index))).map(item => item.id));
    setWorkGroupKeys(new Set(data.items.flatMap((item, index) => groupIds.has(item.id) ? [buildRowKey(item, index)] : [])));
    if (clearHistory) { setUndoStack([]); setRedoStack([]); }
    skipNextHistoryRef.current = true;
    setBaseProjectSettings(data.settings);
    setItems(data.items); setGeneralCosts(data.generalCosts ?? []);
    setControls(buildInitialOfferControls(mergedProject)); setVatControls(buildVatControls(mergedProject));
    setName(data.name); setUsdToCopRate(data.settings.usdToCopRate); setUsdImportPct(data.settings.usdImportPct);
    setManualReferenceTotal(data.settings.manualReferenceTotal);
    setExcludedProcurementLotIds(data.settings.excludedProcurementLotIds ?? []);
    setSettlement(current => ({ ...current, ...Object.fromEntries(Object.keys(current).map(key => [key, data.settings[key as keyof typeof data.settings]])) }));
    latestWorkspaceDataRef.current = data;
    workspaceSaveKeyRef.current = workspaceDataKey(data);
  }

  function persistCalculation(): Promise<boolean> {
    if (resetInProgressRef.current || adoptingRemoteRef.current) return Promise.resolve(false);
    // All callers share the same drain; no second PATCH can escape an awaited promise.
    if (savePromiseRef.current) return savePromiseRef.current;
    if (workspaceSaveKeyRef.current === lastPersistedKeyRef.current) return Promise.resolve(true);
    const operation = (async (): Promise<boolean> => {
      saveInFlightRef.current = true; setSaveStatus("saving"); setSaveError("");
      try {
        for (let drain = 0; drain < 8; drain += 1) {
          const submitted = latestWorkspaceDataRef.current;
          const submittedKey = workspaceDataKey(submitted);
          let candidate = submitted;
          if (postSaveConflictRef.current) {
            const previous = postSaveConflictRef.current;
            const reconciled = mergeWorkspace(previous.submitted, submitted, previous.saved);
            if (reconciled.conflicts.length) { blockedSaveKeyRef.current = workspaceSaveKeyRef.current; throw new Error("Tus cambios posteriores siguen en pantalla. Otra actualización cambió el mismo dato; revisa el conflicto antes de guardar."); }
            candidate = reconciled.value;
            postSaveConflictRef.current = null;
          }
          let baseline = savedWorkspaceDataRef.current;
          let revision = latestProjectUpdatedAtRef.current;
          let ids = latestProjectItemIdsRef.current;
          let saved: FinancialOfferProject | undefined;
          let warning: string | null = null;
          for (let retry = 0; retry < 3; retry += 1) {
            const response = await fetch(appPath(`/api/projects/${props.project.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...candidate, expectedUpdatedAt: revision, expectedItemIds: ids }) });
            const result = await response.json() as { project?: FinancialOfferProject; calculation?: FinancialOfferProject; error?: string; odooCollaborationWarning?: string | null };
            if (response.status === 409) {
              const remoteResponse = await fetch(appPath(`/api/projects/${props.project.id}`), { cache: "no-store" });
              if (!remoteResponse.ok) throw new Error("No se pudo consultar la versión actual para guardar tus cambios.");
              const remoteData = await remoteResponse.json() as { project?: FinancialOfferProject; calculation?: FinancialOfferProject };
              const remote = remoteData.project ?? remoteData.calculation;
              if (!remote) throw new Error("La versión actual no está disponible.");
              const remoteWorkspace = workspaceDataFor(remote);
              const merged = mergeWorkspace(baseline, candidate, remoteWorkspace);
              if (merged.conflicts.length) {
                saveConflictRef.current = { base: baseline, remote: remoteWorkspace, revision: remote.updatedAt, ids: remote.items.map(item => item.id), fields: merged.conflicts };
                blockedSaveKeyRef.current = workspaceSaveKeyRef.current;
                setExternalRevisionPending(true);
                throw new Error(`Tus cambios siguen en esta pantalla. Hay otra edición del mismo dato (${merged.conflicts.slice(0, 3).join("; ")}). Revisa el conflicto antes de guardar.`);
              }
              candidate = merged.value; baseline = remoteWorkspace; revision = remote.updatedAt; ids = remote.items.map(item => item.id);
              continue;
            }
            if (!response.ok) throw new Error(result.error ?? "No se pudo guardar.");
            saved = result.project ?? result.calculation;
            warning = result.odooCollaborationWarning ?? null;
            break;
          }
          if (!saved) throw new Error("El cálculo está recibiendo cambios. Conservamos tu edición y volveremos a intentar el guardado.");
          // Capture edits made while the request was in flight before adopting remote additions.
          const savedData = workspaceDataFor(saved);
          const pending = mergeWorkspace(submitted, latestWorkspaceDataRef.current, savedData);
          if (pending.conflicts.length) {
            savedWorkspaceDataRef.current = savedData;
            latestProjectUpdatedAtRef.current = saved.updatedAt; latestProjectItemIdsRef.current = saved.items.map(item => item.id);
            setSavedCalculationUpdatedAt(saved.updatedAt);
            lastPersistedKeyRef.current = workspaceDataKey(savedData);
            postSaveConflictRef.current = { submitted, saved: savedData };
            saveConflictRef.current = { base: submitted, remote: savedData, revision: saved.updatedAt, ids: saved.items.map(item => item.id), fields: pending.conflicts };
            blockedSaveKeyRef.current = workspaceSaveKeyRef.current;
            throw new Error("Se guardó la primera edición; conservamos los cambios posteriores en pantalla. Revisa el aviso de cambios simultáneos.");
          }
          savedWorkspaceDataRef.current = savedData;
          latestProjectUpdatedAtRef.current = saved.updatedAt; latestProjectItemIdsRef.current = saved.items.map(item => item.id);
          setSavedCalculationUpdatedAt(saved.updatedAt);
          lastPersistedKeyRef.current = workspaceDataKey(savedData);
          blockedSaveKeyRef.current = null; saveConflictRef.current = null; autoSaveFailuresRef.current = 0;
          if (workspaceDataKey(pending.value) !== workspaceSaveKeyRef.current) adoptMergedWorkspace(pending.value, saved.updatedAt, workspaceDataKey(candidate) !== submittedKey);
          setSaveWarning(warning ?? ""); setExternalRevisionPending(false);
          if (workspaceDataKey(pending.value) === lastPersistedKeyRef.current) { setSaveStatus("saved"); setSaveError(""); return true; }
          // Drain any committed edits made during saving using the acknowledged revision.
          if (submittedKey === workspaceDataKey(pending.value)) break;
        }
        setSaveStatus("idle"); return false;
      } catch (error) {
        autoSaveFailuresRef.current += 1;
        setSaveStatus("error"); setSaveError(error instanceof Error ? error.message : "No se pudo guardar el cálculo."); return false;
      } finally { saveInFlightRef.current = false; }
    })();
    savePromiseRef.current = operation;
    void operation.finally(() => { if (savePromiseRef.current === operation) savePromiseRef.current = null; });
    return operation;
  }

  function renderLotFinancialSummary() {
    return hasContractLots ? <details className="lot-financial-summaries"><summary>Lotes de la oferta · {procurementGroups.filter(group => !group.id || !excludedProcurementLotIds.includes(group.id)).length} de {procurementGroups.length} activos</summary>
              <p>Activar un lote determina si entra en los totales y en la oferta exportada. Los checks de las tablas sirven para editar.</p>
              {procurementGroups.map(group => {
                const active = !group.id || !excludedProcurementLotIds.includes(group.id);
                const lotItems = itemsWithUiState();
                const lotProject = { ...project, items: group.indexes.map(index => lotItems[index]!), generalCosts: [], settings: { ...project.settings, manualReferenceTotal: null, excludedProcurementLotIds: [] } };
                const lotSimulation = buildSimulation(lotProject, buildInitialOfferControls(lotProject));
                const lotOffer = buildOfferPresentation(lotSimulation, buildVatControls(lotProject), settlement);
                return <div key={group.key} className={`lot-financial-entry ${active ? "" : "is-excluded"}`}>
                  <label><input type="checkbox" checked={active} disabled={!group.id} onChange={event => { const checked = event.target.checked; setExcludedProcurementLotIds(current => checked ? current.filter(id => id !== group.id) : [...current, group.id!]); setSaveStatus("idle"); }} /> Incluir {group.label} en la oferta</label>
                  <details><summary>Resumen de {group.label} · {group.indexes.length} ítems{active ? "" : " · excluido"}</summary>
                    <OfferCompositionBar offer={lotOffer.summary.totalOfferWithVat} ceiling={lotSimulation.summary.referenceKnownTotal} cost={lotSimulation.summary.knownCostTotal} netUtility={lotOffer.summary.estimatedNetUtility} deductions={lotOffer.summary.totalDeductions} scope={group.label} preliminary={!lotOffer.summary.isComplete} compact />
                  </details>
                </div>;
              })}
              {generalCosts.length ? <small>Los costos generales se mantienen en el resumen global; no se reparten entre lotes.</small> : null}
            </details> : null;
  }

  function resolveSaveConflict() {
    const conflict = saveConflictRef.current;
    if (!conflict || saveInFlightRef.current) return;
    if (!window.confirm(`Hay ediciones simultáneas en: ${conflict.fields.join("; ")}.\n¿Conservar tu edición en esos datos? Los demás cambios del servidor se mantienen.`)) return;
    const resolved = mergeWorkspace(conflict.base, latestWorkspaceDataRef.current, conflict.remote, true).value;
    savedWorkspaceDataRef.current = conflict.remote;
    latestProjectUpdatedAtRef.current = conflict.revision;
    latestProjectItemIdsRef.current = conflict.ids;
    lastPersistedKeyRef.current = workspaceDataKey(conflict.remote);
    postSaveConflictRef.current = null; saveConflictRef.current = null; blockedSaveKeyRef.current = null;
    adoptMergedWorkspace(resolved, conflict.revision, true);
    setSaveError(""); setSaveStatus("idle");
  }

  async function prepareVersionAction(): Promise<string | null> {
    if (manualCostEditingRef.current) {
      setHeaderActionMessage("Termina o cancela la edición del costo manual antes de cambiar o guardar versiones.");
      return null;
    }
    return await persistCalculation() ? latestProjectUpdatedAtRef.current : null;
  }

  async function runExclusiveVersionAction(task: () => Promise<boolean>, label: string): Promise<boolean> {
    if (versionActionBusyRef.current) return false;
    if (manualCostEditingRef.current) {
      setHeaderActionMessage("Termina o cancela la edición del costo manual antes de continuar.");
      return false;
    }
    versionActionBusyRef.current = true;
    setVersionActionBusy(true);
    setHeaderActionMessage(label);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    try {
      return await task();
    } finally {
      versionActionBusyRef.current = false;
      setVersionActionBusy(false);
    }
  }

  function acknowledgeVersionSave(updatedAt: string): void {
    if (!updatedAt) return;
    latestProjectUpdatedAtRef.current = updatedAt;
    setSavedCalculationUpdatedAt(updatedAt);
  }

  async function runHeaderSave(kind: "calculation" | "scenario" | "cost"): Promise<void> {
    let ok = false;
    if (kind === "calculation") {
      ok = await runExclusiveVersionAction(() => persistCalculation(), "Guardando cálculo...");
    } else if (kind === "scenario") {
      ok = await scenarioManagerRef.current?.save() ?? false;
    } else {
      ok = await costVersionRef.current?.save() ?? false;
    }
    if (ok) {
      setSaveMenuOpen(false);
      setHeaderActionMessage(kind === "calculation" ? "Cálculo guardado." : kind === "scenario" ? "Escenario guardado." : "Base de costos guardada.");
    } else if (kind === "calculation" && !manualCostEditingRef.current) {
      setHeaderActionMessage("No se pudo guardar el cálculo. Vuelve a intentarlo.");
    }
  }

  async function appendImportedPayload(payload: unknown) {
    setAppendStatus("loading");
    setAppendMessage("Agregando items...");
    const saved = await persistCalculation();
    if (!saved) {
      setAppendStatus("error");
      setAppendMessage("No pude guardar los cambios actuales antes de agregar nuevos items.");
      return;
    }

    try {
      const response = await fetch(appPath(`/api/projects/${props.project.id}/append-items`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { project?: FinancialOfferProject; appendedCount?: number; error?: string };
      if (!response.ok || !data.project) {
        throw new Error(data.error ?? "No se pudieron agregar los items.");
      }
      setItems(data.project.items);
      setGeneralCosts(data.project.generalCosts ?? generalCosts);
      latestProjectUpdatedAtRef.current = data.project.updatedAt;
      latestProjectItemIdsRef.current = data.project.items.map((item) => item.id);
      setSavedCalculationUpdatedAt(data.project.updatedAt);
      setControls(buildInitialOfferControls(data.project));
      setVatControls(buildVatControls(data.project));
      setSelectedRowKeys(new Set());
      clearWorkGroup();
      setSortRowIndexes(null);
      setAppendStatus("success");
      setAppendMessage(`${formatNumber(data.appendedCount ?? 0)} items agregados al calculo.`);
      setAppendPanelOpen(false);
      setAppendText("");
      lastPersistedKeyRef.current = persistedWorkspaceKey(data.project.items);
      setSaveStatus("saved");
    } catch (error) {
      setAppendStatus("error");
      setAppendMessage(error instanceof Error ? error.message : "No se pudieron agregar los items.");
    }
  }

  function numericPatchValue(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === "number" ? (Number.isFinite(value) ? value : null) : updateNumeric(String(value));
  }

  function applyPastedItemPatches(patches: PastedItemPatch[]) {
    const selectedIndexes = [...selectedTargetIndexes()].sort((left, right) => left - right);
    const normalizedItemToIndex = new Map(items.map((item, index) => [String(item.item ?? "").trim().toLowerCase(), index]));
    const patchByIndex = new Map<number, PastedItemPatch>();
    let unmatched = 0;

    patches.forEach((patch, orderIndex) => {
      let targetIndex: number | undefined;
      if (patch.item) {
        targetIndex = normalizedItemToIndex.get(patch.item.trim().toLowerCase());
      } else if (selectedIndexes.length) {
        targetIndex = selectedIndexes[orderIndex];
      } else {
        targetIndex = patch.rowNumber - 1;
      }

      if (targetIndex === undefined || targetIndex < 0 || targetIndex >= items.length) {
        unmatched += 1;
        return;
      }
      patchByIndex.set(targetIndex, patch);
    });

    if (!patchByIndex.size) {
      setAppendStatus("error");
      setAppendMessage(unmatched ? `${formatNumber(unmatched)} fila(s) sin coincidencia.` : "No encontr? filas para actualizar.");
      return;
    }

    const nextItems = items.map((item, index) => {
      const patch = patchByIndex.get(index);
      if (!patch) return item;

      const next: FinancialOfferItem = { ...item };
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.technicalDescription !== undefined) next.technicalDescription = patch.technicalDescription;
      if (patch.quantity !== undefined) next.quantity = numericPatchValue(patch.quantity);
      if (patch.unit !== undefined) next.unit = patch.unit;
      if (patch.referenceUnit !== undefined) next.referenceUnit = numericPatchValue(patch.referenceUnit);
      if (patch.manualUnitCost !== undefined) {
        const manualUnitCost = numericPatchValue(patch.manualUnitCost);
        if (manualUnitCost === null || manualUnitCost >= 0) {
          next.manualUnitCost = manualUnitCost;
          if (manualUnitCost !== null && (item.manualUnitCost === null || item.selectedCostMode === "manual")) {
            next.selectedCostMode = "manual";
          }
        }
      }
      if (patch.notes !== undefined) next.notes = patch.notes;
      return next;
    });

    pushUndoSnapshot();
    setItems(nextItems);
    setSortRowIndexes(null);
    setAppendStatus("success");
    setAppendMessage(`${formatNumber(patchByIndex.size)} fila(s) actualizadas${unmatched ? `, ${formatNumber(unmatched)} sin coincidencia` : ""}.`);
    setAppendPanelOpen(false);
    setAppendText("");
    setSaveStatus("idle");
  }


  async function appendSpreadsheetFile(file: File) {
    setAppendStatus("loading");
    setAppendMessage("Leyendo archivo...");
    try {
      const { payloadFromSpreadsheetFile } = await import("@offer/lib/client-ingest");
      await appendImportedPayload(await payloadFromSpreadsheetFile(file));
    } catch (error) {
      setAppendStatus("error");
      setAppendMessage(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    } finally {
      if (appendFileInputRef.current) {
        appendFileInputRef.current.value = "";
      }
    }
  }

  async function appendFromText() {
    setAppendStatus("loading");
    setAppendMessage("Leyendo texto...");
    try {
      const { itemPatchesFromPastedText, payloadFromPastedText } = await import("@offer/lib/client-ingest");
      if (appendMode === "update") {
        applyPastedItemPatches(itemPatchesFromPastedText(appendText, pasteUpdateField));
        return;
      }
      await appendImportedPayload(payloadFromPastedText(appendText));
    } catch (error) {
      setAppendStatus("error");
      setAppendMessage(error instanceof Error ? error.message : "No pude interpretar el texto pegado.");
    }
  }

  async function openGoogleSearch(index: number) {
    const item = items[index];
    if (!item) return;
    const fallbackQuery = [item.description, item.technicalDescription].filter(Boolean).join(" ").split(/\s+/).slice(0, 22).join(" ").trim();
    const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(`${fallbackQuery || "producto"} proveedor precio`)}`;
    await openSearchWindow(item.id, fallbackUrl, async () => {
      setSearchFeedback("Preparando consulta de búsqueda…");
      const response = await fetch(appPath("/api/search-query"), {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: item.item,
          description: item.description,
          technicalDescription: item.technicalDescription,
          unit: item.unit,
          notes: item.notes,
          referenceUnit: item.referenceUnit,
          priceSources: item.priceSources.map((source) => ({
            label: source.label,
            url: source.url,
            notes: source.notes,
            currency: source.currency,
          })),
        }),
      });
      const data = (await response.json()) as { url?: string; query?: string; source?: "deepseek" | "local" };
      if (response.ok && data.url && data.query) {
        setSearchFeedback(`${data.source === "deepseek" ? "Consulta preparada por IA" : "Consulta básica; la IA no respondió"}: ${data.query}`);
        return data.url;
      }
      setSearchFeedback("Consulta básica; no se pudo conectar con la IA.");
      return fallbackUrl;
    }, {
      onBlocked: () => setSearchFeedback("El navegador bloqueó la pestaña. Permite ventanas emergentes para este sitio y vuelve a buscar."),
      onFallback: () => setSearchFeedback("Consulta básica; no se pudo conectar con la IA."),
    });
  }

  function openItemEditor(index: number, section: "additional" | "cost" | null = null) {
    setDetailEditSection(null);
    setDetailOpenSections(new Set(section ? [section] : ["base"]));
    setDetailQuickCostOpen(false);
    setDetailRowIndex(index);
  }

  function openUnifiedItemEditor(index: number) {
    setTab("simulator");
    setAnalysisView("decide");
    setDecisionPreviewIndex(index);
    openItemEditor(index);
  }

  function addUnifiedItemCost(index: number) {
    const item = items[index];
    if (!item) return;
    updateItem(index, {
      additionalCosts: [
        ...(item.additionalCosts ?? []),
        { id: `item-cost-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`, name: "Nuevo servicio", category: "service", mode: "fixed", amount: null, notes: "" },
      ],
    });
    setDecisionPreviewIndex(index);
    openItemEditor(index, "additional");
  }

  function openReviewItemInAnalysis(rowKey: string) {
    const index = simulation.rows.findIndex((row) => row.rowKey === rowKey);
    if (index >= 0) openUnifiedItemEditor(index);
  }

  async function saveAndExport(format: "json" | "csv" | "offer-xlsx") {
    if (exportBusy) return;
    setExportBusy(true); setHeaderActionMessage("Preparando descarga…");
    try {
      if (!(await persistCalculation())) { setHeaderActionMessage("La descarga espera a que se guarden los cambios. Revisa el aviso de guardado."); return; }
      await downloadExport(appPath(`/api/projects/${project.id}/export?format=${format}`), format === "offer-xlsx" ? "Oferta económica.xlsx" : `Calculo.${format}`);
      setHeaderActionMessage("Archivo preparado para descargar.");
    } catch (error) { setHeaderActionMessage(error instanceof Error ? error.message : "No se pudo descargar el archivo."); }
    finally { setExportBusy(false); }
  }

  async function resetCalculationData() {
    if (!resetConfirmed || resetStatus === "loading") return;
    resetInProgressRef.current = true;
    setResetStatus("loading");
    setResetError("");
    try {
      const response = await fetch(appPath(`/api/projects/${props.project.id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          confirmation: "RESET_CALCULATION",
          expectedUpdatedAt: latestProjectUpdatedAtRef.current,
        }),
      });
      const data = (await response.json()) as { error?: string; odooSyncWarning?: string | null; assetCleanupWarning?: string | null };
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo reiniciar el cálculo.");
      }
      const params = new URLSearchParams({
        preparedCalculationId: props.project.id,
        resetStatus: data.odooSyncWarning || data.assetCleanupWarning ? "warning" : "success",
      });
      window.location.replace(`${appPath("/")}?${params.toString()}`);
    } catch (error) {
      resetInProgressRef.current = false;
      setResetStatus("error");
      setResetError(error instanceof Error ? error.message : "No se pudo reiniciar. No se borró ningún dato.");
    }
  }

  const totalComplete = simulation.summary.total.isComplete;
  const partialScope = simulation.summary.partial;
  const costComparisonReady = manualReferenceTotal !== null
    && simulation.summary.costIsComplete
    && simulation.summary.missingAssociatedCostCount === 0
    && simulation.summary.assumedQuantityCount === 0;
  const summaryFocusClass = totalComplete ? "total-focus" : `is-preliminary ${partialScope.evaluableCount > 0 ? "partial-focus" : "balanced-focus"}`;
  const partialReferenceComplete = partialScope.evaluableCount > 0 &&
    simulation.rows.filter((row) => row.includedInOffer !== false && row.isFinanciallyEvaluable).every((row) => row.referenceTotal !== null);
  const graphicSummary = totalComplete ? offer.summary : partialOffer?.summary;
  const graphicCeiling = totalComplete
    ? simulation.summary.referenceIsComplete ? simulation.summary.referenceKnownTotal : null
    : partialReferenceComplete ? partialScope.totalReference : null;
  const totalCeiling = simulation.summary.referenceIsComplete ? simulation.summary.referenceKnownTotal : null;
  const offerCeiling = globalOfferCeilingComparison({
    ceiling: totalCeiling,
    grossOffer: offer.summary.totalOfferWithVat,
    offeredItemCount: simulation.summary.knownOfferCount,
    itemCount: simulation.summary.itemCount,
  });
  const utilityIsScenario = simulation.summary.nonFinalCostBasisCount > 0;
  // Once there is an evaluable offer, the composition uses that same set of items
  // for cost, offer and utility. The global-budget graph is only for costs alone.
  const costOverview = !totalComplete && manualReferenceTotal !== null && !partialScope.evaluableCount
    ? { knownCost: simulation.summary.knownCostTotal, knownCostCount: simulation.summary.knownCostCount, knownOffer: simulation.summary.knownOfferCount ? offer.summary.totalOfferWithVat : null, knownOfferCount: simulation.summary.knownOfferCount, itemCount: simulation.summary.itemCount, pendingCostCount: simulation.summary.missingCostCount, pendingOfferCount: simulation.summary.missingOfferCount, costComplete: costComparisonReady }
    : undefined;
  const assumedQuantityNote = simulation.summary.assumedQuantityCount
    ? ` · ${simulation.summary.assumedQuantityCount} con 1 unidad asumida` : "";
  const summaryCoverage = costOverview
    ? `${simulation.summary.knownOfferCount} de ${simulation.summary.itemCount} ítems con oferta · ${simulation.summary.knownCostCount} con costo conocido · datos parciales${assumedQuantityNote}`
    : totalComplete ? `${simulation.summary.itemCount} ítems evaluables${assumedQuantityNote}` : `${partialScope.evaluableCount} de ${simulation.summary.itemCount} ítems evaluables · datos parciales${assumedQuantityNote}`;
  const graphicScope = totalComplete ? "Oferta total" : `Oferta parcial · ${partialScope.evaluableCount}/${simulation.summary.itemCount} ítems`;
  const partialUtility = !totalComplete && partialOffer?.summary.estimatedNetUtility != null && partialScope.evaluableCount > 0 ? { value: partialOffer.summary.estimatedNetUtility, coveredCount: partialScope.evaluableCount, excludedCount: simulation.summary.itemCount - partialScope.evaluableCount } : null;
  const offerSummaryUtility = totalComplete ? offer.summary.estimatedNetUtility : provisionalOffer?.utility ?? partialUtility?.value ?? null;
  const offerSummaryHasLoss = offerSummaryUtility !== null && offerSummaryUtility < 0;
  const missingTotalParts = [
    simulation.summary.missingQuantityCount ? `${simulation.summary.missingQuantityCount} sin cantidad` : null,
    simulation.summary.missingCostCount ? `${simulation.summary.missingCostCount} con costos pendientes` : null,
    manualReferenceTotal === null && simulation.summary.missingReferenceCount ? `${simulation.summary.missingReferenceCount} sin techo` : null,
    simulation.summary.missingOfferCount ? `${simulation.summary.missingOfferCount} sin oferta` : null,
  ].filter(Boolean);
  function valueForSort(column: SimulatorColumnKey, row: (typeof simulation.rows)[number], index: number): string | number {
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
    if (column === "costTotal") return row.costTotal ?? Number.NEGATIVE_INFINITY;
    if (column === "costSource") return displayCostSource(row);
    if (column === "reference") return row.referenceUnit ?? Number.NEGATIVE_INFINITY;
    if (column === "referenceTotal") return row.referenceTotal ?? Number.NEGATIVE_INFINITY;
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

  function sortedRowIndexesFor(key: SimulatorColumnKey, direction: SortDirection): number[] {
    return [...simulation.rows.map((row, index) => ({ row, index }))].sort((left, right) => {
      const leftValue = valueForSort(key, left.row, left.index);
      const rightValue = valueForSort(key, right.row, right.index);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "es", { numeric: true, sensitivity: "base" });
      return direction === "asc" ? result : -result;
    }).map(({ index }) => index);
  }

  const sortedSimulatorRows = useMemo(() => {
    const indexedRows = simulation.rows.map((row, index) => ({ row, index })).filter(entry => matchesRowFilter(entry.row));
    if (!sortState || !sortRowIndexes) return groupedProcurementIndexes(items, indexedRows.map(entry => entry.index)).map(index => indexedRows.find(entry => entry.index === index)!);
    const byIndex = new Map(indexedRows.map((entry) => [entry.index, entry]));
    const ordered = sortRowIndexes.flatMap((index) => {
      const entry = byIndex.get(index);
      return entry ? [entry] : [];
    });
    const seen = new Set(ordered.map((entry) => entry.index));
    return groupedProcurementIndexes(items, [...ordered, ...indexedRows.filter((entry) => !seen.has(entry.index))].map((entry) => entry.index)).map(index => indexedRows.find(entry => entry.index === index)!);
  }, [simulation, items, sortRowIndexes, sortState, rowFilter]);

  function toggleSort(key: SimulatorColumnKey) {
    setSortState((current) => {
      if (!current || current.key !== key) {
        setSortRowIndexes(sortedRowIndexesFor(key, "asc"));
        return { key, direction: "asc" };
      }
      if (current.direction === "asc") {
        setSortRowIndexes(sortedRowIndexesFor(key, "desc"));
        return { key, direction: "desc" };
      }
      setSortRowIndexes(null);
      return null;
    });
  }

  function sortLabel(key: SimulatorColumnKey): string {
    if (sortState?.key !== key) return "\u2195";
    return sortState.direction === "asc" ? "\u2191" : "\u2193";
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

  function clearAdjustmentGate() {
    setAdjustmentGate(null);
  }

  function guardedAdjustmentValue(rowKey: string, mode: "discount" | "profit", current: number, next: number, safety: AdjustmentSafety): number {
    if (safety.safeStartValue === null || safety.safeEndValue === null) return next;
    const lower = Math.min(safety.safeStartValue, safety.safeEndValue);
    const upper = Math.max(safety.safeStartValue, safety.safeEndValue);
    const activeGate = adjustmentGate?.rowKey === rowKey && adjustmentGate.mode === mode ? adjustmentGate : null;

    if (activeGate) {
      const stillPushingPastGate = activeGate.side === "below" ? next < activeGate.boundary : next > activeGate.boundary;
      return stillPushingPastGate ? activeGate.boundary : next;
    }

    if (next < lower && current > lower + 0.0001) {
      setAdjustmentGate({ rowKey, mode, side: "below", boundary: lower });
      return lower;
    }
    if (next > upper && current < upper - 0.0001) {
      setAdjustmentGate({ rowKey, mode, side: "above", boundary: upper });
      return upper;
    }
    return next;
  }

  function applyOfferAdjustment(
    row: ReturnType<typeof buildSimulation>["rows"][number],
    index: number,
    mode: "discount" | "profit",
    next: number,
  ) {
    if (mode === "discount") {
      updateControl(row.rowKey, { ...offerPatchFromUnit(row, offerUnitFromDiscount(row, next)), discountPct: next }, index);
      return;
    }
    updateControl(row.rowKey, { ...offerPatchFromUnit(row, offerUnitFromProfit(row, next)), profitPct: next }, index);
  }

  function adjustmentSafetyStyle(): CSSProperties {
    return {
      "--safe-start": `${SAFE_ZONE_START}%`,
      "--safe-end": `${SAFE_ZONE_END}%`,
    } as CSSProperties;
  }

  function maxSafeAdjustmentValue(row: ReturnType<typeof buildSimulation>["rows"][number], mode: "discount" | "profit" = row.control.mode === "discount" ? "discount" : "profit"): number {
    return rawMaxSafeAdjustmentValue(row, mode) ?? 0;
  }

  function stickyStyleForColumn(key: SimulatorColumnKey, isHeader = false): CSSProperties | undefined {
    if (!FROZEN_SIMULATOR_COLUMNS.has(key)) return undefined;
    let left = 0;
    for (const column of visibleSimulatorColumns) {
      if (column.key === key) {
        return { left, zIndex: isHeader ? 24 : 8 };
      }
      if (FROZEN_SIMULATOR_COLUMNS.has(column.key)) {
        left += columnPrefs[column.key]?.width ?? column.defaultWidth;
      }
    }
    return undefined;
  }

  function withStickyCell(column: ColumnDef, cell: ReactNode): ReactNode {
    const stickyStyle = stickyStyleForColumn(column.key);
    if (!isValidElement<{ className?: string; style?: CSSProperties }>(cell)) return cell;
    const groupClass = `table-group-${column.group}`;
    const stickyClass = stickyStyle ? "sticky-reference-col" : "";
    return cloneElement(cell, {
      className: `${cell.props.className ?? ""} ${groupClass} ${stickyClass}`.trim(),
      style: { ...cell.props.style, ...(stickyStyle ?? {}) },
    });
  }

  function lockedCellKey(index: number, field: LockedFieldKey): string {
    return `${index}:${field}`;
  }

  function renderLockedInput(props: {
    index: number;
    field: LockedFieldKey;
    value: string;
    displayValue: string;
    placeholder: string;
    inputMode?: "text" | "numeric" | "decimal";
    className?: string;
    onChange: (value: string) => void;
  }): ReactNode {
    const key = lockedCellKey(props.index, props.field);
    const hasValue = props.displayValue.trim().length > 0;
    const isEditing = !hasValue || editingLockedCell === key;

    if (isEditing) {
      return (
        <input
          className={`table-input ${props.className ?? ""}`}
          inputMode={props.inputMode}
          value={props.value}
          autoFocus={hasValue && editingLockedCell === key}
          onChange={(event) => props.onChange(event.target.value)}
          onBlur={() => setEditingLockedCell((current) => (current === key ? null : current))}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          placeholder={props.placeholder}
        />
      );
    }

    return (
      <button
        className={`locked-data-pill ${props.className ?? ""}`}
        type="button"
        onClick={() => setEditingLockedCell(key)}
        onDoubleClick={() => setEditingLockedCell(key)}
        title="Dato importado. Clic para editar."
      >
        <strong>{props.displayValue}</strong>
        <span>Editar</span>
      </button>
    );
  }

  function renderHeader(column: ColumnDef): ReactNode {
    const isSorted = sortState?.key === column.key;
    const stickyStyle = stickyStyleForColumn(column.key, true);
    if (column.key === "select") {
      return (
        <th className={`table-group-${column.group} sticky-reference-col selection-col`} key={column.key} style={stickyStyle}>
          <input
            type="checkbox"
            checked={allRowsSelected}
            onChange={(event) => toggleAllRows(event.target.checked)}
            aria-label="Seleccionar todas las filas"
            title="Seleccionar todas las filas"
          />
        </th>
      );
    }
    return (
      <th className={`table-group-${column.group} ${stickyStyle ? "sticky-reference-col" : ""}`} key={column.key} style={stickyStyle}>
        <div className="th-content">
          <span className="th-title-stack">
            <span className="th-label">{column.label}</span>
          </span>
          {column.key !== "actions" ? (
            <span className={`th-tools ${isSorted ? "active" : ""}`}>
              <button
                className="column-hide-button"
                type="button"
                onClick={() => setColumnVisible(column.key, false)}
                title={`Ocultar ${column.label || "columna"}`}
                aria-label={`Ocultar ${column.label || "columna"}`}
              >
                -
              </button>
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

  function renderOfferAdjustment(row: (typeof simulation.rows)[number], index: number): ReactNode {
      const discountValue = discountValueForRow(row);
      const profitValue = profitValueForRow(row);
      return (
        <div className="offer-adjust-inner">
            <select value={row.control.mode} onChange={(event) => switchOfferMode(row, index, event.target.value as OfferMode)}>
              {(["discount", "profit", "manual"] as OfferMode[]).map((mode) => (
                <option value={mode} key={mode}>
                  {labelForOfferMode(mode)}
                </option>
              ))}
            </select>
            {row.control.mode === "discount" ? (
              <div
                className={`safe-range-control mode-discount risk-${adjustmentSafety(row).risk}`}
                style={adjustmentSafetyStyle()}
              >
                <input
                  className="wide-range safe-range-input"
                  type="range"
                  min={0}
                  max={100}
                  step={ADJUSTMENT_STEP}
                  value={visualAdjustmentValue(row, "discount", discountValue)}
                  onDoubleClick={() => {
                    const next = 0;
                    applyOfferAdjustment(row, index, "discount", next);
                  }}
                  onPointerUp={clearAdjustmentGate}
                  onMouseUp={clearAdjustmentGate}
                  onTouchEnd={clearAdjustmentGate}
                  onChange={(event) => {
                    const rawValue = adjustmentValueFromVisual(row, "discount", Number(event.target.value));
                    const next = guardedAdjustmentValue(row.rowKey, "discount", discountValue, roundAdjustment(rawValue), adjustmentSafety(row));
                    applyOfferAdjustment(row, index, "discount", next);
                  }}
                />
                <label className="safe-range-stepper-wrap" aria-label="Ajuste fino descuento">
                  <input
                    className="safe-range-stepper"
                    type="number"
                    min={-adjustmentBounds(row, "discount").max}
                    max={-adjustmentBounds(row, "discount").min}
                    step={ADJUSTMENT_STEP}
                    value={(-discountValue).toFixed(1)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isFinite(parsed)) {
                        const next = guardedAdjustmentValue(row.rowKey, "discount", discountValue, roundAdjustment(-parsed), adjustmentSafety(row));
                        applyOfferAdjustment(row, index, "discount", next);
                      }
                    }}
                  />
                  <span>%</span>
                </label>
                <span className="safe-range-money">{formatCop(row.utilityValue)}</span>
                <small><span>{adjustmentSafety(row).label}</span>{adjustmentRiskLabel(adjustmentSafety(row).risk) ? <em>{adjustmentRiskLabel(adjustmentSafety(row).risk)}</em> : null}</small>
              </div>
            ) : row.control.mode === "profit" ? (
              <div
                className={`safe-range-control mode-profit risk-${adjustmentSafety(row).risk}`}
                style={adjustmentSafetyStyle()}
              >
                <input
                  className="wide-range safe-range-input"
                  type="range"
                  min={0}
                  max={100}
                  step={ADJUSTMENT_STEP}
                  value={visualAdjustmentValue(row, "profit", profitValue)}
                  onDoubleClick={() => {
                    const next = maxSafeAdjustmentValue(row, "profit");
                    applyOfferAdjustment(row, index, "profit", next);
                  }}
                  onPointerUp={clearAdjustmentGate}
                  onMouseUp={clearAdjustmentGate}
                  onTouchEnd={clearAdjustmentGate}
                  onChange={(event) => {
                    const rawValue = adjustmentValueFromVisual(row, "profit", Number(event.target.value));
                    const next = guardedAdjustmentValue(row.rowKey, "profit", profitValue, roundAdjustment(rawValue), adjustmentSafety(row));
                    applyOfferAdjustment(row, index, "profit", next);
                  }}
                />
                <label className="safe-range-stepper-wrap" aria-label="Ajuste fino utilidad">
                  <input
                    className="safe-range-stepper"
                    type="number"
                    min={adjustmentBounds(row, "profit").min}
                    max={adjustmentBounds(row, "profit").max}
                    step={ADJUSTMENT_STEP}
                    value={profitValue.toFixed(1)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isFinite(parsed)) {
                        const next = guardedAdjustmentValue(row.rowKey, "profit", profitValue, roundAdjustment(parsed), adjustmentSafety(row));
                        applyOfferAdjustment(row, index, "profit", next);
                      }
                    }}
                  />
                  <span>%</span>
                </label>
                <span className="safe-range-money">{formatCop(row.utilityValue)}</span>
                <small><span>{adjustmentSafety(row).label}</span>{adjustmentRiskLabel(adjustmentSafety(row).risk) ? <em>{adjustmentRiskLabel(adjustmentSafety(row).risk)}</em> : null}</small>
              </div>
            ) : (
              <input
                className="compact-input"
                inputMode="numeric"
                value={formatInputNumber(row.control.manualOfferUnit)}
                onChange={(event) => updateControl(row.rowKey, { manualOfferUnit: updateNumeric(event.target.value) }, index)}
                placeholder="COP"
              />
            )}
        </div>
      );
  }

  function renderSimulatorCell(column: SimulatorColumnKey, row: (typeof simulation.rows)[number], index: number): ReactNode {
    if (column === "select") {
      return (
        <td className="selection-cell" key={column}>
          <input
            type="checkbox"
            checked={selectedRowKeys.has(row.rowKey)}
            onChange={(event) => toggleRowSelection(row.rowKey, event.target.checked)}
            aria-label={`Seleccionar item ${row.item || index + 1}`}
          />
        </td>
      );
    }
    if (column === "item") {
      return (
        <td className="editable-cell locked-source-cell" key={column}>
          {renderLockedInput({
            index,
            field: "item",
            value: items[index]?.item ?? "",
            displayValue: items[index]?.item ?? "",
            placeholder: "Item",
            className: "item-code-input",
            onChange: (value) => updateItem(index, { item: value }),
          })}
        </td>
      );
    }
    if (column === "description") {
      const item = items[index];
      const technicalText = (item?.technicalDescription ?? "").trim();
      const isEditingName = editingDescriptionIndex === index || !(item?.description ?? "").trim();
      const isTechnicalExpanded = technicalPreviewExpandedIndex === index;
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
                  onClick={() => setEditingDescriptionIndex(index)}
                  title="Clic para editar"
                >
                  {item?.description || EMPTY_CELL}
                </button>
              )}
            </div>
            <div className="row-action-menu">
              <button
                className="row-menu-trigger"
                type="button"
                onClick={() => openItemEditor(index)}
                aria-label="Ver y editar item"
                title="Ver y editar item"
              >
                ...
              </button>
            </div>
          </div>
          <div className="item-row-links">
            <button className="item-associated-cost-link" type="button" onClick={() => openItemEditor(index)} title="Editar servicios y costos asociados">
              Costos asociados: {item?.additionalCosts?.length ? `${item.additionalCosts.length}${item.additionalCosts.some((cost) => cost.amount === null) ? " · pendiente" : ""}` : "agregar"}
            </button>
            <QuoteLinkButton links={quoteLinks[index] ?? []} />
          </div>
          <div className={`inline-details technical-preview ${isTechnicalExpanded ? "is-expanded" : ""}`}>
            <span className="technical-preview-label">Ficha técnica</span>
            {editingTechnicalIndex === index ? (
              <textarea
                value={item?.technicalDescription ?? ""}
                autoFocus
                onChange={(event) => updateItem(index, { technicalDescription: event.target.value })}
                onBlur={() => setEditingTechnicalIndex(null)}
                placeholder="Ficha técnica"
              />
            ) : (
              <button
                className={`technical-preview-text ${technicalText ? "" : "is-empty"} ${isTechnicalExpanded ? "is-expanded" : ""}`}
                type="button"
                onClick={() => setEditingTechnicalIndex(index)}
                title="Editar ficha técnica"
              >
                {technicalText || EMPTY_CELL}
              </button>
            )}
            {technicalText && editingTechnicalIndex !== index ? (
              <button className="technical-preview-more" type="button" aria-expanded={isTechnicalExpanded} onClick={() => setTechnicalPreviewExpandedIndex(isTechnicalExpanded ? null : index)}>
                {isTechnicalExpanded ? "Ver menos" : "Ver ficha completa"}
              </button>
            ) : null}
          </div>
        </td>
      );
    }
    if (column === "quantity") {
      return (
        <td className="editable-cell locked-source-cell" key={column}>
          <div className="quantity-inputs">
            <div className="quantity-main">
              {renderLockedInput({
                index,
                field: "quantity",
                value: formatInputNumber(items[index]?.quantity),
                displayValue: formatInputNumber(items[index]?.quantity),
                placeholder: "Cant.",
                inputMode: "decimal",
                className: "compact-input",
                onChange: (value) => updateItem(index, { quantity: updateNumeric(value) }),
              })}
            </div>
            <div className="quantity-unit">
              {renderLockedInput({
                index,
                field: "unit",
                value: items[index]?.unit ?? "",
                displayValue: items[index]?.unit ?? "",
                placeholder: "UND",
                className: "unit-input",
                onChange: (value) => updateItem(index, { unit: value }),
              })}
            </div>
          </div>
        </td>
      );
    }
    if (column === "costMode") {
      return (
        <td className="editable-cell" key={column}>
          <select
            value={items[index]?.selectedCostMode ?? "weighted"}
            onChange={(event) => { const patch = costModePatch(items[index]!, project.settings, event.target.value as CostMode); if (patch) updateItem(index, patch); }}
          >
            {costOptions(items[index]!, project.settings).map(option => <option key={option.mode} value={option.mode}>{option.label}</option>)}
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
        <td className={`editable-cell manual-cost-cell ${items[index]?.selectedCostMode === "manual" ? "active-cost-cell" : row.costUnit === null ? "needs-manual-cost" : ""}`} key={column}>
          <div className="manual-cost-input-row">
            <input
              className="table-input compact-input"
              inputMode="numeric"
              value={formatInputNumber(items[index]?.manualUnitCost)}
              onChange={(event) => updateManualUnitCost(index, updateNumeric(event.target.value))}
              placeholder="COP"
            />
            <button
              className="google-search-icon-button"
              type="button"
              onClick={() => openGoogleSearch(index)}
              title="Buscar en Google"
              aria-label="Buscar en Google"
            >
              G
            </button>
          </div>
        </td>
      );
    }
    if (column === "costUnit") {
      const item = items[index];
      const scenarioPct = item?.costScenarioDiscountPct ?? null;
      const scenarioMode = item?.costScenarioMode ?? "unit";
      const hasScenario = scenarioPct !== null && Number.isFinite(scenarioPct);
      const visibleSources = (item?.priceSources ?? [])
        .map((source, sourceIndex) => ({ source, sourceIndex }))
        .filter(({ source }) => source.label || source.unitPrice !== null || source.url);
      return (
        <td className={`money calculated-cell total-cost-cell cost-scenario-cell ${hasScenario ? "has-cost-scenario" : ""}`} key={column}>
          <div className="cost-scenario-stack">
            <div className="unit-total-stack">
              <span className="unit-total-label">Unit.</span>
              <strong>{formatCop(row.costUnit)}</strong>
              <span className="unit-total-sub">
                Total <strong>{formatCop(row.costTotal)}</strong>
              </span>
            </div>
            <span className="cost-scenario-source">
              {displayCostSource(row)}
              {displayCostSource(row) && hasScenario && row.baseCostUnit !== null ? ` desde ${formatCop(row.baseCostUnit)}` : ""}
            </span>
            <details className="cost-scenario-actions">
              <summary aria-label="Editar escenario de costo">...</summary>
              <div className="cost-scenario-popover">
                <div className="cost-scenario-controls" aria-label="Escenario de descuento al costo">
                  <span className="cost-scenario-mode-pill">{labelForCostScenarioMode(scenarioMode)}</span>
                  <label>
                    <input
                      inputMode="decimal"
                      value={scenarioPct === null ? "" : formatInputNumber(scenarioPct)}
                      onChange={(event) => updateCostScenario(index, { costScenarioMode: "unit", costScenarioDiscountPct: updateNumeric(event.target.value) })}
                      placeholder="Desc."
                      title="Descuento porcentual sobre el costo visible"
                    />
                    <span>%</span>
                  </label>
                  {hasScenario ? (
                    <button type="button" onClick={() => resetCostScenario(index)} title="Resetear escenario de costo" aria-label="Resetear escenario de costo">
                      x
                    </button>
                  ) : null}
                  {visibleSources.length ? (
                    <button
                      className="cost-source-toggle"
                      type="button"
                      onClick={() => setOpenCostSourcesIndex((current) => (current === index ? null : index))}
                    >
                      Fuentes
                    </button>
                  ) : null}
                </div>
                {row.costBreakdown.sources.some((source) => source.normalizedUnit !== null) ? (
                  <select className="cost-selected-source" value={item?.selectedCostMode === "source" ? item.selectedPriceSourceId ?? "" : ""} aria-label={`Cotización elegida para ítem ${item?.item || index + 1}`} onChange={(event) => updateItem(index, { selectedCostMode: "source", selectedPriceSourceId: event.target.value || null })}>
                    <option value="">Elegir cotización</option>
                    {row.costBreakdown.sources.filter((source) => source.normalizedUnit !== null).map((source) => <option value={source.id} key={source.id}>{source.label}</option>)}
                  </select>
                ) : null}
                {openCostSourcesIndex === index && visibleSources.length ? (
                  <div className="cost-source-mini-report">
                    <span className="cost-source-mini-title">Fuentes</span>
                    {visibleSources.map(({ source, sourceIndex }) => {
                      const normalized = row.costBreakdown.sources[sourceIndex];
                      const href = sourceHref(source.url);
                      const rawPrice = source.unitPrice !== null && source.unitPrice > 0 ? `${source.currency} ${formatInputNumber(source.unitPrice)}` : "Precio pendiente";
                      const normalizedPrice = normalized?.normalizedUnit ?? null;
                      return (
                        <div className="cost-source-mini-row" key={source.id || sourceIndex}>
                          <span className="cost-source-mini-main">
                            <strong>{source.label || `Fuente ${sourceIndex + 1}`}</strong>
                            <em>{rawPrice}</em>
                          </span>
                          <span className="cost-source-mini-price">{formatCop(normalizedPrice)}</span>
                          {href ? (
                            <span className="cost-source-mini-link" title={source.url}><SourcePreviewLink href={href} label="Link" /></span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </details>
            {hasScenario ? (
              <em className="cost-scenario-tag">
                {labelForCostScenarioMode(scenarioMode)} -{formatPercent(scenarioPct)}
              </em>
            ) : null}
          </div>
        </td>
      );
    }
    if (column === "costTotal") return <td className="money calculated-cell total-cost-cell" key={column}>{formatCop(row.costTotal)}</td>;
    if (column === "costSource") return <td className="calculated-cell" key={column}>{displayCostSource(row)}</td>;
    if (column === "reference") {
      return (
        <td className="editable-cell locked-source-cell reference-stack-cell" key={column}>
          <div className="unit-total-stack">
            <span className="unit-total-label">Unit.</span>
            {renderLockedInput({
              index,
              field: "reference",
              value: formatInputNumber(items[index]?.referenceUnit),
              displayValue: formatInputNumber(items[index]?.referenceUnit),
              placeholder: "COP",
              inputMode: "numeric",
              className: "compact-input unit-total-primary-input",
              onChange: (value) => updateItem(index, { referenceUnit: updateNumeric(value) }),
            })}
            <span className="unit-total-sub">
              Total <strong>{formatCop(row.referenceTotal)}</strong>
            </span>
          </div>
        </td>
      );
    }
    if (column === "referenceTotal") return <td className="money calculated-cell total-reference-cell" key={column}>{formatCop(row.referenceTotal)}</td>;
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
      return <td className="editable-cell offer-adjust-cell" key={column}>{renderOfferAdjustment(row, index)}</td>;
    }
    if (column === "offerUnit") {
      return (
        <td className="money calculated-cell offer-stack-cell" key={column}>
          <div className="unit-total-stack">
            <span className="unit-total-label">Unit.</span>
            <strong>{formatCop(row.offerUnit)}</strong>
            <span className="unit-total-sub">
              Total <strong>{formatCop(row.offerTotal)}</strong>
            </span>
          </div>
        </td>
      );
    }
    if (column === "offerTotal") return <td className="money calculated-cell" key={column}>{formatCop(row.offerTotal)}</td>;
    if (column === "utility") {
      return (
        <td className="money calculated-cell utility-cell" key={column}>
          <div className="utility-stack">
            <span>Total</span>
            <strong>{formatCop(row.utilityValue)}</strong>
            <span>{formatPercent(row.marginPctOnCost)}</span>
          </div>
        </td>
      );
    }
    if (column === "status") {
      const itemNotes = items[index]?.notes?.trim() ?? "";
      const visibleWarnings = row.warnings
        .filter((warning) => !isEmptyFieldWarning(warning))
        .map((warning) => ({ raw: warning, label: conciseWarning(warning), tone: warningTone(warning) }));
      return (
        <td className="calculated-cell status-alert-cell" key={column}>
          <div className="notes-alerts-stack">
            {itemNotes ? (
              <div className="item-note-inline">
                <strong>Nota</strong>
                <span>{itemNotes}</span>
              </div>
            ) : null}
            {visibleWarnings.length ? (
              <ul className="alert-chip-list">
                {visibleWarnings.map((warning) => (
                  <li className={`alert-chip alert-${warning.tone}`} key={warning.raw} title={warning.raw}>
                    {warning.label}
                  </li>
                ))}
              </ul>
            ) : null}
            {!itemNotes && !visibleWarnings.length ? <span className="empty-alert-space" aria-label="Sin notas ni alertas" /> : null}
          </div>
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
    if (column === "actions") {
      return (
        <td className="action-cell search-action-cell" key={column}>
          <button className="google-search-button" type="button" onClick={() => openGoogleSearch(index)} title="Preparar busqueda en Google">
            Google
          </button>
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

  function renderTechnicalModal(): ReactNode {
    if (technicalModalIndex === null) return null;
    const item = items[technicalModalIndex];
    if (!item) return null;
    const technicalText = (item.technicalDescription ?? "").trim();

    return (
      <div
        className="item-detail-overlay technical-text-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Ficha técnica completa"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setTechnicalModalIndex(null);
          }
        }}
      >
        <div className="technical-text-modal">
          <div className="item-detail-head">
            <div>
              <span className="modal-eyebrow">Ficha técnica</span>
              <h2>{item.description || EMPTY_CELL}</h2>
            </div>
            <button className="modal-close-button" type="button" onClick={() => setTechnicalModalIndex(null)} aria-label="Cerrar ficha tecnica">
              X
            </button>
          </div>
          <button
            className="technical-text-body"
            type="button"
            onClick={() => {
              setEditingTechnicalIndex(technicalModalIndex);
              setTechnicalModalIndex(null);
            }}
            title="Clic para editar ficha tecnica"
          >
            {technicalText || EMPTY_CELL}
          </button>
          <div className="technical-text-actions">
            <button className="icon-button copy-icon-button" type="button" onClick={() => void navigator.clipboard?.writeText(technicalText)} aria-label="Copiar ficha tecnica" title="Copiar">
              <span className="copy-glyph" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
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
        onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailRowIndex(null); }}
      >
        <div className="item-detail-modal">
          <div className="item-detail-head">
            <div>
              <span className="modal-eyebrow">Detalle del item</span>
              <h2>{item.description || row.description || EMPTY_CELL}</h2>
              <p>{item.item ? `Item ${item.item}` : "Item sin codigo"}</p>
            </div>
            <button className="modal-close-button" type="button" onClick={() => setDetailRowIndex(null)} aria-label="Cerrar detalle">
              X
            </button>
          </div>

          <div className="details-body modal-details-body">
            <div className="item-detail-summary" aria-label="Resumen financiero del item">
              <span><small>Techo unit.</small><strong>{formatCop(row.referenceUnit)}</strong></span>
              <span className="item-detail-cost-summary"><small>Costo unit. total · {item.costBasisStatus === "partial" ? "Parcial" : item.costBasisStatus === "comparable_scenario" ? "Escenario comparable" : row.costSourceLabel || "Sin método"}</small><strong>{formatCop(row.costUnit)}</strong><small>Totales: producto {formatCop(row.productCostTotal)} + asociados {formatCop(row.additionalCostTotal)}</small><button type="button" onClick={() => setDetailQuickCostOpen((current) => !current)}>Editar costo base</button>
                {detailQuickCostOpen ? <QuickCostEditor label={item.deliverableType === "service" ? "Costo base del servicio por unidad" : "Costo base del producto por unidad"} value={manualBaseCostInputForRow(row)} explanation={item.deliverableType === "service" ? "Al guardar se usará como costo manual del servicio." : "Al guardar se usará como costo manual del producto; los servicios se suman aparte."} onSave={(amount) => { pushUndoSnapshot(); updateItem(detailRowIndex, { manualUnitCost: amount, selectedCostMode: "manual" }); setDetailQuickCostOpen(false); }} onCancel={() => setDetailQuickCostOpen(false)} /> : null}
              </span>
              <span><small>Oferta unit.</small><strong>{formatCop(row.offerUnit)}</strong></span>
              <span><small>{item.costBasisStatus === "partial" || item.costBasisStatus === "comparable_scenario" ? "Utilidad de escenario" : "Utilidad"}</small><strong>{formatCop(row.utilityValue)}</strong></span>
            </div>

            <div className="detail-provenance-grid">
              <section className="detail-provenance-column is-input" aria-label="Datos recibidos del ítem">
                <header className="detail-provenance-heading"><span>Entrada</span><h3>Datos recibidos</h3><p>Descripción y ficha registradas en el cálculo. Puedes contrastarlas con el pliego.</p></header>
            <details className="detail-disclosure" open={detailOpenSections.has("base")}>
              <summary onClick={(event) => { event.preventDefault(); setDetailEditSection(null); toggleDetailOpenSection("base"); }}><strong>Datos registrados</strong><small>Descripción, cantidad y techo</small></summary>
            <section className="detail-section">
              <div className="detail-edit-bar"><button type="button" onClick={() => setDetailEditSection((current) => current === "base" ? null : "base")}>{detailEditSection === "base" ? "Terminar edición" : "Editar datos registrados"}</button></div>
              {detailEditSection === "base" ? <div className="edit-grid item-detail-grid">
                <label className="detail-wide-field">
                  Nombre o descripcion
                  <input value={item.description ?? ""} onChange={(event) => updateItem(detailRowIndex, { description: event.target.value })} placeholder="Nombre del item" />
                </label>
                <label>
                  Tipo de entregable
                  <select aria-label="Tipo de entregable" value={item.deliverableType ?? ""} onChange={(event) => updateItem(detailRowIndex, { deliverableType: event.target.value === "product" ? "product" : event.target.value === "service" ? "service" : null })}>
                    <option value="">Sin clasificar</option><option value="product">Producto</option><option value="service">Servicio</option>
                  </select>
                </label>
                <label>
                  Item
                  <input value={item.item ?? ""} onChange={(event) => updateItem(detailRowIndex, { item: event.target.value })} placeholder="Codigo" />
                </label>
                <label>
                  Cantidad
                  <input
                    inputMode="decimal"
                    value={formatInputNumber(item.quantity)}
                    onChange={(event) => updateItem(detailRowIndex, { quantity: updateNumeric(event.target.value) })}
                    placeholder="Sin cantidad"
                  />
                </label>
                <label>
                  Unidad
                  <input value={item.unit ?? ""} onChange={(event) => updateItem(detailRowIndex, { unit: event.target.value })} placeholder="UND" />
                </label>
                <label>
                  Precio techo unit.
                  <input
                    inputMode="numeric"
                    value={formatInputNumber(item.referenceUnit)}
                    onChange={(event) => updateItem(detailRowIndex, { referenceUnit: updateNumeric(event.target.value) })}
                    placeholder="Sin techo"
                  />
                </label>
              </div> : <dl className="detail-readonly-grid">
                <div><dt>Descripción</dt><dd>{item.description || "Sin descripción"}</dd></div>
                <div><dt>Tipo de entregable</dt><dd>{item.deliverableType === "product" ? "Producto" : item.deliverableType === "service" ? "Servicio" : "Sin clasificar"}</dd></div>
                <div><dt>Ítem</dt><dd>{item.item || "Sin código"}</dd></div>
                <div><dt>Cantidad</dt><dd>{item.quantity ?? "Pendiente"}</dd></div>
                <div><dt>Unidad</dt><dd>{item.unit || "UND"}</dd></div>
                <div><dt>Techo unitario</dt><dd>{formatCop(item.referenceUnit)}</dd></div>
              </dl>}
            </section>
            </details>

            {item.technicalAnnex?.length ? <TechnicalAnnexViewer excerpts={item.technicalAnnex} itemName={item.description || `Ítem ${item.item}`} /> : null}

            <details className="detail-disclosure" open={detailOpenSections.has("technical")}>
              <summary onClick={(event) => { event.preventDefault(); setDetailEditSection(null); toggleDetailOpenSection("technical"); }}><strong>Ficha técnica</strong><small>Características solicitadas</small></summary>
            <section className="detail-section">
              <div className="detail-edit-bar"><button type="button" onClick={() => setDetailEditSection((current) => current === "technical" ? null : "technical")}>{detailEditSection === "technical" ? "Terminar edición" : "Editar ficha registrada"}</button></div>
              {detailEditSection === "technical" ? <textarea
                className="detail-textarea"
                value={item.technicalDescription ?? ""}
                onChange={(event) => updateItem(detailRowIndex, { technicalDescription: event.target.value })}
                placeholder="Sin ficha tecnica"
              /> : <p className="detail-readonly-text">{item.technicalDescription || "Sin ficha técnica registrada."}</p>}
            </section>
            </details>

              </section>
              <section className="detail-provenance-column is-work" aria-label="Investigación y decisiones del ítem">
                <header className="detail-provenance-heading"><span>Trabajo</span><h3>Investigación y ajustes</h3><p>Costo elegido, servicios, fuentes y notas del estudio.</p></header>
            <details className="detail-disclosure" open={detailOpenSections.has("cost")}>
              <summary onClick={(event) => { event.preventDefault(); setDetailEditSection(null); toggleDetailOpenSection("cost"); }}><strong>Costo de trabajo</strong><small>Costo manual y método elegido</small></summary>
            <section className="detail-section">
              <div className="edit-grid item-detail-grid item-cost-grid">
                <label>
                  Costo manual unit.
                  <input
                    inputMode="numeric"
                    value={formatInputNumber(item.manualUnitCost)}
                    onChange={(event) => {
                      const manualUnitCost = updateNumeric(event.target.value);
                      if (manualUnitCost !== null && manualUnitCost < 0) return;
                      updateItem(detailRowIndex, {
                        manualUnitCost,
                        selectedCostMode: manualUnitCost === null ? item.selectedCostMode : "manual",
                      });
                    }}
                    placeholder="Sin costo manual"
                  />
                </label>
                <label>
                  Costo a usar
                  <select value={item.selectedCostMode ?? "weighted"} onChange={(event) => { const patch = costModePatch(item, project.settings, event.target.value as CostMode); if (patch) updateItem(detailRowIndex, patch); }}>
                    {costOptions(item, project.settings).map(option => <option value={option.mode} key={option.mode}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  Estado de la base de costo
                  <select value={item.costBasisStatus ?? ""} onChange={(event) => updateItem(detailRowIndex, { costBasisStatus: (event.target.value || null) as FinancialOfferItem["costBasisStatus"] })}>
                    <option value="">Sin clasificar</option>
                    <option value="conforming">Alcance confirmado</option>
                    <option value="comparable_scenario">Escenario comparable</option>
                    <option value="partial">Costo parcial</option>
                    <option value="pending">Costo pendiente</option>
                  </select>
                </label>
                {item.selectedCostMode === "source" ? <label>
                  Fuente elegida
                  <select value={item.selectedPriceSourceId ?? ""} onChange={(event) => updateItem(detailRowIndex, { selectedPriceSourceId: event.target.value || null })}>
                    <option value="">Elige una cotización</option>
                    {row.costBreakdown.sources.filter((source) => source.normalizedUnit !== null).map((source) => <option value={source.id} key={source.id}>{source.label}</option>)}
                  </select>
                </label> : null}
              </div>
            </section>
            </details>

            <details ref={detailAdditionalRef} className="detail-disclosure" open={detailOpenSections.has("additional")}>
              <summary onClick={(event) => { event.preventDefault(); setDetailEditSection(null); toggleDetailOpenSection("additional"); }}><strong>Servicios y costos asociados</strong><small>{item.additionalCosts?.length ?? 0} costos asociados</small></summary>
            <section className="detail-section">
              <AdditionalCostRows costs={item.additionalCosts ?? []} onChange={(additionalCosts) => updateItem(detailRowIndex, { additionalCosts })} />
            </section>
            </details>

            <details className="detail-disclosure" open={detailOpenSections.has("sources")}>
              <summary onClick={(event) => { event.preventDefault(); setDetailEditSection(null); toggleDetailOpenSection("sources"); }}><strong>Fuentes de precio</strong><small>Tres proveedores; abre uno para editarlo</small></summary>
            <section className="detail-section">
              {[0, 1, 2].map((sourceIndex) => {
                const source = sourceAt(item, sourceIndex);
                const normalized = row.costBreakdown.sources[sourceIndex];
                const hasSourceData = Boolean(source.label || source.unitPrice !== null || source.url || source.notes);
                return (
                  <details className="source-editor" key={source.id || sourceIndex} >
                    <summary>
                      <span>Fuente {sourceIndex + 1}</span>
                      <strong>{source.label || (hasSourceData ? "Sin nombre" : "Agregar fuente")}</strong>
                      <em>{source.unitPrice !== null && source.unitPrice > 0 ? source.currency + " " + formatInputNumber(source.unitPrice) : "Precio pendiente"}</em>
                    </summary>
                    <div className="edit-grid source-grid source-main-grid">
                      <label>
                        Proveedor o fuente
                        <input value={source.label} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { label: event.target.value })} placeholder="Proveedor" />
                      </label>
                      <label>
                        Precio unitario
                        <input
                          inputMode="numeric"
                          value={formatInputNumber(source.unitPrice)}
                          onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { unitPrice: updateNumeric(event.target.value) })}
                          placeholder="Valor"
                        />
                      </label>
                      <label>
                        Moneda
                        <select value={source.currency} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { currency: event.target.value as PriceSourceCurrency })}>
                          {SOURCE_CURRENCIES.map((currency) => (
                            <option value={currency} key={currency}>{currency}</option>
                          ))}
                        </select>
                      </label>
                      <label className="detail-wide-field">
                        <span className="source-url-label">
                          URL
                          {sourceHref(source.url) ? <SourcePreviewLink href={sourceHref(source.url) ?? "#"} label="Vista previa" /> : null}
                        </span>
                        <input value={source.url} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { url: event.target.value })} placeholder="https://..." />
                      </label>
                    </div>
                    <details className="source-advanced">
                      <summary>TRM, importación y notas de fuente</summary>
                      <div className="edit-grid source-grid">
                        <label>
                          TRM
                          <input inputMode="numeric" value={formatInputNumber(source.trm)} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { trm: updateNumeric(event.target.value) })} placeholder="Usa global" />
                        </label>
                        <label>
                          Importacion %
                          <input inputMode="decimal" value={formatInputNumber(source.importPct)} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { importPct: updateNumeric(event.target.value) })} placeholder="Usa global" />
                        </label>
                        <label className="detail-wide-field">
                          Nota de fuente
                          <input value={source.notes ?? ""} onChange={(event) => updatePriceSource(detailRowIndex, sourceIndex, { notes: event.target.value })} placeholder="Comparabilidad, presentación o condición" />
                        </label>
                      </div>
                    </details>
                    <div className="source-normalized">
                      Normalizado COP: <strong>{formatCop(normalized?.normalizedUnit ?? null)}</strong>
                      {normalized?.warning ? <span>{normalized.warning}</span> : null}
                    </div>
                  </details>
                );
              })}
            </section>
            </details>

            <details className="detail-disclosure" open={detailOpenSections.has("notes")}>
              <summary onClick={(event) => { event.preventDefault(); setDetailEditSection(null); toggleDetailOpenSection("notes"); }}><strong>Notas del ítem</strong><small>Contexto de la oferta</small></summary>
            <section className="detail-section">
              <div className="detail-edit-bar"><button type="button" onClick={() => setDetailEditSection((current) => current === "notes" ? null : "notes")}>{detailEditSection === "notes" ? "Terminar edición" : "Editar notas"}</button></div>
              {detailEditSection === "notes" ? <textarea className="detail-textarea" value={item.notes ?? ""} onChange={(event) => updateItem(detailRowIndex, { notes: event.target.value })} placeholder="Sin notas" /> : <p className="detail-readonly-text">{item.notes || "Sin notas registradas."}</p>}
            </section>
            </details>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function switchTableView(next: "simulator" | "quick-edit") {
    // Preserve what is visible, including a summary compacted by scrolling.
    // Otherwise the new table height can move the scroll anchor and reopen it.
    if (next === tab) return;
    if (compactHeader.get()) setSummaryExpanded(false);
    setTab(next);
    if (next === "simulator") setAnalysisView("decide");
  }

  const viewSwitch = (
    <div className="workspace-view-switch" role="group" aria-label="Mesa de ítems">
      <button className={tab === "simulator" ? "active" : ""} type="button" aria-pressed={tab === "simulator"} onClick={() => switchTableView("simulator")} title="Mesa de ítems">
        <BarChart3 size={17} aria-hidden="true" /> Mesa de ítems
      </button>
      <button className={tab === "quick-edit" ? "active" : ""} type="button" aria-pressed={tab === "quick-edit"} onClick={() => switchTableView("quick-edit")} title="Edición en bloque">
        <Table2 size={17} aria-hidden="true" /> Edición en bloque
      </button>
    </div>
  );

  const modeSwitch = <div className="workspace-mode-tabs" role="tablist" aria-label="Área del simulador">
    {([ ["simulator", "Análisis financiero"], ["offer", "Oferta económica"] ] as const).map(([mode, label], index) => <button
      key={mode} id={`financial-mode-${mode}`} type="button" role="tab"
      aria-selected={(tab === "offer") === (mode === "offer")}
      aria-controls={mode === "offer" ? "financial-offer-panel" : "financial-analysis-panel"}
      tabIndex={(tab === "offer") === (mode === "offer") ? 0 : -1}
      onClick={() => { if (compactHeader.get()) setSummaryExpanded(false); setTab(mode); }}
      onKeyDown={(event) => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowRight" || event.key === "ArrowLeft" ? 1 - index : null;
        if (next === null) return;
        event.preventDefault();
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{label}</button>)}
  </div>;

  return (
    <CalculationBars>
    <div ref={workspaceRootRef} className={`calculation-workspace ${compactHeaderActive && (tab === "simulator" || tab === "quick-edit") ? "is-table-focus" : ""}`} aria-busy={versionActionBusy}>
      {versionActionBusy ? <div className="version-action-overlay" role="status"><span>{headerActionMessage}</span></div> : null}
      {renderDetailModal()}
      {renderTechnicalModal()}
      {resetOpen ? (
        <div
          className="api-modal-overlay"
          role="presentation"
          onMouseDown={() => {
            if (resetStatus !== "loading") setResetOpen(false);
          }}
        >
          <section
            ref={resetDialogRef}
            className="api-modal reset-calculation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-calculation-title"
            aria-describedby="reset-calculation-description"
            aria-busy={resetStatus === "loading"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <p className="modal-eyebrow">Acción irreversible</p>
                <h2 id="reset-calculation-title">¿Reiniciar este cálculo?</h2>
              </div>
              <button
                className="modal-close-button"
                type="button"
                aria-label="Cerrar"
                disabled={resetStatus === "loading"}
                onClick={() => setResetOpen(false)}
              >
                x
              </button>
            </div>
            <div id="reset-calculation-description" className="reset-calculation-copy">
              <p>Se borrarán los ítems, costos, ofertas, ajustes, notas, imágenes y escenarios guardados.</p>
              <p>
                Se conservarán el cálculo <strong>{name}</strong>
                {project.odooProjectId
                  ? ` y su vínculo con ${project.odooProcessNumber || project.odooProjectName || "el proyecto de Odoo"}`
                  : " y su identidad"}.
              </p>
              <p>Volverás a la pantalla inicial para cargar los datos desde cero.</p>
            </div>
            <label className="reset-confirmation-check">
              <input
                type="checkbox"
                checked={resetConfirmed}
                disabled={resetStatus === "loading"}
                onChange={(event) => setResetConfirmed(event.target.checked)}
              />
              <span>Entiendo que los datos actuales no se podrán recuperar desde esta pantalla.</span>
            </label>
            {resetError ? <div className="status-line error" role="alert">{resetError}</div> : null}
            <div className="modal-actions reset-modal-actions">
              <button
                ref={resetCancelRef}
                className="ghost-button"
                type="button"
                disabled={resetStatus === "loading"}
                onClick={() => setResetOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={!resetConfirmed || resetStatus === "loading"}
                onClick={() => void resetCalculationData()}
              >
                {resetStatus === "loading" ? "Reiniciando cálculo..." : "Borrar datos y reiniciar"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {settlementOpen ? (
        <div className="api-modal-overlay" role="presentation" onMouseDown={() => setSettlementOpen(false)}>
          <section className="api-modal settlement-modal" role="dialog" aria-modal="true" aria-labelledby="settlement-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="modal-eyebrow">Este calculo</p>
                <h2 id="settlement-modal-title">Retenciones</h2>
              </div>
              <button className="modal-close-button" type="button" aria-label="Cerrar" onClick={() => setSettlementOpen(false)}>x</button>
            </div>
            <p className="settlement-modal-copy">Se descuentan del recaudo esperado. No cambian el costo ni el precio ofrecido.</p>
            <div className="settlement-modal-controls">
              <WithholdingControl
                label="ReteFuente"
                enabled={settlement.applyReteFuente}
                rate={settlement.reteFuenteRate}
                base={settlement.reteFuenteBase}
                onChange={(patch) => setSettlement((current) => ({
                  ...current,
                  applyReteFuente: patch.enabled ?? current.applyReteFuente,
                  reteFuenteRate: patch.rate ?? current.reteFuenteRate,
                  reteFuenteBase: patch.base ?? current.reteFuenteBase,
                }))}
              />
              <WithholdingControl
                label="ReteIVA"
                enabled={settlement.applyReteIva}
                rate={settlement.reteIvaRate}
                base={settlement.reteIvaBase}
                onChange={(patch) => setSettlement((current) => ({
                  ...current,
                  applyReteIva: patch.enabled ?? current.applyReteIva,
                  reteIvaRate: patch.rate ?? current.reteIvaRate,
                  reteIvaBase: patch.base ?? current.reteIvaBase,
                }))}
              />
              <WithholdingControl
                label="ReteICA"
                enabled={settlement.applyReteIca}
                rate={settlement.reteIcaRate}
                base={settlement.reteIcaBase}
                onChange={(patch) => setSettlement((current) => ({
                  ...current,
                  applyReteIca: patch.enabled ?? current.applyReteIca,
                  reteIcaRate: patch.rate ?? current.reteIcaRate,
                  reteIcaBase: patch.base ?? current.reteIcaBase,
                }))}
              />
            </div>
            <div className="modal-actions">
              <span>Los cambios se guardan con el calculo.</span>
              <button className="button" type="button" onClick={() => setSettlementOpen(false)}>Listo</button>
            </div>
          </section>
        </div>
      ) : null}
      <OdooProjectContext key={"context-" + project.id} calculationId={project.id}
        projectId={project.odooProjectId} process={project.odooProcessNumber || project.odooProjectName}
        entity={project.odooEntityName} href={odooProjectHref(project)}>
        <CalculationNotes embedded linkedToOdoo={!!project.odooProjectId} calculationId={project.id} initialDocument={visibleProject.notesDocument} />
        <StudyDocuments embedded calculationId={project.id} linked={!!project.odooProjectId} />
      </OdooProjectContext>
      <section className="calculation-header">
        <CalculationMenuSlot>
          <CalculationMenu open={saveMenuOpen} anchorRef={saveMenuTriggerRef} busy={versionActionBusy}
            onToggle={() => { costVersionRef.current?.close(); setActiveBatchToolbarPopover(null); setSaveMenuOpen((current) => !current); }}
            onClose={() => setSaveMenuOpen(false)} onSave={() => void runHeaderSave("calculation")}
            identity={<>
              <div className="calculation-save-identity">
          <label htmlFor="calculation-name">Nombre del cálculo</label>
          <input
            id="calculation-name"
            aria-label="Nombre del calculo"
            className="calculation-name-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaveStatus("idle");
            }}
          />
          <div className="metadata-line">
            <span>{calculationOriginLabel(project)}</span>
            <span>Actualizado {formatBogotaDateTime(project.updatedAt)}</span>
            {!project.odooProjectId ? (project.entity ? <span>{project.entity}</span> : <span>Entidad sin definir</span>) : null}
          </div>
        </div>
            </>}
            items={<>
              <input
                    ref={appendFileInputRef}
                    className="visually-hidden"
                    type="file"
                    accept={spreadsheetAccept}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void appendSpreadsheetFile(file);
                    }}
                  />
              <button type="button" disabled={appendStatus === "loading"} title="Agregar ítems desde un archivo de Excel o CSV" onClick={() => { setSaveMenuOpen(false); appendFileInputRef.current?.click(); }}>
                <strong>Importar desde Excel</strong><small>Agrega ítems desde un archivo.</small>
              </button>
              <button type="button" title="Pegar filas copiadas o actualizar ítems existentes" onClick={() => { setSaveMenuOpen(false); setTab("simulator"); setAppendPanelOpen(true); }}>
                <strong>Pegar o actualizar ítems</strong><small>Filas copiadas de una hoja.</small>
              </button>
              <button type="button" className="unified-more-danger" disabled={saveStatus === "saving" || resetStatus === "loading"} title="Vaciar los ítems y empezar de nuevo" onClick={() => { resetTriggerRef.current = saveMenuTriggerRef.current; setSaveMenuOpen(false); setResetConfirmed(false); setResetError(""); setResetStatus("idle"); setResetOpen(true); }}>
                <strong>Reiniciar cálculo…</strong><small>Pide confirmación antes de vaciar.</small>
              </button>
            </>}
            exports={<>
              <button type="button" onClick={() => { setSaveMenuOpen(false); void saveAndExport("csv"); }} disabled={saveStatus === "saving"} title="Archivo CSV con los datos del cálculo">
                <strong>Tabla para Excel</strong><small>CSV con los datos del cálculo.</small>
              </button>
              <button type="button" onClick={() => { setSaveMenuOpen(false); void saveAndExport("json"); }} disabled={saveStatus === "saving"} title="Archivo JSON para otra aplicación o API">
                <strong>Datos para integrar</strong><small>JSON para otra aplicación o API.</small>
              </button>
            </>}
            settings={<ApplicationSettings panel onOpen={() => setSaveMenuOpen(false)} />} />
        </CalculationMenuSlot>
        <CalculationCostHistory>
                        <CostVersionHistory ref={costVersionRef} projectId={props.project.id} linkedToOdoo={!!project.odooProjectId}
                          onBeforeSnapshot={prepareVersionAction} runExclusive={runExclusiveVersionAction}
                          globalBusy={versionActionBusy} onOpen={() => { setSaveMenuOpen(false); setActiveBatchToolbarPopover(null); }}
                          onSaveRequest={() => void runHeaderSave("cost")}
                          onActionSaved={acknowledgeVersionSave} onError={setHeaderActionMessage} />
        </CalculationCostHistory>
        <CalculationActionBar>
          <span className={`calculation-save-status ${saveStatus === "error" ? "is-error" : ""}`} role="status" aria-live="polite">
            {saveStatus === "saving" ? "Guardando…" : saveStatus === "error" ? "No guardado" : workspaceSaveKey === lastPersistedKeyRef.current ? "Guardado" : "Sin guardar"}
          </span>
          <a className="ghost-button header-back-button" href={project.odooReturnUrl || appPath("/")} title="Volver" aria-label="Volver">
            <ArrowLeft size={17} aria-hidden="true" /><span>Volver</span>
          </a>

        </CalculationActionBar>
        {externalRevisionPending ? <div className="status-line warning compact-status" role="status">Hay una nueva versión en el servidor. Tus cambios pendientes se conservan; no se sobrescribirán los cambios de IA.</div> : null}
        {headerActionMessage && !versionActionBusy ? <div className="status-line compact-status" role="status">
          {headerActionMessage}
          {headerActionMessage.startsWith("Inicia sesión en Odoo") && odooLoginHref() ? (
            <a className="header-auth-link" href={odooLoginHref()!} target="_blank" rel="noopener noreferrer">
              Abrir Odoo{window.location.port === "18030" ? " DEV" : ""} para iniciar sesión
            </a>
          ) : null}
        </div> : null}
        {saveStatus === "error" ? <div className="status-line error compact-status">{saveError || "No se pudo guardar el cálculo."}{saveConflictRef.current ? <button type="button" onClick={resolveSaveConflict}>Conservar mi edición en el conflicto</button> : null}</div> : null}
        {saveStatus !== "error" && saveWarning ? <div className="status-line warning compact-status">{saveWarning}</div> : null}
      </section>

      <CalculationModeSlot>{modeSwitch}</CalculationModeSlot>
      <div hidden role="tabpanel" id={tab === "offer" ? "financial-analysis-panel" : "financial-offer-panel"} aria-labelledby={tab === "offer" ? "financial-mode-simulator" : "financial-mode-offer"} />
      <section className="panel workspace-panel">
        {tab === "simulator" || tab === "quick-edit" || tab === "items" ? (
          <div className={`simulator-view ${tab === "quick-edit" ? "quick-edit-active" : tab === "items" ? "item-view-active" : ""}`} id="financial-analysis-panel" role="tabpanel" aria-labelledby="financial-mode-simulator">
            {summaryExpanded ? <div ref={expandedSummaryRef} className={`summary-section results-panel ${summaryFocusClass} is-expanded`}>
              <div className={`unified-summary-strip decision-price-strip offer-composition-summary ${costComparisonReady ? "is-cost-comparable" : ""}`}>
                <div className="offer-summary-heading">
                  <div>
                    <h2 className="visually-hidden">Resumen financiero</h2>
                    <span>{totalComplete ? summaryCoverage : "Datos parciales"}</span>
                  </div>
                  <button type="button" onClick={() => { setSummaryExpanded(false); window.setTimeout(() => simulatorTableShellRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} aria-expanded={summaryExpanded}>
                    Plegar resumen
                  </button>
                </div>
                <OfferCompositionBar
                  offer={graphicSummary?.totalOfferWithVat ?? null}
                  ceiling={costOverview ? (excludedProcurementLotIds.length ? simulation.summary.referenceKnownTotal : manualReferenceTotal) : graphicCeiling}
                  preliminary={!totalComplete}
                  costOverview={costOverview}
                  cost={graphicSummary?.totalProjectCost ?? null}
                  netUtility={graphicSummary?.estimatedNetUtility ?? null}
                  deductions={graphicSummary?.totalDeductions ?? null}
                  scope={graphicScope}
                  compact={!summaryExpanded}
                  utilityLabel={utilityIsScenario ? "Utilidad de escenario" : "Utilidad neta"}
                />
              </div>
              {mobileLayout ? <div className="mobile-summary-metrics">
                <OfferReferenceSummary offer={graphicSummary?.totalOfferWithVat ?? null} cost={graphicSummary?.totalProjectCost ?? null}
                  deductions={graphicSummary?.totalDeductions ?? null} netUtility={graphicSummary?.estimatedNetUtility ?? null}
                  ceiling={graphicCeiling} scope={graphicScope} preliminary={!totalComplete}
                  utilityLabel={utilityIsScenario ? "Utilidad de escenario" : "Utilidad neta"} />
              </div> : null}
              {summaryExpanded ? (
                <div className="offer-summary-details">
                  {!totalComplete ? (
                    <div className="offer-summary-total-context" aria-label="Cifras de todos los ítems con oferta registrada">
                      <span><small>Oferta registrada · {simulation.summary.itemCount - simulation.summary.missingOfferCount} ítems</small><strong>{formatCop(offer.summary.totalOfferWithVat)}</strong></span>
                      <span><small>Retenciones de esa oferta</small><strong>{formatCop(offer.summary.totalDeductions)}</strong></span>
                      <span><small>Recaudo neto registrado</small><strong>{formatCop(offer.summary.expectedNetCollection)}</strong></span>
                      {totalCeiling !== null ? <span><small>Techo total</small><strong>{formatCop(totalCeiling)}</strong></span> : null}
                    </div>
                  ) : (
                    <div className="offer-summary-total-context is-complete"><span><small>Recaudo neto</small><strong>{formatCop(offer.summary.expectedNetCollection)}</strong></span></div>
                  )}
                  {budgetControls()}
                </div>
              ) : null}
            </div> : null}
            {renderLotFinancialSummary()}
            <div ref={summarySectionRef} className="summary-scroll-anchor" aria-hidden="true" />

            <div ref={generalCostsRef} className={`unified-general-costs ${generalCostsOpen ? "is-open" : ""}`}>
              <GeneralCostsPanel
                costs={generalCosts}
                total={offer.summary.generalCostsTotal}
                open={generalCostsOpen}
                onToggle={() => setGeneralCostsOpen((current) => !current)}
                onChange={updateGeneralCosts}
              />
            </div>

            <div
              className={`simulator-table-fit view-${tab} ${mobileLayout || (tab === "simulator" && analysisView === "decide") ? "is-decision-view" : ""}`}
              ref={simulatorTableShellRef}
            >
                <div ref={tableCockpitRef} className={`table-cockpit-stack ${compactHeaderActive ? "is-compact-sticky" : ""}`}>
                <CalculationActionDock store={compactHeader} />
                {mobileLayout && mobileSheet ? <button type="button" className="mobile-sheet-backdrop" aria-label="Cerrar panel" onClick={() => setMobileSheet(null)} /> : null}
                {/* Bloque 2: la cinta siempre existe (en PC se pliega con transición; en móvil, oculta, equivale a no pintarla). */}
                {true ? (
                  <div ref={scrollRibbonRef} className={`summary-section results-panel ${summaryFocusClass} is-collapsed is-table-attached is-scroll-ribbon ${summaryJump ? "is-ribbon-instant" : ""} ${(!summaryExpanded || (compactHeaderActive && !summaryJump)) ? "" : "is-ribbon-hidden"}`} aria-hidden={(!summaryExpanded || (compactHeaderActive && !summaryJump)) ? undefined : true}>
                    <div className={`unified-summary-strip decision-price-strip offer-composition-summary ${costComparisonReady ? "is-cost-comparable" : ""}`}>
                      <div className="offer-summary-heading">
                        <div><h2 className="visually-hidden">Resumen financiero</h2><span>{summaryCoverage}</span></div>
                        <button type="button" onClick={() => { setSummaryJump(true); if (!summaryExpanded) setSummaryExpanded(true); window.setTimeout(() => expandedSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); window.setTimeout(() => setSummaryJump(false), 3000); }} aria-expanded={summaryExpanded}>Ver resumen</button>
                        <button ref={budgetActionsRef} type="button" className="summary-budget-more" aria-label="Ajustes del presupuesto" title="Techo global, estampillas y retenciones" aria-expanded={budgetActionsOpen} aria-controls="budget-actions" onClick={() => setBudgetActionsOpen((current) => !current)}>⋯</button>
                        <AnchoredPopover open={budgetActionsOpen} anchorRef={budgetActionsRef} id="budget-actions" className="budget-actions-popover" ariaLabel="Ajustes del presupuesto" width={320} onClose={() => setBudgetActionsOpen(false)}><div className="budget-actions-panel"><strong>Ajustes del presupuesto</strong>{budgetControls()}</div></AnchoredPopover>
                      </div>
                      {costOverview ? (<OfferCompositionBar
                        offer={graphicSummary?.totalOfferWithVat ?? null}
                        ceiling={costOverview ? (excludedProcurementLotIds.length ? simulation.summary.referenceKnownTotal : manualReferenceTotal) : graphicCeiling}
                  preliminary={!totalComplete}
                  costOverview={costOverview}
                        cost={graphicSummary?.totalProjectCost ?? null}
                        netUtility={graphicSummary?.estimatedNetUtility ?? null}
                        deductions={graphicSummary?.totalDeductions ?? null}
                        scope={graphicScope}
                        compact
                        utilityLabel={utilityIsScenario ? "Utilidad de escenario" : "Utilidad neta"}
                      />) : (
                        <OfferReferenceSummary offer={graphicSummary?.totalOfferWithVat ?? null} cost={graphicSummary?.totalProjectCost ?? null}
                          deductions={graphicSummary?.totalDeductions ?? null} netUtility={graphicSummary?.estimatedNetUtility ?? null}
                          ceiling={graphicCeiling} scope={graphicScope} preliminary={!totalComplete}
                          utilityLabel={utilityIsScenario ? "Utilidad de escenario" : "Utilidad neta"} />
                      )}
                      <p className="summary-reference-scope">{summaryCoverage} · COP</p>
                      {mobileLayout ? (
                        <div className="mobile-ribbon-tools" role="toolbar" aria-label="Herramientas del cálculo">
                          <button type="button" className={mobileSheet === "tools" ? "is-active" : ""} aria-expanded={mobileSheet === "tools"} onClick={() => setMobileSheet(current => current === "tools" ? null : "tools")}><SlidersHorizontal size={18} aria-hidden="true" />Herramientas</button>
                          <button type="button" className={`${mobileSheet === "filters" ? "is-active" : ""} ${rowFilter !== "all" ? "has-filter" : ""}`} aria-expanded={mobileSheet === "filters"} onClick={() => setMobileSheet(current => current === "filters" ? null : "filters")}><ListFilter size={18} aria-hidden="true" /><span>{rowFilterLabel}</span></button>
                          <button type="button" onClick={undoWorkspaceChange} disabled={!undoStack.length} title="Deshacer" aria-label="Deshacer"><Undo2 size={18} aria-hidden="true" /></button>
                          <button type="button" onClick={redoWorkspaceChange} disabled={!redoStack.length} title="Rehacer" aria-label="Rehacer"><Redo2 size={18} aria-hidden="true" /></button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div
                  ref={batchToolbarRef}
                  className={`operation-toolbar batch-toolbar ${compactHeaderActive ? "is-compact-sticky" : ""} ${mobileLayout ? "is-mobile-collapsible" : ""} ${mobileLayout && mobileSheet === "tools" ? "is-mobile-sheet-open" : ""}`}
                  aria-label="Operaciones de datos, costos y oferta"
                >
                  {mobileLayout ? <div className="mobile-sheet-head"><strong>Herramientas</strong><button type="button" onClick={() => setMobileSheet(null)} aria-label="Cerrar herramientas">×</button></div> : null}

                  <CalculationTableRibbon>
                    {viewSwitch}

                    <span className="batch-toolbar-divider" aria-hidden="true" />

                    {selectedRowsCount ? (
                      <div className="batch-toolbar-scope batch-selection-chip" aria-label="Alcance de acciones de lote">
                        <span><small>Aplicar a</small> {`${formatNumber(selectedRowsCount)} ${selectedRowsCount === 1 ? "seleccionado" : "seleccionados"}`}</span>
                        <button type="button" onClick={() => toggleAllRows(false)} title="Quitar selección" aria-label="Quitar selección">×</button>
                      </div>
                    ) : (
                      <div className="batch-toolbar-scope batch-scope-chip" aria-label="Alcance de acciones de lote" title="Las acciones de costo y precio se aplican a estas filas. Marca filas para limitarlas.">
                        <span><small>Aplicar a</small> {rowFilter === "all" ? `todas · ${formatNumber(activeBulkRowsCount)}` : `«${rowFilterLabel}» · ${formatNumber(activeBulkRowsCount)}`}</span>
                      </div>
                    )}

                    <button
                      className="ghost-button batch-delete-selected"
                      type="button"
                      onClick={removeSelectedItems}
                      disabled={!selectedRowsCount}
                      title={selectedRowsCount ? `Eliminar ${formatNumber(selectedRowsCount)} elementos seleccionados` : "Selecciona elementos para eliminarlos"}
                      aria-label={selectedRowsCount ? `Eliminar ${formatNumber(selectedRowsCount)} elementos seleccionados` : "Eliminar elementos seleccionados"}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                      {selectedRowsCount ? <span>{formatNumber(selectedRowsCount)}</span> : null}
                    </button>

                    <span className="batch-toolbar-divider" aria-hidden="true" />

                    <div className="batch-adjust-group batch-cost-menu" role="group" aria-label="Ajuste de costos">
                      <div className="batch-adjust-heading">
                        <span className="batch-adjust-title">Ajuste de costos</span>
                        <CalculationCostTarget />
                      </div>
                      <div className="batch-adjust-actions">
                        <span className="batch-quick-action" title={`Estima un costo, no una cotización: techo menos este %. Cambia ${formatNumber(activeBulkReferenceCount)} filas con techo${activeBulkTypedCostCount ? ` y reemplaza ${formatNumber(activeBulkTypedCostCount)} costos escritos a mano` : ""}; las filas sin techo no cambian.`}>
                          <span className="batch-quick-label">Estimar desde techo −</span>
                          <input inputMode="decimal" value={costLotDiscountPct} onChange={(event) => setCostLotDiscountPct(event.target.value)} placeholder="0" aria-label="Porcentaje bajo el techo para suponer el costo" />
                          <span className="batch-quick-unit">%</span>
                          <button type="button" aria-label={`Estimar costo para ${activeBulkReferenceCount} ítems con techo`} onClick={applyReferenceToManualCost} disabled={!activeBulkReferenceCount || !bulkCostPctValid}>{`Aplicar${activeBulkReferenceCount < activeBulkRowsCount ? ` (${formatNumber(activeBulkReferenceCount)})` : ""}`}</button>
                        </span>
                        <span className="batch-quick-action" title={`Descuenta este % del costo base, sin acumular descuentos anteriores, en ${formatNumber(activeBulkCostReadyCount)} filas con costo. Se quita desde ⋯.`}>
                          <span className="batch-quick-label">Descontar al costo</span>
                          <input inputMode="decimal" value={costScenarioPct} onChange={(event) => setCostScenarioPct(event.target.value)} placeholder="0" aria-label="Porcentaje a descontar al costo actual" />
                          <span className="batch-quick-unit">%</span>
                          <button type="button" aria-label={`Descontar al costo de ${activeBulkCostReadyCount} ítems`} onClick={applyLotCostScenarioToSelected} disabled={!activeBulkRowsCount || !costScenarioPctValid}>{`Aplicar${activeBulkCostReadyCount < activeBulkRowsCount ? ` (${formatNumber(activeBulkCostReadyCount)})` : ""}`}</button>
                        </span>
                        <button
                          ref={costToolbarTriggerRef}
                          className={`ghost-button batch-adjust-more ${simulation.rows.some((row) => row.costUnit === null) ? "needs-attention" : ""}`}
                          type="button"
                          aria-expanded={activeBatchToolbarPopover === "cost"}
                          aria-controls="batch-cost-menu"
                          title="Otras opciones de costo"
                          aria-label="Otras opciones de costo"
                          onClick={() => setActiveBatchToolbarPopover((current) => (current === "cost" ? null : "cost"))}
                        >
                          ⋯
                        </button>
                      </div>
                      {activeBatchToolbarPopover === "cost" ? (
                        <AnchoredPopover open anchorRef={costToolbarTriggerRef} id="batch-cost-menu"
                          className="batch-toolbar-popover batch-decision-panel" width={320} minTop={56} ariaLabel="Otras opciones de costo"
                          onClose={() => setActiveBatchToolbarPopover(null)}>
                          <p className="batch-panel-scope">Ajuste de costos · <b>{`${formatNumber(activeBulkRowsCount)} filas`}</b> {activeBulkScopeLabel}</p>
                          <TrmCalculator />
                          <p className="batch-tool-explanation"><b>Estimar desde techo</b> crea un supuesto: techo menos el porcentaje. <b>Descontar al costo</b> aplica el porcentaje al costo base y sustituye el descuento anterior.</p>
                          <section className="batch-panel-step is-secondary">
                            <button className="ghost-button" type="button" onClick={resetLotCostScenarioForSelected} disabled={!activeBulkRowsCount}>
                              Quitar descuento al costo
                            </button>
                          </section>
                          <section className="batch-panel-step is-secondary">
                            <label>
                              Fuente de costo <small>(se aplica al elegir)</small>
                              <select
                                value={activeBulkCostMode}
                                onChange={(event) => {
                                  const mode = event.target.value as CostMode | "unique";
                                  if (!mode) return;
                                  applyCostModeToAll(mode);
                                }}
                              >
                                <option value="">{activeBulkCostModes.size > 1 ? "Varios costos" : "Elegir costo"}</option>
                                {[...activeBulkCostOptions].map(([mode, label]) => <option value={mode} key={mode}>{label}</option>)}
                              </select>
                            </label>
                          </section>
                          {strategyMessage ? (
                            <div className="batch-panel-result" role="status">
                              <span>{strategyMessage}</span>
                              <button className="ghost-button" type="button" onClick={undoWorkspaceChange} disabled={!undoStack.length}>Deshacer</button>
                            </div>
                          ) : null}
                        </AnchoredPopover>
                      ) : null}
                    </div>

                    <div className="batch-adjust-group batch-offer-menu" role="group" aria-label="Ajuste de oferta">
                      <div className="batch-adjust-heading">
                        <span className="batch-adjust-title">Ajuste de oferta</span>
                        <button ref={scenarioToolbarTriggerRef} className="offer-scenarios-trigger" type="button"
                          aria-expanded={activeBatchToolbarPopover === "scenarios"} aria-controls="batch-scenarios-menu"
                          title="Escenarios de oferta guardados" onClick={() => { setSaveMenuOpen(false); setActiveBatchToolbarPopover((current) => (current === "scenarios" ? null : "scenarios")); }}>
                          <Layers size={16} aria-hidden="true" /><span>Escenarios</span><ChevronDown size={14} aria-hidden="true" />
                        </button>
                      </div>
                      {activeBatchToolbarPopover === "scenarios" ? (
                        <AnchoredPopover open anchorRef={scenarioToolbarTriggerRef} id="batch-scenarios-menu"
                          className="batch-toolbar-popover offer-scenarios" width={340} minTop={56} ariaLabel="Escenarios de oferta"
                          onClose={() => setActiveBatchToolbarPopover(null)}>
                          <div className="offer-scenarios-head">
                            <strong>Escenarios de oferta</strong>
                            <button className="ghost-button" type="button" disabled={versionActionBusy} title="Guardar las decisiones actuales de oferta como escenario" onClick={() => void runHeaderSave("scenario")}>
                              <Save size={14} aria-hidden="true" /><span>Guardar escenario</span>
                            </button>
                          </div>
                          <ScenarioManager ref={scenarioManagerRef}
            projectId={props.project.id}
            onBeforeSnapshot={prepareVersionAction}
            runExclusive={runExclusiveVersionAction}
            globalBusy={versionActionBusy}
            onActionSaved={acknowledgeVersionSave}
            onError={setHeaderActionMessage}
            actor={project.odooUserName ? { id: project.odooUserId, name: project.odooUserName } : null}
          />
                        </AnchoredPopover>
                      ) : null}
                      <div className="batch-adjust-actions">
                        <span className="batch-quick-action" title={`Fija el precio sumando este % al costo con IVA (recargo sobre costo, no margen sobre venta), en ${formatNumber(activeBulkCostReadyCount)} filas con costo${activeBulkManualOfferCount ? `; reemplaza ${formatNumber(activeBulkManualOfferCount)} precios manuales` : ""}; las filas sin costo no cambian.`}>
                          <span className="batch-quick-label">Sumar al costo +</span>
                          <input inputMode="decimal" value={globalProfitPct} onChange={(event) => setGlobalProfitPct(event.target.value)} placeholder="0" aria-label="Porcentaje a sumar al costo con IVA para fijar el precio" />
                          <span className="batch-quick-unit">%</span>
                          <button type="button" aria-label={`Fijar oferta desde costo para ${activeBulkCostReadyCount} ítems`} onClick={applyProfitPctToTargets} disabled={!activeBulkCostReadyCount || !bulkProfitPctValid}>{`Aplicar${activeBulkCostReadyCount < activeBulkRowsCount ? ` (${formatNumber(activeBulkCostReadyCount)})` : ""}`}</button>
                        </span>
                        <span className="batch-quick-action" title={`Descuento a la oferta: fija el precio rebajando este % del techo, en ${formatNumber(activeBulkReferenceCount)} filas con techo. Reparto: ${GLOBAL_DISCOUNT_STRATEGIES.find((strategy) => strategy.value === globalStrategy)?.label ?? ""} (se cambia en las opciones junto a Aplicar).`}>
                          <span className="batch-quick-label">Descuento a la oferta −</span>
                          <input inputMode="decimal" value={globalDiscountPct} onChange={(event) => setGlobalDiscountPct(event.target.value)} placeholder="0" aria-label="Descuento sobre el techo para fijar el precio" />
                          <span className="batch-quick-unit">%</span>
                          <button type="button" aria-label={`Fijar oferta desde techo para ${activeBulkReferenceCount} ítems`} onClick={applyGlobalDiscountStrategy} disabled={!activeBulkRowsCount || !activeBulkReferenceCount}>{`Aplicar${activeBulkReferenceCount < activeBulkRowsCount ? ` (${formatNumber(activeBulkReferenceCount)})` : ""}`}</button>
                          <button ref={offerToolbarTriggerRef} className="ghost-button batch-adjust-more offer-discount-more" type="button"
                            aria-expanded={activeBatchToolbarPopover === "offer"} aria-controls="batch-offer-menu"
                            title="Opciones del descuento: reparto, modo y restablecer" aria-label="Opciones del descuento a la oferta"
                            onClick={() => setActiveBatchToolbarPopover((current) => (current === "offer" ? null : "offer"))}>
                            <SlidersHorizontal size={14} aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                      {activeBatchToolbarPopover === "offer" ? (
                        <AnchoredPopover open anchorRef={offerToolbarTriggerRef} id="batch-offer-menu"
                          className="batch-toolbar-popover batch-offer-popover batch-decision-panel" width={320} minTop={56} ariaLabel="Otras opciones de oferta"
                          onClose={() => setActiveBatchToolbarPopover(null)}>
                          <p className="batch-panel-scope">Descuento a la oferta · <b>{`${formatNumber(activeBulkRowsCount)} filas`}</b> {activeBulkScopeLabel}</p>
                          <div className="offer-discount-options">
                            <label title="Cómo se reparte el descuento entre las filas con techo">
                              <span>Reparto</span>
                              <select value={globalStrategy} disabled={!activeBulkReferenceCount} onChange={(event) => setGlobalStrategy(event.target.value as GlobalDiscountStrategy)}>
                                {GLOBAL_DISCOUNT_STRATEGIES.map((strategy) => (
                                  <option value={strategy.value} key={strategy.value}>
                                    {strategy.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label title="Se aplica al elegir">
                              <span>Modo</span>
                              <select
                                value={discountPanelMode}
                                onChange={(event) => {
                                  const mode = event.target.value as OfferMode;
                                  if (!mode) return;
                                  setDiscountPanelMode(mode);
                                  applyOfferModeToTargets(mode);
                                }}
                              >
                                <option value="discount" disabled={!activeBulkReferenceCount}>Descuento</option>
                                <option value="profit">Precio desde costo</option>
                                <option value="manual">Manual</option>
                              </select>
                            </label>
                            <button className="ghost-button offer-discount-reset" type="button" onClick={resetOffersToCeiling} disabled={!activeBulkRowsCount || !activeBulkReferenceCount} title="Vuelve a poner cada oferta igual a su techo">
                              <RotateCcw size={14} aria-hidden="true" /><span>Restablecer ofertas al techo</span>
                            </button>
                          </div>
                          {strategyMessage ? (
                            <div className="batch-panel-result" role="status">
                              <span>{strategyMessage}</span>
                              <button className="ghost-button" type="button" onClick={undoWorkspaceChange} disabled={!undoStack.length}>Deshacer</button>
                            </div>
                          ) : null}
                        </AnchoredPopover>
                      ) : null}
                    </div>

                    <div className="table-view-toolbar" aria-label="Opciones de tabla">
                      {tab === "quick-edit" && !mobileLayout ? <ColumnControls columns={QUICK_EDIT_COLUMNS}
                        prefs={Object.fromEntries(QUICK_EDIT_COLUMNS.map(column => [column.key, { visible: !quickHiddenColumns.includes(column.key) }]))}
                        onToggle={(key, visible) => setQuickHiddenColumns(current => visible ? current.filter(value => value !== key) : [...current.filter(value => value !== key), key])}
                        onReset={() => setQuickHiddenColumns([])} /> : analysisView === "edit" ? (
                        <ColumnControls columns={SIMULATOR_COLUMNS} prefs={Object.fromEntries(SIMULATOR_COLUMNS.map(column => [column.key, { ...columnPrefs[column.key], visible: columnPrefs[column.key].visible && (showCostDetails || !COST_DETAIL_COLUMNS.has(column.key)) }]))}
                          onToggle={(key, visible) => {
                            if (!showCostDetails && COST_DETAIL_COLUMNS.has(key)) {
                              setColumnPrefs(current => Object.fromEntries(SIMULATOR_COLUMNS.map(column => [column.key, { ...current[column.key], visible: COST_DETAIL_COLUMNS.has(column.key) ? column.key === key && visible : current[column.key].visible }])) as ColumnPrefs);
                              setColumnPrefsUserOwned(true);
                              setShowCostDetails(true);
                            } else setColumnVisible(key, visible);
                          }} onWidth={setColumnWidth} onReset={() => { resetColumnPreferences(); setShowCostDetails(false); }}>
                          <button type="button" onClick={() => setAnalysisView("decide")}>Volver a la mesa</button>
                        </ColumnControls>
                      ) : <ColumnControls columns={DECISION_COLUMNS} prefs={decisionColumnPrefs} onToggle={setDecisionColumnVisible} onWidth={setDecisionColumnWidth} onReset={resetDecisionColumnPreferences}>
                        <button type="button" onClick={() => { setExpandAllItems(current => !current); setDecisionPreviewIndex(null); setDetailRowIndex(null); }}>{expandAllItems ? "Plegar detalles" : "Desplegar detalles"}</button>
                        {mobileLayout ? null : <button type="button" onClick={() => setAnalysisView("edit")}>Tabla detallada de costos</button>}
                      </ColumnControls>}
                    </div>
                    <div className="batch-persistent-actions" aria-label="Acciones del cálculo">
                        <button className="ghost-button" type="button" onClick={undoWorkspaceChange} disabled={!undoStack.length} title="Deshacer" aria-label="Deshacer"><Undo2 size={17} aria-hidden="true" /></button>
                        <button className="ghost-button" type="button" onClick={redoWorkspaceChange} disabled={!redoStack.length} title="Rehacer" aria-label="Rehacer"><Redo2 size={17} aria-hidden="true" /></button>
                    </div>
                  </CalculationTableRibbon>
            </div>
            {strategyMessage && !activeBatchToolbarPopover ? (
              <div className="status-line batch-result-line" role="status">
                <span>{strategyMessage}</span>
                <button className="ghost-button" type="button" onClick={undoWorkspaceChange} disabled={!undoStack.length}>Deshacer</button>
                <button className="ghost-button" type="button" onClick={() => setStrategyMessage("")} aria-label="Cerrar mensaje">×</button>
              </div>
            ) : null}

            {appendPanelOpen ? (
              <div className="append-items-panel">
                <div className="append-mode-switch" role="group" aria-label="Modo de pegado">
                  <button className={appendMode === "append" ? "active" : ""} type="button" onClick={() => setAppendMode("append")}>
                    Agregar filas
                  </button>
                  <button className={appendMode === "update" ? "active" : ""} type="button" onClick={() => setAppendMode("update")}>
                    Actualizar campos
                  </button>
                </div>
                {appendMode === "update" ? (
                  <div className="paste-update-options">
                    <label>
                      Campo destino
                      <select value={pasteUpdateField} onChange={(event) => setPasteUpdateField(event.target.value as PastedUpdateField)}>
                        <option value="auto">Detectar por encabezados</option>
                        <option value="referenceUnit">Precio techo unitario</option>
                        <option value="manualUnitCost">Costo manual unitario</option>
                        <option value="quantity">Cantidad</option>
                        <option value="unit">Unidad</option>
                        <option value="notes">Notas / alertas</option>
                      </select>
                    </label>
                    <p>Si eliges un campo, puedes pegar solo una lista. Sin Item se aplica por orden; con filas seleccionadas se aplica por orden de seleccion.</p>
                  </div>
                ) : null}
                <label>
                  {appendMode === "update"
                    ? pasteUpdateField === "auto"
                      ? "Pega una tabla con Item y los campos a cambiar"
                      : "Pega valores para el campo elegido"
                    : "Pega JSON, tabla Markdown o filas copiadas desde Excel"}
                  <textarea
                    value={appendText}
                    onChange={(event) => setAppendText(event.target.value)}
                    placeholder={
                      appendMode === "update"
                        ? pasteUpdateField === "auto"
                          ? "Item\tPrecio techo unitario\tCosto manual unitario\n42\t$\t190.000\t$\t150.000"
                          : pasteUpdateField === "referenceUnit"
                            ? "$ 110.156\n$ 93.630\n$ 100.305"
                            : pasteUpdateField === "manualUnitCost"
                              ? "$ 70.000\n$ 65.000\n$ 80.000"
                              : pasteUpdateField === "quantity"
                                ? "1\n2\n1"
                                : pasteUpdateField === "unit"
                                  ? "UN\nM2\nPAQUETE"
                                  : "Nota item 1\nNota item 2"
                        : "Item\tNombre\tDescripcion\tUnd de medida\tCant\tPrecio techo unitario"
                    }
                    spellCheck={false}
                  />
                </label>
                <div className="append-items-actions">
                  <button className="button" type="button" disabled={appendStatus === "loading"} onClick={appendFromText}>
                    {appendMode === "update" ? "Actualizar campos" : "Agregar items"}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setAppendPanelOpen(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
            {appendMessage ? <div className={`status-line append-status ${appendStatus === "error" ? "error" : appendStatus === "success" ? "success" : ""}`}>{appendMessage}</div> : null}
            {searchFeedback ? <div className="status-line append-status" role="status" style={{ position: "fixed", bottom: 16, right: 16, zIndex: 100, maxWidth: "min(480px, calc(100vw - 32px))", pointerEvents: "none" }}>{searchFeedback}</div> : null}
                </div>
                    <div className={`decision-filters ${mobileLayout ? "is-mobile-collapsible" : ""} ${mobileLayout && mobileSheet === "filters" ? "is-mobile-sheet-open" : ""}`} ref={tableChipsRef} role="group" aria-label="Filtrar ítems" onClick={event => { if (mobileSheet === "filters" && (event.target as HTMLElement).closest(".decision-filter")) setMobileSheet(null); }}>
                {mobileLayout ? <div className="mobile-sheet-head"><strong>Filtrar ítems</strong><button type="button" onClick={() => setMobileSheet(null)} aria-label="Cerrar filtros">×</button></div> : null}
                {rowFilters.map(filter => { const count = simulation.rows.filter(filter.test).length; return <button key={filter.key} type="button" className={`decision-filter filter-${filter.key} ${rowFilter === filter.key ? "is-active" : ""}`} aria-pressed={rowFilter === filter.key} onClick={() => setRowFilter(filter.key)}>{filter.label} <b>{count}</b></button>; })}
                {workGroupCount ? <button type="button" className={`decision-filter filter-group ${rowFilter === "group" ? "is-active" : ""}`} aria-pressed={rowFilter === "group"} onClick={() => setRowFilter("group")} title="Ítems del último ajuste en bloque, aunque ya no cumplan el filtro de antes">Último grupo <b>{workGroupCount}</b></button> : null}
                {adjustmentFilters.length ? <span className="decision-filters-label">Ajustes</span> : null}

                {adjustmentFilters.map(filter => <button key={filter.key} type="button" className={`decision-filter filter-adjustment ${rowFilter === filter.key ? "is-active" : ""}`} aria-pressed={rowFilter === filter.key} onClick={() => { setRowFilter(filter.key); setSelectedRowKeys(new Set()); }} title="Ítems ajustados juntos; las acciones en bloque actúan sobre ellos">{filter.label} <b>{filter.count}</b></button>)}
                {rowFilter.startsWith("adj:") ? <>
                  <button ref={adjustmentRemovalRef} className="remove-adjustment-trigger" type="button" disabled={!activeBulkIndexes.some((index) => adjustmentTest(simulation.rows[index]!))} aria-expanded={adjustmentRemovalOpen} aria-controls="remove-adjustment" onClick={() => setAdjustmentRemovalOpen((open) => !open)}>Quitar ajuste…</button>
                  <AnchoredPopover open={adjustmentRemovalOpen} anchorRef={adjustmentRemovalRef} id="remove-adjustment" className="adjustment-removal-popover" ariaLabel="Quitar ajuste del grupo" width={360} onClose={() => setAdjustmentRemovalOpen(false)}><div className="adjustment-removal-panel"><strong>{rowFilterLabel}</strong><p>{selectedRowsCount ? "Solo seleccionados de este grupo" : "Todo este grupo"}: {activeBulkIndexes.filter((index) => adjustmentTest(simulation.rows[index]!)).length} {activeBulkIndexes.filter((index) => adjustmentTest(simulation.rows[index]!)).length === 1 ? "ítem" : "ítems"}.</p>{[...new Set(activeBulkIndexes.filter((index) => adjustmentTest(simulation.rows[index]!)).map((index) => adjustmentRemovalDetail(items[index]!, rowFilter)))].map((detail) => <p key={detail}>{detail}</p>)}<button type="button" onClick={removeActiveAdjustment}>Quitar de {activeBulkIndexes.filter((index) => adjustmentTest(simulation.rows[index]!)).length} {activeBulkIndexes.filter((index) => adjustmentTest(simulation.rows[index]!)).length === 1 ? "ítem" : "ítems"}</button></div></AnchoredPopover>
                </> : null}
                <button type="button" onClick={() => selectIndexes(filteredIndexes, true)}>Seleccionar {filteredIndexes.length} visibles</button>
                {selectedRowsCount ? <button type="button" onClick={() => setSelectedRowKeys(new Set())}>Quitar selección</button> : null}
                {rowFilter === "associated" ? (() => {
                  const targets = associatedBulkIndexes();
                  const costs = targets.flatMap((index) => items[index]?.additionalCosts ?? []);
                  const included = costs.filter((cost) => (cost.reviewStatus ?? "included") === "included").length;
                  const scope = targets.length === filteredIndexes.length ? (targets.length === 1 ? "el ítem visible" : `los ${formatNumber(targets.length)} ítems visibles`) : (targets.length === 1 ? "1 ítem seleccionado" : `${formatNumber(targets.length)} ítems seleccionados`);
                  return (
                    <span className="decision-associated-bulk" role="group" aria-label="Costos asociados en bloque">
                      <span>Costos de {scope}: <b>{formatNumber(included)} de {formatNumber(costs.length)}</b> incluidos</span>
                      <button type="button" onClick={() => setAssociatedCostsStatus("included")} disabled={!costs.length || included === costs.length}>Incluir todos</button>
                      <button type="button" onClick={() => setAssociatedCostsStatus("excluded")} disabled={!included}>Excluir todos</button>
                    </span>
                  );
                })() : null}
              </div>
              {tab === "simulator" || mobileLayout ? (
              <TableWorkspace compactNote={analysisView === "edit" ? "La tabla tiene scroll propio y encabezados fijos." : undefined}>
                {analysisView === "decide" || mobileLayout ? (
                  <DecisionTable highlightedItemIds={new Set(aiActivityReady ? aiSavedActivity?.itemIds || [] : [])}
                    filterKey={rowFilter.startsWith("adj:") ? "group" : rowFilter as RowFilterKey} filterTest={rowFilter === "group" ? workGroupTest : rowFilter.startsWith("adj:") ? adjustmentTest : undefined} adjustmentTags={rowAdjustmentTags} collapsedLots={collapsedLots} onToggleLot={toggleLot} onSelectLot={selectIndexes}
                    items={items}
                    rows={simulation.rows}
                    selectedRowKeys={selectedRowKeys}
                    onToggleRowSelection={toggleRowSelection}
                    onToggleAllRows={toggleAllRows}
                    onOpenDetail={openUnifiedItemEditor}
                    onAddCost={addUnifiedItemCost}
                    onSetManualCost={(index, amount) => { pushUndoSnapshot(); updateItem(index, { manualUnitCost: amount, selectedCostMode: "manual" }); }}
                    onSetAdditionalCost={(index, costIndex, amount) => {
                      const item = items[index];
                      if (!item?.additionalCosts[costIndex]) return;
                      pushUndoSnapshot();
                      updateItem(index, { additionalCosts: item.additionalCosts.map((cost, position) => position === costIndex ? { ...cost, amount } : cost) });
                    }}
                    onUpdateAdditionalCost={(index, costIndex, patch) => {
                      const item = items[index];
                      if (!item?.additionalCosts[costIndex]) return;
                      pushUndoSnapshot();
                      updateItem(index, { additionalCosts: item.additionalCosts.map((cost, position) => position === costIndex ? { ...cost, ...patch } : cost) });
                    }}
                    onRemoveAdditionalCost={(index, costIndex) => {
                      const item = items[index];
                      if (!item?.additionalCosts[costIndex]) return;
                      pushUndoSnapshot();
                      updateItem(index, { additionalCosts: item.additionalCosts.filter((_, position) => position !== costIndex) });
                    }}
                    onDeliverableTypeChange={(index, deliverableType) => updateItem(index, { deliverableType })}
                    expandedAll={expandAllItems}
                    onExpandedAllChange={setExpandAllItems}
                    editingIndex={detailRowIndex}
                    onSearch={openGoogleSearch}
                    onManualCostEditingChange={(editing) => { manualCostEditingRef.current = editing; }}
                    onManualCostChange={(index, value) => {
                      const clean = value.trim();
                      if (clean && !/^(?:COP\s*)?\$?\s*\d[\d.,\s]*$/i.test(clean)) return false;
                      const manualUnitCost = updateNumeric(clean);
                      if (clean && (manualUnitCost === null || manualUnitCost < 0)) return false;
                      updateItem(index, { manualUnitCost, selectedCostMode: manualUnitCost === null ? items[index]?.selectedCostMode : "manual" });
                      return true;
                    }}
                    renderOfferAdjustment={renderOfferAdjustment}
                    columnPrefs={decisionColumnPrefs}
                    onResizeStart={startDecisionColumnResize}
                    onResizeBy={(key, delta) => setDecisionColumnWidth(key, (decisionColumnPrefs[key]?.width ?? DECISION_COLUMNS.find((column) => column.key === key)?.defaultWidth ?? 120) + delta)}
                    previewIndex={decisionPreviewIndex}
                    onPreviewChange={(index) => { setDecisionPreviewIndex(index); if (index !== detailRowIndex) setDetailRowIndex(null); }}
                  />
                ) : (
                <table className="financial-table" style={{ minWidth: `${simulatorTableWidth}px`, width: `${simulatorTableWidth}px` }}>
                  <colgroup>
                    {visibleSimulatorColumns.map((column) => (
                      <col className={`table-group-${column.group}`} key={column.key} style={{ width: `${columnPrefs[column.key]?.width ?? column.defaultWidth}px` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>{visibleSimulatorColumns.map(renderHeader)}</tr>
                  </thead>
                  <tbody>
                    {sortedSimulatorRows.map(({ row, index }, position) => { const lot = procurementGroups.find(group => group.indexes.includes(index))!; const collapsed = hasContractLots && collapsedLots.has(lot.key); return (
                      <Fragment key={row.rowKey}>
                      {hasContractLots && (position === 0 || items[sortedSimulatorRows[position - 1]!.index]?.procurementLot?.id !== items[index]?.procurementLot?.id) ? <tr className="contract-lot-row"><th colSpan={visibleSimulatorColumns.length} scope="rowgroup"><div className="lot-table-header"><LotSelection label={lot.label} keys={lot.indexes.map(i => simulation.rows[i]!.rowKey)} selected={selectedRowKeys} onChange={checked => selectIndexes(lot.indexes, checked)} /><button type="button" onClick={() => toggleLot(lot.key)} aria-expanded={!collapsed}>{collapsed ? "▸" : "▾"} {lot.label} · {lot.indexes.length} ítems</button></div></th></tr> : null}
                      {!collapsed ? <tr className={selectedRowKeys.has(row.rowKey) ? "is-selected-row" : ""} data-row-key={row.rowKey} key={row.rowKey} tabIndex={-1}>
                        {visibleSimulatorColumns.map((column) => withStickyCell(column, renderSimulatorCell(column.key, row, index)))}
                      </tr> : null}
                      </Fragment>
                    ); })}
                  </tbody>
                </table>
                )}
                <div className="table-add-footer">
                  <details className="table-add-actions">
                    <summary>+ Agregar</summary>
                    <div className="table-add-options">
                      <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); const newIndex = items.length; addManualRows(1); if (analysisView === "decide") { openUnifiedItemEditor(newIndex); setDetailOpenSections(new Set(["base"])); setDetailEditSection("base"); } }}>Agregar ítem</button>
                      <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); openGeneralCosts(); }}>Agregar costo general</button>
                    </div>
                  </details>
                </div>
                <details className={`review-drawer table-review-drawer ${reviewEntries.length ? "has-alerts" : ""}`}>
                  <summary>
                    <span>Revisar excepciones</span>
                    <strong>{reviewEntries.length ? `${formatNumber(reviewEntries.length)} pendientes` : "Sin alertas"}</strong>
                  </summary>
                  <div className="review-drawer-body">
                    <section className="review-view" aria-label="Revisar excepciones">
                      {reviewEntries.length ? (
                        <div className="review-queue">
                          {reviewEntries.map(({ row, index, issues }) => {
                            const primaryIssue = issues[0]!;
                            const actionLabel = reviewActionLabel(primaryIssue);
                            return (
                              <article className={`review-entry review-${primaryIssue.kind}`} key={row.rowKey}>
                                <div className="review-entry-main">
                                  <div className="review-entry-title">
                                    <span>Item {row.item || index + 1}</span>
                                    <h3>{row.description || "Item sin descripcion"}</h3>
                                  </div>
                                  <p>{primaryIssue.message}</p>
                                </div>
                                <div className="review-entry-actions">
                                  <button
                                    className="button"
                                    type="button"
                                    onClick={() => {
                                      if (primaryIssue.kind === "source") {
                                        setAnalysisView("decide");
                                        setDecisionPreviewIndex(index);
                                        return;
                                      }
                                      if (primaryIssue.kind === "incomplete") {
                                        openUnifiedItemEditor(index);
                                        return;
                                      }
                                      openReviewItemInAnalysis(row.rowKey);
                                    }}
                                  >
                                    {actionLabel}
                                  </button>
                                  <button className="ghost-button" type="button" onClick={() => openUnifiedItemEditor(index)}>
                                    Ver detalle
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="review-empty" role="status">
                          <strong>Sin alertas</strong>
                          <span>Los items completos no tienen perdida, sobre techo ni margen bajo.</span>
                        </div>
                      )}
                    </section>
                  </div>
                </details>
              </TableWorkspace>
              ) : tab === "quick-edit" ? (
                <div>{filteredProcurementGroups.map((group) => <section key={group.key} aria-label={hasContractLots ? group.label : "Edición rápida"}>
                {hasContractLots ? <div className="lot-table-header"><LotSelection label={group.label} keys={procurementGroups.find(lot => lot.key === group.key)!.indexes.map(index => simulation.rows[index]!.rowKey)} selected={selectedRowKeys} onChange={checked => selectIndexes(procurementGroups.find(lot => lot.key === group.key)!.indexes, checked)} /><button type="button" onClick={() => toggleLot(group.key)} aria-expanded={!collapsedLots.has(group.key)}>{collapsedLots.has(group.key) ? "▸" : "▾"} {group.label} · {group.indexes.length} ítems</button></div> : null}
                {!hasContractLots || !collapsedLots.has(group.key) ? <>
                <QuickEditGrid
                  rows={group.indexes.map((index) => quickEditRows[index]!)}
                  hiddenColumns={quickHiddenColumns}
                  selectedRowKeys={selectedRowKeys}
                  onToggleRowSelection={toggleRowSelection}
                  onToggleAllRows={(checked) => setSelectedRowKeys((current) => {
                    const next = new Set(current); for (const index of group.indexes) { const key = simulation.rows[index]!.rowKey; if (checked) next.add(key); else next.delete(key); } return next;
                  })}
                  onPatches={applyQuickEditPatches}
                  onAddRow={() => addManualRows(1)}
                  onAddGeneralCost={openGeneralCosts}
                  onOpenDetail={(index) => openItemEditor(index)}
                  onSelectSource={(index, sourceId) => updateItem(index, { selectedCostMode: "source", selectedPriceSourceId: sourceId })}
                  onSearch={openGoogleSearch}
                  renderOfferAdjustment={(index) => simulation.rows[index] ? renderOfferAdjustment(simulation.rows[index], index) : null}
                  onBackToSimulator={() => setTab("simulator")}
                  onUndo={undoWorkspaceChange}
                  onRedo={redoWorkspaceChange}
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                  saveStatus={saveStatus}
                  embedded
                />
                </> : null}</section>)}</div>
              ) : (
                <ItemWorkspace
                  items={items}
                  rows={simulation.rows}
                  quoteLinks={quoteLinks}
                  selectedRowKeys={selectedRowKeys}
                  onToggleRowSelection={toggleRowSelection}
                  onToggleAllRows={toggleAllRows}
                  onUpdateItem={updateItem}
                  onUpdateControl={updateControl}
                  onSwitchOfferMode={switchOfferMode}
                  onOpenDetail={(index) => openItemEditor(index)}
                />
              )}
            </div>
            {tab === "quick-edit" ? (
            <details className={`review-drawer ${reviewEntries.length ? "has-alerts" : ""}`}>
              <summary>
                <span>Revisar excepciones</span>
                <strong>{reviewEntries.length ? `${formatNumber(reviewEntries.length)} pendientes` : "Sin alertas"}</strong>
              </summary>
              <div className="review-drawer-body">
                <section className="review-view" aria-label="Revisar excepciones">
                  <div className="review-filters" aria-label="Filtrar excepciones">
                    <button className={reviewFilter === "all" ? "active" : ""} type="button" onClick={() => setReviewFilter("all")}>
                      Todas <strong>{formatNumber(reviewEntries.length)}</strong>
                    </button>
                    {REVIEW_FILTERS.filter(({ kind }) => reviewStats[kind] > 0).map(({ kind, label }) => (
                      <button className={`review-filter-${kind} ${reviewFilter === kind ? "active" : ""}`} type="button" key={kind} onClick={() => setReviewFilter(kind)}>
                        {label} <strong>{formatNumber(reviewStats[kind])}</strong>
                      </button>
                    ))}
                  </div>

                  {filteredReviewEntries.length ? (
                    <div className="review-queue">
                      {filteredReviewEntries.map(({ row, index, issues }) => {
                        const primaryIssue = issues[0]!;
                        const actionLabel = reviewActionLabel(primaryIssue);
                        return (
                          <article className={`review-entry review-${primaryIssue.kind}`} key={row.rowKey}>
                            <div className="review-entry-main">
                              <div className="review-entry-title">
                                <span>Ítem {row.item || index + 1}</span>
                                <h3>{row.description || "Ítem sin descripción"}</h3>
                              </div>
                              <p>{primaryIssue.message} {issues.length > 1 ? `Además: ${issues.slice(1).map((issue) => issue.label.toLowerCase()).join(", ")}.` : ""}</p>
                            </div>
                            <div className="review-entry-actions">
                              <button
                                className="button"
                                type="button"
                                onClick={() => {
                                  if (primaryIssue.kind === "source" || primaryIssue.kind === "incomplete") {
                                    openItemEditor(index);
                                    return;
                                  }
                                  openReviewItemInAnalysis(row.rowKey);
                                }}
                              >
                                {actionLabel}
                              </button>
                              <button className="ghost-button" type="button" onClick={() => openItemEditor(index)}>
                                Ver detalle
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="review-empty" role="status">
                      <strong>Sin alertas</strong>
                      <span>Los ítems completos no tienen pérdida, sobre techo ni margen bajo.</span>
                    </div>
                  )}
                </section>
              </div>
            </details>
            ) : null}

          </div>
        ) : (
          <div className="offer-view" id="financial-offer-panel" role="tabpanel" aria-labelledby="financial-mode-offer">
            {renderLotFinancialSummary()}
            {simulation.summary.assumedQuantityCount ? <div className="view-status warning" role="status">
              <strong>{simulation.summary.assumedQuantityCount} ítems calculados con 1 unidad asumida</strong>
              <span>El pliego no indica su cantidad. Confírmala antes de entregar una oferta.</span>
            </div> : null}
            {!totalComplete ? (
              <div className="view-status warning" role="status">
                <strong>Oferta parcial</strong>
                <span>{missingTotalParts.length ? missingTotalParts.join(" · ") : "Faltan datos"}</span>
                <button className="ghost-button" type="button" onClick={() => setTab("simulator")}>Completar en la mesa de ítems</button>
              </div>
            ) : null}
            <div className="offer-cockpit-stack">
            <div className="offer-view-header">
              <span className="view-meta">{formatNumber(simulation.summary.knownOfferCount)} de {formatNumber(simulation.summary.itemCount)} ítems con oferta{simulation.summary.missingOfferCount ? " · cifras registradas" : ""}</span>
              <button className="button" type="button" onClick={() => saveAndExport("offer-xlsx")} disabled={saveStatus === "saving" || exportBusy}><Download size={17} aria-hidden="true" /> Exportar Excel</button>
            </div>
            <div className={"summary-card offer-ceiling-reference " + (offerCeiling.status === "exceeded" ? "is-over-ceiling" : "")} aria-label="Referencia de techo total">
              <div className="offer-ceiling-primary">
                <small>Referencia · Techo total</small>
                {totalCeiling !== null ? <strong>{formatCop(totalCeiling)}</strong> : <span className="summary-card-pending">No definido</span>}
              </div>
              <div className="offer-ceiling-details">
                {offerCeiling.status === "exceeded" ? <span className="offer-ceiling-note is-danger" role="alert">La oferta con IVA supera el techo total en {formatCop(-offerCeiling.difference!)}{offerCeiling.partial ? " · faltan ítems por ofertar" : ""}.</span>
                  : offerCeiling.status === "at_limit" ? <span className="offer-ceiling-note">Oferta con IVA al límite{offerCeiling.partial ? " · faltan ítems por ofertar" : ""}.</span>
                  : offerCeiling.status === "within" ? <span className="offer-ceiling-note">{offerCeiling.partial ? "Diferencia provisional respecto al techo total" : "Descuento respecto al techo total"}: {formatCop(offerCeiling.difference)}{offerCeiling.partial ? " · faltan ítems por ofertar" : ""}.</span>
                  : offerCeiling.status === "no_offer" ? <span className="offer-ceiling-note">Registra una oferta para comparar.</span> : null}
                {offer.summary.rowsAboveCeiling > 0 ? <span className="offer-ceiling-note is-danger" role="alert">{formatNumber(offer.summary.rowsAboveCeiling)} ítems superan su techo unitario.</span> : null}
              </div>
            </div>
            <h3 className="offer-economic-group-title">Valores de la oferta registrada</h3>
            <div className="summary-grid offer-economic-summary" aria-label="Resumen de la oferta económica">
              <div className="summary-card">
                <small>Total sin IVA</small>
                {simulation.summary.knownOfferCount ? <strong>{formatCop(offer.summary.totalOfferWithoutVat)}</strong> : <span className="summary-card-pending">Pendiente</span>}
              </div>
              <div className="summary-card">
                <small>IVA</small>
                {simulation.summary.knownOfferCount ? <strong>{formatCop(offer.summary.totalVat)}</strong> : <span className="summary-card-pending">Pendiente</span>}
              </div>
              <div className="summary-card">
                <small>Total con IVA</small>
                {simulation.summary.knownOfferCount ? <strong>{formatCop(offer.summary.totalOfferWithVat)}</strong> : <span className="summary-card-pending">Pendiente</span>}
              </div>
              <div className="summary-card offer-retentions-card">
                <small className="summary-color-key is-deductions"><i aria-hidden="true" />Retenciones y estampillas</small>
                {simulation.summary.knownOfferCount ? <strong>{formatCop(offer.summary.totalDeductions)}</strong> : <span className="summary-card-pending">Pendiente</span>}
                {simulation.summary.knownOfferCount && offer.summary.totalDeductions > 0 ? <details className="offer-retention-details">
                  <summary>Ver desglose</summary>
                  <div>
                    {offer.summary.reteFuente > 0 ? <span>ReteFuente <strong>{formatCop(offer.summary.reteFuente)}</strong></span> : null}
                    {offer.summary.reteIva > 0 ? <span>ReteIVA <strong>{formatCop(offer.summary.reteIva)}</strong></span> : null}
                    {offer.summary.reteIca > 0 ? <span>ReteICA <strong>{formatCop(offer.summary.reteIca)}</strong></span> : null}
                    {offer.summary.stampTax > 0 ? <span>Estampillas <strong>{formatCop(offer.summary.stampTax)}</strong></span> : null}
                  </div>
                </details> : null}
              </div>
              <div className={"summary-card" + (offerSummaryHasLoss ? " metric-danger" : "")}>
                <small className={"summary-color-key " + (offerSummaryHasLoss ? "is-loss" : "is-utility")}><i aria-hidden="true" />{totalComplete ? utilityIsScenario ? "Utilidad neta de escenario estimada" : "Utilidad neta estimada" : "Utilidad neta parcial estimada"}</small>
                {totalComplete ? <strong>{formatCop(offer.summary.estimatedNetUtility)}</strong> : provisionalOffer
                  ? <><strong>{formatCop(provisionalOffer.utility)}</strong><span className="summary-card-pending">{provisionalOffer.coveredCount}/{simulation.summary.itemCount} ítems; faltan costos</span></>
                  : partialUtility ? <><strong>{formatCop(partialUtility.value)}</strong><span className="summary-card-pending">{partialUtility.coveredCount}/{simulation.summary.itemCount} ítems con costo y oferta</span></>
                  : <span className="summary-card-pending">Pendiente</span>}
              </div>
            </div>
            </div>
            {mobileLayout ? <div className="offer-item-list" aria-label="Ítems de la oferta económica">
              {procurementGroups.filter(group => !group.id || !excludedProcurementLotIds.includes(group.id)).map(group => <section key={group.key} aria-label={hasContractLots ? group.label : "Oferta registrada"}>
                {hasContractLots ? <h3 className="offer-lot-heading">{group.label} · {group.indexes.length} ítems</h3> : null}
                {group.indexes.map(index => <OfferItemCard key={offer.rows[index]!.rowKey} row={offer.rows[index]!}
                  itemLabel={displayItemNumber(offer.rows[index]!.item)} quantityAssumed={!!simulation.rows[index]?.quantityAssumed}
                  provisionalUtility={simulation.rows[index] ? provisionalUtilityForRow(simulation.rows[index]!) : null}
                  statusLabel={statusLabel(offer.rows[index]!.status)} />)}
                {hasContractLots ? (() => { const totals = procurementLotTotals(group, simulation.rows, offer.rows); return <div className="offer-lot-subtotal">
                  <strong>Subtotal {group.label}{totals.pendingOffer ? ` · parcial: ${totals.pendingOffer} ítems sin oferta` : ""}</strong>
                  <dl><div><dt>Sin IVA</dt><dd>{formatCop(totals.offerWithoutVat)}</dd></div><div><dt>IVA</dt><dd>{formatCop(totals.offerVat)}</dd></div><div><dt>Con IVA</dt><dd>{formatCop(totals.offerWithVat)}</dd></div></dl>
                </div>; })() : null}
              </section>)}
            </div> : <TableWorkspace>
              <table className="offer-table economic-offer-table">
                <colgroup>
                  {[56, 280, 76, 84, 116, 124, 64, 104, 110, 116, 124, 104, 116, 124, 120, 116, 124, 116, 76].map((width, index) => <col key={index} style={{ width }} />)}
                </colgroup>
                <thead>
                  <tr className="group-header-row">
                    <th colSpan={11}>Cliente</th>
                    <th>Control</th>
                    <th colSpan={7}>Interno</th>
                  </tr>
                  <tr>
                    <th>Ítem</th>
                    <th>Descripción</th>
                    <th>Cant.</th>
                    <th>Unidad</th>
                    <th>Unit. sin IVA</th>
                    <th>Total sin IVA</th>
                    <th>IVA %</th>
                    <th>IVA unit.</th>
                    <th>IVA total</th>
                    <th>Unit. con IVA</th>
                    <th>Total con IVA</th>
                    <th>Estado</th>
                    <th>Techo unit.</th>
                    <th>Techo total</th>
                    <th>Dif. vs techo</th>
                    <th>Costo unit.</th>
                    <th>Costo total</th>
                    <th>Utilidad</th>
                    <th>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {procurementGroups.filter(group => !group.id || !excludedProcurementLotIds.includes(group.id)).map((group) => <Fragment key={group.key}>
                    {hasContractLots ? <tr className="contract-lot-row"><th colSpan={19} scope="rowgroup">{group.label} · {group.indexes.length} ítems</th></tr> : null}
                    {group.indexes.map((index) => { const row = offerScreen.rows[index]!; return (
                    <tr key={row.rowKey}>
                      <td>{row.item}</td>
                      <td className="description-cell" title={row.description}><span className="offer-description">{row.description}</span></td>
                      <td className="number">{formatNumber(row.quantity)}{simulation.rows[index]?.quantityAssumed ? <small title="Cantidad no indicada en el pliego"> asumida</small> : null}</td>
                      <td>{row.unit}</td>
                      <td className="money">{formatCop(row.unitPriceWithoutVat)}</td>
                      <td className="money">{formatCop(row.totalWithoutVat)}</td>
                      <td className="number">{formatPercent(row.vatRatePct)}</td>
                      <td className="money">{formatCop(row.vatUnitValue)}</td>
                      <td className="money">{formatCop(row.totalVatValue)}</td>
                      <td className="money">{formatCop(row.unitPriceWithVat)}</td>
                      <td className="money">{formatCop(row.totalWithVat)}</td>
                      <td>
                        <span className={`status-pill ${row.status}`} title={row.warnings.join(" ") || undefined}>{statusLabel(row.status)}</span>
                      </td>
                      <td className="money">{formatCop(row.referenceUnit)}</td>
                      <td className="money">{formatCop(row.referenceTotal)}</td>
                      <td className={`money ${row.differenceVsReferenceTotal !== null && row.differenceVsReferenceTotal < 0 ? "metric-danger" : ""}`}>
                        {formatCop(row.differenceVsReferenceTotal)}
                      </td>
                      <td className="money">{formatCop(row.costUnit)}</td>
                      <td className="money">{formatCop(row.costTotal)}</td>
                      <td className="money">{simulation.rows[index] && provisionalUtilityForRow(simulation.rows[index]!) !== null
                        ? <span title="Antes de los costos asociados pendientes">{formatCop(provisionalUtilityForRow(simulation.rows[index]!))}<small>Provisional</small></span>
                        : formatCop(row.utilityValue)}</td>
                      <td className="number">{formatPercent(row.marginPctOnCost)}</td>
                    </tr>
                  ); })}
                  {hasContractLots ? (() => { const totals = procurementLotTotals(group, simulation.rows, offer.rows); return <tr className="contract-lot-subtotal"><th colSpan={19}>Subtotal {group.label}{totals.pendingOffer ? ` · parcial: ${totals.pendingOffer} ítems sin oferta` : ""} · Sin IVA: {formatCop(totals.offerWithoutVat)} · IVA: {formatCop(totals.offerVat)} · Con IVA: {formatCop(totals.offerWithVat)}</th></tr>; })() : null}
                  </Fragment>)}
                </tbody>
              </table>
            </TableWorkspace>}
          </div>
        )}
      </section>
      <AiWorkspaceActivity activity={aiSavedActivity} historical={aiActivityHistorical} pending={!aiActivityReady || externalRevisionPending} onDismiss={() => { aiSavedActivityRef.current = null; setAiSavedActivity(null); }} />
      <CalculationCollaboration key={props.project.id} project={visibleProject} items={items} onBeforeSend={persistCalculation} />
    </div>
    </CalculationBars>
  );
}
