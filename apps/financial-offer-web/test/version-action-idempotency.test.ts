import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { sampleImportPayload } from "../lib/contract";
import {
  CalculationConflictError,
  createProjectScenario,
  getVersionActionReceipt,
  importProject,
  listPriceBaseVersions,
  listProjectScenarios,
  restorePriceBaseVersion,
  restoreProjectScenario,
  saveManualPriceBaseVersion,
  saveProject,
} from "../lib/store";

async function isolatedStore(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
  return async () => {
    cwd.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  };
}

describe("recibos idempotentes de versiones", () => {
  it("tolera doble clic y respuesta perdida al guardar y activar bases A-B-A", async () => {
    const cleanup = await isolatedStore("caf-version-actions-base-");
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const project = await importProject(payload);
      const saveAOperation = randomUUID();
      const [saveA, repeatedSaveA] = await Promise.all([
        saveManualPriceBaseVersion(project.id, project.updatedAt, saveAOperation),
        saveManualPriceBaseVersion(project.id, project.updatedAt, saveAOperation),
      ]);
      expect(repeatedSaveA?.version.id).toBe(saveA?.version.id);
      expect(await listPriceBaseVersions(project.id)).toHaveLength(1);
      expect(await getVersionActionReceipt(saveAOperation, project.id, "price_base"))
        .toMatchObject({ status: "saved", targetId: saveA?.version.id });

      const changed = await saveProject(project.id, {
        items: project.items.map((item, index) => index ? item : {
          ...item,
          manualOfferUnit: 765432,
          offerMode: "manual",
          priceSources: [{ ...item.priceSources[0]!, id: "human-quote", unitPrice: 54321 }],
        }),
      }, project.updatedAt);
      const saveB = await saveManualPriceBaseVersion(changed!.id, changed!.updatedAt, randomUUID());
      expect(saveB?.status).toBe("saved");

      const restoreAOperation = randomUUID();
      const [restoredA, repeatedRestoredA] = await Promise.all([
        restorePriceBaseVersion(project.id, saveA!.version.id, changed!.updatedAt, restoreAOperation),
        restorePriceBaseVersion(project.id, saveA!.version.id, changed!.updatedAt, restoreAOperation),
      ]);
      expect(repeatedRestoredA?.project.updatedAt).toBe(restoredA?.project.updatedAt);
      expect(restoredA?.project.items[0]?.manualOfferUnit).toBe(765432);
      expect(restoredA?.project.items[0]?.priceSources[0]?.id).not.toBe("human-quote");

      const restoredB = await restorePriceBaseVersion(
        project.id, saveB!.version.id, restoredA!.project.updatedAt, randomUUID(),
      );
      expect(restoredB?.project.items[0]?.priceSources[0]?.id).toBe("human-quote");
      expect(restoredB?.project.items[0]?.manualOfferUnit).toBe(765432);
      const backToA = await restorePriceBaseVersion(
        project.id, saveA!.version.id, restoredB!.project.updatedAt, randomUUID(),
      );
      expect(backToA?.project.items[0]?.manualOfferUnit).toBe(765432);

      const noOpOperation = randomUUID();
      const noOp = await restorePriceBaseVersion(
        project.id, saveA!.version.id, backToA!.project.updatedAt, noOpOperation,
      );
      expect(noOp?.status).toBe("no_changes");
      expect(noOp?.project.updatedAt).toBe(backToA?.project.updatedAt);
      expect(await getVersionActionReceipt(noOpOperation)).toMatchObject({ status: "no_changes" });

      await expect(saveManualPriceBaseVersion(
        project.id, project.updatedAt, randomUUID(),
      )).rejects.toBeInstanceOf(CalculationConflictError);
      await expect(restorePriceBaseVersion(
        project.id, saveB!.version.id, backToA!.project.updatedAt, restoreAOperation,
      )).rejects.toThrow(/operationId/);
    } finally {
      await cleanup();
    }
  });

  it("guarda y activa escenarios con conflicto, no-op e idempotencia A-B-A", async () => {
    const cleanup = await isolatedStore("caf-version-actions-scenario-");
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const project = await importProject(payload);
      const saveAOperation = randomUUID();
      const [scenarioA, duplicateA] = await Promise.all([
        createProjectScenario(project.id, "A", "", null, project.updatedAt, saveAOperation),
        createProjectScenario(project.id, "A", "", null, project.updatedAt, saveAOperation),
      ]);
      expect(duplicateA?.id).toBe(scenarioA?.id);
      expect(await listProjectScenarios(project.id)).toHaveLength(1);

      const offerB = await saveProject(project.id, {
        items: project.items.map((item, index) => index ? item : {
          ...item, offerMode: "manual", manualOfferUnit: 222222,
        }),
      }, project.updatedAt);
      const scenarioB = await createProjectScenario(
        project.id, "B", "", null, offerB!.updatedAt, randomUUID(),
      );

      const restoreAOperation = randomUUID();
      const [activeA, repeatedA] = await Promise.all([
        restoreProjectScenario(project.id, scenarioA!.id, offerB!.updatedAt, restoreAOperation),
        restoreProjectScenario(project.id, scenarioA!.id, offerB!.updatedAt, restoreAOperation),
      ]);
      expect(repeatedA?.updatedAt).toBe(activeA?.updatedAt);
      expect(activeA?.items[0]?.manualOfferUnit).toBe(project.items[0]?.manualOfferUnit);

      const activeB = await restoreProjectScenario(
        project.id, scenarioB!.id, activeA!.updatedAt, randomUUID(),
      );
      expect(activeB?.items[0]?.manualOfferUnit).toBe(222222);
      const backToA = await restoreProjectScenario(
        project.id, scenarioA!.id, activeB!.updatedAt, randomUUID(),
      );
      const noOpOperation = randomUUID();
      const noOp = await restoreProjectScenario(
        project.id, scenarioA!.id, backToA!.updatedAt, noOpOperation,
      );
      expect(noOp?.updatedAt).toBe(backToA?.updatedAt);
      expect(await getVersionActionReceipt(noOpOperation)).toMatchObject({ status: "no_changes" });

      await expect(createProjectScenario(
        project.id, "stale", "", null, project.updatedAt, randomUUID(),
      )).rejects.toBeInstanceOf(CalculationConflictError);
      await expect(restoreProjectScenario(
        project.id, scenarioB!.id, backToA!.updatedAt, restoreAOperation,
      )).rejects.toThrow(/operationId/);
    } finally {
      await cleanup();
    }
  });
});
