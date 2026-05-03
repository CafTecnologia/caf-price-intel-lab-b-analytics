import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getFinancialOfferApiBaseUrl,
  getFinancialOfferPublicBaseUrl,
  resolveCalculationPublicUrl,
} from "./financial-offer-env";

describe("financial-offer-env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("default API base es el proceso del simulador en 18030", () => {
    vi.stubEnv("FINANCIAL_OFFER_API_URL", "");
    expect(getFinancialOfferApiBaseUrl()).toBe("http://127.0.0.1:18030");
  });

  it("public URL por defecto coincide con API", () => {
    vi.stubEnv("FINANCIAL_OFFER_API_URL", "");
    vi.stubEnv("FINANCIAL_OFFER_PUBLIC_URL", "");
    expect(getFinancialOfferPublicBaseUrl()).toBe("http://127.0.0.1:18030");
  });

  it("resuelve rutas relativas del API", () => {
    vi.stubEnv("FINANCIAL_OFFER_PUBLIC_URL", "");
    vi.stubEnv("FINANCIAL_OFFER_API_URL", "");
    expect(resolveCalculationPublicUrl("/calculations/abc")).toBe("http://127.0.0.1:18030/calculations/abc");
  });
});
