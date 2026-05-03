import { getFinancialOfferApiBaseUrl } from "@/lib/financial-offer-env";

export async function proxyToFinancialOfferApi(
  path: "/api/validate" | "/api/import",
  payload: unknown
): Promise<Response> {
  const base = getFinancialOfferApiBaseUrl();
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
