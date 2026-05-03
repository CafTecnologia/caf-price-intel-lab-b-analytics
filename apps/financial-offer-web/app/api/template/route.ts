import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { normalizeImportPayload, sampleImportPayload } from "@offer/lib/contract";

const sample = normalizeImportPayload(sampleImportPayload());

const rows = sample.items.map((item) => {
  const source1 = item.price_sources[0];
  const source2 = item.price_sources[1];
  const source3 = item.price_sources[2];

  return {
    item: item.item,
    description: item.description,
    technical_description: item.technical_description,
    quantity: item.quantity ?? "",
    unit: item.unit,
    reference_unit: item.reference_unit ?? "",
    manual_unit_cost: item.manual_unit_cost ?? "",
    selected_cost_mode: item.selected_cost_mode,
    offer_mode: item.offer_mode ?? "",
    discount_pct: item.discount_pct ?? "",
    profit_pct: item.profit_pct ?? "",
    manual_offer_unit: item.manual_offer_unit ?? "",
    vat_mode: item.vat_mode,
    vat_rate: item.vat_rate ?? "",
    source_1_name: source1?.name ?? source1?.provider ?? source1?.source ?? "",
    source_1_price: source1?.unit_price ?? source1?.price ?? "",
    source_1_currency: source1?.currency ?? "COP",
    source_1_url: source1?.url ?? "",
    source_1_trm: source1?.trm ?? "",
    source_1_import_pct: source1?.import_pct ?? "",
    source_2_name: source2?.name ?? source2?.provider ?? source2?.source ?? "",
    source_2_price: source2?.unit_price ?? source2?.price ?? "",
    source_2_currency: source2?.currency ?? "COP",
    source_2_url: source2?.url ?? "",
    source_2_trm: source2?.trm ?? "",
    source_2_import_pct: source2?.import_pct ?? "",
    source_3_name: source3?.name ?? source3?.provider ?? source3?.source ?? "",
    source_3_price: source3?.unit_price ?? source3?.price ?? "",
    source_3_currency: source3?.currency ?? "COP",
    source_3_url: source3?.url ?? "",
    source_3_trm: source3?.trm ?? "",
    source_3_import_pct: source3?.import_pct ?? "",
    notes: item.notes,
  };
});

export async function GET() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "items");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-calculadora-oferta.xlsx"',
    },
  });
}
