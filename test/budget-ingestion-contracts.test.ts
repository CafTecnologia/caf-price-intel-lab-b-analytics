import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getOperations } from "../app/api/projects/[projectId]/operations/route";
import { PATCH as patchProject } from "../app/api/projects/[projectId]/route";
import { CalculationOperationsSchema } from "../lib/calculation-operations";
import { normalizeImportPayload, toCalculation } from "../lib/contract";
import { buildProjectExport } from "../lib/export";
import {
  applyCalculationOperations,
  getCalculationOperationReceipt,
  getProject,
  importProject,
  listPriceBaseVersions,
  restorePriceBaseVersion,
  saveProject,
} from "../lib/store";

let tempDir: string | null = null;
let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

afterEach(async () => {
  cwdSpy?.mockRestore();
  cwdSpy = null;
  delete process.env.FINANCIAL_PRICE_BASE_TOKEN;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function isolatedStore(prefix: string) {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
}

function publicItem(name: string, deliverableType?: "product" | "service", pendingCost = false) {
  return {
    name,
    description: `Ficha ${name}`,
    ...(deliverableType === undefined ? {} : { deliverable_type: deliverableType }),
    quantity: 1,
    unit: "UND",
    ceiling_unit_price: null,
    price_sources: [{ id: `source-${name}`, name: "Proveedor", unit_price: 8_000_000, currency: "COP" as const }],
    ...(pendingCost ? {
      additional_costs: [{ id: "installation", name: "Instalación", category: "service" as const, mode: "fixed" as const, amount: null }],
    } : {}),
  };
}

function operationBase(projectId: string, updatedAt: string, operationId: string) {
  return {
    projectId,
    odooProjectId: "2015",
    externalRunId: "budget-run-2015",
    jobId: "budget-review-2015",
    operationId,
    expectedUpdatedAt: updatedAt,
  };
}

describe("contratos de presupuesto global y clasificación", () => {
  it("contrato 1: legacy queda sin clasificar y las referencias globales negativas se rechazan sin negar cero", () => {
    const legacy = toCalculation(normalizeImportPayload({
      project: { name: "Legacy" },
      items: [{ description: "Ítem legado" }],
      settings: {},
    }), "legacy", "2026-10-01T00:00:00.000Z");
    expect(legacy.items[0]?.deliverableType).toBeNull();

    expect(() => normalizeImportPayload({
      version: 2,
      settings: { manual_reference_total: -1 },
      items: [publicItem("Equipo")],
    })).toThrow(/no negativo/);
    expect(() => normalizeImportPayload({
      calculation: { name: "Negativo" },
      items: [{ description: "Equipo" }],
      settings: { global_reference_total: -1 },
    })).toThrow(/no negativo/);
    expect(toCalculation(normalizeImportPayload({
      version: 2,
      settings: { manual_reference_total: 0 },
      items: [publicItem("Equipo")],
    }), "zero", "2026-10-01T00:00:00.000Z").settings.manualReferenceTotal).toBe(0);
  });

  it("contratos 1 y 4: omisión conserva, null explícito limpia y reordenar filas sin código no cruza datos", async () => {
    await isolatedStore("caf-budget-reimport-");
    const first = await importProject({
      version: 2,
      source: { system: "budget-qa", run_id: "stable-run" },
      settings: { manual_reference_total: 13_000_000 },
      items: [publicItem("Equipo A", "product"), publicItem("Equipo B", "service")],
    });
    const edited = await saveProject(first.id, {
      items: first.items.map((item) => item.description === "Equipo A"
        ? { ...item, additionalCosts: [{ id: "human-a", name: "Instalación A", category: "service", mode: "fixed", amount: 100, notes: "" }] }
        : item),
    }, first.updatedAt);
    const reordered = await importProject({
      version: 2,
      source: { system: "budget-qa", run_id: "stable-run" },
      items: [publicItem("Equipo B"), publicItem("Equipo A")],
    });
    expect(reordered.settings.manualReferenceTotal).toBe(13_000_000);
    expect(reordered.items.map((item) => [item.description, item.deliverableType, item.additionalCosts[0]?.amount ?? null])).toEqual([
      ["Equipo B", "service", null],
      ["Equipo A", "product", 100],
    ]);

    const cleared = await importProject({
      version: 2,
      source: { system: "budget-qa", run_id: "stable-run" },
      settings: { manual_reference_total: null },
      items: [publicItem("Equipo B"), publicItem("Equipo A")],
    });
    expect(edited).not.toBeNull();
    expect(cleared.settings.manualReferenceTotal).toBeNull();
  });

  it("contratos 2 y 3: acepta 13 millones sin prorrateo y un servicio asociado pendiente", () => {
    const calculation = toCalculation(normalizeImportPayload({
      version: 2,
      settings: { manual_reference_total: 13_000_000 },
      items: [publicItem("Equipo", "service", true)],
    }), "global-budget", "2026-10-01T00:00:00.000Z");

    expect(calculation.settings.manualReferenceTotal).toBe(13_000_000);
    expect(calculation.items[0]).toMatchObject({
      deliverableType: "service",
      referenceUnit: null,
      additionalCosts: [{ id: "installation", amount: null }],
    });
    expect(calculation.items[0]?.priceSources[0]?.unitPrice).toBe(8_000_000);
  });

  it("contratos 4 y 5: versiona campos, protege ediciones humanas y reintenta mediante recibo", async () => {
    await isolatedStore("caf-budget-operations-");
    const project = await importProject({
      version: 2,
      source: { system: "odoo_caf", run_id: "budget-run-2015", odoo_project_id: "2015" },
      items: [{ item: "1", ...publicItem("Equipo", "product", true) }],
    });
    const row = project.items[0]!;
    const input = {
      ...operationBase(project.id, project.updatedAt, "set-budget-and-service"),
      operations: [{
        type: "set_project_reference" as const,
        manual_reference_total: 13_000_000,
        expected: { manual_reference_total: null },
      }, {
        type: "update_item" as const,
        itemId: row.id,
        patch: { deliverable_type: "service" as const },
        expected: { deliverable_type: "product" as const },
      }],
    };

    const receipt = await applyCalculationOperations(input);
    expect(receipt?.changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(["manual_reference_total", "deliverable_type"]),
    );
    expect(await applyCalculationOperations(input)).toEqual(receipt);
    expect(await getCalculationOperationReceipt(input.operationId)).toEqual(receipt);
    expect(() => CalculationOperationsSchema.parse({
      ...operationBase(project.id, project.updatedAt, "negative-reference"),
      operations: [{ type: "set_project_reference", manual_reference_total: -1, expected: { manual_reference_total: null } }],
    })).toThrow();

    const afterOperation = (await getProject(project.id))!;
    const exported = buildProjectExport(afterOperation);
    expect(exported.project.settings.manualReferenceTotal).toBe(13_000_000);
    expect(exported.project.items[0]?.deliverableType).toBe("service");
    const human = await saveProject(project.id, {
      settings: { manualReferenceTotal: 12_000_000 },
      items: afterOperation.items.map((item) => ({
        ...item, deliverableType: null, offerMode: "manual" as const, manualOfferUnit: 12_500_000,
      })),
    }, afterOperation.updatedAt);

    await expect(applyCalculationOperations({
      ...operationBase(project.id, human!.updatedAt, "stale-project-reference"),
      operations: [{ type: "set_project_reference", manual_reference_total: 14_000_000, expected: { manual_reference_total: 13_000_000 } }],
    })).rejects.toMatchObject({ field: "manual_reference_total", expected: 13_000_000, actual: 12_000_000 });
    await expect(applyCalculationOperations({
      ...operationBase(project.id, human!.updatedAt, "stale-deliverable"),
      operations: [{ type: "update_item", itemId: row.id, patch: { deliverable_type: "product" }, expected: { deliverable_type: "service" } }],
    })).rejects.toMatchObject({ field: "deliverable_type", expected: "service", actual: null });

    const versions = await listPriceBaseVersions(project.id);
    expect(versions[1]).toMatchObject({ manualReferenceTotal: null });
    expect(versions[1]?.snapshot[0]?.deliverableType).toBe("product");
    expect(versions[0]).toMatchObject({ manualReferenceTotal: 13_000_000 });
    expect(versions[0]?.snapshot[0]?.deliverableType).toBe("service");
    const restored = await restorePriceBaseVersion(project.id, versions[1]!.id, human!.updatedAt);
    expect(restored?.project.settings.manualReferenceTotal).toBeNull();
    expect(restored?.project.items[0]).toMatchObject({
      deliverableType: "product", offerMode: "manual", manualOfferUnit: 12_500_000,
    });
  });

  it("contrato 4 autosave: un cliente antiguo conserva clasificación/costo null y GET expone solo referencia manual", async () => {
    await isolatedStore("caf-budget-autosave-");
    const project = await importProject({
      version: 2,
      settings: { manual_reference_total: 13_000_000 },
      items: [publicItem("Equipo", "product", true)],
    });
    const { deliverableType: _omitted, ...legacyItem } = project.items[0]!;
    const response = await patchProject(new Request(`http://localhost/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: project.updatedAt,
        expectedItemIds: [project.items[0]!.id],
        settings: { manualReferenceTotal: 14_000_000 },
        items: [legacyItem],
      }),
    }), { params: Promise.resolve({ projectId: project.id }) });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = await response.json();
    expect(body.calculation.items[0]).toMatchObject({
      deliverableType: "product",
      additionalCosts: [{ id: "installation", amount: null }],
    });
    expect((await getProject(project.id))?.settings.manualReferenceTotal).toBe(14_000_000);

    process.env.FINANCIAL_PRICE_BASE_TOKEN = "x".repeat(32);
    const snapshotResponse = await getOperations(new Request(
      `http://localhost/api/projects/${project.id}/operations`,
      { headers: { Authorization: `Bearer ${"x".repeat(32)}` } },
    ), { params: Promise.resolve({ projectId: project.id }) });
    const snapshot = await snapshotResponse.json();
    expect(snapshot.calculation.settings).toEqual({ manualReferenceTotal: 14_000_000 });
    expect(snapshot.calculation.settings).not.toHaveProperty("usdToCopRate");
    const current = (await getProject(project.id))!;
    const limit = { id: "document-total", label: "Máximo documental", procurementLotId: null, maximum: 14_000_000, document: "Pliego sintético", locator: "Sección 1" };
    await saveProject(project.id, { settings: { ...current.settings, budgetLimits: [limit] } }, current.updatedAt);
    const limitedResponse = await getOperations(new Request(`http://localhost/api/projects/${project.id}/operations`, { headers: { Authorization: `Bearer ${"x".repeat(32)}` } }), { params: Promise.resolve({ projectId: project.id }) });
    const limited = await limitedResponse.json();
    expect(limited.calculation.settings).toEqual({ manualReferenceTotal: 14_000_000, budgetLimits: [limit] });
    expect(limited.calculation.settings).not.toHaveProperty("usdImportPct");
  });
});

