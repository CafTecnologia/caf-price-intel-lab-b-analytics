import { PipelineFailure } from "@/lib/ai-failures";

type PricingEvidenceIssue = {
  itemIndex: number;
  quoteIndex: number;
  field: string;
  reason: string;
  value?: unknown;
  severity: "high" | "medium";
};

const PLACEHOLDER_URL_PATTERN =
  /(x{4,}|lxxxx|placeholder|example\.(com|org|net)|dummy|fake|url-aqui|sin-url|\[|\]|<|>|\.\.\.)/i;

export function validateStage3PricingEvidence(result: Record<string, unknown>, raw: string) {
  const items = Array.isArray(result.items) ? result.items : [];
  const issues: PricingEvidenceIssue[] = [];

  items.forEach((item, itemIndex) => {
    if (!isRecord(item)) {
      return;
    }

    const quotes = getByNormalizedKey(item, "cotizaciones encontradas");

    if (!Array.isArray(quotes)) {
      return;
    }

    quotes.forEach((quote, quoteIndex) => {
      if (!isRecord(quote)) {
        return;
      }

      const source = getRecord(getByNormalizedKey(quote, "fuente"));
      const price = getRecord(getByNormalizedKey(quote, "precio"));
      const defense = getRecord(getByNormalizedKey(quote, "defensa"));
      const sourceName = textValue(getByNormalizedKey(source, "nombre"));
      const sourceUrl = textValue(getByNormalizedKey(source, "url"));
      const sourceStatus = textValue(getByNormalizedKey(defense, "estado fuente"));
      const usableForPricing = getByNormalizedKey(defense, "usable para pricing") === true;
      const usable = usableForPricing || sourceStatus === "usable" || sourceStatus === "usable_con_alertas";

      if (sourceUrl && isSuspiciousUrl(sourceUrl)) {
        issues.push({
          itemIndex,
          quoteIndex,
          field: "fuente.url",
          reason: "La URL parece un placeholder o no es verificable.",
          value: sourceUrl,
          severity: "high"
        });
      }

      if (usable && !sourceName) {
        issues.push({
          itemIndex,
          quoteIndex,
          field: "fuente.nombre",
          reason: "La fuente marcada como usable no trae nombre comercial.",
          severity: "high"
        });
      }

      if (usable && !sourceUrl) {
        issues.push({
          itemIndex,
          quoteIndex,
          field: "fuente.url",
          reason: "La fuente marcada como usable no trae URL trazable.",
          severity: "medium"
        });
      }

      if (usable && !hasVisiblePrice(price)) {
        issues.push({
          itemIndex,
          quoteIndex,
          field: "precio",
          reason: "La fuente marcada como usable no trae precio visible.",
          severity: "high"
        });
      }
    });
  });

  const severeIssues = issues.filter((issue) => issue.severity === "high");

  if (severeIssues.length) {
    throw new PipelineFailure({
      code: "AI_UNRELIABLE_PRICING",
      stage: "stage3",
      technicalMessage:
        "La Etapa 3 devolvio fuentes de precio con evidencia no verificable o incompleta.",
      details: { issues },
      raw,
      result
    });
  }
}

function hasVisiblePrice(price: Record<string, unknown>) {
  const original = textValue(getByNormalizedKey(price, "texto original"));
  const value = getByNormalizedKey(price, "valor");

  return Boolean(
    original ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.trim())
  );
}

function isSuspiciousUrl(value: string) {
  if (PLACEHOLDER_URL_PATTERN.test(value)) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.hostname.length < 4 || /\s/.test(value);
  } catch {
    return true;
  }
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getByNormalizedKey(record: Record<string, unknown>, wantedKey: string) {
  const normalizedWantedKey = normalizeKey(wantedKey);
  const key = Object.keys(record).find((currentKey) => normalizeKey(currentKey) === normalizedWantedKey);
  return key ? record[key] : undefined;
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

function textValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
