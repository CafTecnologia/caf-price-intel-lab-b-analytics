import { describe, expect, it } from "vitest";
import { normalizeImportPayload, toCalculation } from "../lib/contract";
import { applyCalculationOperationBatch, CalculationOperationsSchema } from "../lib/calculation-operations";

function fixture() {
  const project = toCalculation(normalizeImportPayload({ version: 2, items: [{
    item: "002", name: "SERVICIO SINTETICO", quantity: 1, unit: "SERV", deliverable_type: "service",
    cost_basis_status: "pending", price_sources: [{ name: "Pendiente de referencia", unit_price: null, currency: "COP" }],
  }] }), "synthetic-regression", "2026-10-14T00:00:00.000Z");
  project.items[0]!.costBasisStatus = "conforming";
  return project;
}
function input(project: ReturnType<typeof fixture>, expected = "conforming", patch = "pending") {
  return CalculationOperationsSchema.parse({ projectId: project.id, odooProjectId: "2611", externalRunId: "synthetic-regression",
    jobId: "regression", operationId: "regression-pending", expectedUpdatedAt: project.updatedAt,
    operations: [{ type: "update_item", itemId: project.items[0]!.id, expected: { cost_basis_status: expected }, patch: { cost_basis_status: patch } }],
  });
}
describe("precondicion observada de servicio sin costo", () => {
  it("permite corregir el estado heredado sin reinterpretar la precondicion", () => {
    const p = fixture(); const result = applyCalculationOperationBatch(p, input(p));
    expect(result.project.items[0]!.costBasisStatus).toBe("pending");
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.field).toBe("cost_basis_status");
    expect(p.items[0]!.costBasisStatus).toBe("conforming");
  });
  it("rechaza una precondicion realmente distinta", () => {
    const p = fixture(); expect(() => applyCalculationOperationBatch(p, input(p, "partial"))).toThrow(/cost_basis_status.*cambió/);
  });
  it("un reintento no duplica cambios", () => {
    const p = fixture(); const fixed = applyCalculationOperationBatch(p, input(p)).project;
    expect(applyCalculationOperationBatch(fixed, input(fixed)).changes).toHaveLength(0);
  });
  it("mantiene la politica de escritura para servicio pendiente", () => {
    const p = fixture(); const item = applyCalculationOperationBatch(p, input(p, "conforming", "conforming")).project.items[0]!;
    expect(item.costBasisStatus).toBe("pending"); expect(item.manualUnitCost).toBeNull();
  });
});
