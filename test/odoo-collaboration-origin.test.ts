import { afterEach, describe, expect, it, vi } from "vitest";
import { sameAppOrigin } from "../lib/odoo-collaboration";
afterEach(() => vi.unstubAllEnvs());
describe("origen del chat financiero", () => {
  it("admite el origen local y rechaza otro sitio sin configuración", () => {
    delete process.env.FINANCIAL_ALLOWED_ORIGINS;
    expect(sameAppOrigin(new Request("http://localhost:3000/a", { headers: { Origin: "http://localhost:3000" } }))).toBe(true);
    expect(sameAppOrigin(new Request("http://localhost:3000/a", { headers: { Origin: "https://other.example" } }))).toBe(false);
  });
  it("admite HTTPS configurado aunque Next reciba una dirección interna", () => {
    vi.stubEnv("FINANCIAL_ALLOWED_ORIGINS", "https://erp.caftecnologia.com,http://127.0.0.1:18303");
    expect(sameAppOrigin(new Request("http://0.0.0.0:3000/a", { headers: { Origin: "https://erp.caftecnologia.com" } }))).toBe(true);
    expect(sameAppOrigin(new Request("http://0.0.0.0:3000/a", { headers: { Origin: "http://127.0.0.1:18303" } }))).toBe(true);
    expect(sameAppOrigin(new Request("http://0.0.0.0:3000/a", { headers: { Origin: "https://other.example", Host: "other.example", "X-Forwarded-Host": "other.example" } }))).toBe(false);
  });
  it("rechaza ausencia, null, rutas y configuración inválida", () => {
    vi.stubEnv("FINANCIAL_ALLOWED_ORIGINS", "https://erp.caftecnologia.com/bad,file:///tmp");
    for (const origin of [undefined, "null", "https://erp.caftecnologia.com", "https://erp.caftecnologia.com/bad"]) {
      expect(sameAppOrigin(new Request("http://localhost:3000/a", { headers: origin ? { Origin: origin } : {} }))).toBe(false);
    }
  });

  it("matches the public request host behind the DEV listener without trusting another origin", () => {
    vi.stubEnv("FINANCIAL_ALLOWED_ORIGINS", undefined);
    const headers = { Host: "127.0.0.1:18030", Origin: "http://127.0.0.1:18030" };
    expect(sameAppOrigin(new Request("http://0.0.0.0:3000/a", { headers }))).toBe(true);
    expect(sameAppOrigin(new Request("http://0.0.0.0:3000/a", { headers: { ...headers, Origin: "http://other.example" } }))).toBe(false);
    expect(sameAppOrigin(new Request("http://0.0.0.0:3000/a", { headers: { ...headers, Host: "bad/host" } }))).toBe(false);
  });
});
