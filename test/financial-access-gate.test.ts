import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const root = "http://127.0.0.1:18030";
const importToken = "i".repeat(48);
const priceToken = "p".repeat(48);
const deleteToken = "d".repeat(48);
const originalEnv = {
  base: process.env.ODOO_INTERNAL_BASE_URL,
  importToken: process.env.FINANCIAL_IMPORT_TOKEN,
  priceToken: process.env.FINANCIAL_PRICE_BASE_TOKEN,
  deleteToken: process.env.FINANCIAL_DELETE_SERVICE_TOKEN,
  origins: process.env.FINANCIAL_ALLOWED_ORIGINS,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
};

function request(path: string, options: { method?: string; session?: string; origin?: string; bearer?: string } = {}) {
  return new NextRequest(`${root}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Host: "127.0.0.1:18030",
      ...(options.session ? { Cookie: `session_id=${options.session}` } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
    },
  });
}

beforeEach(() => {
  process.env.ODOO_INTERNAL_BASE_URL = "http://odoo.test:8069";
  process.env.FINANCIAL_IMPORT_TOKEN = importToken;
  process.env.FINANCIAL_PRICE_BASE_TOKEN = priceToken;
  process.env.FINANCIAL_DELETE_SERVICE_TOKEN = deleteToken;
  delete process.env.FINANCIAL_ALLOWED_ORIGINS;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
});
afterEach(() => {
  for (const [key, value] of [
    ["ODOO_INTERNAL_BASE_URL", originalEnv.base],
    ["FINANCIAL_IMPORT_TOKEN", originalEnv.importToken],
    ["FINANCIAL_PRICE_BASE_TOKEN", originalEnv.priceToken],
    ["FINANCIAL_DELETE_SERVICE_TOKEN", originalEnv.deleteToken],
    ["FINANCIAL_ALLOWED_ORIGINS", originalEnv.origins],
    ["NEXT_PUBLIC_BASE_PATH", originalEnv.basePath],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("puerta global de Finanzas", () => {
  it("sin sesión no sirve páginas ni API de datos o escritura y no llama al almacén/Odoo", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const page = await middleware(request("/calculations/abc"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/access?reason=login");
    for (const path of ["/api/projects", "/api/projects/abc", "/api/projects/abc/export", "/api/projects/abc/scenarios"]) {
      const response = await middleware(request(path));
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("ODOO_LOGIN_REQUIRED");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect((await middleware(request("/api/import", { method: "POST", origin: root }))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("valida la sesión en cada petición y cierra cuando caduca o Odoo no responde", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new Error("Odoo fuera de servicio"));
    vi.stubGlobal("fetch", upstream);
    const first = await middleware(request("/api/projects", { session: "session-test" }));
    expect(first.headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(request("/api/projects", { session: "session-test" }))).status).toBe(401);
    const unavailable = await middleware(request("/api/projects", { session: "session-test" }));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).code).toBe("ODOO_AUTH_UNAVAILABLE");
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(upstream.mock.calls[0][1].headers.Cookie).toBe("session_id=session-test");
  });

  it("rechaza usuario sin acceso y cambios desde otro origen aunque la sesión sea válida", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", upstream);
    expect((await middleware(request("/api/projects", { session: "session-test" }))).status).toBe(403);
    expect((await middleware(request("/api/projects", { method: "POST", session: "session-test", origin: "http://127.0.0.1:18031" }))).status).toBe(403);
    const accepted = await middleware(request("/api/projects", { method: "POST", session: "session-test", origin: root }));
    expect(accepted.headers.get("x-middleware-next")).toBe("1");
    upstream.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const proxied = new NextRequest("http://127.0.0.1:18030/api/projects", {
      method: "POST",
      headers: {
        Host: "erp.caftecnologia.com",
        "X-Forwarded-Proto": "https",
        Origin: "https://erp.caftecnologia.com",
        Cookie: "session_id=session-test",
      },
    });
    expect((await middleware(proxied)).headers.get("x-middleware-next")).toBe("1");
  });

  it("conserva el prefijo público sin convertir 127.0.0.1 en localhost", async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/finanzas";
    const page = new NextRequest("http://127.0.0.1:18030/finanzas/calculations/abc", {
      headers: { Host: "127.0.0.1:18030" },
    });
    const result = await middleware(page);
    expect(result.status).toBe(307);
    expect(result.headers.get("location")).toBe("http://127.0.0.1:18030/finanzas/access?reason=login");
    const secure = new NextRequest("http://127.0.0.1:18030/finanzas/calculations/abc", {
      headers: { Host: "erp.caftecnologia.com", "X-Forwarded-Proto": "https" },
    });
    expect((await middleware(secure)).headers.get("location")).toBe("https://erp.caftecnologia.com/finanzas/access?reason=login");
    const machine = new NextRequest("http://127.0.0.1:18030/finanzas/api/import", {
      method: "POST", headers: { Host: "127.0.0.1:18030", Authorization: `Bearer ${importToken}` },
    });
    expect((await middleware(machine)).headers.get("x-middleware-next")).toBe("1");
  });

  it("un bearer solo pasa por su ruta de servicio y debe ser correcto", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const id = "123e4567-e89b-12d3-a456-426614174000";
    for (const [path, method, bearer] of [
      ["/api/import", "POST", importToken],
      ["/api/validate", "POST", importToken],
      [`/api/projects/${id}/operations`, "POST", priceToken],
      [`/api/projects/${id}/price-bases`, "GET", priceToken],
      [`/api/projects/${id}`, "GET", priceToken],
      [`/api/projects/${id}?deletionPreflight=1`, "GET", deleteToken],
      [`/api/projects/${id}`, "DELETE", deleteToken],
    ] as const) {
      const result = await middleware(request(path, { method, bearer }));
      expect(result.headers.get("x-middleware-next"), `${method} ${path}`).toBe("1");
    }
    expect((await middleware(request("/api/import", { method: "POST", bearer: priceToken }))).status).toBe(401);
    expect((await middleware(request("/api/projects", { bearer: importToken }))).status).toBe(401);
    expect((await middleware(request(`/api/projects/${id}`, { method: "POST", bearer: priceToken }))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
