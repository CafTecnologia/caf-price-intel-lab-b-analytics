import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CalculationOperationsSchema,
  calculationOperationItemValues,
  deterministicOperationItemId,
} from "../lib/calculation-operations";
import { buildInitialOfferControls } from "../lib/financial-engine";
import {
  applyCalculationOperations,
  getCalculationItemDocumentKeys,
  getCalculationOperationReceipt,
  getProject,
  getSavedCalculationChangeReceipt,
  importProject,
  listCalculationChangeReceipts,
  listCalculationOperationReceiptsByJob,
  listPriceBaseVersions,
  restorePriceBaseVersion,
  saveProject,
} from "../lib/store";

let tempDir: string | null = null;
let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

afterEach(async () => {
  cwdSpy?.mockRestore();
  cwdSpy = null;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function isolatedStore(prefix: string) {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
}

function publicItem(code: string, name = `Equipo ${code}`) {
  return {
    item: code,
    name,
    description: `Ficha ${code}`,
    quantity: 1,
    unit: "UND",
    ceiling_unit_price: 100_000,
    price_sources: [{ id: `source-${code}`, name: "Proveedor", unit_price: 60_000, currency: "COP" as const }],
    additional_costs: [],
    notes: "",
  };
}

async function importLinked(count = 2) {
  return importProject({
    version: 2,
    source: { system: "odoo_caf", run_id: "external-run-1972", odoo_project_id: "1972" },
    items: Array.from({ length: count }, (_, index) => publicItem(String(index + 1))),
  });
}

function operationBase(projectId: string, expectedUpdatedAt: string, operationId: string) {
  return {
    projectId,
    odooProjectId: "1972",
    externalRunId: "external-run-1972",
    jobId: "review-job-1",
    operationId,
    expectedUpdatedAt,
  };
}

describe("operaciones controladas del cálculo", () => {
  it("agrega transcripción literal en una revisión sin pisar una corrección humana posterior", async () => {
    await isolatedStore("caf-calculation-original-source-");
    const imported = await importLinked(1);
    const itemId = imported.items[0]!.id;
    const literal = { description: "Equipo documental literal", quantity: "1,00", unit: "UN", document: "pliego.xlsx", locator: "Hoja 1 fila 8" };
    const first = {
      ...operationBase(imported.id, imported.updatedAt, "operation-original-source"),
      operations: [{ type: "update_item" as const, itemId,
        patch: { source_original: literal }, expected: { source_original: null } }],
    };
    const receipt = await applyCalculationOperations(first);
    expect(receipt?.updatedItemIds).toEqual([itemId]);
    expect((await getProject(imported.id))?.items[0]?.sourceOriginal).toMatchObject(literal);
    expect(await applyCalculationOperations(first)).toEqual(receipt);

    const afterAi = (await getProject(imported.id))!;
    const humanLiteral = { ...afterAi.items[0]!.sourceOriginal!, locator: "Hoja corregida fila 9" };
    const human = await saveProject(imported.id, {
      items: [{ ...afterAi.items[0]!, sourceOriginal: humanLiteral, manualUnitCost: 55_000 }],
    }, afterAi.updatedAt);
    expect(human?.items[0]?.sourceOriginal?.locator).toBe("Hoja corregida fila 9");
    await expect(applyCalculationOperations({
      ...operationBase(imported.id, human!.updatedAt, "operation-original-source-stale"),
      operations: [{ type: "update_item", itemId,
        patch: { source_original: { ...literal, locator: "Hoja 1 fila 10" } },
        expected: { source_original: literal } }],
    })).rejects.toThrow(/cambió después/);
    expect((await getProject(imported.id))?.items[0]).toMatchObject({ sourceOriginal: humanLiteral, manualUnitCost: 55_000 });
    expect(CalculationOperationsSchema.safeParse({
      ...operationBase(imported.id, human!.updatedAt, "operation-original-source-clear"),
      operations: [{ type: "update_item", itemId, patch: { source_original: null }, expected: { source_original: humanLiteral } }],
    }).success).toBe(false);
  });
  it("crece 53→76, alterna bases completas, conserva ofertas y el retry no duplica", async () => {
    await isolatedStore("caf-calculation-ops-growth-");
    const imported = await importLinked(53);
    const originalIds = imported.items.map((item) => item.id);
    const withOffer = await saveProject(imported.id, {
      items: imported.items.map((item, index) => index === 0
        ? { ...item, offerMode: "manual", manualOfferUnit: 91_000, discountPct: 9 }
        : item),
    }, imported.updatedAt);
    expect(withOffer).not.toBeNull();

    const input = {
      ...operationBase(imported.id, withOffer!.updatedAt, "operation-grow-53-76"),
      operations: Array.from({ length: 23 }, (_, index) => ({
        type: "add_item" as const,
        key: `document-section-b-row-${index + 54}`,
        item: publicItem(String(index + 54)),
      })),
    };
    const receipt = await applyCalculationOperations(input);
    const after = await getProject(imported.id);
    expect(receipt?.createdItemIds).toHaveLength(23);
    expect(receipt?.createdItemKeys).toEqual(input.operations.map((operation) => ({
      itemId: deterministicOperationItemId(imported.id, operation.key),
      key: operation.key,
    })));
    expect(after?.items).toHaveLength(76);
    expect(after?.items.slice(0, 53).map((item) => item.id)).toEqual(originalIds);
    expect(after?.items[0]).toMatchObject({ offerMode: "manual", manualOfferUnit: 91_000, discountPct: 9 });

    const retry = await applyCalculationOperations(input);
    expect(retry).toEqual(receipt);
    expect((await getProject(imported.id))?.items).toHaveLength(76);
    expect(await listPriceBaseVersions(imported.id)).toHaveLength(2);
    expect(await getCalculationOperationReceipt(input.operationId)).toEqual(receipt);
    expect(await listCalculationOperationReceiptsByJob(input.jobId)).toEqual([receipt]);
    expect(await getCalculationItemDocumentKeys(imported.id)).toEqual(Object.fromEntries(
      receipt!.createdItemKeys.map(({ itemId, key }) => [itemId, key]),
    ));

    const addedId = receipt!.createdItemIds[0]!;
    const withAddedOffer = await saveProject(imported.id, {
      items: after!.items.map((item) => item.id === addedId
        ? { ...item, offerMode: "manual", manualOfferUnit: 77_000 }
        : item),
    }, after!.updatedAt, after!.items.map((item) => item.id));
    const fullVersions = await listPriceBaseVersions(imported.id);
    const base76 = fullVersions.find((version) => version.snapshot.length === 76)!;
    const base53 = fullVersions.find((version) => version.snapshot.length === 53)!;

    await expect(restorePriceBaseVersion(imported.id, base53.id, withAddedOffer!.updatedAt)).rejects.toThrow(/quitaría 23 costos y 23 filas/);
    expect((await getProject(imported.id))?.items).toHaveLength(76);
    const restored53 = await restorePriceBaseVersion(imported.id, base53.id, withAddedOffer!.updatedAt, undefined, true);
    expect(restored53?.project.items).toHaveLength(53);
    expect(restored53?.project.items.map((item) => item.id)).toEqual(originalIds);
    expect(restored53?.project.items[0]).toMatchObject({
      offerMode: "manual", manualOfferUnit: 91_000, discountPct: 9,
    });

    const restored76 = await restorePriceBaseVersion(imported.id, base76.id, restored53!.project.updatedAt);
    expect(restored76?.project.items).toHaveLength(76);
    expect(restored76?.project.items.slice(0, 53).map((item) => item.id)).toEqual(originalIds);
    expect(restored76?.project.items.find((item) => item.id === addedId)).toMatchObject({
      offerMode: "manual", manualOfferUnit: 77_000,
    });
    expect((await getProject(imported.id))?.items).toEqual(restored76?.project.items);
    expect(await applyCalculationOperations(input)).toEqual(receipt);
    expect((await getProject(imported.id))?.items).toHaveLength(76);
  });

  it("rechaza un guardado con estructura base 53 aunque declare la revisión vigente de 76", async () => {
    await isolatedStore("caf-calculation-stale-structure-");
    const imported = await importLinked(53);
    const originalIds = imported.items.map((item) => item.id);
    await applyCalculationOperations({
      ...operationBase(imported.id, imported.updatedAt, "operation-stale-structure"),
      operations: Array.from({ length: 23 }, (_, index) => ({
        type: "add_item" as const,
        key: `annex-stale-row-${index + 54}`,
        item: publicItem(String(index + 54)),
      })),
    });
    const current = (await getProject(imported.id))!;
    expect(current.items).toHaveLength(76);
    await expect(saveProject(
      imported.id,
      { items: imported.items },
      current.updatedAt,
      originalIds,
    )).rejects.toThrow(/lista de ítems cambió/);
    expect((await getProject(imported.id))?.items).toHaveLength(76);

    const intentionallyRemoved = await saveProject(
      imported.id,
      { items: current.items.slice(0, -1) },
      current.updatedAt,
      current.items.map((item) => item.id),
    );
    expect(intentionallyRemoved?.items).toHaveLength(75);
  });

  it("recupera una base 76 heredada después del autosave 53 usando IDs y el recibo humano", async () => {
    await isolatedStore("caf-calculation-legacy-restore-");
    const imported = await importLinked(53);
    const originalIds = imported.items.map((item) => item.id);
    const receipt = await applyCalculationOperations({
      ...operationBase(imported.id, imported.updatedAt, "operation-legacy-restore"),
      operations: Array.from({ length: 23 }, (_, index) => ({
        type: "add_item" as const,
        key: `legacy-document-row-${index + 54}`,
        item: publicItem(String(index + 54)),
      })),
    });
    const current76 = (await getProject(imported.id))!;
    const addedId = receipt!.createdItemIds[0]!;
    const offered76 = await saveProject(imported.id, {
      items: current76.items.map((item) => item.id === addedId
        ? { ...item, offerMode: "manual", manualOfferUnit: 72_500 }
        : item),
    }, current76.updatedAt);

    const storeFile = path.join(tempDir!, "data", "financial-offer", "projects.json");
    const stored = JSON.parse(await fs.readFile(storeFile, "utf8"));
    for (const version of stored.priceBaseVersions) delete version.offerSnapshots;
    await fs.writeFile(storeFile, JSON.stringify(stored, null, 2), "utf8");

    const stale53 = await saveProject(imported.id, { items: imported.items }, offered76!.updatedAt);
    expect(stale53?.items).toHaveLength(53);
    expect(stale53?.items.map((item) => item.id)).toEqual(originalIds);
    const legacy76 = (await listPriceBaseVersions(imported.id))
      .find((version) => version.snapshot.length === 76)!;
    expect(legacy76.offerSnapshots).toBeUndefined();

    const recovered = await restorePriceBaseVersion(imported.id, legacy76.id, stale53!.updatedAt);
    expect(recovered?.project.items).toHaveLength(76);
    expect(recovered?.project.items.find((item) => item.id === addedId)).toMatchObject({
      description: "Equipo 54",
      technicalDescription: "Ficha 54",
      quantity: 1,
      unit: "UND",
      offerMode: "manual",
      manualOfferUnit: 72_500,
    });
    expect((await getProject(imported.id))?.items).toHaveLength(76);
  });

  it("persiste claves documentales sin crear altas en retry y filtra por cálculo", async () => {
    await isolatedStore("caf-calculation-document-keys-");
    const first = await importLinked(1);
    const second = await importProject({
      version: 2,
      source: { system: "odoo_caf", run_id: "external-run-1973", odoo_project_id: "1973" },
      items: [publicItem("1")],
    });
    const firstInput = {
      ...operationBase(first.id, first.updatedAt, "operation-document-key-first"),
      operations: [{ type: "add_item" as const, key: "annex-a:sheet-2:row-54", item: publicItem("54") }],
    };
    const firstReceipt = await applyCalculationOperations(firstInput);
    const retry = await applyCalculationOperations(firstInput);
    await applyCalculationOperations({
      ...operationBase(second.id, second.updatedAt, "operation-document-key-second"),
      odooProjectId: "1973",
      externalRunId: "external-run-1973",
      jobId: "review-job-2",
      operations: [{ type: "add_item", key: "annex-b:sheet-1:row-8", item: publicItem("8") }],
    });

    expect(retry).toEqual(firstReceipt);
    expect((await getProject(first.id))?.items).toHaveLength(2);
    expect(await getCalculationItemDocumentKeys(first.id)).toEqual({
      [deterministicOperationItemId(first.id, "annex-a:sheet-2:row-54")]: "annex-a:sheet-2:row-54",
    });
    expect(await getCalculationItemDocumentKeys(second.id)).toEqual({
      [deterministicOperationItemId(second.id, "annex-b:sheet-1:row-8")]: "annex-b:sheet-1:row-8",
    });
  });

  it("acepta etiquetas repetidas, pendientes null y no confunde código visible con ID", async () => {
    await isolatedStore("caf-calculation-ops-labels-");
    const project = await importLinked(1);
    const input = {
      ...operationBase(project.id, project.updatedAt, "operation-duplicate-labels"),
      operations: [
        { type: "add_item" as const, key: "section-a-row-1", item: { ...publicItem("A-1", "Licencia"), quantity: null } },
        {
          type: "add_item" as const,
          key: "section-b-row-1",
          item: {
            ...publicItem("B-1", "Licencia"), ceiling_unit_price: null, price_sources: [],
            additional_costs: [{ name: "Instalación pendiente", amount: null, review_status: "suggested" as const }],
          },
        },
      ],
    };
    await applyCalculationOperations(input);
    const after = await getProject(project.id);
    const added = after!.items.slice(-2);
    expect(added.map((item) => item.description)).toEqual(["Licencia", "Licencia"]);
    expect(added[0]?.id).not.toBe(added[1]?.id);
    expect(added[0]?.item).toBe("A-1");
    expect(added[1]?.item).toBe("B-1");
    expect(added[1]?.additionalCosts[0]?.amount).toBeNull();
    expect(added[1]?.additionalCosts[0]?.reviewStatus).toBe("suggested");
    expect(added[1]?.referenceUnit).toBeNull();
    const controls = buildInitialOfferControls(after!);
    expect(Object.values(controls).at(-2)?.manualOfferUnit).toBe(100_000);
  });

  it("permite concurrencia ajena, detecta conflicto de la misma celda y recupera respuesta perdida", async () => {
    await isolatedStore("caf-calculation-ops-concurrency-");
    const project = await importLinked(2);
    const first = project.items[0]!;
    const second = project.items[1]!;
    const unrelated = await saveProject(project.id, {
      items: project.items.map((item) => item.id === second.id ? { ...item, notes: "Edición humana ajena" } : item),
    }, project.updatedAt);

    const safeInput = {
      ...operationBase(project.id, project.updatedAt, "operation-safe-stale-timestamp"),
      operations: [{
        type: "update_item" as const,
        itemId: first.id,
        patch: { quantity: 2 },
        expected: { quantity: first.quantity },
      }],
    };
    const firstReceipt = await applyCalculationOperations(safeInput);
    expect(firstReceipt?.status).toBe("applied");
    expect((await applyCalculationOperations(safeInput))).toEqual(firstReceipt);

    const current = (await getProject(project.id))!;
    const human = await saveProject(project.id, {
      items: current.items.map((item) => item.id === first.id ? { ...item, quantity: 3 } : item),
    }, current.updatedAt);
    await expect(applyCalculationOperations({
      ...operationBase(project.id, unrelated!.updatedAt, "operation-same-cell-conflict"),
      operations: [{
        type: "update_item",
        itemId: first.id,
        patch: { quantity: 4 },
        expected: { quantity: 2 },
      }],
    })).rejects.toMatchObject({
      name: "CalculationOperationConflictError",
      itemId: first.id,
      field: "quantity",
      expected: 2,
      actual: 3,
    });
    expect(human?.items.find((item) => item.id === first.id)?.quantity).toBe(3);
  });

  it("hace upsert no destructivo de costos generales y rechaza claves reutilizadas con otro contenido", async () => {
    await isolatedStore("caf-calculation-ops-costs-");
    const project = await importLinked(1);
    const first = await applyCalculationOperations({
      ...operationBase(project.id, project.updatedAt, "operation-general-cost"),
      operations: [{
        type: "set_general_costs",
        costs: [{
          id: "policy",
          expected: null,
          value: { name: "Póliza", category: "other", amount: "15.000", notes: "Global" },
        }],
      }, {
        type: "add_item",
        key: "stable-document-key",
        item: publicItem("2"),
      }],
    });
    expect(first?.changes.some((change) => change.field === "general_cost")).toBe(true);
    expect((await getProject(project.id))?.generalCosts).toEqual([
      { id: "policy", name: "Póliza", category: "other", amount: 15_000, notes: "Global" },
    ]);

    const current = (await getProject(project.id))!;
    await expect(applyCalculationOperations({
      ...operationBase(project.id, current.updatedAt, "operation-reused-key"),
      operations: [{
        type: "add_item",
        key: "stable-document-key",
        item: publicItem("2", "Contenido distinto"),
      }],
    })).rejects.toThrow(/contenido distinto/);
    expect(deterministicOperationItemId(project.id, "stable-document-key")).toBe(current.items[1]?.id);
  });

  it("rechaza campos comerciales o fiscales fuera del contrato estricto", () => {
    const base = {
      ...operationBase("calculation-1", "2026-09-29T12:00:00.000Z", "operation-forbidden"),
      operations: [{
        type: "add_item",
        key: "row-1",
        item: { ...publicItem("1"), offer_mode: "manual" },
      }],
    };
    expect(() => CalculationOperationsSchema.parse(base)).toThrow(/Unrecognized key/);
    expect(() => CalculationOperationsSchema.parse({ ...base, externalRunId: undefined })).toThrow();
  });

  it("versiona y restaura ficha, cantidad y costos generales sin tocar la oferta", async () => {
    await isolatedStore("caf-calculation-version-metadata-");
    const project = await importLinked(1);
    const row = project.items[0]!;
    const withOffer = await saveProject(project.id, {
      items: [{ ...row, offerMode: "manual", manualOfferUnit: 82_000 }],
    }, project.updatedAt);
    await applyCalculationOperations({
      ...operationBase(project.id, withOffer!.updatedAt, "operation-version-metadata"),
      operations: [{
        type: "update_item",
        itemId: row.id,
        patch: { name: "Nombre revisado", description: "Ficha revisada", quantity: 7 },
        expected: { name: row.description, description: row.technicalDescription, quantity: row.quantity },
      }, {
        type: "set_general_costs",
        costs: [{ id: "shipping", expected: null, value: { name: "Envío", amount: 25_000 } }],
      }],
    });
    const versions = await listPriceBaseVersions(project.id);
    expect(versions[0]?.snapshot[0]).toMatchObject({ description: "Nombre revisado", technicalDescription: "Ficha revisada", quantity: 7 });
    expect(versions[0]?.generalCosts).toEqual([{ id: "shipping", name: "Envío", category: "other", amount: 25_000, notes: "" }]);

    const changed = (await getProject(project.id))!;
    const restored = await restorePriceBaseVersion(project.id, versions[1]!.id, changed.updatedAt);
    expect(restored?.project.items[0]).toMatchObject({
      description: row.description,
      technicalDescription: row.technicalDescription,
      quantity: row.quantity,
      offerMode: "manual",
      manualOfferUnit: 82_000,
    });
    expect(restored?.project.generalCosts).toEqual([]);
  });

  it("persiste un recibo humano por save real y ninguno por save idéntico", async () => {
    await isolatedStore("caf-calculation-human-receipt-");
    const project = await importLinked(1);
    const unchanged = await saveProject(project.id, { items: project.items }, project.updatedAt);
    expect(unchanged?.updatedAt).toBe(project.updatedAt);
    expect(await listCalculationChangeReceipts(project.id)).toEqual([]);

    const changed = await saveProject(project.id, {
      items: project.items.map((item) => ({ ...item, manualOfferUnit: 88_000, offerMode: "manual" })),
    }, project.updatedAt);
    const receipt = await getSavedCalculationChangeReceipt(project.id, changed!.updatedAt);
    expect(receipt).toMatchObject({ projectId: project.id, updatedAt: changed!.updatedAt, source: "human" });
    expect(receipt?.changes.map((change) => change.field)).toEqual(expect.arrayContaining(["manualOfferUnit", "offerMode"]));
  });

  // Retain DEV regressions when converging with current production.
  it("rechaza costos, porcentajes de importación y TRM negativos antes de escribir", () => {
    const base = operationBase("calc", new Date().toISOString(), "qa-negative-values");
    for (const badSource of [
      { name: "Proveedor", unit_price: -50, currency: "COP" },
      { name: "Proveedor", unit_price: 50, currency: "USD", trm: -1 },
      { name: "Proveedor", unit_price: 50, currency: "USD", trm: 0 },
      { name: "Proveedor", unit_price: 50, currency: "USD", import_pct: -5 },
    ]) {
      expect(CalculationOperationsSchema.safeParse({
        ...base, operations: [{ type: "add_item", key: "test", item: {
          ...publicItem("1"), price_sources: [badSource],
        } }],
      }).success).toBe(false);
    }
    expect(CalculationOperationsSchema.safeParse({
      ...base, operations: [{ type: "add_item", key: "test", item: {
        ...publicItem("1"), additional_costs: [{ name: "Servicio", amount: -50 }],
      } }],
    }).success).toBe(false);
  });

  it("mantiene el porcentaje de importación explícito al revisar una fuente USD", async () => {
    await isolatedStore("caf-calculation-import-pct-");
    const imported = await importLinked(1);
    const row = imported.items[0]!;
    const withUsd = await saveProject(imported.id, {
      items: [{ ...row, priceSources: [{
        ...row.priceSources[0]!, currency: "USD", unitPrice: 100, trm: 4000, importPct: 15,
      }] }],
    }, imported.updatedAt);
    const source = calculationOperationItemValues(withUsd!.items[0]!).price_sources[0]!;
    expect(source.import_pct).toBe(15);
    const revised = { ...source, unit_price: 110 };
    const receipt = await applyCalculationOperations({
      ...operationBase(imported.id, withUsd!.updatedAt, "qa-import-pct-update"),
      operations: [{ type: "update_item", itemId: row.id,
        patch: { price_sources: [revised] }, expected: { price_sources: [source] } }],
    });
    expect(receipt?.status).toBe("applied");
    expect((await getProject(imported.id))?.items[0]?.priceSources[0]).toMatchObject({
      unitPrice: 110, trm: 4000, importPct: 15,
    });
  });

  it("acepta ficha anexa y estado de costo cuando antes estaban vacíos", async () => {
    await isolatedStore("caf-calculation-empty-optional-");
    const imported = await importLinked(1);
    const row = imported.items[0]!;
    const legacy = await saveProject(imported.id, {
      items: [{ ...row, technicalAnnex: undefined, costBasisStatus: undefined }],
    }, imported.updatedAt);
    const annex = [{ document: "ficha.pdf", locator: "p. 1", text: "Dato literal del ítem" }];
    const receipt = await applyCalculationOperations({
      ...operationBase(imported.id, legacy!.updatedAt, "qa-optional-fields"),
      operations: [{ type: "update_item", itemId: row.id,
        patch: { technical_annex: annex, cost_basis_status: "partial" },
        expected: { technical_annex: [], cost_basis_status: null } }],
    });
    expect(receipt?.status).toBe("applied");
    expect((await getProject(imported.id))?.items[0]).toMatchObject({
      technicalAnnex: annex, costBasisStatus: "partial",
    });
  });

  it("rechaza cantidades y techos unitarios negativos en lotes de IA", async () => {
    await isolatedStore("caf-calculation-ops-negative-");
    const project = await importLinked(1);
    const item = project.items[0]!;
    for (const [field, value] of [["quantity", -5], ["quantity", "-5"], ["ceiling_unit_price", -100], ["ceiling_unit_price", "-100"]] as const) {
      expect(CalculationOperationsSchema.safeParse({
        ...operationBase(project.id, project.updatedAt, `negative-${field}-${value}`),
        operations: [{ type: "update_item", itemId: item.id, patch: { [field]: value }, expected: { [field]: field === "quantity" ? item.quantity : item.referenceUnit } }],
      }).success).toBe(false);
    }
    expect((await getProject(project.id))?.items[0]).toMatchObject({ quantity: 1, referenceUnit: 100_000 });
  });

  it("rechaza costos derivados no finitos aunque cada entrada sea positiva y finita", async () => {
    await isolatedStore("caf-calculation-ops-finite-");
    const project = await importLinked(1);
    const item = project.items[0]!;
    await expect(applyCalculationOperations({
      ...operationBase(project.id, project.updatedAt, "overflow-sources"),
      operations: [{ type: "add_item", key: "overflow", item: {
        ...publicItem("overflow"),
        price_sources: [
          { id: "huge-a", name: "A", unit_price: 1e308, currency: "COP" },
          { id: "huge-b", name: "B", unit_price: 1e308, currency: "COP" },
        ],
      } }],
    })).rejects.toThrow(/no finito/);
    await expect(applyCalculationOperations({
      ...operationBase(project.id, project.updatedAt, "overflow-quantity"),
      operations: [{ type: "update_item", itemId: item.id,
        patch: { quantity: 1e308 }, expected: { quantity: item.quantity } }],
    })).rejects.toThrow(/no finito/);
    expect((await getProject(project.id))!.items).toHaveLength(1);
  });

  it("rechaza montos finitos fuera del rango monetario preciso sin escribir", async () => {
    await isolatedStore("caf-calculation-ops-money-range-");
    const project = await importLinked(1);
    const base = operationBase(project.id, project.updatedAt, "money-range");
    await expect(applyCalculationOperations({
      ...base, operationId: "huge-reference",
      operations: [{ type: "set_project_reference", manual_reference_total: 1e300,
        expected: { manual_reference_total: project.settings.manualReferenceTotal } }],
    })).rejects.toThrow(/rango monetario/);
    await expect(applyCalculationOperations({
      ...base, operationId: "huge-general",
      operations: [{ type: "set_general_costs", costs: [{
        id: "new", expected: null, value: { name: "Extremo", amount: 1e300 },
      }] }],
    })).rejects.toThrow(/no finito/);
    await expect(applyCalculationOperations({
      ...base, operationId: "huge-source",
      operations: [{ type: "add_item", key: "huge-source", item: {
        ...publicItem("huge"), price_sources: [{ id: "large", name: "A", unit_price: 1e300, currency: "COP" }],
      } }],
    })).rejects.toThrow(/no finito/);
    const after = (await getProject(project.id))!;
    expect(after.updatedAt).toBe(project.updatedAt);
    expect(after.items).toHaveLength(1);
    expect(after.generalCosts).toEqual([]);
  });

  it("al reclasificar un producto como servicio retira el costo automático y registra los efectos", async () => {
    await isolatedStore("caf-calculation-ops-service-transition-");
    const project = await importLinked(1);
    const item = project.items[0]!;
    const receipt = await applyCalculationOperations({
      ...operationBase(project.id, project.updatedAt, "service-transition"),
      operations: [{ type: "update_item", itemId: item.id,
        patch: { deliverable_type: "service" }, expected: { deliverable_type: item.deliverableType } }],
    });
    const after = (await getProject(project.id))!.items[0]!;
    expect(after).toMatchObject({ deliverableType: "service", selectedCostMode: "manual", manualUnitCost: null, costBasisStatus: "pending" });
    expect(receipt?.changes.map((change) => change.field)).toContain("selected_cost_mode");
    expect(receipt?.changes.map((change) => change.field)).toContain("cost_basis_status");
    const serialized = JSON.parse(JSON.stringify(receipt));
    expect(serialized.changes.find((change: { field: string }) => change.field === "cost_basis_status"))
      .toMatchObject({ before: null, after: "pending" });
  });

  it("la IA no decide aplicar ni excluir costos asociados existentes o nuevos", async () => {
    await isolatedStore("caf-calculation-ops-human-cost-decision-");
    const project = await importLinked(1);
    const item = project.items[0]!;
    const excluded = { id: "human-cost", name: "Garantía", category: "service" as const, mode: "fixed" as const, amount: 100, notes: "", reviewStatus: "excluded" as const };
    const saved = await saveProject(project.id, { items: [{ ...item, additionalCosts: [excluded], additionalCostsReviewed: true }] }, project.updatedAt);
    expect(saved).not.toBeNull();
    const publicCost = { id: excluded.id, name: excluded.name, category: excluded.category, mode: excluded.mode, amount: excluded.amount, notes: excluded.notes, review_status: "excluded" as const };
    await expect(applyCalculationOperations({
      ...operationBase(project.id, saved!.updatedAt, "change-human-decision"),
      operations: [{ type: "update_item", itemId: item.id,
        patch: { additional_costs: [{ ...publicCost, review_status: "included" }] },
        expected: { additional_costs: [publicCost] } }],
    })).rejects.toThrow(/no puede cambiar|no puede decidir/);
    await expect(applyCalculationOperations({
      ...operationBase(project.id, saved!.updatedAt, "new-included-cost"),
      operations: [{ type: "add_item", key: "new-with-cost", item: { ...publicItem("new"), additional_costs: [{ name: "Envío", amount: 100, review_status: "included" }] } }],
    })).rejects.toThrow(/decisión humana/);
    expect((await getProject(project.id))?.items[0]?.additionalCosts[0]?.reviewStatus).toBe("excluded");
  });

  it("conserva costos asociados existentes y decisiones humanas ante cambios de IA", async () => {
    await isolatedStore("caf-calculation-ops-preserve-costs-");
    const project = await importLinked(1);
    const item = project.items[0]!;
    const included = { id: "approved-installation", name: "Instalación", category: "service" as const,
      mode: "fixed" as const, amount: 900_000, notes: "Aprobado", reviewStatus: "included" as const };
    const saved = await saveProject(project.id, {
      items: [{ ...item, additionalCosts: [included], additionalCostsReviewed: true }],
    }, project.updatedAt);
    const currentCost = { id: included.id, name: included.name, category: included.category,
      mode: included.mode, amount: included.amount, notes: included.notes, review_status: "included" as const };
    for (const [key, proposed] of [
      ["remove", []],
      ["change-approved", [{ ...currentCost, amount: 0 }]],
    ] as const) {
      await expect(applyCalculationOperations({
        ...operationBase(project.id, saved!.updatedAt, key),
        operations: [{ type: "update_item", itemId: item.id,
          patch: { additional_costs: [...proposed] }, expected: { additional_costs: [currentCost] } }],
      })).rejects.toThrow(/no puede quitar|decidido por una persona/);
    }
    expect((await getProject(project.id))!.items[0]!.additionalCosts).toEqual([included]);
    const receipt = await applyCalculationOperations({
      ...operationBase(project.id, saved!.updatedAt, "add-suggested-cost"),
      operations: [{ type: "update_item", itemId: item.id,
        patch: { additional_costs: [currentCost, { id: "suggestion", name: "Flete", amount: 50_000, review_status: "suggested" }] },
        expected: { additional_costs: [currentCost] } }],
    });
    expect(receipt?.status).toBe("applied");
    expect((await getProject(project.id))!.items[0]!.additionalCosts[0]).toEqual(included);
  });
});
