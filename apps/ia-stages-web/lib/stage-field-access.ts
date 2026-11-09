export type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getStageItems(value: unknown): JsonRecord[] {
  if (!isJsonRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.filter(isJsonRecord);
}

export function normalizeFieldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[??]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aliasesToSet(aliases: string[]) {
  return new Set(aliases.map(normalizeFieldName));
}

export function getFieldValue(record: JsonRecord, aliases: string[], maxDepth = 4): unknown {
  const wanted = aliasesToSet(aliases);
  const seen = new Set<unknown>();

  function walk(value: unknown, depth: number): unknown {
    if (!isJsonRecord(value) || depth > maxDepth || seen.has(value)) return undefined;
    seen.add(value);

    for (const [key, nested] of Object.entries(value)) {
      if (wanted.has(normalizeFieldName(key)) && nested !== null && nested !== undefined && String(nested).trim() !== "") {
        return nested;
      }
    }

    for (const nested of Object.values(value)) {
      if (isJsonRecord(nested)) {
        const found = walk(nested, depth + 1);
        if (found !== undefined) return found;
      }
    }

    return undefined;
  }

  return walk(record, 0);
}

export function getFieldText(record: JsonRecord, aliases: string[]): string {
  const value = getFieldValue(record, aliases);
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

export function itemKeyFromRecord(item: JsonRecord, fallbackIndex: number): string {
  return (
    getFieldText(item, ["Consecutivo interno", "consecutivo", "consecutivo interno"]) ||
    getFieldText(item, ["No. item", "No item", "item", "numero item"]) ||
    String(fallbackIndex + 1)
  ).trim();
}

export function compactItemForPricing(item: JsonRecord, index: number) {
  const itemKey = itemKeyFromRecord(item, index);
  const name = getFieldText(item, ["Nombre o descripcion", "Nombre", "name", "producto"]);
  const description = getFieldText(item, [
    "Detalles o ficha tecnica",
    "Ficha tecnica",
    "Descripcion tecnica",
    "Descripcion",
    "description"
  ]);
  const unit = getFieldText(item, ["Und de medida", "Unidad", "Unidad de medida", "unit"]);
  const quantity = getFieldText(item, ["Cant", "Cantidad", "quantity"]);
  const ceiling = getFieldText(item, ["Precio techo encontrado", "Precio techo", "ceiling unit price", "precio techo unitario"]);
  const type = getFieldText(item, ["Tipo de ficha", "tipo ficha", "tipo_ficha"]);
  const technicalUnit = getFieldText(item, ["Unidad tecnica de referencia", "unidad tecnica"]);
  const technicalNote = getFieldText(item, [
    "Nota tecnica para cotizacion",
    "nota tecnica",
    "observacion tecnica",
    "observacion_tecnica",
    "resumen comprable",
    "resumen_comprable"
  ]);
  const criticalAttributes = getFieldValue(item, [
    "Atributos criticos",
    "atributos criticos",
    "atributos obligatorios",
    "atributos_obligatorios",
    "atributos"
  ]);
  const searchGuide = getFieldValue(item, ["Guia para cotizacion", "guia cotizacion", "busqueda sugerida", "pauta busqueda etapa3", "pauta_busqueda_etapa3"]);

  return {
    itemKey,
    name,
    description,
    unit,
    quantity,
    ceiling,
    type,
    technicalUnit,
    technicalNote,
    criticalAttributes,
    searchGuide,
    original: item
  };
}
