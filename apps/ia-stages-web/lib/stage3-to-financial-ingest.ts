/**
 * Maps Etapa 3 pipeline JSON (columnas en español) al contrato público de ingesta
 * de financial-offer-web (versión 2). La app financiera calcula lo financiero;
 * aquí solo enviamos ítems, techo, fuentes y notas simples.
 */

export type FinancialIngestPriceSource = {
  name?: string | null;
  unit_price?: number | string | null;
  currency?: "COP" | "USD";
  url?: string | null;
  notes?: string | null;
  trm?: number | string | null;
};

export type FinancialIngestItem = {
  item?: string | null;
  name: string;
  description?: string | null;
  unit?: string | null;
  quantity?: number | string | null;
  ceiling_unit_price?: number | string | null;
  notes?: string | null;
  price_sources: FinancialIngestPriceSource[];
};

export type FinancialIngestPayload = {
  version: 2;
  source?: {
    system?: string | null;
    analysis_id?: string | null;
    run_id?: string | null;
    odoo_project_id?: string | null;
  };
  items: FinancialIngestItem[];
  settings?: {
    usd_to_cop_rate?: number;
  };
};

export type Stage3ToIngestOptions = {
  analysisId?: string | null;
  runId?: string | null;
  odooProjectId?: string | null;
  sourceSystem?: string;
  usdToCopRate?: number;
  /** Compatibilidad con llamadas viejas; ya no se envía al contrato v2. */
  calculationName?: string;
  externalId?: string | null;
  defaultUsdImportPct?: number;
};

export function stage3ResultToFinancialIngest(
  stage3Result: Record<string, unknown>,
  options: Stage3ToIngestOptions = {}
): FinancialIngestPayload {
  const itemsRaw = Array.isArray(stage3Result.items) ? stage3Result.items : [];
  const items: FinancialIngestItem[] = [];
  let needsUsdRate = false;

  for (let i = 0; i < itemsRaw.length; i++) {
    const row = itemsRaw[i];
    if (!isRecord(row)) {
      items.push({
        item: String(i + 1),
        name: `Item ${i + 1}`,
        notes: "La IA devolvió una fila no estructurada; revisar el resultado crudo de Etapa 3.",
        price_sources: []
      });
      continue;
    }

    const name = firstText(row, [
      "name",
      "Nombre",
      "Nombre o descripción",
      "Nombre o descripci?n",
      "Nombre o descripcion",
      "descripcion corta",
      "producto",
      "titulo"
    ]) || `Item ${i + 1}`;

    const description = firstText(row, [
      "description",
      "Descripción",
      "Descripci?n",
      "Descripcion",
      "Detalles o ficha técnica",
      "Detalles o ficha t?cnica",
      "Detalles o ficha tecnica",
      "Ficha t?cnica",
      "Ficha tecnica"
    ]);

    const priceSources = mapQuotesToPriceSources(
      firstValue(row, ["price_sources", "Cotizaciones encontradas", "Fuentes", "fuentes", "cotizaciones"])
    );
    if (priceSources.some((s) => (s.currency ?? "COP") === "USD")) {
      needsUsdRate = true;
    }

    items.push({
      item: firstText(row, ["item", "Item", "No. item", "No item", "Consecutivo interno"]),
      name,
      description: description || undefined,
      unit: firstText(row, ["unit", "Unidad", "Und de medida", "Und", "unidad"]),
      quantity: parseNumberLike(firstValue(row, ["quantity", "Cantidad", "Cant", "cant"])) ?? firstText(row, ["quantity", "Cantidad", "Cant", "cant"]),
      ceiling_unit_price:
        parseNumberLike(firstValue(row, ["ceiling_unit_price", "Precio techo unitario", "Precio techo encontrado", "reference_unit"])) ??
        firstText(row, ["ceiling_unit_price", "Precio techo unitario", "Precio techo encontrado", "reference_unit"]),
      notes: buildItemNotes(row),
      price_sources: priceSources
    });
  }

  const payload: FinancialIngestPayload = {
    version: 2,
    source: {
      system: options.sourceSystem ?? "ia-stages-web",
      analysis_id: options.analysisId ?? null,
      run_id: options.runId ?? null,
      odoo_project_id: options.odooProjectId ?? null
    },
    items
  };

  if (needsUsdRate && options.usdToCopRate !== undefined && options.usdToCopRate > 0) {
    payload.settings = { usd_to_cop_rate: options.usdToCopRate };
  }

  return payload;
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

    const fuente = getRecord(firstValue(q, ["fuente", "source", "proveedor"]));
    const precio = getRecord(firstValue(q, ["precio", "price"]));
    const defensa = getRecord(firstValue(q, ["defensa", "evidence", "validacion"]));
    const producto = getRecord(firstValue(q, ["producto", "product"]));

    const unitPrice = parseBestMoneyValue([
      firstValue(precio, ["texto_original", "valor_texto", "text", "original"]),
      firstValue(q, ["precio_texto", "price_text", "Precio proveedor texto"]),
      firstValue(precio, ["valor", "unit_price", "price", "precio"]),
      firstValue(q, ["unit_price", "price", "precio", "Precio proveedor"])
    ]);
    const currency = normalizeCurrency(
      firstText(precio, ["moneda", "currency"]) || firstText(q, ["currency", "moneda"]) || "COP"
    );
    const name =
      firstText(fuente, ["nombre", "name", "provider", "source"]) ||
      firstText(q, ["name", "provider", "source", "Proveedor"]) ||
      firstText(producto, ["titulo", "title", "nombre"]);
    const url = firstText(fuente, ["url", "link"]) || firstText(q, ["url", "link"]);
    const notes = buildSourceNotes(q, fuente, producto, precio, defensa);
    const trm = parseNumberLike(firstValue(precio, ["trm", "TRM"])) ?? parseNumberLike(firstValue(q, ["trm", "TRM"]));

    if (!name && unitPrice === undefined && !url && !notes) {
      continue;
    }

    out.push({
      name: name || `Fuente ${out.length + 1}`,
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

function buildItemNotes(row: Record<string, unknown>): string | undefined {
  const lectura = getRecord(firstValue(row, ["Lectura tecnica", "Lectura técnica", "Lectura t?cnica", "lectura_tecnica"]));
  const guia = getRecord(firstValue(row, ["Guia para cotizacion", "Guía para cotización", "Guia para cotización", "guia_para_cotizacion"]));
  const parts = [
    labeled("Tipo ficha", firstText(row, ["Tipo de ficha"])),
    labeled("Tipo ficha", firstText(lectura, ["tipo_ficha"])),
    labeled("Resumen técnico", firstText(lectura, ["resumen_comprable"])),
    labeled("Flexibilidad", firstText(lectura, ["flexibilidad_tecnica"])),
    labeled("Pauta búsqueda", firstText(guia, ["pauta_busqueda_etapa3"])),
    labeled("Rigidez", firstText(guia, ["rigidez_comparacion"])),
    labeled("Unidad ref.", firstText(row, ["Unidad técnica de referencia", "Unidad t?cnica de referencia", "Unidad tecnica de referencia"])),
    labeled("Requisito", firstText(row, ["Nota técnica para cotización", "Nota t?cnica para cotizaci?n", "Nota tecnica para cotizacion"])),
    labeled("Confianza", firstText(row, ["Confianza"])),
    firstText(row, ["Vista rápida de cotización", "Vista r?pida de cotizaci?n", "Vista rapida de cotizacion"]),
    firstText(row, ["Resumen de cotización", "Resumen de cotizaci?n", "Resumen de cotizacion"])
  ].filter(Boolean) as string[];

  const atributos = firstValue(lectura, ["atributos_obligatorios"]);
  if (Array.isArray(atributos)) {
    const list = atributos.map((item) => textVal(item)).filter(Boolean).slice(0, 8);
    if (list.length) {
      parts.push(`Atributos obligatorios: ${list.join("; ")}`);
    }
  }

  const criterios = firstValue(guia, ["criterios_validacion_fuente"]);
  if (Array.isArray(criterios)) {
    const list = criterios.map((item) => textVal(item)).filter(Boolean).slice(0, 6);
    if (list.length) {
      parts.push(`Validación sugerida: ${list.join("; ")}`);
    }
  }

  const estado = getRecord(firstValue(row, ["Estado de cotización", "Estado de cotizaci?n", "Estado de cotizacion"]));
  const estadoBits = [
    firstText(estado, ["resultado_busqueda"]),
    firstText(estado, ["estado_pricing"]),
    firstText(estado, ["decision_siguiente_paso"])
  ].filter(Boolean);
  if (estadoBits.length) {
    parts.push(`Estado IA: ${estadoBits.join(" / ")}`);
  }

  return trimNote(parts.join(" | "));
}

function buildSourceNotes(
  quote: Record<string, unknown>,
  fuente: Record<string, unknown>,
  producto: Record<string, unknown>,
  precio: Record<string, unknown>,
  defensa: Record<string, unknown>
): string | undefined {
  const parts = [
    firstText(quote, ["notes", "notas"]),
    labeled("Producto", firstText(producto, ["titulo", "title", "nombre"])),
    firstText(defensa, ["justificacion", "justificación", "justificaci?n", "notes", "notas"]),
    labeled("Coincidencia", firstText(defensa, ["coincidencia_tecnica"])),
    labeled("Unidad", firstText(defensa, ["coincidencia_unidad"])),
    labeled("Precio", firstText(precio, ["texto_original", "text", "original"])),
    labeled("Fuente", firstText(fuente, ["tipo_fuente", "origen_geografico"]))
  ].filter(Boolean) as string[];

  const alertas = firstValue(defensa, ["alertas", "alerts"]);
  if (Array.isArray(alertas)) {
    const list = alertas.map((x) => textVal(x)).filter(Boolean);
    if (list.length) {
      parts.push(`Alertas IA: ${list.join(", ")}`);
    }
  }

  return trimNote(parts.join(" | "));
}

function labeled(label: string, value: string | undefined): string | undefined {
  return value ? `${label}: ${value}` : undefined;
}

function trimNote(value: string): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > 1200 ? `${cleaned.slice(0, 1197)}...` : cleaned;
}

function firstValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = getColumn(row, key);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function firstText(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = textVal(getColumn(row, key));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeCurrency(c: string): "COP" | "USD" {
  const u = c.toUpperCase();
  if (u === "USD" || u === "US$" || u === "DOLAR" || u === "DÓLAR" || u === "D?LAR") {
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
    .replace(/\u00c3\u0192\u00c2\u00a1/g, "a")
    .replace(/\u00c3\u0192\u00c2\u00a9/g, "e")
    .replace(/\u00c3\u0192\u00c2\u00ad/g, "i")
    .replace(/\u00c3\u0192\u00c2\u00b3/g, "o")
    .replace(/\u00c3\u0192\u00c2\u00ba/g, "u")
    .replace(/\u00c3\u0192\u00c2\u00b1/g, "n")
    .replace(/\u00c3\u00a1/g, "a")
    .replace(/\u00c3\u00a9/g, "e")
    .replace(/\u00c3\u00ad/g, "i")
    .replace(/\u00c3\u00b3/g, "o")
    .replace(/\u00c3\u00ba/g, "u")
    .replace(/\u00c3\u00b1/g, "n")
    .replace(/\u00ef\u00bf\u00bd/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/descripci.n/g, "descripcion")
    .replace(/t.cnica/g, "tecnica")
    .replace(/cotizaci.n/g, "cotizacion")
    .replace(/b.squeda/g, "busqueda")
    .replace(/r.pida/g, "rapida")
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

function parseBestMoneyValue(values: unknown[]): number | undefined {
  const parsed = values.map((value) => parseNumberLike(value)).filter((value): value is number => value !== undefined);
  if (!parsed.length) {
    return undefined;
  }

  // Prefer the first parsed value, normally the original visible price text. If a later
  // parser produced a clearly larger COP-like value, keep it instead of a truncated 20/64/7.
  return parsed.reduce((best, current) => {
    if (best > 0 && current >= best * 100 && current >= 1000) {
      return current;
    }
    return best;
  }, parsed[0]);
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  let cleaned = value.trim();
  if (!cleaned) {
    return undefined;
  }
  cleaned = cleaned.replace(/\u00a0/g, " ");
  const match = cleaned
    .replace(/COP|COL\$|USD|IVA\s*incluido|IVA/gi, " ")
    .match(/-?\d[\d.,\s]*(?:\d)?/);
  if (!match) {
    return undefined;
  }
  cleaned = match[0].replace(/\s/g, "");

  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(/,/g, ".")
      : cleaned.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned.replace(/,/g, ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
