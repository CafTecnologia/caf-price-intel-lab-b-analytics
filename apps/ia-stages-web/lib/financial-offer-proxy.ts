import { getFinancialOfferApiBaseUrl } from "@/lib/financial-offer-env";

export async function proxyToFinancialOfferApi(
  path: "/api/validate" | "/api/import",
  payload: unknown
): Promise<Response> {
  const base = getFinancialOfferApiBaseUrl();
  const token = process.env.FINANCIAL_IMPORT_TOKEN?.trim() ?? "";
  if (token.length < 32) throw new Error("Falta la credencial de importación de Finanzas.");
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
}
