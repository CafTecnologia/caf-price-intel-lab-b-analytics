import { describe, expect, it } from "vitest";

import type { NormalizedItem } from "../../ai-first-contracts/src/schemas/item";

import { normalizeSequentialItemNumbers } from "../src/document/item-label-utils";

function buildItem(numeroItem: string, unit: string | null = "UND"): NormalizedItem {
  return {
    item_uid: `test:${numeroItem}`,
    numero_item: numeroItem,
    nombre_o_descripcion: `Item ${numeroItem}`,
    ficha_tecnica: null,
    cantidad: 1,
    unidad_medida: unit,
    precio_referencia_unit: 100,
    precio_referencia_total: 100,
    moneda: "COP",
    raw_text_evidence: `${numeroItem} | Item ${numeroItem} | 1 | ${unit ?? ""} | 100 | 100 | COP`,
    source_location: {
      primary_locator: {
        page: null,
        sheet: "Items",
        table: "Items",
        row_start: 1,
        row_end: 1,
        cell_range: null,
        paragraph_index: null,
        char_start: null,
        char_end: null,
        note: "synthetic",
      },
      source_range: {
        start_segment_id: "seg-1",
        end_segment_id: "seg-1",
        start_segment_index: 0,
        end_segment_index: 0,
        label: "segments 0-0",
      },
      segment_ids: ["seg-1"],
    },
    extraction_mode: "extracted_directly",
    warnings: [],
    confidence: 0.8,
  };
}

describe("normalizeSequentialItemNumbers", () => {
  it("normalizes OCR-like item labels using sequence continuity", () => {
    const normalized = normalizeSequentialItemNumbers([
      buildItem("8"),
      buildItem("G"),
      buildItem("10"),
      buildItem("18"),
      buildItem("1G"),
      buildItem("20"),
      buildItem("28"),
      buildItem("2G"),
      buildItem("30"),
    ]);

    expect(normalized.map((item) => item.numero_item)).toEqual(["8", "9", "10", "18", "19", "20", "28", "29", "30"]);
    expect(normalized[1].warnings.some((warning) => warning.includes("'G'") && warning.includes("'9'"))).toBe(true);
    expect(normalized[4].warnings.some((warning) => warning.includes("'1G'") && warning.includes("'19'"))).toBe(true);
    expect(normalized[7].warnings.some((warning) => warning.includes("'2G'") && warning.includes("'29'"))).toBe(true);
  });

  it("converts null-like string values to real nulls without changing solid numeric labels", () => {
    const normalized = normalizeSequentialItemNumbers([buildItem("22", "null"), buildItem("23", "UND")]);

    expect(normalized[0].numero_item).toBe("22");
    expect(normalized[0].unidad_medida).toBeNull();
    expect(normalized[1].unidad_medida).toBe("UND");
  });
});
