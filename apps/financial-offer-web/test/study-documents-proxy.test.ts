import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxyStudyDocuments } from "../lib/study-documents-proxy";
import { proxyOdooSession } from "../lib/odoo-collaboration";
vi.mock("../lib/odoo-collaboration", () => ({ proxyOdooSession: vi.fn(), isOdooLoginRedirect: (r: Response) => r.status >= 300 && r.status < 400 }));
const CALC = "12345678-1234-4234-8234-123456789abc";
const FILE = "test_pdf_file_12345";
const mocked = vi.mocked(proxyOdooSession);
describe("archivos del estudio: sesión y alcance", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rechaza IDs y rutas arbitrarios antes de contactar Odoo", async () => {
    expect((await proxyStudyDocuments(new Request("http://app/documents"), "../admin")).status).toBe(404);
    expect((await proxyStudyDocuments(new Request("http://app/documents"), CALC, "../../secret")).status).toBe(404);
    expect(mocked).not.toHaveBeenCalled();
  });
  it("limita parámetros a carpeta/página, sin URL ni raíz aportada", async () => {
    mocked.mockResolvedValue(new Response('{"files":[]}', { headers: { "Content-Type": "application/json" } }));
    const request = new Request("http://app/documents?folder=folder_12345&page=next%2Bpage&root=other&url=http://private", { headers: { Cookie: "session_id=normal-user" } });
    const response = await proxyStudyDocuments(request, CALC);
    expect(mocked.mock.calls[0][0]).toBe(request);
    expect(mocked.mock.calls[0][1]).toBe(`/caf/finanzas/calculations/${CALC}/documents?folder=folder_12345&page=next%2Bpage`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });
  it("convierte sesión vencida en error sin navegar fuera", async () => {
    mocked.mockResolvedValue(new Response(null, { status: 303, headers: { Location: "/web/login" } }));
    const response = await proxyStudyDocuments(new Request("http://app/documents"), CALC, FILE);
    expect(response.status).toBe(401);
    expect(response.headers.has("Location")).toBe(false);
  });
  it("propaga denegación del cálculo sin entregar datos", async () => {
    mocked.mockResolvedValue(Response.json({ error: "Sin acceso" }, { status: 404 }));
    const response = await proxyStudyDocuments(new Request("http://app/documents"), CALC);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Sin acceso" });
  });
  it("entrega binario privado sin cookies ni encabezados de terceros", async () => {
    mocked.mockResolvedValue(new Response("%PDF-prueba", { headers: { "Content-Type": "application/pdf", "Set-Cookie": "secret", "Content-Security-Policy": "sandbox" } }));
    const response = await proxyStudyDocuments(new Request("http://app/documents"), CALC, FILE);
    expect(await response.text()).toBe("%PDF-prueba");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(mocked.mock.calls[0][1].endsWith(`/documents/${FILE}`)).toBe(true);
  });
  it("fallo de Drive conserva mensaje útil y no expone error técnico", async () => {
    mocked.mockRejectedValue(new Error("Bearer-secret"));
    const response = await proxyStudyDocuments(new Request("http://app/documents"), CALC);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Bearer-secret");
  });
});
