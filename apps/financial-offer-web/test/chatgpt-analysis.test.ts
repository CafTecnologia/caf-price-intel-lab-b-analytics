import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisChangeSchema, AnalysisConflictError, previewAnalysis } from "../lib/chatgpt-analysis";
import { median } from "../lib/financial-engine";
import {
  acceptAnalysisScenario,
  createAnalysisScenario,
  freezeCalculation,
  getAnalysisActionReceipt,
  getAnalysisScenario,
  getProject,
  importProject,
  listAnalysisActionReceipts,
  listAnalysisScenarios,
  listPriceBaseVersions,
  saveFinancialDefaults,
  saveProject,
  unfreezeCalculation,
  undoAnalysisAcceptance,
} from "../lib/store";

let tempDir: string | null = null;
let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

afterEach(async () => {
  cwdSpy?.mockRestore();
  cwdSpy = null;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function isolatedStore() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-chatgpt-analysis-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
}

async function importedProject() {
  return importProject({
    version: 2,
    source: { system: "odoo_caf", run_id: "analysis-run", odoo_project_id: "1972" },
    items: [{
      item: "1", name: "Equipo", description: "Ficha", quantity: 2, unit: "UND",
      ceiling_unit_price: 2_000,
      price_sources: [
        { id: "s1", name: "Uno", unit_price: 100, currency: "COP" },
        { id: "s2", name: "Dos", unit_price: 200, currency: "COP" },
        { id: "s3", name: "Tres", unit_price: 1_000, currency: "COP" },
      ],
      additional_costs: [],
    }],
  });
}

const actor = { id: "user-7", name: "Finanzas QA" };

function changes(itemId: string) {
  return [
    { type: "exclude_price_source" as const, kind: "criterion" as const, reason: "Atípico no comparable", itemId, sourceId: "s3", excluded: true },
    { type: "set_cost_statistic" as const, kind: "criterion" as const, reason: "Usar centro robusto", itemId, statistic: "median" as const },
    { type: "add_additional_cost" as const, kind: "correction" as const, reason: "Instalación exigida", itemId,
      cost: { id: "installation", name: "Instalación", category: "service" as const, mode: "fixed" as const, amount: null, notes: "Pendiente de cotización" } },
    { type: "set_margin" as const, kind: "criterion" as const, reason: "Margen aprobado", itemIds: [itemId], marginPctOnCost: 20 },
    { type: "group_specifications" as const, kind: "exploration" as const, reason: "Comparar la misma familia", groupId: "group-1", label: "Equipos", itemIds: [itemId] },
  ];
}

describe("escenarios de análisis ChatGPT", () => {
  it("valida operaciones estrictas y calcula mediana sin crear un COST_MODE", () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([10, 2, 4, 8])).toBe(6);
    expect(median([])).toBeNull();
    expect(AnalysisChangeSchema.safeParse({
      type: "set_margin", kind: "criterion", reason: "margen", itemIds: [], marginPctOnCost: 10, extra: true,
    }).success).toBe(false);
  });

  it("previsualiza sobre una copia, conserva fuentes excluidas y mantiene costos sin precio pendientes", async () => {
    await isolatedStore();
    const project = await importedProject();
    const before = structuredClone(project);
    const preview = previewAnalysis(project, changes(project.items[0]!.id));

    expect(project).toEqual(before);
    expect(preview.project.items[0]!.priceSources).toHaveLength(3);
    expect(preview.project.items[0]!.analysisExcludedPriceSourceIds).toEqual(["s3"]);
    expect(preview.simulation.rows[0]!.costBreakdown.average).toBe(150);
    expect(preview.simulation.rows[0]!.costBreakdown.median).toBe(150);
    expect(preview.simulation.rows[0]!.costUnit).toBe(150);
    expect(preview.project.items[0]!.manualOfferUnit).toBe(180);
    expect(preview.simulation.rows[0]!.offerUnit).toBe(180);
    expect(preview.simulation.summary.knownOfferTotal).toBe(360);
    expect(preview.project.items[0]!.additionalCosts[0]).toMatchObject({ id: "installation", amount: null, reviewStatus: "suggested" });
    expect(preview.simulation.rows[0]!.hasPendingAssociatedCosts).toBe(false);
    expect(preview.simulation.rows[0]!.hasSuggestedAssociatedCosts).toBe(true);
    expect(preview.groups).toEqual([{ groupId: "group-1", label: "Equipos", itemIds: [project.items[0]!.id], reason: "Comparar la misma familia" }]);
  });

  it("rechaza un margen cuando no hay costo disponible en todo el alcance", async () => {
    await isolatedStore();
    const project = await importedProject();
    project.items[0]!.priceSources = [];
    project.items[0]!.costOptimistic = null;
    project.items[0]!.costModerate = null;
    project.items[0]!.costWeightedUnit = null;

    expect(() => previewAnalysis(project, [{
      type: "set_margin", kind: "criterion", reason: "Margen solicitado",
      itemIds: [project.items[0]!.id], marginPctOnCost: 20,
    }])).toThrow(/falta un costo disponible/i);
  });

  it("crea, reabre, acepta y deshace con recibos idempotentes y versiones", async () => {
    await isolatedStore();
    const project = await importedProject();
    const created = await createAnalysisScenario(project.id, {
      name: "Mediana sin atípico", changes: changes(project.items[0]!.id),
      expectedUpdatedAt: project.updatedAt, operationId: "create-analysis-1",
    }, actor);
    expect(created?.scenario.status).toBe("draft");

    await saveFinancialDefaults(await (await import("../lib/store")).getFinancialDefaults());
    expect(await listAnalysisScenarios(project.id)).toHaveLength(1);
    expect((await getAnalysisScenario(project.id, created!.scenario.id))?.preview.groups).toHaveLength(1);

    const accepted = await acceptAnalysisScenario(project.id, created!.scenario.id, {
      expectedUpdatedAt: project.updatedAt, operationId: "accept-analysis-1",
    }, actor);
    expect(accepted?.receipt.status).toBe("applied");
    expect(accepted?.receipt.versionId).toBeTruthy();
    const saved = await getProject(project.id);
    expect(saved?.items[0]!.priceSources).toHaveLength(3);
    expect(saved?.items[0]!.analysisExcludedPriceSourceIds).toEqual(["s3"]);
    expect(saved?.items[0]!.analysisCostStatistic).toBe("median");
    expect(saved?.items[0]!.profitPct).toBe(20);

    const replay = await acceptAnalysisScenario(project.id, created!.scenario.id, {
      expectedUpdatedAt: project.updatedAt, operationId: "accept-analysis-1",
    }, actor);
    expect(replay?.receipt).toEqual(accepted?.receipt);

    const undone = await undoAnalysisAcceptance(project.id, created!.scenario.id, {
      acceptanceOperationId: "accept-analysis-1", expectedUpdatedAt: saved!.updatedAt, operationId: "undo-analysis-1",
    }, actor);
    expect(undone?.scenario.status).toBe("undone");
    const restored = await getProject(project.id);
    expect(restored?.items[0]!.analysisExcludedPriceSourceIds).toEqual([]);
    expect(restored?.items[0]!.analysisCostStatistic).toBeNull();
    expect(restored?.items[0]!.additionalCosts).toEqual([]);
    expect(restored?.items[0]!.profitPct).toBeNull();
    expect(await listAnalysisActionReceipts(project.id)).toHaveLength(3);
    expect((await getAnalysisActionReceipt("undo-analysis-1"))?.action).toBe("undo");
    expect((await listPriceBaseVersions(project.id)).length).toBeGreaterThanOrEqual(3);
  });

  it("deshacer no pisa una edición humana posterior", async () => {
    await isolatedStore();
    const project = await importedProject();
    const created = await createAnalysisScenario(project.id, {
      name: "Margen", changes: [{ type: "set_margin", kind: "criterion", reason: "Escenario", itemIds: [project.items[0]!.id], marginPctOnCost: 20 }],
      expectedUpdatedAt: project.updatedAt, operationId: "create-analysis-2",
    }, actor);
    const accepted = await acceptAnalysisScenario(project.id, created!.scenario.id, {
      expectedUpdatedAt: project.updatedAt, operationId: "accept-analysis-2",
    }, actor);
    const current = await getProject(project.id);
    const humanItems = structuredClone(current!.items);
    humanItems[0]!.profitPct = 35;
    const human = await saveProject(project.id, { items: humanItems }, current!.updatedAt, current!.items.map((item) => item.id));

    await expect(undoAnalysisAcceptance(project.id, created!.scenario.id, {
      acceptanceOperationId: accepted!.receipt.operationId, expectedUpdatedAt: human!.updatedAt, operationId: "undo-analysis-2",
    }, actor)).rejects.toBeInstanceOf(AnalysisConflictError);
    expect((await getProject(project.id))?.items[0]!.profitPct).toBe(35);
  });

  it("deshacer respeta una reafirmación humana posterior de un criterio global", async () => {
    await isolatedStore();
    const project = await importedProject();
    const created = await createAnalysisScenario(project.id, {
      name: "Referencia", changes: [{
        type: "set_reference_inclusion", kind: "criterion", reason: "Escenario",
        scope: "project", itemIds: [], included: false,
      }], expectedUpdatedAt: project.updatedAt, operationId: "create-analysis-global",
    }, actor);
    const accepted = await acceptAnalysisScenario(project.id, created!.scenario.id, {
      expectedUpdatedAt: project.updatedAt, operationId: "accept-analysis-global",
    }, actor);
    let current = await getProject(project.id);
    current = await saveProject(project.id, {
      settings: { ...current!.settings, analysisReferenceIncluded: true },
    }, current!.updatedAt);
    current = await saveProject(project.id, {
      settings: { ...current!.settings, analysisReferenceIncluded: false },
    }, current!.updatedAt);

    await expect(undoAnalysisAcceptance(project.id, created!.scenario.id, {
      acceptanceOperationId: accepted!.receipt.operationId,
      expectedUpdatedAt: current!.updatedAt,
      operationId: "undo-analysis-global",
    }, actor)).rejects.toBeInstanceOf(AnalysisConflictError);
    expect((await getProject(project.id))?.settings.analysisReferenceIncluded).toBe(false);
  });

  it("rechaza aceptar y deshacer mientras el cálculo está en solo lectura", async () => {
    await isolatedStore();
    const project = await importedProject();
    const first = await createAnalysisScenario(project.id, {
      name: "Bloqueado al aceptar", changes: changes(project.items[0]!.id),
      expectedUpdatedAt: project.updatedAt, operationId: "create-analysis-readonly-accept",
    }, actor);
    const frozenBeforeAccept = await freezeCalculation(project.id, {});
    await expect(acceptAnalysisScenario(project.id, first!.scenario.id, {
      expectedUpdatedAt: frozenBeforeAccept!.updatedAt,
      operationId: "accept-analysis-readonly-rejected",
    }, actor)).rejects.toThrow(/solo lectura|congelado/i);

    const editable = await unfreezeCalculation(project.id, {});
    const second = await createAnalysisScenario(project.id, {
      name: "Bloqueado al deshacer", changes: changes(editable!.items[0]!.id),
      expectedUpdatedAt: editable!.updatedAt, operationId: "create-analysis-readonly-undo",
    }, actor);
    const accepted = await acceptAnalysisScenario(project.id, second!.scenario.id, {
      expectedUpdatedAt: editable!.updatedAt, operationId: "accept-analysis-before-freeze",
    }, actor);
    const frozenBeforeUndo = await freezeCalculation(project.id, {});
    await expect(undoAnalysisAcceptance(project.id, second!.scenario.id, {
      acceptanceOperationId: accepted!.receipt.operationId,
      expectedUpdatedAt: frozenBeforeUndo!.updatedAt,
      operationId: "undo-analysis-readonly-rejected",
    }, actor)).rejects.toThrow(/solo lectura|congelado/i);
  });

  it("deja estadísticas vacías cuando no hay fuente incluida y normalizable", async () => {
    await isolatedStore();
    const project = await importedProject();
    project.items[0]!.costOptimistic = 400_000;
    project.items[0]!.costModerate = 400_000;
    project.items[0]!.costWeightedUnit = 400_000;
    const excluded = previewAnalysis(project, [
      ...project.items[0]!.priceSources.map((source) => ({
        type: "exclude_price_source" as const, kind: "criterion" as const, reason: "No comparable",
        itemId: project.items[0]!.id, sourceId: source.id, excluded: true,
      })),
      { type: "set_cost_statistic", kind: "criterion", reason: "Mediana", itemId: project.items[0]!.id, statistic: "median" },
    ]);
    expect(excluded.simulation.rows[0]!.costUnit).toBeNull();

    project.items[0]!.priceSources = [{
      ...project.items[0]!.priceSources[0]!, currency: "USD", unitPrice: 100, trm: null,
    }];
    const missingTrm = previewAnalysis(project, [{
      type: "set_cost_statistic", kind: "criterion", reason: "Mediana normalizada",
      itemId: project.items[0]!.id, statistic: "median",
    }]);
    expect(missingTrm.simulation.rows[0]!.costUnit).toBeNull();
    expect(missingTrm.simulation.rows[0]!.costBreakdown.warnings.join(" ")).toMatch(/sin TRM/i);
  });

  it("falla cerrado al crear sobre un cálculo congelado", async () => {
    await isolatedStore();
    const project = await importedProject();
    const frozen = await freezeCalculation(project.id, {});
    await expect(createAnalysisScenario(project.id, {
      name: "No permitido", changes: changes(project.items[0]!.id),
      expectedUpdatedAt: frozen!.updatedAt, operationId: "create-analysis-frozen",
    }, actor)).rejects.toThrow(/solo lectura|congelado/i);
  });
});
