import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111", odooProjectId: "2550",
  updatedAt: "2026-10-28T14:00:00.000Z", items: [],
}));
vi.mock("../lib/store", () => ({
  getCalculation: vi.fn(async () => fixture), saveCalculation: vi.fn(async () => fixture),
  getSavedCalculationChangeReceipt: vi.fn(async () => ({ id: "receipt-test" })),
  CalculationConflictError: class extends Error {}, HistoricalReadonlyError: class extends Error {},
}));
import { PATCH } from "../app/api/projects/[projectId]/route";
import { GET, POST } from "../app/api/projects/[projectId]/collaboration/route";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("guardar y enviar sin consultar la IA", () => {
  it("registra el comprobante con contexto ligero y la misma sesión", async () => {
    vi.stubEnv("ODOO_INTERNAL_BASE_URL", "http://odoo.test");
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("Cookie")).toBe("session_id=normal-user");
      if (url.endsWith("/cost-version-auth")) return new Response(null, { status: 204 });
      if (url.endsWith("/collaboration?accessOnly=1")) return Response.json({ csrfToken: "csrf-test" });
      if (url.endsWith("/record-change")) {
        expect(String(init.body)).toContain("receipt_id=receipt-test");
        return Response.json({ ok: true });
      }
      throw new Error("La escritura intentó consultar el servicio IA");
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await PATCH(new Request("http://localhost:3000/api/projects/" + fixture.id, {
      method: "PATCH", headers: { Cookie: "session_id=normal-user", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: fixture.updatedAt, name: "Laboratorio ficticio" }),
    }), { params: Promise.resolve({ projectId: fixture.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).odooCollaborationWarning).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("envía un mensaje con ACL/CSRF sin cargar primero toda la conversación", async () => {
    vi.stubEnv("ODOO_INTERNAL_BASE_URL", "http://odoo.test");
    vi.stubEnv("FINANCIAL_ALLOWED_ORIGINS", "http://localhost:3000");
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/collaboration?accessOnly=1")) return Response.json({ canMessage: true, taskId: 9251, csrfToken: "csrf-test" });
      if (url.endsWith("/message")) return Response.json({ accepted: true });
      throw new Error("No debe cargar la conversación antes del envío");
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(new Request("http://localhost:3000/api/projects/" + fixture.id + "/collaboration", {
      method: "POST", headers: { Cookie: "session_id=normal-user", Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Ejemplo ficticio", requestId: "22222222-2222-4222-8222-222222222222", expectedUpdatedAt: fixture.updatedAt }),
    }), { params: Promise.resolve({ projectId: fixture.id }) });
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const denied = await POST(new Request("http://localhost:3000/api/projects/" + fixture.id + "/collaboration", {
      method: "POST", headers: { Origin: "http://other.test" }, body: "{}",
    }), { params: Promise.resolve({ projectId: fixture.id }) });
    expect(denied.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

it("expone el contexto de envío ligero sin consultar historial ni IA", async () => {
 vi.stubEnv("ODOO_INTERNAL_BASE_URL","http://odoo.test");
 const fetcher=vi.fn(async (url: string)=>{
  expect(url).toBe(`http://odoo.test/caf/finanzas/calculations/${fixture.id}/collaboration?accessOnly=1`);
  return Response.json({canMessage:true,taskId:9251,csrfToken:"normal-csrf"});
 });
 vi.stubGlobal("fetch",fetcher);
 const result=await GET(new Request(`http://localhost:3000/api/projects/${fixture.id}/collaboration?accessOnly=1`,{headers:{Cookie:"session_id=normal-user"}}),{params:Promise.resolve({projectId:fixture.id})});
 expect(result.status).toBe(200);
 expect(await result.json()).toEqual({canMessage:true,taskId:9251,csrfToken:"normal-csrf",calculationUpdatedAt:fixture.updatedAt});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
