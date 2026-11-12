import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeImportPayload, sampleImportPayload, toCalculation } from "../lib/contract";
import { applyPriceBasePatch, capturePriceBase, restorePriceBase } from "../lib/price-base";
import {
  applyPriceBaseRevision, createProjectScenario, getProject, importProject,
  listPriceBaseVersions, restorePriceBaseVersion, restoreProjectScenario, saveProject,
  saveManualPriceBaseVersion,
} from "../lib/store";

describe("versiones de precios base", () => {
  it("aplica una revisión una sola vez, conserva oferta y permite volver a una base anterior", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-base-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const imported = await importProject(payload);
      const original = imported.items[0]!;
      const withOffer = await saveProject(imported.id, {
        settings: { manualReferenceTotal: 1000 },
        items: imported.items.map((item, index) => index === 0
          ? { ...item, discountPct: 7, offerMode: "discount", manualUnitCost: 12345 }
          : item),
      });
      expect(withOffer).not.toBeNull();
      const scenario = await createProjectScenario(imported.id, "Oferta inicial");
      expect(scenario).not.toBeNull();
      const patch = {
        projectId: imported.id,
        odooProjectId: "1972",
        jobId: "7e89d4d0-a165-4e9c-b7da-67c275bdcb34",
        expectedUpdatedAt: withOffer!.updatedAt,
        items: [{
          id: original.id,
          item: original.item,
          referenceUnit: 98765,
          expectedNotes: original.notes,
          notes: "Referencia de compra corregida.",
          priceSources: [{
            id: "new-source", label: "Proveedor comprobado", unitPrice: 54000,
            currency: "COP" as const, url: "https://example.com/item", notes: "Cotización",
            trm: null, importPct: null,
          }],
        }],
      };
      const first = await applyPriceBaseRevision(patch);
      expect(first?.status).toBe("applied");
      expect(first?.project.items[0]).toMatchObject({
        referenceUnit: 98765, discountPct: 7, offerMode: "discount", manualUnitCost: 12345,
      });
      expect(first?.project.items[0]?.priceSources).toHaveLength(1);
      expect(first?.project.items[0]?.notes).toBe("Referencia de compra corregida.");
      const retry = await applyPriceBaseRevision(patch);
      expect(retry?.status).toBe("already_applied");
      expect(retry?.project.updatedAt).toBe(first?.project.updatedAt);
      expect(await listPriceBaseVersions(imported.id)).toHaveLength(2);
      await expect(applyPriceBaseRevision({ ...patch, items: [{ ...patch.items[0], referenceUnit: 1 }] }))
        .rejects.toThrow(/otros precios/);
      await saveProject(imported.id, { settings: { manualReferenceTotal: 2000 } });
      const restoredScenario = await restoreProjectScenario(imported.id, scenario!.id);
      expect(restoredScenario?.items[0]?.referenceUnit).toBe(98765);
      expect(restoredScenario?.items[0]?.priceSources[0]?.id).toBe("new-source");
      expect(restoredScenario?.settings.manualReferenceTotal).toBe(2000);
      const versions = await listPriceBaseVersions(imported.id);
      const restoredBase = await restorePriceBaseVersion(imported.id, versions[1]!.id, restoredScenario!.updatedAt);
      expect(restoredBase?.project.items[0]?.referenceUnit).toBe(original.referenceUnit);
      expect(restoredBase?.project.items[0]?.discountPct).toBe(7);
      expect(restoredBase?.project.items[0]?.manualUnitCost).toBe(12345);
      expect(restoredBase?.project.items[0]?.notes).toBe(original.notes);
      expect(restoredBase?.project.settings.manualReferenceTotal).toBe(1000);
      expect((await getProject(imported.id))?.id).toBe(imported.id);
      const afterRestore = await listPriceBaseVersions(imported.id);
      expect(afterRestore).toHaveLength(4);
      expect(afterRestore[1]?.source).toBe("manual");
      expect(afterRestore[1]?.manualReferenceTotal).toBe(2000);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("conserva una nota humana posterior al estudio original", async () => {
    const project = toCalculation(normalizeImportPayload(sampleImportPayload()), "preview", new Date().toISOString());
    const row = project.items[0]!;
    const edited = { ...row, notes: "Nota corregida manualmente" };
    const patched = applyPriceBasePatch([edited], [{
      id: row.id, item: row.item, expectedNotes: row.notes,
      notes: "Nota propuesta por IA", referenceUnit: 1234,
    }]);
    expect(patched[0]?.notes).toBe("Nota corregida manualmente");
    expect(patched[0]?.referenceUnit).toBe(1234);
  });

  it("no reinserta una fila de una versión heredada sin ficha estructural completa", () => {
    const project = toCalculation(normalizeImportPayload(sampleImportPayload()), "preview", new Date().toISOString());
    const current = project.items[0]!;
    const incomplete = {
      ...capturePriceBase([current])[0]!,
      id: "legacy-missing-row",
      item: "54",
    } as any;
    delete incomplete.description;
    expect(() => restorePriceBase([current], [capturePriceBase([current])[0]!, incomplete]))
      .toThrow(/heredada.*ficha completa/);
  });

  it("impide reemplazar techos o fuentes que una persona corrigió desde el estudio original", () => {
    const project = toCalculation(normalizeImportPayload(sampleImportPayload()), "preview", new Date().toISOString());
    const row = project.items[0]!;
    const revisedSources = [{ ...row.priceSources[0]!, unitPrice: 12345 }];
    const patch = {
      id: row.id, item: row.item, referenceUnit: 99999,
      expectedReferenceUnit: row.referenceUnit,
      priceSources: revisedSources, expectedPriceSources: row.priceSources,
    };
    expect(() => applyPriceBasePatch([{ ...row, referenceUnit: 88888 }], [patch]))
      .toThrow(/cambiaron desde el estudio original/);
    expect(() => applyPriceBasePatch([{ ...row, priceSources: [{ ...row.priceSources[0]!, unitPrice: 88888 }] }], [patch]))
      .toThrow(/cambiaron desde el estudio original/);
    expect(applyPriceBasePatch([row], [patch])[0]?.referenceUnit).toBe(99999);
  });

  it("rechaza conflictos y filas ambiguas sin escribir una versión", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-base-conflict-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const payload = sampleImportPayload() as any;
      payload.calculation.odoo_project_id = "1972";
      const project = await importProject(payload);
      const row = project.items[0]!;
      const base = {
        projectId: project.id, odooProjectId: "1972",
        jobId: "f94a1025-fdd7-4ea8-a31f-6825504b48da",
        expectedUpdatedAt: project.updatedAt,
        items: [{ id: row.id, item: row.item, referenceUnit: 500 }],
      };
      await expect(applyPriceBaseRevision({ ...base, odooProjectId: "otro" })).rejects.toThrow(/vínculo/);
      await expect(applyPriceBaseRevision({ ...base, items: [base.items[0], base.items[0]] })).rejects.toThrow(/dos veces/);
      await expect(applyPriceBaseRevision({ ...base, items: [{ ...base.items[0], item: "incorrecto" }] }))
        .rejects.toThrow(/no coincide/);
      await expect(applyPriceBaseRevision({ ...base, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }))
        .rejects.toThrow(/cambió/);
      expect(await listPriceBaseVersions(project.id)).toHaveLength(0);
      expect((await getProject(project.id))?.items[0]?.referenceUnit).toBe(row.referenceUnit);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("guarda una base manual separada y no duplica una versión sin cambios", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-manual-base-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const project = await importProject(sampleImportPayload());
      const first = await saveManualPriceBaseVersion(project.id, project.updatedAt);
      expect(first?.status).toBe("saved");
      const duplicate = await saveManualPriceBaseVersion(project.id, project.updatedAt);
      expect(duplicate?.status).toBe("no_changes");
      expect(duplicate?.version.id).toBe(first?.version.id);
      expect(await listPriceBaseVersions(project.id)).toHaveLength(1);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // Retain DEV regressions when converging with current production.
  it("recupera los datos y decisiones de costo previos a una corrección equivocada de IA", () => {
    const project = toCalculation(normalizeImportPayload(sampleImportPayload()), "preview", new Date().toISOString());
    const original = {
      ...project.items[0]!,
      sourceOriginal: undefined,
      technicalAnnex: [],
      costBasisStatus: null,
      manualCostReviewed: false,
      additionalCostsReviewed: false,
    };
    const priorBase = JSON.parse(JSON.stringify(capturePriceBase([original])));
    const changed = {
      ...original,
      sourceOriginal: {
        description: "Ficha equivocada", technical_description: "Otro ítem",
        quantity: "1", unit: "UN", ceiling_unit_price: "", document: "anexo.pdf", locator: "p. 3",
      },
      technicalAnnex: [{ document: "anexo.pdf", locator: "p. 3", text: "Otro producto" }],
      costBasisStatus: "pending" as const,
      manualCostReviewed: true,
      additionalCostsReviewed: true,
      offerMode: "manual" as const,
      manualOfferUnit: 42000,
    };
    const [restored] = restorePriceBase([changed], priorBase);
    expect(restored?.sourceOriginal).toBeUndefined();
    expect(restored?.technicalAnnex).toEqual([]);
    expect(restored?.costBasisStatus).toBeNull();
    expect(restored?.manualCostReviewed).toBe(false);
    expect(restored?.additionalCostsReviewed).toBe(false);
    expect(restored?.offerMode).toBe("manual");
    expect(restored?.manualOfferUnit).toBe(42000);
  });

  it("recupera la TRM y el porcentaje global de importación de una base USD", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-base-usd-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const imported = await importProject(sampleImportPayload());
      const baseline = await saveProject(imported.id, {
        settings: { usdToCopRate: 4000, usdImportPct: 15 },
      }, imported.updatedAt);
      const saved = await saveManualPriceBaseVersion(imported.id, baseline!.updatedAt);
      const changed = await saveProject(imported.id, {
        settings: { usdToCopRate: 5000, usdImportPct: 30 },
      }, baseline!.updatedAt);
      const restored = await restorePriceBaseVersion(imported.id, saved!.version.id, changed!.updatedAt);
      expect(restored?.project.settings.usdToCopRate).toBe(4000);
      expect(restored?.project.settings.usdImportPct).toBe(15);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("recupera criterios de fuentes y referencia sin cambiar la oferta", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-base-analysis-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const imported = await importProject(sampleImportPayload());
      const row = imported.items[0]!;
      const sourceId = row.priceSources[0]?.id;
      expect(sourceId).toBeTruthy();
      const baseline = await saveProject(imported.id, {
        settings: { analysisReferenceIncluded: false, manualReferenceTotal: 900_000 },
        items: imported.items.map((item) => item.id === row.id
          ? { ...item, analysisExcludedPriceSourceIds: [sourceId!],
              analysisCostStatistic: "median" as const, analysisReferenceIncluded: false,
              offerMode: "manual" as const, manualOfferUnit: 72_000 }
          : item),
      }, imported.updatedAt);
      const saved = await saveManualPriceBaseVersion(imported.id, baseline!.updatedAt);
      const changed = await saveProject(imported.id, {
        settings: { analysisReferenceIncluded: true, manualReferenceTotal: 910_000 },
        items: baseline!.items.map((item) => item.id === row.id
          ? { ...item, analysisExcludedPriceSourceIds: [], analysisCostStatistic: null,
              analysisReferenceIncluded: true, manualOfferUnit: 73_000 }
          : item),
      }, baseline!.updatedAt);
      const restored = await restorePriceBaseVersion(imported.id, saved!.version.id, changed!.updatedAt);
      expect(restored?.project.settings.analysisReferenceIncluded).toBe(false);
      expect(restored?.project.settings.manualReferenceTotal).toBe(900_000);
      expect(restored?.project.items[0]).toMatchObject({
        analysisExcludedPriceSourceIds: [sourceId], analysisCostStatistic: "median",
        analysisReferenceIncluded: false, offerMode: "manual", manualOfferUnit: 73_000,
      });
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("una base histórica sin techo global guardado conserva el techo actual", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-price-base-legacy-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const imported = await importProject(sampleImportPayload());
      const saved = await saveManualPriceBaseVersion(imported.id, imported.updatedAt);
      const storePath = path.join(dir, "data", "financial-offer", "projects.json");
      const stored = JSON.parse(await fs.readFile(storePath, "utf8"));
      const version = stored.priceBaseVersions.find((entry: { id: string }) => entry.id === saved!.version.id);
      expect(version).toBeTruthy();
      delete version.manualReferenceTotal;
      await fs.writeFile(storePath, JSON.stringify(stored), "utf8");
      const withCeiling = await saveProject(imported.id, {
        settings: { manualReferenceTotal: 1_500_000 },
      }, imported.updatedAt);
      const restored = await restorePriceBaseVersion(imported.id, saved!.version.id, withCeiling!.updatedAt);
      expect(restored?.project.settings.manualReferenceTotal).toBe(1_500_000);
    } finally {
      cwd.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
