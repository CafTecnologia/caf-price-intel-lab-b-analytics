"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import type { MarketAnalysisRun } from "@web/lib/market-analysis-store";
import {
  buildInitialOfferControls,
  buildOfferSimulation,
  formatCop,
  formatNumberEs,
  formatPercent,
  type OfferControl,
  type OfferMode,
} from "@web/lib/financial-simulation";
import { FinancialCompositionBar } from "@web/components/financial-composition-bar";
import { TableWorkspace } from "@web/components/table-workspace";
import {
  type BulkActionScope,
  loadFinancialControls,
  loadSelectedRows,
  saveFinancialControls,
  saveSelectedRows,
} from "@web/lib/offer-controls-storage";
import { compareBySortDirection, type SortState } from "@web/lib/table-sorting";
import type { TrmSnapshot } from "@web/lib/trm-service";

type FinancialSortColumn =
  | "item"
  | "description"
  | "quantity"
  | "costUnit"
  | "referenceUnit"
  | "offerUnit"
  | "offerTotal"
  | "utilityValue"
  | "marginPctOnCost"
  | "maxProfitPctBeforeCeiling"
  | "status";

function statusLabel(status: string): string {
  switch (status) {
    case "viable":
      return "Viable";
    case "tight":
      return "Ajustada";
    case "over_ceiling":
      return "Supera techo";
    case "loss":
      return "Pérdida";
    default:
      return "Incompleta";
  }
}

function modeLabel(mode: OfferMode): string {
  switch (mode) {
    case "discount":
      return "Descuento";
    case "profit":
      return "Rentabilidad";
    default:
      return "Manual";
  }
}

export function FinancialSimulator(props: { run: MarketAnalysisRun; trm: TrmSnapshot; openInNewTabHref?: string }) {
  const [controls, setControls] = useState<Record<string, OfferControl>>(() => buildInitialOfferControls(props.run.result.rows));
  const [usdAmount, setUsdAmount] = useState<string>("");
  const [increasePct, setIncreasePct] = useState<string>("0");
  const [globalDiscountPct, setGlobalDiscountPct] = useState<string>("0");
  const [globalProfitPct, setGlobalProfitPct] = useState<string>("25");
  const [bulkScope, setBulkScope] = useState<BulkActionScope>("all");
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState<FinancialSortColumn>>({
    column: "item",
    direction: "asc",
  });

  useEffect(() => {
    const parsed = loadFinancialControls(props.run.runId);
    if (parsed) {
      setControls((current) => ({
        ...current,
        ...parsed,
      }));
    }
  }, [props.run.runId]);

  useEffect(() => {
    const storedSelection = loadSelectedRows(props.run.runId);
    if (storedSelection) {
      setSelectedRowKeys(storedSelection);
    }
  }, [props.run.runId]);

  useEffect(() => {
    saveFinancialControls(props.run.runId, controls);
  }, [controls, props.run.runId]);

  const simulation = useMemo(() => buildOfferSimulation(props.run.result.rows, controls), [props.run.result.rows, controls]);
  const allRowKeys = useMemo(() => simulation.rows.map((row) => row.rowKey), [simulation.rows]);
  const selectedRowKeySet = useMemo(() => new Set(selectedRowKeys), [selectedRowKeys]);
  const sortedRows = useMemo(() => {
    return simulation.rows.slice().sort((left, right) => {
      const leftValue = left[sort.column];
      const rightValue = right[sort.column];
      return compareBySortDirection(leftValue, rightValue, sort.direction);
    });
  }, [simulation.rows, sort]);
  const usdValue = Number(usdAmount.replace(",", "."));
  const increaseValue = Number(increasePct.replace(",", "."));
  const convertedCop = Number.isFinite(usdValue) ? usdValue * props.trm.value : null;
  const increasedCop = convertedCop !== null && Number.isFinite(increaseValue) ? convertedCop * (1 + increaseValue / 100) : null;

  useEffect(() => {
    setSelectedRowKeys((current) => current.filter((rowKey) => allRowKeys.includes(rowKey)));
  }, [allRowKeys]);

  useEffect(() => {
    saveSelectedRows(props.run.runId, selectedRowKeys);
  }, [props.run.runId, selectedRowKeys]);

  function patchControl(rowKey: string, patch: Partial<OfferControl>) {
    setControls((current) => ({
      ...current,
      [rowKey]: {
        ...current[rowKey],
        ...patch,
      },
    }));
  }

  function getTargetRows(scope: BulkActionScope) {
    return simulation.rows.filter((row) => {
      if (scope === "all") {
        return true;
      }
      if (scope === "over_ceiling") {
        return row.status === "over_ceiling";
      }
      return selectedRowKeySet.has(row.rowKey);
    });
  }

  function toggleRowSelection(rowKey: string) {
    setSelectedRowKeys((current) =>
      current.includes(rowKey) ? current.filter((value) => value !== rowKey) : [...current, rowKey],
    );
  }

  function toggleAllVisibleRows() {
    setSelectedRowKeys((current) => {
      const allVisibleSelected = sortedRows.every((row) => current.includes(row.rowKey));
      if (allVisibleSelected) {
        return current.filter((rowKey) => !sortedRows.some((row) => row.rowKey === rowKey));
      }

      return Array.from(new Set([...current, ...sortedRows.map((row) => row.rowKey)]));
    });
  }

  function selectExceededRows() {
    setSelectedRowKeys((current) =>
      Array.from(new Set([...current, ...simulation.rows.filter((row) => row.status === "over_ceiling").map((row) => row.rowKey)])),
    );
  }

  function selectLowMarginRows() {
    setSelectedRowKeys((current) =>
      Array.from(
        new Set([
          ...current,
          ...simulation.rows
            .filter((row) => row.marginPctOnCost !== null && row.marginPctOnCost >= 0 && row.marginPctOnCost < 10)
            .map((row) => row.rowKey),
        ]),
      ),
    );
  }

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  function applyDiscountToScope() {
    const discountPct = Number(globalDiscountPct.replace(",", ".")) || 0;
    setControls((current) => {
      const next = { ...current };
      for (const row of getTargetRows(bulkScope)) {
        if (row.referenceUnit !== null) {
          next[row.rowKey] = {
            ...next[row.rowKey],
            mode: "discount",
            discountPct,
          };
        }
      }
      return next;
    });
  }

  function applyProfitToScope() {
    const profitPct = Number(globalProfitPct.replace(",", ".")) || 0;
    setControls((current) => {
      const next = { ...current };
      for (const row of getTargetRows(bulkScope)) {
        if (row.costUnit !== null) {
          next[row.rowKey] = {
            ...next[row.rowKey],
            mode: "profit",
            profitPct,
          };
        }
      }
      return next;
    });
  }

  function clampRowsToCeiling() {
    setControls((current) => {
      const next = { ...current };
      for (const row of getTargetRows(bulkScope)) {
        if (row.referenceUnit !== null && (bulkScope !== "over_ceiling" || row.status === "over_ceiling")) {
          next[row.rowKey] = {
            ...next[row.rowKey],
            mode: "manual",
            manualOfferUnit: row.referenceUnit,
          };
        }
      }
      return next;
    });
  }

  function resetAdjustmentsByScope() {
    const defaults = buildInitialOfferControls(props.run.result.rows);
    setControls((current) => {
      if (bulkScope === "all") {
        return defaults;
      }

      const next = { ...current };
      for (const row of getTargetRows(bulkScope)) {
        next[row.rowKey] = defaults[row.rowKey];
      }
      return next;
    });
  }

  async function downloadSimulation(format: "json" | "csv" | "xlsx") {
    const rows = simulation.rows.map((row) => ({
      item: row.item,
      description: row.description,
      quantity: row.quantity,
      costUnit: row.costUnit,
      referenceUnit: row.referenceUnit,
      offerUnit: row.offerUnit,
      offerTotal: row.offerTotal,
      utilityValue: row.utilityValue,
      marginPctOnCost: row.marginPctOnCost,
      maxProfitPctBeforeCeiling: row.maxProfitPctBeforeCeiling,
      discountPctVsReference: row.discountPctVsReference,
      status: row.status,
      warnings: row.warnings.join(" "),
      sourceNotes: row.sourceNotes,
    }));

    if (format === "json") {
      const blob = new Blob([JSON.stringify({ summary: simulation.summary, rows }, null, 2)], { type: "application/json" });
      triggerDownload(blob, `${props.run.fileName}.financial-simulation.json`);
      return;
    }

    if (format === "csv") {
      const headers = Object.keys(rows[0] ?? {});
      const csv = [
        headers.join(","),
        ...rows.map((row) =>
          headers
            .map((header) => {
              const value = row[header as keyof (typeof rows)[number]];
              const text = value === null || value === undefined ? "" : String(value);
              return `"${text.replace(/"/g, '""')}"`;
            })
            .join(","),
        ),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      triggerDownload(blob, `${props.run.fileName}.financial-simulation.csv`);
      return;
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Oferta");
    const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const blob = new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    triggerDownload(blob, `${props.run.fileName}.financial-simulation.xlsx`);
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Decisión financiera</div>
            <h2>Simulador de oferta</h2>
            <p className="muted small">
              Ajusta cada ítem por descuento, rentabilidad o valor manual y vigila techo, margen y riesgo en tiempo real.
            </p>
          </div>
        </div>

        <div className="financial-overview">
          <div className="utility-strip">
            <div className="utility-chip">
              <span className="metric-label">TRM hoy</span>
              <strong>{formatCop(props.trm.value)}</strong>
              <div className="muted small">{props.trm.date}</div>
            </div>

            <details className="utility-drawer">
              <summary className="utility-summary">
                <div>
                  <span className="metric-label">Calculadora rápida</span>
                  <strong>Conversor USD → COP</strong>
                </div>
                <span className="muted small">Abrir</span>
              </summary>

              <div className="utility-drawer-content">
                <div className="grid two">
                  <label className="field">
                    <span>Valor en USD</span>
                    <input value={usdAmount} onChange={(event) => setUsdAmount(event.target.value)} placeholder="0" inputMode="decimal" />
                  </label>
                  <label className="field">
                    <span>Aumento % sobre el resultado</span>
                    <input
                      value={increasePct}
                      onChange={(event) => setIncreasePct(event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <div className="metric-grid compact">
                  <div className="metric-card">
                    <span className="metric-label">COP base</span>
                    <strong>{formatCop(convertedCop)}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">COP con aumento</span>
                    <strong>{formatCop(increasedCop)}</strong>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <div className="financial-priority-grid">
            <div className="metric-card metric-card-highlight metric-card-reference">
              <span className="metric-label">Presupuesto oficial techo</span>
              <strong>{formatCop(simulation.summary.totalReference)}</strong>
              <div className="muted small">Valor total de referencia para no perder el norte de la entidad.</div>
            </div>
            <div className="metric-card metric-card-highlight metric-card-offer">
              <span className="metric-label">Oferta a presentar</span>
              <strong>{formatCop(simulation.summary.totalOffer)}</strong>
              <div className="muted small">Valor total que estás construyendo con los ajustes del simulador.</div>
            </div>
          </div>

          <FinancialCompositionBar
            title="Composición de la oferta"
            totalLabel="Oferta a presentar"
            totalValue={simulation.summary.totalOffer}
            costValue={simulation.summary.totalCost}
            utilityValue={simulation.summary.totalMargin}
            note="La barra es la referencia principal: muestra cuánto del total ofertado es costo y cuánto utilidad."
            showFooter={false}
          />

          <div className="metric-grid finance-summary">
            <div className="metric-card">
              <span className="metric-label">Utilidad total</span>
              <strong>{formatCop(simulation.summary.totalMargin)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Margen global</span>
              <strong>{formatPercent(simulation.summary.marginPctOnCost)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Oferta vs techo</span>
              <strong>{formatPercent(simulation.summary.offerVsReferencePct)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Descuento global</span>
              <strong>{formatPercent(simulation.summary.discountPctVsReference)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Filas superando techo</span>
              <strong>{formatNumberEs(simulation.summary.overCeilingCount)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Filas en pérdida</span>
              <strong>{formatNumberEs(simulation.summary.lossCount)}</strong>
            </div>
          </div>
        </div>

      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Oferta por ítem</h2>
            <p className="muted small">La fila cambia según el modo que elijas: descuento, rentabilidad o precio manual.</p>
          </div>
          <div className="actions-row">
            <Link href={`/market-analysis/${props.run.runId}/offer`} className="primary-button link-button">
              Oferta económica a presentar
            </Link>
            <button type="button" className="primary-button" onClick={() => void downloadSimulation("xlsx")}>
              Descargar simulación XLSX
            </button>
            <button type="button" className="secondary-button" onClick={() => void downloadSimulation("csv")}>
              Descargar simulación CSV
            </button>
            <button type="button" className="secondary-button" onClick={() => void downloadSimulation("json")}>
              Descargar simulación JSON
            </button>
          </div>
        </div>

        <div className="selection-summary muted small">
          {selectedRowKeys.length} fila(s) seleccionadas. Puedes aplicar acciones a todo, solo excedidos o solo seleccionados.
        </div>

        <TableWorkspace openInNewTabHref={props.openInNewTabHref}>
          <table className="data-table financial-table">
            <thead>
              <tr>
                <th className="selection-column">
                  <input
                    type="checkbox"
                    checked={sortedRows.length > 0 && sortedRows.every((row) => selectedRowKeySet.has(row.rowKey))}
                    onChange={() => toggleAllVisibleRows()}
                    aria-label="Seleccionar filas visibles"
                  />
                </th>
                <SortableHeader label="Ítem" column="item" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Descripción" column="description" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Cant" column="quantity" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Costo UNIT" column="costUnit" sort={sort} onSortChange={setSort} />
                <SortableHeader
                  label="Techo UNIT"
                  column="referenceUnit"
                  sort={sort}
                  onSortChange={setSort}
                  actions={
                    <HeaderActionMenu title="Acciones de techo">
                      <ScopePicker value={bulkScope} onChange={setBulkScope} />
                      <button type="button" className="secondary-button" onClick={clampRowsToCeiling}>
                        Ajustar al techo en alcance
                      </button>
                    </HeaderActionMenu>
                  }
                />
                <th>Modo</th>
                <th>
                  <div className="header-stack">
                    <span>Ajuste</span>
                    <HeaderActionMenu title="Acciones de ajuste">
                      <ScopePicker value={bulkScope} onChange={setBulkScope} />
                      <label className="field inline-field compact-field">
                        <span>Descuento global %</span>
                        <input value={globalDiscountPct} onChange={(event) => setGlobalDiscountPct(event.target.value)} inputMode="decimal" />
                      </label>
                      <button type="button" className="secondary-button" onClick={applyDiscountToScope}>
                        Aplicar descuento al alcance
                      </button>
                      <label className="field inline-field compact-field">
                        <span>Rentabilidad global %</span>
                        <input value={globalProfitPct} onChange={(event) => setGlobalProfitPct(event.target.value)} inputMode="decimal" />
                      </label>
                      <button type="button" className="secondary-button" onClick={applyProfitToScope}>
                        Aplicar rentabilidad al alcance
                      </button>
                      <button type="button" className="secondary-button" onClick={resetAdjustmentsByScope}>
                        Restablecer ajustes del alcance
                      </button>
                    </HeaderActionMenu>
                  </div>
                </th>
                <SortableHeader label="Oferta UNIT" column="offerUnit" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Oferta TOTAL" column="offerTotal" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Utilidad $" column="utilityValue" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Margen" column="marginPctOnCost" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Máx subir" column="maxProfitPctBeforeCeiling" sort={sort} onSortChange={setSort} />
                <SortableHeader
                  label="Estado"
                  column="status"
                  sort={sort}
                  onSortChange={setSort}
                  actions={
                    <HeaderActionMenu title="Selección inteligente">
                      <button type="button" className="secondary-button" onClick={selectExceededRows}>
                        Seleccionar excedidos
                      </button>
                      <button type="button" className="secondary-button" onClick={selectLowMarginRows}>
                        Seleccionar margen bajo
                      </button>
                      <button type="button" className="secondary-button" onClick={clearSelection}>
                        Limpiar selección
                      </button>
                    </HeaderActionMenu>
                  }
                />
                <th>Alertas</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.rowKey} className={selectedRowKeySet.has(row.rowKey) ? "row-selected" : undefined}>
                  <td className="selection-column">
                    <input
                      type="checkbox"
                      checked={selectedRowKeySet.has(row.rowKey)}
                      onChange={() => toggleRowSelection(row.rowKey)}
                      aria-label={`Seleccionar ítem ${row.item || row.rowKey}`}
                    />
                  </td>
                  <td>{row.item || "N/D"}</td>
                  <td className="evidence-cell">
                    <strong>{row.description || "Sin descripción"}</strong>
                    {row.technicalDescription ? <div className="muted small">{row.technicalDescription}</div> : null}
                  </td>
                  <td>{formatNumberEs(row.quantity)}</td>
                  <td>{formatCop(row.costUnit)}</td>
                  <td>{formatCop(row.referenceUnit)}</td>
                  <td>
                    <label className="field">
                      <span className="visually-hidden">Modo</span>
                      <select
                        value={row.control.mode}
                        onChange={(event) =>
                          patchControl(row.rowKey, {
                            mode: event.target.value as OfferMode,
                          })
                        }
                      >
                        <option value="discount">Descuento</option>
                        <option value="profit">Rentabilidad</option>
                        <option value="manual">Manual</option>
                      </select>
                    </label>
                    <div className="muted small">{modeLabel(row.control.mode)}</div>
                  </td>
                  <td>
                    {row.control.mode === "discount" ? (
                      <div className="stack tight">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="0.5"
                          value={row.control.discountPct}
                          onChange={(event) => patchControl(row.rowKey, { discountPct: Number(event.target.value) })}
                        />
                        <input
                          value={String(row.control.discountPct)}
                          onChange={(event) => patchControl(row.rowKey, { discountPct: Number(event.target.value.replace(",", ".")) || 0 })}
                          inputMode="decimal"
                        />
                        <div className="muted small">Descuento: {formatPercent(row.control.discountPct)}</div>
                      </div>
                    ) : null}

                    {row.control.mode === "profit" ? (
                      <div className="stack tight">
                        <input
                          type="range"
                          min="-50"
                          max={Math.max(200, Math.ceil((row.maxProfitPctBeforeCeiling ?? 50) + 20))}
                          step="0.5"
                          value={row.control.profitPct}
                          onChange={(event) => patchControl(row.rowKey, { profitPct: Number(event.target.value) })}
                        />
                        <input
                          value={String(row.control.profitPct)}
                          onChange={(event) => patchControl(row.rowKey, { profitPct: Number(event.target.value.replace(",", ".")) || 0 })}
                          inputMode="decimal"
                        />
                        <div className="muted small">Rentabilidad: {formatPercent(row.control.profitPct)}</div>
                      </div>
                    ) : null}

                    {row.control.mode === "manual" ? (
                      <div className="stack tight">
                        <input
                          value={row.control.manualOfferUnit === null ? "" : String(row.control.manualOfferUnit)}
                          onChange={(event) =>
                            patchControl(row.rowKey, {
                              manualOfferUnit: event.target.value.trim() ? Number(event.target.value.replace(",", ".")) : null,
                            })
                          }
                          inputMode="decimal"
                        />
                        <div className="muted small">Precio unitario manual.</div>
                      </div>
                    ) : null}
                  </td>
                  <td>{formatCop(row.offerUnit)}</td>
                  <td>{formatCop(row.offerTotal)}</td>
                  <td>{formatCop(row.utilityValue)}</td>
                  <td>{formatPercent(row.marginPctOnCost)}</td>
                  <td>{formatPercent(row.maxProfitPctBeforeCeiling)}</td>
                  <td>
                    <span className={`status-pill status-${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                  <td className="evidence-cell">{row.warnings.length > 0 ? row.warnings.join(" ") : "Sin alertas."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWorkspace>
      </section>
    </div>
  );
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function SortableHeader(props: {
  label: string;
  column: FinancialSortColumn;
  sort: SortState<FinancialSortColumn>;
  onSortChange: (next: SortState<FinancialSortColumn>) => void;
  actions?: ReactNode;
}) {
  const active = props.sort.column === props.column;
  const symbol = active ? (props.sort.direction === "asc" ? "↑" : "↓") : "↕";

  return (
    <th>
      <div className="header-stack">
        <button
          type="button"
          className={`sort-button ${active ? "sort-button-active" : ""}`}
          onClick={() =>
            props.onSortChange({
              column: props.column,
              direction: active && props.sort.direction === "asc" ? "desc" : "asc",
            })
          }
        >
          {props.label} <span>{symbol}</span>
        </button>
        {props.actions}
      </div>
    </th>
  );
}

function HeaderActionMenu(props: { title: string; children: ReactNode }) {
  return (
    <details className="header-menu">
      <summary className="header-menu-trigger" aria-label={props.title}>
        ...
      </summary>
      <div className="header-menu-content">{props.children}</div>
    </details>
  );
}

function ScopePicker(props: { value: BulkActionScope; onChange: (next: BulkActionScope) => void }) {
  return (
    <label className="field inline-field compact-field">
      <span>Aplicar a</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value as BulkActionScope)}>
        <option value="all">Todo el lote</option>
        <option value="over_ceiling">Solo excedidos</option>
        <option value="selected">Solo seleccionados</option>
      </select>
    </label>
  );
}
