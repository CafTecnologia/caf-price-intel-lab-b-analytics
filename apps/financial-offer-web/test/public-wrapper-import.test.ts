import { describe, expect, it } from "vitest";
import { normalizeImportPayload, toCalculation } from "../lib/contract";

describe("JSON público con metadatos de cálculo", () => {
  it("conserva techo y anexo al agregar calculation", () => {
    const parsed = normalizeImportPayload({
      version: 2,
      calculation: { name: "QA", external_id: "qa:case", source_system: "qa_ai_simulation" },
      items: [{
        item: "1", name: "COMPUTADOR", description: "Ficha de trabajo",
        quantity: 1, unit: "UN", ceiling_unit_price: 2502356,
        source_original: { description: "COMPUTADOR", ceiling_unit_price: "2.502.356,00" },
        technical_annex: [{ document: "Anexo.pdf", locator: "p. 1", text: "Texto completo." }],
        cost_basis_status: "comparable_scenario",
        price_sources: [{ name: "Proveedor", unit_price: 2200000, currency: "COP" }],
        additional_costs: [{ name: "Servicio posible", amount: null, review_status: "suggested" }],
      }],
    });
    expect(parsed.items[0].reference_unit).toBe(2502356);
    expect(parsed.items[0].technical_annex[0]?.text).toBe("Texto completo.");
    expect(parsed.items[0].additional_costs[0]?.review_status).toBe("suggested");
    expect(parsed.items[0].price_sources[0]?.unit_price).toBe(2200000);
    expect(toCalculation(parsed, "qa-id", "2026-10-06T00:00:00Z").items[0]?.costBasisStatus).toBe("comparable_scenario");
  });
});
