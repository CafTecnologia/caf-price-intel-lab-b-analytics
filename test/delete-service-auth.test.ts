import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@offer/lib/contract", async () => import("../lib/contract"));
vi.mock("@offer/lib/store", async () => import("../lib/store"));
vi.mock("@offer/lib/base-path", async () => import("../lib/base-path"));

import { DELETE, GET } from "../app/api/projects/[projectId]/route";
import { sampleImportPayload } from "../lib/contract";
import { deleteCalculation, getCalculation, importCalculation, saveCalculation } from "../lib/store";

const TEST_SERVICE_TOKEN = "test-only-financial-delete-service-token-0001";
const OPERATION_ID = "0123456789abcdef0123456789abcdef";

function routeProps(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function deleteRequest(projectId: string, body: unknown, token = TEST_SERVICE_TOKEN) {
  return new Request(`http://financial.test/api/projects/${projectId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function createLinkedCalculation() {
  const input = sampleImportPayload() as {
    calculation: Record<string, unknown>;
  };
  input.calculation = {
    ...input.calculation,
    external_id: "fin-p42-o77",
    source_system: "odoo",
    odoo_project_id: "42",
    ia_run_id: "run-77",
    source_analysis_id: "analysis-77",
  };
  return importCalculation(input);
}

function deletionBody(calculation: Awaited<ReturnType<typeof createLinkedCalculation>>, operationId = OPERATION_ID) {
  return {
    operationId,
    calculationId: calculation.id,
    externalId: calculation.externalId,
    odooProjectId: calculation.odooProjectId,
    iaRunId: calculation.iaRunId,
    sourceAnalysisId: calculation.sourceAnalysisId,
    expectedUpdatedAt: calculation.updatedAt,
  };
}

describe("authenticated financial calculation deletion", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const previousServiceToken = process.env.FINANCIAL_DELETE_SERVICE_TOKEN;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "caf-financial-delete-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    process.env.FINANCIAL_DELETE_SERVICE_TOKEN = TEST_SERVICE_TOKEN;
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    if (previousServiceToken === undefined) delete process.env.FINANCIAL_DELETE_SERVICE_TOKEN;
    else process.env.FINANCIAL_DELETE_SERVICE_TOKEN = previousServiceToken;
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("requires the server credential before revealing or deleting a calculation", async () => {
    const calculation = await createLinkedCalculation();
    const body = deletionBody(calculation);

    const unauthorized = await DELETE(
      deleteRequest(calculation.id, body, "wrong-test-token-that-is-long-enough-000"),
      routeProps(calculation.id),
    );
    expect(unauthorized.status).toBe(401);
    expect(await getCalculation(calculation.id)).not.toBeNull();

    const preflight = await GET(
      new Request(`http://financial.test/api/projects/${calculation.id}?deletionPreflight=1`),
      routeProps(calculation.id),
    );
    expect(preflight.status).toBe(401);
  });

  it("rejects the former caller-controlled Odoo URL without making an outbound request", async () => {
    const calculation = await createLinkedCalculation();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not be called"));
    const response = await DELETE(
      deleteRequest(calculation.id, {
        ...deletionBody(calculation),
        launchToken: "attacker-controlled-token",
        odooBaseUrl: "https://attacker.invalid",
        odooDb: "forged",
      }),
      routeProps(calculation.id),
    );

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getCalculation(calculation.id)).not.toBeNull();
  });

  it("returns an authenticated minimal preflight and enforces every link field", async () => {
    const calculation = await createLinkedCalculation();
    const preflight = await GET(
      new Request(`http://financial.test/api/projects/${calculation.id}?deletionPreflight=1`, {
        headers: { Authorization: `Bearer ${TEST_SERVICE_TOKEN}` },
      }),
      routeProps(calculation.id),
    );
    expect(preflight.status).toBe(200);
    expect(await preflight.json()).toEqual({
      calculationId: calculation.id,
      externalId: calculation.externalId,
      odooProjectId: calculation.odooProjectId,
      iaRunId: calculation.iaRunId,
      sourceAnalysisId: calculation.sourceAnalysisId,
      updatedAt: calculation.updatedAt,
    });

    const response = await DELETE(
      deleteRequest(calculation.id, { ...deletionBody(calculation), sourceAnalysisId: "other-analysis" }),
      routeProps(calculation.id),
    );
    expect(response.status).toBe(403);
    expect(await getCalculation(calculation.id)).not.toBeNull();
  });

  it("deletes once, returns the same tombstone on retry, and rejects a new operation after deletion", async () => {
    const calculation = await createLinkedCalculation();
    const body = deletionBody(calculation);

    const first = await DELETE(deleteRequest(calculation.id, body), routeProps(calculation.id));
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    expect(firstPayload.status).toBe("deleted");
    expect(firstPayload.deletionReceipt).toMatchObject({
      operationId: OPERATION_ID,
      calculationId: calculation.id,
      externalId: calculation.externalId,
      deletedUpdatedAt: calculation.updatedAt,
    });
    expect(await getCalculation(calculation.id)).toBeNull();

    const retry = await DELETE(deleteRequest(calculation.id, body), routeProps(calculation.id));
    expect(retry.status).toBe(200);
    const retryPayload = await retry.json();
    expect(retryPayload.status).toBe("already_deleted");
    expect(retryPayload.deletionReceipt).toEqual(firstPayload.deletionReceipt);

    const unrelatedRetry = await DELETE(
      deleteRequest(calculation.id, { ...body, operationId: "abcdef0123456789abcdef0123456789" }),
      routeProps(calculation.id),
    );
    expect(unrelatedRetry.status).toBe(404);
  });

  it("normalizes absent manual/IA links to null and bounds retained deletion receipts", async () => {
    const calculation = await importCalculation(sampleImportPayload());
    expect(calculation.externalId).toBeNull();
    expect(calculation.odooProjectId).toBeNull();
    expect(calculation.iaRunId).toBeNull();
    expect(calculation.sourceAnalysisId).toBeNull();

    const storeFile = path.join(tempDir, "data/financial-offer/projects.json");
    const store = JSON.parse(await fs.readFile(storeFile, "utf8"));
    const now = Date.now();
    store.deletionReceipts = Object.fromEntries(Array.from({ length: 2_005 }, (_, index) => {
      const operationId = index.toString(16).padStart(32, "0");
      return [operationId, {
        operationId,
        calculationId: `old-${index}`,
        externalId: null,
        odooProjectId: null,
        iaRunId: null,
        sourceAnalysisId: null,
        deletedUpdatedAt: new Date(now - index * 1_000).toISOString(),
        deletedAt: new Date(now - index * 1_000).toISOString(),
      }];
    }));
    await fs.writeFile(storeFile, JSON.stringify(store), "utf8");

    const response = await DELETE(
      deleteRequest(calculation.id, deletionBody(calculation, "ffffffffffffffffffffffffffffffff")),
      routeProps(calculation.id),
    );
    expect(response.status).toBe(200);
    const storedAfterDelete = JSON.parse(await fs.readFile(storeFile, "utf8"));
    expect(Object.keys(storedAfterDelete.deletionReceipts)).toHaveLength(2_000);
  });

  it("keeps the create-once import tombstone and explains that a new run is required", async () => {
    const input = sampleImportPayload() as {
      create_once?: boolean;
      calculation: Record<string, unknown>;
    };
    input.create_once = true;
    input.calculation = {
      ...input.calculation,
      external_id: "run-delete-once",
      source_system: "odoo",
    };
    const calculation = await importCalculation(input);
    const deletion = await deleteCalculation({
      ...deletionBody(calculation),
      operationId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    expect(deletion.status).toBe("deleted");

    await expect(importCalculation(input)).rejects.toThrow(/eliminado.*nueva corrida/i);
    expect(await getCalculation(calculation.id)).toBeNull();
  });

  it("returns 409 for a stale version and serializes deletion with saves", async () => {
    const calculation = await createLinkedCalculation();
    const staleBody = deletionBody(calculation);
    const saved = await saveCalculation(calculation.id, { name: "Edición concurrente" }, calculation.updatedAt);
    expect(saved?.name).toBe("Edición concurrente");

    const staleDelete = await DELETE(deleteRequest(calculation.id, staleBody), routeProps(calculation.id));
    expect(staleDelete.status).toBe(409);
    expect((await getCalculation(calculation.id))?.name).toBe("Edición concurrente");

    const current = await getCalculation(calculation.id);
    expect(current).not.toBeNull();
    const savePromise = saveCalculation(calculation.id, { name: "Última edición" }, current!.updatedAt);
    const deletePromise = deleteCalculation({
      ...deletionBody(current!),
      operationId: "11111111111111111111111111111111",
    });
    const [lastSave, racedDelete] = await Promise.all([savePromise, deletePromise]);
    expect(lastSave?.name).toBe("Última edición");
    expect(racedDelete.status).toBe("conflict");
    expect((await getCalculation(calculation.id))?.name).toBe("Última edición");
  });
});
