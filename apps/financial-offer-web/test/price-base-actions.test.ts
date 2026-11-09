import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sampleImportPayload } from "../lib/contract";
import { importProject, listPriceBaseVersions } from "../lib/store";
import { POST } from "../app/api/projects/[projectId]/price-bases/actions/route";

afterEach(() => { delete process.env.ODOO_INTERNAL_BASE_URL; vi.unstubAllGlobals(); });

describe("guardar manualmente versiones de costos", () => {
  it("exige una sesión Odoo con edición y conserva el cálculo", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-actions-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const project = await importProject(payload);
      const url = `http://localhost:3000/api/projects/${project.id}/price-bases/actions`;
      const params = { params: Promise.resolve({ projectId: project.id }) };
      const body = JSON.stringify({ action: "save", expectedUpdatedAt: project.updatedAt });
      const request = (headers: Record<string, string> = {}) => new Request(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
      });
      expect((await POST(request(), params)).status).toBe(403);
      process.env.ODOO_INTERNAL_BASE_URL = "http://odoo.test:8069";
      const authorize = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", authorize);
      const saved = await POST(request({ Cookie: "session_id=test", Origin: "http://localhost:3000" }), params);
      expect(saved.status).toBe(200);
      expect((await saved.json()).status).toBe("saved");
      expect(authorize).toHaveBeenCalledOnce();
      expect(await listPriceBaseVersions(project.id)).toHaveLength(1);
      expect((await POST(request({ Cookie: "session_id=test", Origin: "https://other.test" }), params)).status).toBe(403);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
