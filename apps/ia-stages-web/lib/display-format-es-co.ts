/**
 * Formato de presentacion Colombia: miles con punto, decimales con coma.
 * Importante: estas funciones son solo de presentacion; no deben mutar el JSON crudo de la IA.
 */

export type NumberDisplayFormat = "es-CO" | "raw";

/**
 * Interpreta numeros en texto (API en ingles, UI en es-CO, o mezclas).
 * Regla: el ultimo separador (`,` o `.`) marca el decimal, salvo patrones claros de miles.
 */
export function parseLooseNumber(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, "");
  if (!cleaned || /[a-z]/i.test(cleaned)) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(/,/g, ".")
      : cleaned.replace(/,/g, "");
  } else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else if (/^[+-]?\d{1,3}(,\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/,/g, ".");
  } else {
    normalized = cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumberEsCO(
  value: number,
  options?: { minFractionDigits?: number; maxFractionDigits?: number }
): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: options?.minFractionDigits ?? 0,
    maximumFractionDigits: options?.maxFractionDigits ?? 12,
    useGrouping: true
  }).format(value);
}

const numericStringPattern = /^[+-]?[\d\s.,]+$/;
const currencyLikePattern = /^(?<prefix>\s*(?:[$]|COP|USD|EUR|COL\$)?\s*)(?<number>[+-]?[\d\s.,]+)(?<suffix>\s*(?:COP|USD|EUR|%)?\s*)$/i;

export function formatScalarForUi(
  value: unknown,
  options?: { numberFormat?: NumberDisplayFormat }
): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (options?.numberFormat === "raw") {
    return typeof value === "boolean" ? (value ? "Si" : "No") : String(value);
  }
  if (typeof value === "number") {
    return formatNumberEsCO(value);
  }
  if (typeof value === "boolean") {
    return value ? "Si" : "No";
  }
  if (typeof value === "string") {
    return formatNumericStringForUi(value);
  }
  return String(value);
}

function formatNumericStringForUi(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (numericStringPattern.test(trimmed) && /\d/.test(trimmed)) {
    const parsed = parseLooseNumber(trimmed);
    return parsed === null ? value : formatNumberEsCO(parsed);
  }

  const match = trimmed.match(currencyLikePattern);
  if (!match?.groups?.number) {
    return value;
  }

  const parsed = parseLooseNumber(match.groups.number);
  if (parsed === null) {
    return value;
  }

  const prefix = match.groups.prefix ?? "";
  const suffix = match.groups.suffix ?? "";
  return `${prefix}${formatNumberEsCO(parsed)}${suffix}`.trim();
}
