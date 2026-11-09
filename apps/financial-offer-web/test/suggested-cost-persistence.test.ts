import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PATCH } from "../app/api/projects/[projectId]/route";
import { getProject, importProject } from "../lib/store";

describe("guardado de sugerencias y anexos", () => {
  it("conserva el estado elegido y los textos originales al recargar", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-suggestion-save-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const project = await importProject({
        version: 2,
        items: [{
          item: "1", name: "Equipo", description: "Ficha interpretada", quantity: 1,
          source_original: { description: "EQUIPO", document: "Oferta.pdf", locator: "fila 1" },
          technical_annex: [{ document: "Anexo.pdf", locator: "página 2", text: "Guía técnica literal.\nOtra línea." }],
          price_sources: [{ name: "Proveedor", unit_price: 100, currency: "COP" }],
          additional_costs: [{ name: "Instalación posible", amount: 30, review_status: "suggested" }],
        }],
      });
      const item = project.items[0]!;
      const request = new Request(`http://localhost/api/projects/${project.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: project.updatedAt,
          expectedItemIds: [item.id],
          items: [{ ...item, additionalCosts: [{ ...item.additionalCosts[0], reviewStatus: "included" }] }],
        }),
      });
      const response = await PATCH(request, { params: Promise.resolve({ projectId: project.id }) });
      expect(response.status).toBe(200);
      const saved = (await getProject(project.id))!.items[0]!;
      expect(saved.additionalCosts[0]?.reviewStatus).toBe("included");
      expect(saved.sourceOriginal?.description).toBe("EQUIPO");
      expect(saved.technicalAnnex?.[0]?.text).toBe("Guía técnica literal.\nOtra línea.");
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
