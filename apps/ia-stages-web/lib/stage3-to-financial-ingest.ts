/**
 * Maps Etapa 3 pipeline JSON (columnas en español) al contrato público de ingesta
 * de la app financiera (version 1: calculation + items + settings + price_sources).
 * No calcula costos agregados: solo fuentes unitarias y metadatos.
 */

export type FinancialIngestPriceSource = {
  name?: string | null;
  unit_price?: number | null;
  currency?: string | null;
  url?: string | null;
  notes?: string | null;
  trm?: number | null;
  import_pct?: number | null;
};

export type FinancialIngestItem = {
  item?: string | null;
  description: string;
  technical_description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  reference_unit?: number | string | null;
  price_sources: FinancialIngestPriceSource[];
};

export type FinancialIngestPayload = {
  version: 1;
  calculation: {
    name: string;
    external_id?: string | null;
    source_system?: string | null;
    entity?: string | null;
    currency?: string | null;
  };
  items: FinancialIngestItem[];
  settings?: {
    usd_to_cop_rate?: number;
    usd_import_pct?: number;
  };
};

export type Stage3ToIngestOptions = {
  calculationName?: string;
  externalId?: string | null;
  sourceSystem?: string;
  usdToCopRate?: number;
  defaultUsdImportPct?: number;
};

export function stage3ResultToFinancialIngest(
  stage3Result: Record<string, unknown>,
  options: Stage3ToIngestOptions = {}
): FinancialIngestPayload {
  const itemsRaw = Array.isArray(stage3Result.items) ? stage3Result.items : [];
  const meta = isRecord(stage3Result.metadata) ? stage3Result.metadata : {};

  const calculationName =
    options.calculationName ??
    (typeof meta.observaciones_generales === "string"
      ? meta.observaciones_generales.slice(0, 80)
      : null) ??
    `Oferta ${new Date().toISOString().slice(0, 10)}`;

  const items: FinancialIngestItem[] = [];
  let needsUsdRate = false;

  for (let i = 0; i < itemsRaw.length; i++) {
    const row = itemsRaw[i];
    if (!isRecord(row)) {
      continue;
    }

    const description = textVal(getColumn(row, "Nombre o descripción"));
    if (!description) {
      continue;
    }

    const quotes = getColumn(row, "Cotizaciones encontradas");
    const price_sources = mapQuotesToPriceSources(quotes);
    if (price_sources.some((s) => (s.currency ?? "COP").toUpperCase() === "USD")) {
      needsUsdRate = true;
    }

    const refRaw = getColumn(row, "Precio techo encontrado");
    const reference_unit = parseNumberLike(refRaw);

    items.push({
      item: textVal(getColumn(row, "No. item")) || String(getColumn(row, "Consecutivo interno") ?? i + 1),
      description,
      technical_description: optionalText(getColumn(row, "Detalles o ficha técnica")),
      quantity: parseNumberLike(getColumn(row, "Cant")) ?? optionalText(getColumn(row, "Cant")),
      unit: optionalText(getColumn(row, "Und de medida")),
      reference_unit: reference_unit ?? undefined,
      price_sources
    });
  }

  const settings: NonNullable<FinancialIngestPayload["settings"]> = {};
  const usdRate = options.usdToCopRate;
  if (needsUsdRate && usdRate !== undefined && usdRate > 0) {
    settings.usd_to_cop_rate = usdRate;
  }
  if (needsUsdRate) {
    settings.usd_import_pct = options.defaultUsdImportPct ?? 30;
  }

  return {
    version: 1,
    calculation: {
      name: calculationName.slice(0, 200),
      external_id: options.externalId ?? null,
      source_system: options.sourceSystem ?? "extraccion-datos-estrategicos",
      currency: "COP"
    },
    items,
    settings: Object.keys(settings).length ? settings : undefined
  };
}

function mapQuotesToPriceSources(quotes: unknown): FinancialIngestPriceSource[] {
  if (!Array.isArray(quotes)) {
    return [];
  }

  const out: FinancialIngestPriceSource[] = [];

  for (const q of quotes) {
    if (!isRecord(q)) {
      continue;
    }

    const fuente = getRecord(getColumn(q, "fuente"));
    const precio = getRecord(getColumn(q, "precio"));
    const defensa = getRecord(getColumn(q, "defensa"));

    const usableRaw = getColumn(defensa, "usable_para_pricing");
    const estado = textVal(getColumn(defensa, "estado_fuente")).toLowerCase();
    const usable =
      usableRaw === true ||
      estado === "usable" ||
      estado === "usable_con_alertas";

    const unitPrice = parseNumberLike(getColumn(precio, "valor"));
    const currency = normalizeCurrency(textVal(getColumn(precio, "moneda")) || "COP");

    if (!usable && unitPrice === undefined) {
      continue;
    }

    if (unitPrice === undefined || !Number.isFinite(unitPrice)) {
      continue;
    }

    const name = textVal(getColumn(fuente, "nombre")).trim() || "Fuente";
    const url = textVal(getColumn(fuente, "url")).trim();
    const notes = buildNotes(defensa, precio);
    const trm = parseNumberLike(getColumn(precio, "trm"));

    out.push({
      name,
      unit_price: unitPrice,
      currency,
      url: url || undefined,
      notes: notes || undefined,
      trm: trm !== undefined ? trm : undefined
    });

    if (out.length >= 3) {
      break;
    }
  }

  return out;
}

function buildNotes(defensa: Record<string, unknown>, precio: Record<string, unknown>): string {
  const parts: string[] = [];
  const just = textVal(getColumn(defensa, "justificacion"));
  if (just) {
    parts.push(just);
  }
  const alertas = getColumn(defensa, "alertas");
  if (Array.isArray(alertas)) {
    const a = alertas.map((x) => textVal(x)).filter(Boolean);
    if (a.length) {
      parts.push(`Alertas: ${a.join(", ")}`);
    }
  }
  const txt = textVal(getColumn(precio, "texto_original"));
  if (txt && !parts.length) {
    parts.push(txt);
  }
  const joined = parts.join(" | ").trim();
  return joined.length > 1200 ? `${joined.slice(0, 1197)}...` : joined;
}

function normalizeCurrency(c: string): "COP" | "USD" {
  const u = c.toUpperCase();
  if (u === "USD" || u === "US$" || u === "DOLAR" || u === "DÓLAR") {
    return "USD";
  }
  return "COP";
}

function getColumn(row: Record<string, unknown>, canonical: string): unknown {
  const want = normalizeKey(canonical);
  for (const [k, v] of Object.entries(row)) {
    if (normalizeKey(k) === want) {
      return v;
    }
  }
  return undefined;
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function textVal(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | undefined {
  const t = textVal(value);
  return t ? t : undefined;
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.trim().replace(/\s/g, "");
  if (!cleaned || /[a-z]/i.test(cleaned.replace(/[.,]/g, ""))) {
    const n = Number(cleaned.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
