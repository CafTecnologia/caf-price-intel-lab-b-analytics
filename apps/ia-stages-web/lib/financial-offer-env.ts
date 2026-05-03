export function getFinancialOfferApiBaseUrl(): string {
  const raw = process.env.FINANCIAL_OFFER_API_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, "") : "http://127.0.0.1:18030";
}

/** Base URL shown to the browser (iframe / nueva pestaña). Defaults to API base. */
export function getFinancialOfferPublicBaseUrl(): string {
  const raw = process.env.FINANCIAL_OFFER_PUBLIC_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, "") : getFinancialOfferApiBaseUrl();
}

export function resolveCalculationPublicUrl(pathFromApi: string): string {
  const base = getFinancialOfferPublicBaseUrl();
  if (/^https?:\/\//i.test(pathFromApi)) {
    return pathFromApi;
  }
  const path = pathFromApi.startsWith("/") ? pathFromApi : `/${pathFromApi}`;
  return `${base}${path}`;
}

export function getDefaultUsdToCopRate(): number | undefined {
  const raw = process.env.FINANCIAL_OFFER_USD_COP?.trim();
  if (!raw) {
    return undefined;
  }
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
