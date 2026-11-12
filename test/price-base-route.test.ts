import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sampleImportPayload } from "../lib/contract";
import { getProject, importProject, listPriceBaseVersions } from "../lib/store";
import { GET, POST } from "../app/api/projects/[projectId]/price-bases/route";

const token = "dev-test-price-base-token-longer-than-thirty-two-characters";
afterEach(() => { delete process.env.FINANCIAL_PRICE_BASE_TOKEN; });

describe("API de versiones de costos", () => {
  it("rechaza acceso sin credencial y aplica un JSON v2 al mismo cálculo", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-base-route-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const artifact = sampleImportPayload() as any;
      artifact.calculation.odoo_project_id = "1972";
      const calculation = await importProject(artifact);
      const params = { params: Promise.resolve({ projectId: calculation.id }) };
      const url = `http://localhost:3000/api/projects/${calculation.id}/price-bases`;
      const body = {
        odooProjectId: "1972",
        jobId: "f3d083fa-e1a3-4ff4-971e-285eeff39092",
        expectedUpdatedAt: calculation.updatedAt,
        artifact: {
          version: 2,
          items: [{
            item: calculation.items[0]!.item,
            name: calculation.items[0]!.description,
            quantity: calculation.items[0]!.quantity,
            unit: calculation.items[0]!.unit,
            ceiling_unit_price: 300000,
            price_sources: [{
              id: "test-quote", name: "Cotización nueva", unit_price: 250000,
              currency: "COP", url: "https://example.com/quote",
            }],
          }],
        },
      };
      const request = (authorization?: string) => new Request(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
        body: JSON.stringify(body),
      });
      delete process.env.FINANCIAL_PRICE_BASE_TOKEN;
      expect((await POST(request(), params)).status).toBe(503);
      process.env.FINANCIAL_PRICE_BASE_TOKEN = token;
      expect((await POST(request(), params)).status).toBe(401);
      const legacyRequest = new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, artifact }),
      });
      expect((await POST(legacyRequest, params)).status).toBe(400);
      expect((await getProject(calculation.id))?.updatedAt).toBe(calculation.updatedAt);
      expect((await listPriceBaseVersions(calculation.id))).toHaveLength(0);
      const applied = await POST(request(`Bearer ${token}`), params);
      expect(applied.status).toBe(200);
      const receipt = await applied.json();
      expect(receipt.status).toBe("applied");
      expect(receipt.calculationId).toBe(calculation.id);
      expect((await getProject(calculation.id))?.items[0]?.referenceUnit).toBe(300000);
      expect((await getProject(calculation.id))?.items[0]?.priceSources[0]?.unitPrice).toBe(250000);
      expect((await listPriceBaseVersions(calculation.id))).toHaveLength(2);
      const repeated = await POST(request(`Bearer ${token}`), params);
      expect((await repeated.json()).status).toBe("already_applied");
      const versions = await GET(new Request(url, { headers: { Authorization: `Bearer ${token}` } }), params);
      expect((await versions.json()).versions[0].active).toBe(true);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
