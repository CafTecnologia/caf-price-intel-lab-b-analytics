import { describe, expect, it } from "vitest";
import { stage3ResultToFinancialIngest } from "@/lib/stage3-to-financial-ingest";

describe("stage3ResultToFinancialIngest", () => {
  it("emite contrato v2 simple para financial-offer-web", () => {
    const payload = stage3ResultToFinancialIngest(
      {
        items: [
          {
            "No. item": "1",
            "Nombre o descripci?n": "Taladro profesional",
            "Detalles o ficha t?cnica": "Taladro 1/2 pulg, uso profesional.",
            "Und de medida": "UND",
            Cant: "2",
            "Precio techo encontrado": "$350.000",
            "Tipo de ficha": "abierta",
            "Cotizaciones encontradas": [
              {
                fuente: { nombre: "Proveedor A", url: "https://example.com/a" },
                precio: { valor: "210000", moneda: "COP", texto_original: "$210.000" },
                defensa: { estado_fuente: "no_usable", justificacion: "Benchmark debil pero util para revisar." }
              }
            ]
          }
        ]
      },
      { analysisId: "analysis-1", runId: "run-1", usdToCopRate: 4000 }
    );

    expect(payload.version).toBe(2);
    expect(payload.source).toMatchObject({ system: "ia-stages-web", analysis_id: "analysis-1", run_id: "run-1" });
    expect(payload.items[0]).toMatchObject({
      item: "1",
      name: "Taladro profesional",
      description: "Taladro 1/2 pulg, uso profesional.",
      unit: "UND",
      quantity: 2,
      ceiling_unit_price: 350000
    });
    expect(payload.items[0].notes).toContain("Tipo ficha: abierta");
    expect(payload.items[0].price_sources[0]).toMatchObject({
      name: "Proveedor A",
      unit_price: 210000,
      currency: "COP",
      url: "https://example.com/a"
    });
  });

  it("conserva filas aunque falte nombre estructurado", () => {
    const payload = stage3ResultToFinancialIngest({ items: [{ foo: "bar" }] });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].name).toBe("Item 1");
  });
});
