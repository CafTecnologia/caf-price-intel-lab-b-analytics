import { getDefaultUsdToCopRate } from "@/lib/financial-offer-env";

/** Conjunto TRM (USD/COP) en Datos Abiertos Colombia — Superfinanciera. */
export const TRM_DATOS_GOV_DATASET_URL =
  "https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciahasta DESC";

export const TRM_DATOS_GOV_SOURCE_LABEL =
  "Datos Abiertos Colombia — TRM (Superfinanciera), recurso 32sa-8pi3";

export type OfficialTrmSnapshot =
  | {
      ok: true;
      value: number;
      vigenciadesde: string;
      vigenciahasta: string;
      source: string;
      /** true = filas del API oficial; false = solo respaldo desde env */
      fromOfficialDataset: boolean;
    }
  | { ok: false; error: string };

export function parseTrmDatasetRow(row: Record<string, unknown> | undefined): number | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const raw = row.valor ?? row.VALOR;
  if (raw == null) {
    return null;
  }
  const n = Number(String(raw).replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Obtiene la TRM más reciente publicada en datos.gov.co; si falla, usa FINANCIAL_OFFER_USD_COP si está definida.
 */
export async function getOfficialTrmSnapshot(): Promise<OfficialTrmSnapshot> {
  try {
    const res = await fetch(TRM_DATOS_GOV_DATASET_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 }
    });
    if (res.ok) {
      const rows = (await res.json()) as unknown;
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        const value = parseTrmDatasetRow(row);
        if (value != null) {
          return {
            ok: true,
            value,
            vigenciadesde: typeof row.vigenciadesde === "string" ? row.vigenciadesde : "",
            vigenciahasta: typeof row.vigenciahasta === "string" ? row.vigenciahasta : "",
            source: TRM_DATOS_GOV_SOURCE_LABEL,
            fromOfficialDataset: true
          };
        }
      }
    }
  } catch {
    // seguir a respaldo
  }

  const envRate = getDefaultUsdToCopRate();
  if (envRate != null) {
    return {
      ok: true,
      value: envRate,
      vigenciadesde: "",
      vigenciahasta: "",
      source: "Respaldo: variable de entorno FINANCIAL_OFFER_USD_COP (no sustituye la TRM diaria oficial)",
      fromOfficialDataset: false
    };
  }

  return {
    ok: false,
    error: "No se pudo obtener la TRM desde la fuente oficial ni un valor de respaldo configurado."
  };
}
