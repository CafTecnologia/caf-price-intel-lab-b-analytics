import { describe, expect, it } from "vitest";
import { extractStage3SourceRecords } from "@/lib/stage3-source-audit";

describe("stage3 source audit", () => {
  it("extrae fuentes de cotizaciones sin modificar el resultado original", () => {
    const stage3 = {
      items: [
        {
          "Consecutivo interno": 7,
          "Nombre o descripci?n": "Taladro profesional",
          "Detalles o ficha t?cnica": "Taladro 1/2 pulg",
          "Cotizaciones encontradas": [
            {
              fuente: { nombre: "Proveedor A", url: "https://example.com/taladro" },
              producto: { titulo: "Taladro 1/2" },
              precio: { valor: 210000, moneda: "COP" },
              text_original: "Referencia exacta"
            }
          ]
        }
      ]
    };

    const { sources, totalSourcesFound } = extractStage3SourceRecords(stage3);
    expect(totalSourcesFound).toBe(1);
    expect(sources[0]).toMatchObject({
      sourceId: "7#1",
      itemKey: "7",
      itemName: "Taladro profesional",
      reportedSourceName: "Proveedor A",
      reportedUrl: "https://example.com/taladro",
      reportedProductTitle: "Taladro 1/2",
      reportedPrice: 210000,
      reportedCurrency: "COP"
    });
  });

  it("limita la muestra de fuentes a auditar", () => {
    const stage3 = {
      items: [
        {
          "Consecutivo interno": 1,
          "Cotizaciones encontradas": [
            { url: "https://example.com/1" },
            { url: "https://example.com/2" },
            { url: "https://example.com/3" }
          ]
        }
      ]
    };

    const { sources, totalSourcesFound } = extractStage3SourceRecords(stage3, 2);
    expect(totalSourcesFound).toBe(3);
    expect(sources).toHaveLength(2);
  });
});
