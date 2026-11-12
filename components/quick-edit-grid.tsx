"use client";
import type { QuoteLink } from "@offer/lib/financial-engine";

import React, { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { CSSProperties } from "react";
import { AgGridReact, type CustomCellEditorProps } from "ag-grid-react";
import { clearSheetRange, isOriginalGridField, moveSheetFocus, parseSheetTsv, pasteSheetRange, serializeSheetTsv } from "@offer/lib/quick-edit-sheet";
import { formatMoneyDraft } from "@offer/lib/money-draft";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type CellValueChangedEvent, type ColDef, type GridApi, type IHeaderParams, type ICellRendererParams } from "ag-grid-community";
import { QuoteLinkButton } from "@offer/components/quote-link-button";
import { SlidersHorizontal, PencilLine, MessageSquareQuote, Search, PanelRightOpen, X } from "lucide-react";

ModuleRegistry.registerModules([AllCommunityModule]);
const cafSheetTheme = themeQuartz.withParams({ fontFamily: "inherit", fontSize: 13, headerFontSize: 12, headerFontWeight: 500, backgroundColor: "#ffffff", oddRowBackgroundColor: "#f7f7f6", headerBackgroundColor: "#f0efec", headerTextColor: "#514b44", accentColor: "#376d9f" });

export type QuickEditField = "item" | "description" | "quantity" | "unit" | "referenceUnit" | "manualUnitCost" | "selectedCostMode" | "offerUnit" | "notes";
export type QuickEditPatch = { index: number; field: QuickEditField; value: string };
export type QuickEditRow = {
  id: string; itemId: string; index: number; item: string; description: string; quantity: string; unit: string;
  referenceUnit: string; referenceTotal: string; manualUnitCost: string; selectedCostMode: string;
  costOptions: { mode: string; label: string }[];
  costUnit: string; costTotal: string; offerUnit: string; offerTotal: string; utility: string;
  margin: string; notes: string; status: string; associatedCosts: string; quoteLinks: QuoteLink[];
  selectedPriceSourceId: string | null; sourceOptions: Array<{ id: string; label: string }>;
};

type GridCellAddress = { rowIndex: number; colId: string };
type GridSelection = { anchor: GridCellAddress; focus: GridCellAddress };

type QuickEditGridProps = {
  rows: QuickEditRow[];
  selectedRowKeys: Set<string>;
  onToggleRowSelection: (rowKey: string, checked: boolean) => void;
  onToggleAllRows: (checked: boolean) => void;
  onPatches: (patches: QuickEditPatch[]) => void;
  onAddRow: () => void;
  onAddGeneralCost: () => void;
  onOpenDetail: (index: number) => void;
  onSelectSource: (index: number, sourceId: string | null) => void;
  onSearch: (index: number) => void;
  renderOfferAdjustment: (index: number) => ReactNode;
  onBackToSimulator: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  embedded?: boolean;
  hiddenColumns?: string[];
};

function MoneyGridEditor(props: CustomCellEditorProps<QuickEditRow, string>) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    if (props.eventKey && props.eventKey.length === 1) props.onValueChange(formatMoneyDraft(props.eventKey));
    else if (props.eventKey === "Backspace" || props.eventKey === "Delete") props.onValueChange("");
    else inputRef.current?.select();
  }, []);
  return <input
    ref={inputRef}
    className="quick-grid-money-editor"
    inputMode="decimal"
    aria-label="Valor monetario"
    value={props.value ?? ""}
    onChange={(event) => props.onValueChange(formatMoneyDraft(event.target.value))}
  />;
}

// Solo presentación: el editor sigue mostrando el valor exacto.
function displayItem(params: { value?: unknown }) { return normalizeGridValue(params.value).replace(/^(\d+)[.,]0+$/, "$1"); }
function displayMoney(params: { value?: unknown }) {
  const raw = normalizeGridValue(params.value).trim();
  if (!raw) return "";
  const number = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? `$ ${Math.round(number).toLocaleString("es-CO")}` : raw;
}

function isEditableField(value: string): value is QuickEditField { return isOriginalGridField(value); }
function isGridDataField(value: string): value is keyof QuickEditRow { return ["item", "description", "quantity", "unit", "referenceUnit", "referenceTotal", "manualUnitCost", "selectedCostMode", "selectedPriceSourceId", "costUnit", "costTotal", "offerUnit", "offerTotal", "utility", "margin", "notes", "status", "associatedCosts"].includes(value); }
function normalizeGridValue(value: unknown): string { return value === null || value === undefined ? "" : String(value); }
export function QuickEditGrid({ rows, selectedRowKeys, onToggleRowSelection, onToggleAllRows, onPatches, onAddRow, onAddGeneralCost, onOpenDetail, onSelectSource, onSearch, renderOfferAdjustment, onBackToSimulator, onUndo, onRedo, canUndo, canRedo, saveStatus, embedded = false, hiddenColumns = [] }: QuickEditGridProps) {
  const gridRef = useRef<AgGridReact<QuickEditRow>>(null);
  const [adjustIndex, setAdjustIndex] = useState<number | null>(null);
  useEffect(() => {
    if (adjustIndex === null) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAdjustIndex(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [adjustIndex]);
  const selectionRef = useRef<GridSelection | null>(null);
  // Filas de hoja de cálculo solo en PC; el móvil conserva su alto táctil.
  const [compactRows, setCompactRows] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 641px)");
    const sync = () => setCompactRows(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const isDraggingSelectionRef = useRef(false);

  const refreshFrameRef = useRef(0);
  const paintedRowsRef = useRef<[number, number] | null>(null);
  const boundsCacheRef = useRef<{ selection: GridSelection | null; bounds: { startRow: number; endRow: number; startColumn: number; endColumn: number; index: Map<string, number> } | null } | null>(null);

  const dataColumns = useCallback((api: GridApi<QuickEditRow>) => api.getAllDisplayedColumns().filter((column) => Boolean(column.getColDef().field)), []);

  const selectionBounds = useCallback((current: GridSelection | null, api: GridApi<QuickEditRow>) => {
    if (!current) return null;
    const columns = dataColumns(api);
    const anchorColumn = columns.findIndex((column) => column.getColId() === current.anchor.colId);
    const focusColumn = columns.findIndex((column) => column.getColId() === current.focus.colId);
    if (anchorColumn < 0 || focusColumn < 0) return null;
    return {
      startRow: Math.min(current.anchor.rowIndex, current.focus.rowIndex),
      endRow: Math.max(current.anchor.rowIndex, current.focus.rowIndex),
      startColumn: Math.min(anchorColumn, focusColumn),
      endColumn: Math.max(anchorColumn, focusColumn),
      columns,
    };
  }, [dataColumns]);

  // Como en Excel: un cuadro de pintura por movimiento y solo las filas que entran o salen del rango.
  const updateSelection = useCallback((next: GridSelection | null) => {
    selectionRef.current = next;
    if (refreshFrameRef.current) return;
    refreshFrameRef.current = requestAnimationFrame(() => {
      refreshFrameRef.current = 0;
      const api = gridRef.current?.api;
      if (!api) return;
      const bounds = selectionBounds(selectionRef.current, api);
      const rows: [number, number] | null = bounds ? [bounds.startRow, bounds.endRow] : null;
      const previous = paintedRowsRef.current;
      paintedRowsRef.current = rows;
      const spans = [previous, rows].filter((span): span is [number, number] => span !== null);
      if (!spans.length) return;
      const rowNodes = [];
      for (let index = Math.min(...spans.map(span => span[0])); index <= Math.max(...spans.map(span => span[1])); index++) {
        const node = api.getDisplayedRowAtIndex(index);
        if (node) rowNodes.push(node);
      }
      api.refreshCells({ rowNodes });
    });
  }, [selectionBounds]);

  const activeSelection = useCallback((api: GridApi<QuickEditRow>) => {
    if (selectionRef.current) return selectionRef.current;
    const focus = api.getFocusedCell();
    if (!focus || focus.rowIndex === null) return null;
    const cell = { rowIndex: focus.rowIndex, colId: focus.column.getColId() };
    return { anchor: cell, focus: cell };
  }, []);

  const cachedBounds = useCallback(() => {
    const api = gridRef.current?.api;
    const current = selectionRef.current;
    if (!api || !current) return null;
    if (boundsCacheRef.current?.selection !== current) {
      const bounds = selectionBounds(current, api);
      boundsCacheRef.current = { selection: current, bounds: bounds && { ...bounds, index: new Map(bounds.columns.map((column, i) => [column.getColId(), i])) } };
    }
    return boundsCacheRef.current.bounds;
  }, [selectionBounds]);

  const isCellSelected = useCallback((rowIndex: number | null | undefined, colId: string) => {
    if (rowIndex === null || rowIndex === undefined) return false;
    const bounds = cachedBounds();
    const colIndex = bounds?.index.get(colId);
    return !!bounds && colIndex !== undefined && rowIndex >= bounds.startRow && rowIndex <= bounds.endRow && colIndex >= bounds.startColumn && colIndex <= bounds.endColumn;
  }, [cachedBounds]);

  // Borde exterior único del rango, como en una hoja de cálculo.
  const isSelectionEdge = useCallback((rowIndex: number | null | undefined, colId: string, edge: "top" | "bottom" | "left" | "right") => {
    if (!isCellSelected(rowIndex, colId)) return false;
    const bounds = cachedBounds()!;
    const colIndex = bounds.index.get(colId)!;
    return edge === "top" ? rowIndex === bounds.startRow : edge === "bottom" ? rowIndex === bounds.endRow : edge === "left" ? colIndex === bounds.startColumn : colIndex === bounds.endColumn;
  }, [cachedBounds, isCellSelected]);

  const cellClasses = useCallback((_field: keyof QuickEditRow, classes = "") => classes, []);

  useEffect(() => {
    const stopSelectionDrag = () => { isDraggingSelectionRef.current = false; };
    window.addEventListener("mouseup", stopSelectionDrag);
    window.addEventListener("blur", stopSelectionDrag);
    return () => { window.removeEventListener("mouseup", stopSelectionDrag); window.removeEventListener("blur", stopSelectionDrag); };
  }, []);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent<QuickEditRow>) => {
    const field = event.colDef.field;
    if (!event.data || !field || !isEditableField(field)) return;
    const value = normalizeGridValue(event.newValue);
    if (value === normalizeGridValue(event.oldValue)) return;
    onPatches([{ index: event.data.index, field, value }]);
  }, [onPatches]);

  const pointerCell = useCallback((target: EventTarget) => {
    if (!(target instanceof HTMLElement) || target.closest("button, input, select, textarea")) return null;
    const cell = target.closest<HTMLElement>(".ag-cell[col-id]");
    const row = cell?.closest<HTMLElement>(".ag-row[row-index]");
    const colId = cell?.getAttribute("col-id"), rawIndex = row?.getAttribute("row-index");
    if (!colId || !isGridDataField(colId) || rawIndex == null) return null;
    const rowIndex = Number(rawIndex);
    return Number.isInteger(rowIndex) && rowIndex >= 0 ? { rowIndex, colId } : null;
  }, []);

  // React capture runs synchronously: AG's public mouse callbacks are queued and
  // can arrive after mouseup, leaving a drag stuck or losing its last cell.
  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const cell = pointerCell(event.target);
    if (!cell) return;
    event.preventDefault();
    gridRef.current?.api.setFocusedCell(cell.rowIndex, cell.colId);
    const current = selectionRef.current;
    updateSelection({ anchor: event.shiftKey && current ? current.anchor : cell, focus: cell });
    isDraggingSelectionRef.current = true;
  }, [pointerCell, updateSelection]);

  const handleMouseOver = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const current = selectionRef.current;
    if (!isDraggingSelectionRef.current || !current || !(event.buttons & 1)) return;
    const cell = pointerCell(event.target);
    if (cell) updateSelection({ anchor: current.anchor, focus: cell });
  }, [pointerCell, updateSelection]);

  const displayedRows = useCallback((api: GridApi<QuickEditRow>) =>
    Array.from({ length: api.getDisplayedRowCount() }, (_, i) => api.getDisplayedRowAtIndex(i)!.data!), []);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const api = gridRef.current?.api;
    if (!api || api.getEditingCells().length || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select"))) return;
    const bounds = selectionBounds(activeSelection(api), api);
    if (!bounds) return;
    const matrix = displayedRows(api).slice(bounds.startRow, bounds.endRow + 1).map(row =>
      bounds.columns.slice(bounds.startColumn, bounds.endColumn + 1).map(column => normalizeGridValue(row[column.getColDef().field as keyof QuickEditRow])));
    event.clipboardData.setData("text/plain", serializeSheetTsv(matrix));
    event.preventDefault();
  }, [activeSelection, displayedRows, selectionBounds]);

  const clearSelection = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const bounds = selectionBounds(activeSelection(api), api);
    if (!bounds) return;
    const patches = clearSheetRange(displayedRows(api), bounds.columns.map(column => column.getColId()), bounds);
    if (patches.length) onPatches(patches);
  }, [activeSelection, displayedRows, onPatches, selectionBounds]);

  const fillSelectionDown = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const bounds = selectionBounds(activeSelection(api), api);
    if (!bounds || bounds.endRow === bounds.startRow) return;
    const source = api.getDisplayedRowAtIndex(bounds.startRow)?.data;
    if (!source) return;
    const patches: QuickEditPatch[] = [];
    bounds.columns.slice(bounds.startColumn, bounds.endColumn + 1).forEach((column) => {
      const field = column.getColDef().field;
      if (!field || !isEditableField(field)) return;
      const value = normalizeGridValue(source[field]);
      for (let rowIndex = bounds.startRow + 1; rowIndex <= bounds.endRow; rowIndex += 1) {
        const row = api.getDisplayedRowAtIndex(rowIndex)?.data;
        if (row) patches.push({ index: row.index, field, value });
      }
    });
    if (patches.length) onPatches(patches);
  }, [activeSelection, onPatches, selectionBounds]);

  const selectAxis = useCallback((axis: "row" | "column" | "all", position: number, extend = false) => {
    const api = gridRef.current?.api;
    if (!api || !api.getDisplayedRowCount()) return;
    const columns = dataColumns(api);
    const previous = selectionRef.current;
    const lastRow = api.getDisplayedRowCount() - 1;
    const firstCol = columns[0]?.getColId(), lastCol = columns.at(-1)?.getColId();
    if (!firstCol || !lastCol) return;
    const anchor = axis === "column" ? { rowIndex: 0, colId: extend && previous ? previous.anchor.colId : columns[position]!.getColId() }
      : { rowIndex: axis === "all" ? 0 : extend && previous ? previous.anchor.rowIndex : position, colId: firstCol };
    const focus = axis === "row" ? { rowIndex: position, colId: lastCol }
      : { rowIndex: lastRow, colId: axis === "all" ? lastCol : columns[position]!.getColId() };
    api.stopEditing();
    api.setFocusedCell(axis === "row" ? position : 0, axis === "column" ? columns[position]! : firstCol);
    updateSelection({ anchor, focus });
  }, [dataColumns, updateSelection]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (api.getEditingCells().length) {
      if (event.key === "Enter" || event.key === "Tab") {
        // AG navigates after committing. Its public focus events are asynchronous;
        // using them for selection would collapse Shift ranges and full columns.
        window.setTimeout(() => {
          if (api.isDestroyed()) return;
          const next = api.getFocusedCell();
          if (next) { const cell = { rowIndex: next.rowIndex, colId: next.column.getColId() }; updateSelection({ anchor: cell, focus: cell }); }
        }, 0);
      }
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button")) return;
    const current = activeSelection(api);
    if (!current) return;
    const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (command && ["z", "y", "d", "a"].includes(key)) {
      consume();
      if (key === "z") { if (event.shiftKey) onRedo(); else onUndo(); }
      if (key === "y") onRedo();
      if (key === "d") fillSelectionDown();
      if (key === "a") selectAxis("all", 0);
      return;
    }
    if (key === "delete" || key === "backspace") { consume(); clearSelection(); return; }
    if (key === "escape") { consume(); updateSelection({ anchor: current.focus, focus: current.focus }); return; }
    const columns = dataColumns(api);
    const active = api.getFocusedCell();
    const origin = event.shiftKey || !active ? current.focus : { rowIndex: active.rowIndex, colId: active.column.getColId() };
    const c = columns.findIndex(column => column.getColId() === origin.colId), r = origin.rowIndex;
    if (key === " " && event.shiftKey) { consume(); selectAxis("row", r); return; }
    if (key === " " && command) { consume(); selectAxis("column", c); return; }
    if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "tab", "enter", "home", "end"].includes(key)) return;
    consume();
    const next = moveSheetFocus({ row: r, column: c }, key, event.shiftKey, command, api.getDisplayedRowCount(), columns.length);
    const focus = { rowIndex: next.row, colId: columns[next.column]!.getColId() };
    api.ensureIndexVisible(focus.rowIndex); api.ensureColumnVisible(focus.colId); api.setFocusedCell(focus.rowIndex, focus.colId);
    updateSelection({ anchor: event.shiftKey && key !== "tab" && key !== "enter" ? current.anchor : focus, focus });
  }, [activeSelection, clearSelection, dataColumns, fillSelectionDown, onRedo, onUndo, selectAxis, updateSelection]);

  const SheetHeader = useCallback((params: IHeaderParams<QuickEditRow>) => {
    const position = () => dataColumns(params.api).findIndex(column => column.getColId() === params.column.getColId());
    return <div className="quick-sheet-header">
      <button type="button" className="quick-sheet-column" title="Seleccionar columna (Shift para ampliar)"
        onMouseDown={event => { if (event.button !== 0) return; event.preventDefault(); selectAxis("column", position(), event.shiftKey); isDraggingSelectionRef.current = true; }}
        onMouseEnter={() => { if (isDraggingSelectionRef.current) selectAxis("column", position(), true); }}
        onClick={event => { if (event.detail === 0) selectAxis("column", position(), event.shiftKey); }}>{params.displayName}</button>
      {params.enableSorting ? <button type="button" className="quick-sheet-sort" aria-label={"Ordenar " + params.displayName} onClick={event => params.progressSort(event.shiftKey)}>↕</button> : null}
    </div>;
  }, [dataColumns, selectAxis]);

  const columnDefs = useMemo<ColDef<QuickEditRow>[]>(() => [
    { colId: "sheetRow", headerName: "", width: 46, minWidth: 46, maxWidth: 46, pinned: "left", sortable: false, resizable: false,
      headerComponent: () => <button type="button" className="quick-sheet-gutter" aria-label="Seleccionar toda la hoja" onClick={() => selectAxis("all", 0)}>▦</button>,
      cellRenderer: (params: ICellRendererParams<QuickEditRow>) => params.node.rowIndex === null ? null : <button type="button" className="quick-sheet-gutter" aria-label={`Seleccionar rango de fila ${params.node.rowIndex + 1}`}
        onMouseDown={event => { if (event.button !== 0) return; event.preventDefault(); selectAxis("row", params.node.rowIndex!, event.shiftKey); isDraggingSelectionRef.current = true; }}
        onMouseEnter={() => { if (isDraggingSelectionRef.current) selectAxis("row", params.node.rowIndex!, true); }}
        onClick={event => { if (event.detail === 0) selectAxis("row", params.node.rowIndex!, event.shiftKey); }}>{params.node.rowIndex + 1}</button> },
    {
      colId: "select", headerName: "", sortable: false, resizable: false, width: 48, minWidth: 48, maxWidth: 48, pinned: "left",
      headerComponent: () => <input type="checkbox" checked={rows.length > 0 && rows.every((row) => selectedRowKeys.has(row.id))} onChange={(event) => onToggleAllRows(event.target.checked)} aria-label="Seleccionar todas las filas" />,
      cellRenderer: (params: { data?: QuickEditRow }) => params.data ? <input type="checkbox" checked={selectedRowKeys.has(params.data.id)} onChange={(event) => onToggleRowSelection(params.data!.id, event.target.checked)} onClick={(event) => event.stopPropagation()} aria-label={`Seleccionar ítem ${params.data.item || params.data.index + 1}`} /> : null,
    },
    { field: "item", headerName: "Ítem", editable: true, valueFormatter: displayItem, width: 74, minWidth: 60, pinned: "left", cellClass: cellClasses("item", "quick-grid-input") },
    { field: "description", headerName: "Descripción", editable: true, flex: 2.4, minWidth: 220, pinned: "left", tooltipField: "description", cellClass: cellClasses("description", "quick-grid-input") },
    { field: "quantity", headerName: "Cant.", editable: true, width: 86, minWidth: 72, cellClass: cellClasses("quantity", "quick-grid-number quick-grid-input") },
    { field: "unit", headerName: "Unidad", editable: true, width: 104, minWidth: 82, cellClass: cellClasses("unit", "quick-grid-input") },
    { field: "referenceUnit", cellEditor: MoneyGridEditor, headerName: "Techo unit.", editable: true, valueFormatter: displayMoney, width: 132, minWidth: 112, cellClass: cellClasses("referenceUnit", "quick-grid-money quick-grid-input") },
    { field: "referenceTotal", headerName: "Techo total", width: 136, minWidth: 116, cellClass: cellClasses("referenceTotal", "quick-grid-money quick-grid-result"), editable: false },
    { field: "manualUnitCost", cellEditor: MoneyGridEditor, headerName: "Costo manual", editable: true, valueFormatter: displayMoney, width: 138, minWidth: 118, cellClass: cellClasses("manualUnitCost", "quick-grid-money quick-grid-input") },
    {
      field: "selectedCostMode", headerName: "Costo a usar", editable: true, cellEditor: "agSelectCellEditor",
      cellEditorParams: (params: { data?: QuickEditRow }) => ({ values: params.data?.costOptions.map(option => option.mode) ?? [] }),
      valueFormatter: params => params.data?.costOptions.find(option => option.mode === params.value)?.label ?? (params.data?.costOptions.length ? "Elegir costo" : "Sin costo"),
      width: 132, minWidth: 114, cellClass: cellClasses("selectedCostMode", "quick-grid-choice"),
    },
    {
      field: "selectedPriceSourceId", headerName: "Fuente elegida", width: 185, minWidth: 160, editable: false,
      cellRenderer: (params: { data?: QuickEditRow }) => params.data ? (
        <select className="quick-grid-source-select" value={params.data.sourceOptions.length === 1 ? params.data.sourceOptions[0]!.id : params.data.selectedPriceSourceId ?? ""} disabled={params.data.sourceOptions.length < 2} aria-label={`Fuente de precio del ítem ${params.data.item || params.data.index + 1}`} onChange={(event) => onSelectSource(params.data!.index, event.target.value || null)}>
          {params.data.sourceOptions.length !== 1 ? <option value="">{params.data.sourceOptions.length ? "Elegir cotización" : "Sin cotizaciones"}</option> : null}
          {params.data.sourceOptions.map((source) => <option value={source.id} key={source.id}>{source.label}</option>)}
        </select>
      ) : null,
    },
    { field: "costUnit", headerName: "Costo unit.", width: 132, minWidth: 112, cellClass: cellClasses("costUnit", "quick-grid-money quick-grid-result"), editable: false },
    { field: "costTotal", headerName: "Costo total", width: 136, minWidth: 116, cellClass: cellClasses("costTotal", "quick-grid-money quick-grid-result"), editable: false },
    {
      field: "associatedCosts", headerName: "Servicios / costos", width: 155, minWidth: 135, editable: false,
      cellRenderer: (params: { data?: QuickEditRow }) => params.data?.associatedCosts ? (
        <button className="quick-grid-detail-button" type="button" onClick={(event) => { event.stopPropagation(); onOpenDetail(params.data!.index); }} title="Editar servicios y costos asociados">{params.data.associatedCosts}</button>
      ) : null,
    },
    { field: "offerUnit", headerName: "Oferta unit.", editable: false, valueFormatter: displayMoney, width: 134, minWidth: 114, cellClass: cellClasses("offerUnit", "quick-grid-money quick-grid-result") },
    { field: "offerTotal", headerName: "Oferta total", width: 136, minWidth: 116, cellClass: cellClasses("offerTotal", "quick-grid-money quick-grid-result") },
    { field: "utility", headerName: "Utilidad", width: 132, minWidth: 112, cellClass: cellClasses("utility", "quick-grid-money quick-grid-utility"), editable: false },
    { field: "margin", headerName: "Margen", width: 90, minWidth: 78, cellClass: cellClasses("margin", "quick-grid-number quick-grid-utility"), editable: false },
    { field: "notes", headerName: "Notas", editable: true, flex: 1.2, minWidth: 160, tooltipField: "notes", cellClass: cellClasses("notes", "quick-grid-input") },
    { field: "status", headerName: "Estado", width: 116, minWidth: 96, editable: false, cellClass: cellClasses("status", "quick-grid-status") },
    {
      colId: "detail", headerName: "Acciones", sortable: false, resizable: false, width: 208, minWidth: 208, maxWidth: 208, pinned: "right",
      cellRenderer: (params: { data?: QuickEditRow; node?: { rowIndex: number | null } }) => params.data ? (
        <span className="quick-grid-row-actions" aria-label={`Acciones del ítem ${params.data.item || params.data.index + 1}`}>
          <button type="button" onClick={(event) => { event.stopPropagation(); setAdjustIndex(params.data!.index); }} title="Ajustar precio" aria-label={`Ajustar precio del ítem ${params.data.item || params.data.index + 1}`}><SlidersHorizontal size={16} aria-hidden="true" /></button>
          <QuoteLinkButton links={params.data.quoteLinks} />
          <button type="button" onClick={(event) => { event.stopPropagation(); const api = gridRef.current?.api; const rowIndex = params.node?.rowIndex; if (api && rowIndex !== null && rowIndex !== undefined) { api.ensureColumnVisible("manualUnitCost"); api.startEditingCell({ rowIndex, colKey: "manualUnitCost" }); } }} title="Escribir costo manual" aria-label={`Escribir costo manual del ítem ${params.data.item || params.data.index + 1}`}><PencilLine size={16} aria-hidden="true" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); window.dispatchEvent(new CustomEvent("caf:quote-financial-item", { detail: { itemId: params.data!.itemId } })); }} title="Citar en el chat IA" aria-label={`Citar el ítem ${params.data.item || params.data.index + 1} en el chat IA`}><MessageSquareQuote size={16} aria-hidden="true" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onSearch(params.data!.index); }} title="Buscar precio en Google" aria-label={`Buscar precio del ítem ${params.data.item || params.data.index + 1} en Google`}><Search size={16} aria-hidden="true" /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenDetail(params.data!.index); }} title="Editar datos y fuentes" aria-label={`Editar datos y fuentes del ítem ${params.data.item || params.data.index + 1}`}><PanelRightOpen size={16} aria-hidden="true" /></button>
        </span>
      ) : null,
    },
  ], [cellClasses, selectAxis, onOpenDetail, onSearch, onSelectSource, onToggleAllRows, onToggleRowSelection, rows, selectedRowKeys]);

  const visibleColumnDefs = useMemo(() => columnDefs.map(column => ({ ...column, hide: hiddenColumns.includes(column.colId ?? column.field ?? "") })), [columnDefs, hiddenColumns]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    // Plain text inside an active editor belongs to that editor. Blocks belong to the sheet.
    if (api.getEditingCells().length && !/[\t\r\n]/.test(text)) return;
    if (!api.getEditingCells().length && event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
    const bounds = selectionBounds(activeSelection(api), api);
    if (!bounds) return;
    event.preventDefault(); event.stopPropagation();
    api.stopEditing(true);
    const patches = pasteSheetRange(displayedRows(api), bounds.columns.map(column => column.getColId()), bounds, parseSheetTsv(text));
    if (patches.length) onPatches(patches);
  }, [activeSelection, displayedRows, onPatches, selectionBounds]);

  return (
    <section className={`quick-edit-view ${embedded ? "is-embedded" : ""}`} aria-label="Edicion rapida de variables financieras">
      <div className="quick-edit-header">
        <div>
          <h2>Vista de tabla</h2>
        </div>
        <div className="quick-edit-actions">
          {!embedded ? <div className="work-mode-switch" role="group" aria-label="Modo de trabajo">
            <button type="button" aria-pressed="false" onClick={onBackToSimulator}>Vista de análisis</button>
            <button className="active" type="button" aria-pressed="true">Vista de tabla</button>
          </div> : null}
          {!embedded ? <div className="history-controls" aria-label="Historial y autoguardado">
            <button className="ghost-button undo-redo-button" type="button" onClick={onUndo} disabled={!canUndo} title="Deshacer cambio (Ctrl+Z)" aria-label="Deshacer cambio">↶</button>
            <button className="ghost-button undo-redo-button" type="button" onClick={onRedo} disabled={!canRedo} title="Rehacer cambio (Ctrl+Y)" aria-label="Rehacer cambio">↷</button>
            <span className={`autosave-indicator ${saveStatus}`} title="Guarda pocos segundos después de cada cambio y verifica pendientes cada minuto.">
              {saveStatus === "saving" ? "Guardando..." : saveStatus === "error" ? "Error al guardar" : "Autoguardado"}
            </span>
          </div> : null}
        </div>
      </div>
      <div className="quick-edit-legend" aria-label="Leyenda de la hoja">
        <span className="quick-edit-legend-input">Campo editable</span>
        <span className="quick-edit-legend-result">Resultado calculado</span>
        <span className="quick-edit-legend-choice">Selector de opciones</span>
        <span className="quick-edit-legend-shortcut">Arrastra o usa Shift + flechas. Encabezados: columnas; números: filas. Ctrl+C/V/Z, Supr y Ctrl+D.</span>
      </div>
      {adjustIndex !== null ? (
        <div className="quick-adjust-overlay" role="dialog" aria-modal="true" aria-label={`Ajustar precio del ítem ${rows[adjustIndex]?.item || adjustIndex + 1}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setAdjustIndex(null); }}>
          <div className="quick-adjust-dialog">
            <div className="quick-adjust-heading"><strong>Ajustar precio · ítem {rows[adjustIndex]?.item || adjustIndex + 1}</strong><button type="button" onClick={() => setAdjustIndex(null)} aria-label="Cerrar ajuste"><X size={18} aria-hidden="true" /></button></div>
            {renderOfferAdjustment(adjustIndex)}
          </div>
        </div>
      ) : null}
      <div className="quick-edit-grid-shell" style={{ "--quick-grid-fit": `${(compactRows ? 34 : 46) + Math.max(rows.length, 3) * (compactRows ? 32 : 42) + 20}px` } as CSSProperties} onPasteCapture={handlePaste} onCopyCapture={handleCopy} onKeyDownCapture={handleKeyDown} onMouseDownCapture={handleMouseDown} onMouseOverCapture={handleMouseOver}>
        <AgGridReact<QuickEditRow>
          ref={gridRef}
          theme={cafSheetTheme}
          className="quick-edit-grid"
          rowData={rows}
          columnDefs={visibleColumnDefs}
          getRowId={(params) => params.data.id}
          defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true, headerComponent: SheetHeader, cellClassRules: {
            "quick-grid-selected": params => isCellSelected(params.node.rowIndex, params.column.getColId()),
            "quick-grid-edge-top": params => isSelectionEdge(params.node.rowIndex, params.column.getColId(), "top"),
            "quick-grid-edge-bottom": params => isSelectionEdge(params.node.rowIndex, params.column.getColId(), "bottom"),
            "quick-grid-edge-left": params => isSelectionEdge(params.node.rowIndex, params.column.getColId(), "left"),
            "quick-grid-edge-right": params => isSelectionEdge(params.node.rowIndex, params.column.getColId(), "right"),
          } }}
          animateRows={false}
          rowHeight={compactRows ? 32 : 42}
          headerHeight={compactRows ? 34 : 46}
          singleClickEdit={false}
          stopEditingWhenCellsLoseFocus
          enterNavigatesVertically
          enterNavigatesVerticallyAfterEdit
          ensureDomOrder
          onCellValueChanged={onCellValueChanged}
          onSortChanged={() => updateSelection(null)}
          onColumnMoved={() => updateSelection(null)}
          noRowsOverlayComponent={() => <span>No hay items para editar.</span>}
        />
      </div>
      <div className="table-add-footer">
        <details className="table-add-actions">
          <summary>+ Agregar</summary>
          <div className="table-add-options">
            <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAddRow(); }}>Agregar ítem</button>
            <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onAddGeneralCost(); }}>Agregar costo general</button>
          </div>
        </details>
      </div>
    </section>
  );
}
