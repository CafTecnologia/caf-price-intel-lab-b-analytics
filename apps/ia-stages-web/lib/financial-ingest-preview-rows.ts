import type { FinancialIngestPayload, FinancialIngestPriceSource } from "@/lib/stage3-to-financial-ingest";

/** Filas planas para la tabla tipo Excel de la vista previa (Etapa 4). */
export function financialIngestToTableRows(payload: FinancialIngestPayload): Record<string, unknown>[] {
  return payload.items.map((row, idx) => {
    const out: Record<string, unknown> = {
      Ítem: row.item ?? String(idx + 1),
      Descripción: row.description,
      "Ficha técnica": row.technical_description ?? "",
      Cantidad: row.quantity ?? "",
      Unidad: row.unit ?? "",
      "Precio techo (ref.)": row.reference_unit ?? ""
    };

    const ps = row.price_sources ?? [];
    for (let i = 0; i < 3; i++) {
      const s = ps[i];
      out[`Fuente ${i + 1}`] = s ? formatPriceSourceCell(s) : "";
    }

    return out;
  });
}

function formatPriceSourceCell(s: FinancialIngestPriceSource): string {
  const price =
    s.unit_price != null && Number.isFinite(Number(s.unit_price))
      ? `${s.unit_price} ${(s.currency ?? "COP").toUpperCase()}`
      : "";
  const bits = [s.name?.trim(), price, s.url?.trim()].filter(Boolean);
  let line = bits.join(" · ");
  if (s.notes?.trim()) {
    const n = s.notes.trim();
    line += (line ? " · " : "") + (n.length > 120 ? `${n.slice(0, 117)}…` : n);
  }
  return line;
}
