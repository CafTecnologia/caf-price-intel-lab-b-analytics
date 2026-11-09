import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisConflictError, previewAnalysis } from "../lib/chatgpt-analysis";
import {
  acceptAnalysisScenario,
  createAnalysisScenario,
  getProject,
  importProject,
  saveProject,
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

async function projectFixture() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-chatgpt-analysis-adversarial-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  return importProject({
    version: 2,
    source: { system: "odoo_caf", run_id: "adversarial-run", odoo_project_id: "1972" },
    items: [{
      item: "1", name: "Equipo", description: "Ficha", quantity: 1, unit: "UND",
      ceiling_unit_price: 2_000,
      price_sources: [{ id: "s1", name: "Uno", unit_price: 100, currency: "COP" }],
      additional_costs: [],
    }],
  });
}

describe("contratos adversariales del análisis ChatGPT", () => {
  it("considera equivalente el reintento del mismo actor aunque cambie su nombre visible", async () => {
    const project = await projectFixture();
    const input = {
      name: "Margen",
      changes: [{
        type: "set_margin" as const,
        kind: "criterion" as const,
        reason: "Escenario",
        itemIds: [project.items[0]!.id],
        marginPctOnCost: 20,
      }],
      expectedUpdatedAt: project.updatedAt,
      operationId: "create-stable-actor",
    };
    const first = await createAnalysisScenario(project.id, input, { id: "user-7", name: "Nombre anterior" });

    const replay = await createAnalysisScenario(project.id, input, { id: "user-7", name: "Nombre actualizado" });

    expect(replay?.receipt).toEqual(first?.receipt);
  });

  it("no deshace un campo que una persona volvió a afirmar después de la aceptación", async () => {
    const project = await projectFixture();
    const actor = { id: "user-7", name: "Finanzas QA" };
    const created = await createAnalysisScenario(project.id, {
      name: "Margen",
      changes: [{
        type: "set_margin", kind: "criterion", reason: "Escenario",
        itemIds: [project.items[0]!.id], marginPctOnCost: 20,
      }],
      expectedUpdatedAt: project.updatedAt,
      operationId: "create-human-reassert",
    }, actor);
    const accepted = await acceptAnalysisScenario(project.id, created!.scenario.id, {
      expectedUpdatedAt: project.updatedAt,
      operationId: "accept-human-reassert",
    }, actor);
    let current = await getProject(project.id);
    let items = structuredClone(current!.items);
    items[0]!.profitPct = 35;
    current = await saveProject(project.id, { items }, current!.updatedAt, current!.items.map((item) => item.id));
    items = structuredClone(current!.items);
    items[0]!.profitPct = 20;
    current = await saveProject(project.id, { items }, current!.updatedAt, current!.items.map((item) => item.id));

    await expect(undoAnalysisAcceptance(project.id, created!.scenario.id, {
      acceptanceOperationId: accepted!.receipt.operationId,
      expectedUpdatedAt: current!.updatedAt,
      operationId: "undo-human-reassert",
    }, actor)).rejects.toBeInstanceOf(AnalysisConflictError);
    expect((await getProject(project.id))?.items[0]!.profitPct).toBe(20);
  });

  it("no resucita agregados heredados cuando se excluyeron todas las fuentes", async () => {
    const project = await projectFixture();
    project.items[0]!.costOptimistic = 100;
    project.items[0]!.costModerate = 100;
    project.items[0]!.costWeightedUnit = 100;

    const preview = previewAnalysis(project, [
      {
        type: "exclude_price_source", kind: "criterion", reason: "No comparable",
        itemId: project.items[0]!.id, sourceId: "s1", excluded: true,
      },
      {
        type: "set_cost_statistic", kind: "criterion", reason: "Mediana solo de fuentes aceptadas",
        itemId: project.items[0]!.id, statistic: "median",
      },
    ]);

    expect(preview.simulation.rows[0]!.costBreakdown.sourceCount).toBe(0);
    expect(preview.simulation.rows[0]!.costUnit).toBeNull();
  });

  it("no usa agregados COP heredados para una fuente USD sin TRM", async () => {
    const project = await projectFixture();
    project.items[0]!.priceSources[0] = {
      ...project.items[0]!.priceSources[0]!, currency: "USD", unitPrice: 100, trm: null,
    };
    project.items[0]!.costOptimistic = 400_000;
    project.items[0]!.costModerate = 400_000;
    project.items[0]!.costWeightedUnit = 400_000;

    const preview = previewAnalysis(project, [{
      type: "set_cost_statistic", kind: "criterion", reason: "Mediana normalizada",
      itemId: project.items[0]!.id, statistic: "median",
    }]);

    expect(preview.simulation.rows[0]!.costBreakdown.warnings.join(" ")).toMatch(/sin TRM/i);
    expect(preview.simulation.rows[0]!.costUnit).toBeNull();
  });

  it("excluye también las referencias por ítem cuando el criterio global las desactiva", async () => {
    const project = await projectFixture();
    const preview = previewAnalysis(project, [{
      type: "set_reference_inclusion", kind: "criterion", reason: "No usar presupuesto de referencia",
      scope: "project", itemIds: [], included: false,
    }]);

    expect(preview.project.settings.analysisReferenceIncluded).toBe(false);
    expect(preview.simulation.rows[0]!.referenceUnit).toBeNull();
    expect(preview.simulation.summary.referenceKnownTotal).toBeNull();
    expect(preview.simulation.summary.referenceIsComplete).toBe(false);
  });

  it("deshace en reversa cambios repetidos del mismo campo y conserva otro cambio humano", async () => {
    const project = await projectFixture();
    const itemId = project.items[0]!.id;
    const actor = { id: "user-7", name: "Finanzas QA" };
    const created = await createAnalysisScenario(project.id, {
      name: "Secuencia incremental",
      changes: [
        { type: "exclude_price_source", kind: "exploration", reason: "Probar sin fuente", itemId, sourceId: "s1", excluded: true },
        { type: "exclude_price_source", kind: "criterion", reason: "Volver a incluir", itemId, sourceId: "s1", excluded: false },
        { type: "set_margin", kind: "exploration", reason: "Primera prueba", itemIds: [itemId], marginPctOnCost: 20 },
        { type: "set_margin", kind: "criterion", reason: "Criterio final", itemIds: [itemId], marginPctOnCost: 30 },
      ],
      expectedUpdatedAt: project.updatedAt,
      operationId: "create-repeated-field",
    }, actor);
    const accepted = await acceptAnalysisScenario(project.id, created!.scenario.id, {
      expectedUpdatedAt: project.updatedAt,
      operationId: "accept-repeated-field",
    }, actor);
    let current = await getProject(project.id);
    expect(current?.items[0]!.analysisExcludedPriceSourceIds).toEqual([]);
    expect(current?.items[0]!.profitPct).toBe(30);
    const items = structuredClone(current!.items);
    items[0]!.unit = "EA";
    current = await saveProject(project.id, { items }, current!.updatedAt, current!.items.map((item) => item.id));

    await undoAnalysisAcceptance(project.id, created!.scenario.id, {
      acceptanceOperationId: accepted!.receipt.operationId,
      expectedUpdatedAt: current!.updatedAt,
      operationId: "undo-repeated-field",
    }, actor);

    const restored = await getProject(project.id);
    expect(restored?.items[0]!.analysisExcludedPriceSourceIds).toEqual([]);
    expect(restored?.items[0]!.offerMode).toBeNull();
    expect(restored?.items[0]!.profitPct).toBeNull();
    expect(restored?.items[0]!.unit).toBe("EA");
  });

  it("no deshace A si aceptaciones posteriores B y C tocaron los mismos campos aunque C vuelva al valor de A", async () => {
    const project = await projectFixture();
    const actor = { id: "user-7", name: "Finanzas QA" };
    const itemId = project.items[0]!.id;
    async function acceptMargin(label: string, marginPctOnCost: number) {
      const current = await getProject(project.id);
      const created = await createAnalysisScenario(project.id, {
        name: label,
        changes: [{ type: "set_margin", kind: "criterion", reason: label, itemIds: [itemId], marginPctOnCost }],
        expectedUpdatedAt: current!.updatedAt,
        operationId: `create-${label}`,
      }, actor);
      return acceptAnalysisScenario(project.id, created!.scenario.id, {
        expectedUpdatedAt: current!.updatedAt,
        operationId: `accept-${label}`,
      }, actor);
    }
    const acceptedA = await acceptMargin("A20", 20);
    await acceptMargin("B30", 30);
    await acceptMargin("C20", 20);
    const current = await getProject(project.id);

    await expect(undoAnalysisAcceptance(project.id, acceptedA!.scenario.id, {
      acceptanceOperationId: acceptedA!.receipt.operationId,
      expectedUpdatedAt: current!.updatedAt,
      operationId: "undo-A20-after-cycle",
    }, actor)).rejects.toBeInstanceOf(AnalysisConflictError);
    expect((await getProject(project.id))?.items[0]!.profitPct).toBe(20);
  });

  it("permite deshacer A tras una aceptación posterior sobre otro ítem y conserva ese cambio", async () => {
    let project = await projectFixture();
    const actor = { id: "user-7", name: "Finanzas QA" };
    const firstId = project.items[0]!.id;
    const second = { ...structuredClone(project.items[0]!), id: "qa-item-2", item: "2" };
    project = (await saveProject(project.id, { items: [...project.items, second] }, project.updatedAt,
      project.items.map((item) => item.id)))!;
    async function acceptMargin(label: string, itemId: string, marginPctOnCost: number) {
      const current = await getProject(project.id);
      const created = await createAnalysisScenario(project.id, {
        name: label,
        changes: [{ type: "set_margin", kind: "criterion", reason: label, itemIds: [itemId], marginPctOnCost }],
        expectedUpdatedAt: current!.updatedAt,
        operationId: `create-${label}`,
      }, actor);
      return acceptAnalysisScenario(project.id, created!.scenario.id, {
        expectedUpdatedAt: current!.updatedAt,
        operationId: `accept-${label}`,
      }, actor);
    }
    const acceptedA = await acceptMargin("A-first", firstId, 20);
    await acceptMargin("B-second", second.id, 30);
    const current = await getProject(project.id);
    await undoAnalysisAcceptance(project.id, acceptedA!.scenario.id, {
      acceptanceOperationId: acceptedA!.receipt.operationId,
      expectedUpdatedAt: current!.updatedAt,
      operationId: "undo-A-non-overlap",
    }, actor);

    const restored = await getProject(project.id);
    expect(restored?.items.find((item) => item.id === firstId)?.profitPct).toBeNull();
    expect(restored?.items.find((item) => item.id === second.id)?.profitPct).toBe(30);
  });
});
