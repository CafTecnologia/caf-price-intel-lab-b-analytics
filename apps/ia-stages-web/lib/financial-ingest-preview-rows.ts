import type { FinancialIngestPayload, FinancialIngestPriceSource } from "@/lib/stage3-to-financial-ingest";

/** Filas planas con las columnas del contrato Excel v2 de financial-offer-web. */
export function financialIngestToTableRows(payload: FinancialIngestPayload): Record<string, unknown>[] {
  return payload.items.map((row, idx) => {
    const out: Record<string, unknown> = {
      Item: row.item ?? String(idx + 1),
      Nombre: row.name,
      "Descripci?n": row.description ?? "",
      "Und de medida": row.unit ?? "",
      Cant: row.quantity ?? "",
      "Precio techo unitario": row.ceiling_unit_price ?? "",
      "Notas del ?tem": row.notes ?? ""
    };

    const ps = row.price_sources ?? [];
    for (let i = 0; i < 3; i++) {
      const source = ps[i];
      addPriceSourceColumns(out, i + 1, source);
    }

    return out;
  });
}

function addPriceSourceColumns(out: Record<string, unknown>, index: number, source?: FinancialIngestPriceSource) {
  out[`Proveedor ${index}`] = source?.name ?? "";
  out[`Precio proveedor ${index}`] = source?.unit_price ?? "";
  out[`Moneda proveedor ${index}`] = source?.currency ?? "";
  out[`URL proveedor ${index}`] = source?.url ?? "";
  out[`Notas proveedor ${index}`] = source?.notes ?? "";
  out[`TRM proveedor ${index}`] = source?.trm ?? "";
}
