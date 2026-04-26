"use client";

import { useState } from "react";

import type { DocumentResult } from "@ai-first-contracts/schemas/document";

const COLUMN_DEFS = [
  { key: "numero_item", label: "Item" },
  { key: "nombre_o_descripcion", label: "Description" },
  { key: "cantidad", label: "Qty" },
  { key: "unidad_medida", label: "Unit" },
  { key: "precio_referencia_unit", label: "Unit Price" },
  { key: "precio_referencia_total", label: "Total Price" },
  { key: "moneda", label: "Currency" },
  { key: "extraction_mode", label: "Mode" },
  { key: "confidence", label: "Confidence" },
  { key: "raw_text_evidence", label: "Evidence" },
  { key: "source_location", label: "Source" },
  { key: "warnings", label: "Warnings" },
] as const;

type ColumnKey = (typeof COLUMN_DEFS)[number]["key"];

const DEFAULT_COLUMNS: ColumnKey[] = [
  "numero_item",
  "nombre_o_descripcion",
  "cantidad",
  "unidad_medida",
  "precio_referencia_unit",
  "precio_referencia_total",
  "moneda",
  "confidence",
  "raw_text_evidence",
  "source_location",
  "warnings",
];

export function ResultsTable(props: { items: DocumentResult["items"] }) {
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);

  function toggleColumn(columnKey: ColumnKey) {
    setVisibleColumns((current) =>
      current.includes(columnKey) ? current.filter((value) => value !== columnKey) : [...current, columnKey],
    );
  }

  return (
    <div className="stack">
      <div className="column-toggle-grid">
        {COLUMN_DEFS.map((column) => (
          <label key={column.key} className="toggle-chip">
            <input
              type="checkbox"
              checked={visibleColumns.includes(column.key)}
              onChange={() => toggleColumn(column.key)}
            />
            <span>{column.label}</span>
          </label>
        ))}
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMN_DEFS.filter((column) => visibleColumns.includes(column.key)).map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => (
              <tr key={item.item_uid}>
                {visibleColumns.includes("numero_item") ? <td>{item.numero_item ?? "-"}</td> : null}
                {visibleColumns.includes("nombre_o_descripcion") ? <td>{item.nombre_o_descripcion ?? "-"}</td> : null}
                {visibleColumns.includes("cantidad") ? <td>{item.cantidad ?? "-"}</td> : null}
                {visibleColumns.includes("unidad_medida") ? <td>{item.unidad_medida ?? "-"}</td> : null}
                {visibleColumns.includes("precio_referencia_unit") ? <td>{item.precio_referencia_unit ?? "-"}</td> : null}
                {visibleColumns.includes("precio_referencia_total") ? <td>{item.precio_referencia_total ?? "-"}</td> : null}
                {visibleColumns.includes("moneda") ? <td>{item.moneda ?? "-"}</td> : null}
                {visibleColumns.includes("extraction_mode") ? <td>{item.extraction_mode}</td> : null}
                {visibleColumns.includes("confidence") ? <td>{item.confidence.toFixed(2)}</td> : null}
                {visibleColumns.includes("raw_text_evidence") ? (
                  <td className="evidence-cell">{item.raw_text_evidence ?? "-"}</td>
                ) : null}
                {visibleColumns.includes("source_location") ? <td>{item.source_location.source_range.label}</td> : null}
                {visibleColumns.includes("warnings") ? <td>{item.warnings.join(" | ") || "-"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
