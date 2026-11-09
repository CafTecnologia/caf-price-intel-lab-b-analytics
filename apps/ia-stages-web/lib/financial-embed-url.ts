const DEFAULT_FINANCIAL_EMBED_ORIGIN = "http://127.0.0.1:18030";

export function safeCalculationPath(id: string): string | null {
  const t = id.trim();
  if (!t || t.length > 200 || /[<>"'`\\]/.test(t)) {
    return null;
  }
  return t;
}

export function buildFinancialEmbedSrc(embedBaseRaw: string | undefined | null, rawCalc: string | null): string {
  const embedBase = (embedBaseRaw?.trim() || DEFAULT_FINANCIAL_EMBED_ORIGIN).replace(/\/+$/, "");
  const calc = rawCalc ? safeCalculationPath(rawCalc) : null;
  const suffix = calc ? `calculations/${encodeURIComponent(calc)}` : "";

  try {
    const url = new URL(embedBase || DEFAULT_FINANCIAL_EMBED_ORIGIN);
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = suffix ? `${basePath}/${suffix}` : basePath || "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return calc
      ? `${DEFAULT_FINANCIAL_EMBED_ORIGIN}/calculations/${encodeURIComponent(calc)}`
      : `${DEFAULT_FINANCIAL_EMBED_ORIGIN}/`;
  }
}
