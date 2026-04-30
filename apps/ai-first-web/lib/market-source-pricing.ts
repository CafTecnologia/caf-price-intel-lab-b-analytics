export const INTERNATIONAL_IMPORT_FACTOR = 1.3;

export type MarketSourceUnitPrice = {
  priceCop: number;
  originalValue: number;
  currency: "COP" | "USD";
  isInternational: boolean;
  adjustedWithImportCost: boolean;
};

const INTERNAL_REFERENCE_RE =
  /\b(documento\s*base|precio\s*(techo|referencia|estimado)|presupuesto\s*oficial|promedio\s*(del\s*)?documento|cotizaci[oó]n\s*(interna|del\s*documento|proveedor))/i;

function normalizeNumericWhitespace(value: string): string {
  return value
    .replace(/(\d)[\s\u00a0]+([.,])[\s\u00a0]*(?=\d)/g, "$1$2")
    .replace(/(\d[.,])[\s\u00a0]+(?=\d)/g, "$1")
    .replace(/(\d)[\s\u00a0]+(?=\d)/g, "$1");
}

function parseDecimalNumber(candidate: string): number | null {
  const cleaned = normalizeNumericWhitespace(candidate).replace(/[^\d.,]/g, "");
  if (!cleaned) {
    return null;
  }

  let normalized = cleaned;
  const commaIndex = cleaned.lastIndexOf(",");
  const dotIndex = cleaned.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized =
      commaIndex > dotIndex
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    const decimals = cleaned.length - commaIndex - 1;
    normalized = decimals > 0 && decimals <= 2 ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (dotIndex >= 0) {
    const looksLikeThousands = /^\d{1,3}(\.\d{3})+$/.test(cleaned);
    normalized = looksLikeThousands ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCopNumber(candidate: string): number | null {
  const cleaned = normalizeNumericWhitespace(candidate).replace(/[^\d.,]/g, "");
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned.replace(/[.,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseUsdValue(source: string): number | null {
  const normalizedSource = normalizeNumericWhitespace(source);
  const hasInternationalTag = /\[INTERNACIONAL\]/i.test(source);
  const hasUsdMarker = /\bUSD\b|US\$/i.test(normalizedSource);
  if (!hasInternationalTag && !hasUsdMarker) {
    return null;
  }

  const markerBefore = normalizedSource.match(/(?:\bUSD\b|US\$|\$)\s*[\|:;-]?\s*([0-9][0-9.,]*)/i);
  if (markerBefore) {
    return parseDecimalNumber(markerBefore[1] ?? "");
  }

  const markerAfter = normalizedSource.match(/([0-9][0-9.,]*)\s*[\|:;-]?\s*(?:\bUSD\b|US\$)/i);
  if (markerAfter) {
    return parseDecimalNumber(markerAfter[1] ?? "");
  }

  return null;
}

function parseCopValue(source: string): number | null {
  const normalizedSource = normalizeNumericWhitespace(source);
  if (/\bUSD\b|US\$/i.test(normalizedSource)) {
    return null;
  }

  const markerBeforeMatches = Array.from(normalizedSource.matchAll(/(?:COP|COL\$|\$)\s*[\|:;-]?\s*([0-9][0-9.,]*)/gi));
  const markerCandidates = markerBeforeMatches
    .map((match) => parseCopNumber(match[1] ?? ""))
    .filter((candidate): candidate is number => candidate !== null);
  if (markerCandidates.length > 0) {
    return markerCandidates[markerCandidates.length - 1] ?? null;
  }

  const markerAfterMatches = Array.from(normalizedSource.matchAll(/([0-9][0-9.,]*)\s*[\|:;-]?\s*(?:COP|COL\$)/gi));
  const markerAfterCandidates = markerAfterMatches
    .map((match) => parseCopNumber(match[1] ?? ""))
    .filter((candidate): candidate is number => candidate !== null);
  if (markerAfterCandidates.length > 0) {
    return markerAfterCandidates[markerAfterCandidates.length - 1] ?? null;
  }

  const trimmed = normalizedSource.trim();
  if (/^[\d\s.,]+$/.test(trimmed)) {
    return parseCopNumber(trimmed);
  }

  const thousandsCandidates = (normalizedSource.match(/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?\b/g) ?? [])
    .map(parseCopNumber)
    .filter((candidate): candidate is number => candidate !== null);
  if (thousandsCandidates.length > 0) {
    return thousandsCandidates[thousandsCandidates.length - 1] ?? null;
  }

  return null;
}

export function isInternalReferenceSource(source: string): boolean {
  return INTERNAL_REFERENCE_RE.test(source);
}

export function isMarketSourcePrice(source: string): boolean {
  if (!source || /^n\/?d$/i.test(source.trim()) || isInternalReferenceSource(source)) {
    return false;
  }

  return parseUsdValue(source) !== null || parseCopValue(source) !== null;
}

export function parseMarketSourceUnitPrice(source: string, trmValue: number): MarketSourceUnitPrice | null {
  if (!isMarketSourcePrice(source)) {
    return null;
  }

  const usdValue = parseUsdValue(source);
  if (usdValue !== null) {
    return {
      priceCop: Math.round(usdValue * trmValue * INTERNATIONAL_IMPORT_FACTOR),
      originalValue: usdValue,
      currency: "USD",
      isInternational: true,
      adjustedWithImportCost: true,
    };
  }

  const copValue = parseCopValue(source);
  if (copValue === null) {
    return null;
  }

  return {
    priceCop: Math.round(copValue),
    originalValue: copValue,
    currency: "COP",
    isInternational: /\[INTERNACIONAL\]/i.test(source),
    adjustedWithImportCost: false,
  };
}
