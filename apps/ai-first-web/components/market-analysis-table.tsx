"use client";

import { useMemo, useState } from "react";

import type { MarketAnalysisRun } from "@web/lib/market-analysis-store";
import { MARKET_ANALYSIS_COLUMNS, type MarketAnalysisColumn } from "@web/lib/market-analysis-schema";
import { compareBySortDirection, type SortState } from "@web/lib/table-sorting";
import { TableWorkspace } from "@web/components/table-workspace";

export function MarketAnalysisTable(props: { run: MarketAnalysisRun; openInNewTabHref?: string }) {
  const [sort, setSort] = useState<SortState<MarketAnalysisColumn>>({
    column: "Ítem",
    direction: "asc",
  });

  const sortedRows = useMemo(() => {
    return props.run.result.rows.slice().sort((left, right) => {
      return compareBySortDirection(left[sort.column], right[sort.column], sort.direction);
    });
  }, [props.run.result.rows, sort]);

  return (
    <TableWorkspace openInNewTabHref={props.openInNewTabHref}>
      <table className="data-table market-table">
        <thead>
          <tr>
            {MARKET_ANALYSIS_COLUMNS.map((column) => (
              <th key={column}>
                <button
                  type="button"
                  className={`sort-button ${sort.column === column ? "sort-button-active" : ""}`}
                  onClick={() =>
                    setSort({
                      column,
                      direction: sort.column === column && sort.direction === "asc" ? "desc" : "asc",
                    })
                  }
                >
                  {column} <span>{sort.column === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr key={`${row["Ítem"] || "row"}-${index}`}>
              {MARKET_ANALYSIS_COLUMNS.map((column) => (
                <td key={column} className={column.includes("Descripción") || column.includes("Resumen") ? "evidence-cell" : undefined}>
                  {row[column] || "N/D"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWorkspace>
  );
}
