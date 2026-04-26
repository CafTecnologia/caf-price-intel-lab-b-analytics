"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  buildInitialOfferControls,
  buildOfferSimulation,
  formatCop,
  formatNumberEs,
  type OfferControl,
} from "@web/lib/financial-simulation";
import type { MarketAnalysisRun } from "@web/lib/market-analysis-store";
import { FinancialCompositionBar } from "@web/components/financial-composition-bar";
import { buildOfferPresentation, type OfferPresentationRow } from "@web/lib/offer-presentation";
import { TableWorkspace } from "@web/components/table-workspace";
import {
  type BulkActionScope,
  loadFinancialControls,
  loadSelectedRows,
  loadVatControls,
  saveFinancialControls,
  saveSelectedRows,
  saveVatControls,
  type VatControl,
} from "@web/lib/offer-controls-storage";
import { compareBySortDirection, type SortState } from "@web/lib/table-sorting";

type OfferSortColumn =
  | "item"
  | "description"
  | "unitPriceWithoutVat"
  | "vatUnitValue"
  | "unitPriceWithVat"
  | "totalWithoutVat"
  | "totalWithVat"
  | "utilityValue"
  | "status";

function statusText(status: OfferPresentationRow["status"]) {
  switch (status) {
    case "within_ceiling":
      return "Dentro del techo";
    case "above_ceiling":
      return "Supera techo";
    default:
      return "Sin techo";
  }
}

export function OfferPresentationTable(props: { run: MarketAnalysisRun; openInNewTabHref?: string }) {
  const [controls, setControls] = useState<Record<string, OfferControl>>(() => buildInitialOfferControls(props.run.result.rows));
  const [vatControls, setVatControls] = useState<Record<string, VatControl>>({});
  const [sort, setSort] = useState<SortState<OfferSortColumn>>({
    column: "item",
    direction: "asc",
  });
  const [globalVatRate, setGlobalVatRate] = useState<string>("19");
  const [bulkScope, setBulkScope] = useState<BulkActionScope>("all");
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  useEffect(() => {
    const loadedControls = loadFinancialControls(props.run.runId);
    if (loadedControls) {
      setControls((current) => ({ ...current, ...loadedControls }));
    }
  }, [props.run.runId]);

  useEffect(() => {
    const storedSelection = loadSelectedRows(props.run.runId);
    if (storedSelection) {
      setSelectedRowKeys(storedSelection);
    }
  }, [props.run.runId]);

  const simulation = useMemo(() => buildOfferSimulation(props.run.result.rows, controls), [props.run.result.rows, controls]);
  const offerRowKeys = useMemo(() => simulation.rows.map((row) => row.rowKey), [simulation.rows]);
  const selectedRowKeySet = useMemo(() => new Set(selectedRowKeys), [selectedRowKeys]);

  useEffect(() => {
    const defaults = Object.fromEntries(
      offerRowKeys.map((rowKey) => [
        rowKey,
        {
          applies: true,
          ratePct: 19,
        },
      ]),
    );
    const loadedVatControls = loadVatControls(props.run.runId);
    setVatControls(loadedVatControls ? { ...defaults, ...loadedVatControls } : defaults);
  }, [props.run.runId, offerRowKeys]);

  useEffect(() => {
    saveFinancialControls(props.run.runId, controls);
  }, [controls, props.run.runId]);

  useEffect(() => {
    setSelectedRowKeys((current) => current.filter((rowKey) => offerRowKeys.includes(rowKey)));
  }, [offerRowKeys]);

  useEffect(() => {
    saveSelectedRows(props.run.runId, selectedRowKeys);
  }, [props.run.runId, selectedRowKeys]);

  useEffect(() => {
    if (Object.keys(vatControls).length > 0) {
      saveVatControls(props.run.runId, vatControls);
    }
  }, [vatControls, props.run.runId]);

  const offerPresentation = useMemo(() => buildOfferPresentation(simulation, vatControls), [simulation, vatControls]);
  const sortedRows = useMemo(() => {
    return offerPresentation.rows.slice().sort((left, right) => {
      return compareBySortDirection(left[sort.column], right[sort.column], sort.direction);
    });
  }, [offerPresentation.rows, sort]);

  function patchVatControl(rowKey: string, patch: Partial<VatControl>) {
    setVatControls((current) => ({
      ...current,
      [rowKey]: { ...(current[rowKey] ?? { applies: true, ratePct: 19 }), ...patch },
    }));
  }

  function getTargetRows(scope: BulkActionScope) {
    return offerPresentation.rows.filter((row) => {
      if (scope === "all") {
        return true;
      }
      if (scope === "over_ceiling") {
        return row.status === "above_ceiling";
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
      Array.from(new Set([...current, ...offerPresentation.rows.filter((row) => row.status === "above_ceiling").map((row) => row.rowKey)])),
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

  function applyVatToAll(applies: boolean, ratePct = Number(globalVatRate.replace(",", ".")) || 19) {
    setVatControls((current) => {
      const next = { ...current };
      for (const row of getTargetRows(bulkScope)) {
        next[row.rowKey] = {
          ...(next[row.rowKey] ?? { applies: true, ratePct: 19 }),
          applies,
          ratePct,
        };
      }
      return next;
    });
  }

  function clampRowToCeiling(rowKey: string, referenceUnit: number | null) {
    if (referenceUnit === null) {
      return;
    }

    setControls((current) => ({
      ...current,
      [rowKey]: {
        ...current[rowKey],
        mode: "manual",
        manualOfferUnit: referenceUnit,
      },
    }));
  }

  function clampAllToCeiling() {
    setControls((current) => {
      const next = { ...current };
      for (const row of getTargetRows(bulkScope)) {
        if (row.referenceUnit !== null && (bulkScope !== "over_ceiling" || row.status === "above_ceiling")) {
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

  async function downloadOffer(format: "json" | "csv" | "xlsx") {
    const exportRows = sortedRows.map((row) => ({
      item: row.item,
      description: row.description,
      technicalDescription: row.technicalDescription,
      unitPriceWithoutVat: row.unitPriceWithoutVat,
      vatApplies: row.vatApplies ? "Sí" : "No",
      vatRatePct: row.vatApplies ? row.vatRatePct : 0,
      vatUnitValue: row.vatUnitValue,
      unitPriceWithVat: row.unitPriceWithVat,
      totalWithoutVat: row.totalWithoutVat,
      totalWithVat: row.totalWithVat,
      utilityValue: row.utilityValue,
      ceilingStatus: statusText(row.status),
      warnings: row.warnings.join(" "),
    }));

    if (format === "json") {
      triggerDownload(
        new Blob([JSON.stringify({ summary: offerPresentation.summary, rows: exportRows }, null, 2)], { type: "application/json" }),
        `${props.run.fileName}.oferta-economica.json`,
      );
      return;
    }

    if (format === "csv") {
      const headers = Object.keys(exportRows[0] ?? {});
      const csv = [
        headers.join(","),
        ...exportRows.map((row) =>
          headers
            .map((header) => {
              const value = row[header as keyof (typeof row)];
              const text = value === null || value === undefined ? "" : String(value);
              return `"${text.replace(/"/g, '""')}"`;
            })
            .join(","),
        ),
      ].join("\n");
      triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${props.run.fileName}.oferta-economica.csv`);
      return;
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Oferta económica");
    const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    triggerDownload(
      new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${props.run.fileName}.oferta-economica.xlsx`,
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Oferta final</div>
            <h2>Oferta económica a presentar</h2>
            <p className="muted small">
              Esta vista toma la oferta viva del simulador, añade IVA cuando aplique y te protege contra precios por encima del techo.
            </p>
          </div>
          <div className="actions-row">
            <Link href={`/market-analysis/${props.run.runId}/financial`} className="secondary-button link-button">
              Volver al simulador
            </Link>
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Total de costos del proyecto</span>
            <strong>{formatCop(offerPresentation.summary.totalProjectCost)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Total oferta sin IVA</span>
            <strong>{formatCop(offerPresentation.summary.totalOfferWithoutVat)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Total IVA</span>
            <strong>{formatCop(offerPresentation.summary.totalVat)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Total de la oferta</span>
            <strong>{formatCop(offerPresentation.summary.totalOfferWithVat)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Utilidad estimada</span>
            <strong>{formatCop(offerPresentation.summary.estimatedUtility)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ítems superando techo</span>
            <strong>{formatNumberEs(offerPresentation.summary.rowsAboveCeiling)}</strong>
          </div>
        </div>

        <FinancialCompositionBar
          title="Composición económica de la oferta"
          totalLabel="Oferta total con IVA"
          totalValue={offerPresentation.summary.totalOfferWithVat}
          costValue={offerPresentation.summary.totalProjectCost}
          utilityValue={offerPresentation.summary.estimatedUtility}
          note="La utilidad compara la oferta final con IVA contra el costo total del proyecto, porque la base de costos se asume con IVA incluido."
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Tabla de presentación</h2>
            <p className="muted small">Ordena cualquier columna y exporta la tabla exactamente como la estés viendo.</p>
          </div>
          <div className="actions-row">
            <button type="button" className="primary-button" onClick={() => void downloadOffer("xlsx")}>
              Descargar XLSX
            </button>
            <button type="button" className="secondary-button" onClick={() => void downloadOffer("csv")}>
              Descargar CSV
            </button>
            <button type="button" className="secondary-button" onClick={() => void downloadOffer("json")}>
              Descargar JSON
            </button>
          </div>
        </div>

        <div className="selection-summary muted small">
          {selectedRowKeys.length} fila(s) seleccionadas. Las acciones del menú pueden aplicarse a todo, solo excedidos o solo seleccionados.
        </div>

        <TableWorkspace openInNewTabHref={props.openInNewTabHref}>
          <table className="data-table offer-table">
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
                <th>Ficha técnica</th>
                <SortableHeader label="Precio unitario sin IVA" column="unitPriceWithoutVat" sort={sort} onSortChange={setSort} />
                <SortableHeader
                  label="Valor del IVA"
                  column="vatUnitValue"
                  sort={sort}
                  onSortChange={setSort}
                  actions={
                    <HeaderActionMenu title="Acciones de IVA">
                      <ScopePicker value={bulkScope} onChange={setBulkScope} />
                      <label className="field inline-field compact-field">
                        <span>IVA global %</span>
                        <input value={globalVatRate} onChange={(event) => setGlobalVatRate(event.target.value)} inputMode="decimal" />
                      </label>
                      <button type="button" className="secondary-button" onClick={() => applyVatToAll(true)}>
                        Activar IVA a todo
                      </button>
                      <button type="button" className="secondary-button" onClick={() => applyVatToAll(false)}>
                        Quitar IVA a todo
                      </button>
                    </HeaderActionMenu>
                  }
                />
                <SortableHeader label="Valor unitario con IVA" column="unitPriceWithVat" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Valor total sin IVA" column="totalWithoutVat" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Valor total con IVA" column="totalWithVat" sort={sort} onSortChange={setSort} />
                <SortableHeader label="Utilidad $" column="utilityValue" sort={sort} onSortChange={setSort} />
                <SortableHeader
                  label="Control de techo"
                  column="status"
                  sort={sort}
                  onSortChange={setSort}
                  actions={
                    <HeaderActionMenu title="Acciones de techo">
                      <ScopePicker value={bulkScope} onChange={setBulkScope} />
                      <button type="button" className="secondary-button" onClick={clampAllToCeiling}>
                        Ajustar al techo en alcance
                      </button>
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
                <th>Acción</th>
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
                  <td className="evidence-cell">{row.description || "Sin descripción"}</td>
                  <td className="evidence-cell">{row.technicalDescription || "N/D"}</td>
                  <td>{formatCop(row.unitPriceWithoutVat)}</td>
                  <td>
                    <div>{formatCop(row.vatUnitValue)}</div>
                    <div className="stack tight offer-inline-controls">
                      <label className="toggle-chip">
                        <input
                          type="checkbox"
                          checked={row.vatApplies}
                          onChange={(event) => patchVatControl(row.rowKey, { applies: event.target.checked })}
                        />
                        <span>IVA</span>
                      </label>
                      <input
                        value={String(row.vatRatePct)}
                        onChange={(event) =>
                          patchVatControl(row.rowKey, {
                            ratePct: Number(event.target.value.replace(",", ".")) || 0,
                          })
                        }
                        inputMode="decimal"
                        disabled={!row.vatApplies}
                      />
                    </div>
                  </td>
                  <td>{formatCop(row.unitPriceWithVat)}</td>
                  <td>{formatCop(row.totalWithoutVat)}</td>
                  <td>{formatCop(row.totalWithVat)}</td>
                  <td>{formatCop(row.utilityValue)}</td>
                  <td>
                    <span className={`status-pill ${statusClass(row.status)}`}>{statusText(row.status)}</span>
                  </td>
                  <td className="evidence-cell">
                    {row.status === "above_ceiling" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => clampRowToCeiling(row.rowKey, row.referenceUnit)}
                      >
                        Ajustar al techo
                      </button>
                    ) : (
                      <span className="muted small">{row.warnings[0] ?? "Sin acción."}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWorkspace>
      </section>
    </div>
  );
}

function statusClass(status: OfferPresentationRow["status"]) {
  switch (status) {
    case "within_ceiling":
      return "status-viable";
    case "above_ceiling":
      return "status-over_ceiling";
    default:
      return "status-tight";
  }
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
  column: OfferSortColumn;
  sort: SortState<OfferSortColumn>;
  onSortChange: (next: SortState<OfferSortColumn>) => void;
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
