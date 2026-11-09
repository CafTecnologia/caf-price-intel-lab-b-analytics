import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { sampleImportPayload } from "../lib/contract";
import {
  createProjectScenario,
  freezeCalculation,
  getProject,
  importProject,
  resetCalculation,
  saveProject,
  unfreezeCalculation,
} from "../lib/store";

describe("histórico comercial de solo lectura", () => {
  it("permite consultar y bloquea cambios, reinicio y escenarios después de congelar", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-financial-readonly-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "recepcion-qa";
      const project = await importProject(payload);
      const frozen = await freezeCalculation(project.id, { odooProjectId: "recepcion-qa" });

      expect(frozen?.readOnly).toBe(true);
      expect(frozen?.frozenAt).toBeTruthy();
      expect((await getProject(project.id))?.items.length).toBeGreaterThan(0);
      await expect(saveProject(project.id, { name: "Cambio indebido" })).rejects.toThrow(/solo lectura/);
      await expect(resetCalculation(project.id)).rejects.toThrow(/solo lectura/);
      await expect(createProjectScenario(project.id, "Escenario indebido")).rejects.toThrow(/solo lectura/);
      expect((await getProject(project.id))?.name).toBe(project.name);
      const editable = await unfreezeCalculation(project.id, { odooProjectId: "recepcion-qa" });
      expect(editable?.readOnly).toBe(false);
      expect(editable?.frozenAt).toBeNull();
      await expect(saveProject(project.id, { name: "Edición reactivada" })).resolves.toBeTruthy();
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rechaza congelar un cálculo con identidad Odoo distinta", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-financial-readonly-link-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "correcto";
      const project = await importProject(payload);
      await expect(freezeCalculation(project.id, { odooProjectId: "otro" })).rejects.toThrow(/no coincide/);
      expect((await getProject(project.id))?.readOnly).toBe(false);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
