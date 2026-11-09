import { describe, expect, it } from "vitest";
import {
  annotateStage3Coverage,
  findMissingItemKeys,
  getItemsArray,
  getStage3ItemKey,
  mergeStage3Results,
  missingItemsDetail,
  validateStage3AgainstInput
} from "@/lib/stage3Review";

describe("stage3Review", () => {
  it("extrae items de objetos con metadata", () => {
    const row = { "Consecutivo interno": 1, x: 1 };
    expect(getItemsArray({ metadata: {}, items: [row] })).toHaveLength(1);
  });

  it("detecta faltantes por consecutivo", () => {
    const inItems = [{ "Consecutivo interno": 1 }, { "Consecutivo interno": 2 }];
    const outItems = [{ "Consecutivo interno": 1 }];
    const v = validateStage3AgainstInput({ items: inItems }, { items: outItems });
    expect(v.expectedCount).toBe(2);
    expect(v.actualCount).toBe(1);
    expect(v.missingKeys.length).toBe(1);

    const m = missingItemsDetail({ items: inItems }, { items: outItems });
    expect(m.missingLabels.length).toBe(1);
  });

  it("clave compuesta lote + item si no hay consecutivo", () => {
    const item = { Lote: "A", "No. item": "5" };
    expect(getStage3ItemKey(item).key).toContain("l:A");
  });

  it("findMissingItemKeys coincide con validate", () => {
    const stage2 = { items: [{ "Consecutivo interno": 10 }] };
    const stage3 = { items: [] as Record<string, unknown>[] };
    const fm = findMissingItemKeys(getItemsArray(stage2), getItemsArray(stage3));
    expect(fm.missingKeys.length).toBe(1);
  });

  it("anota cobertura parcial sin bloquear el resultado", () => {
    const stage2 = { items: [{ "Consecutivo interno": 1 }, { "Consecutivo interno": 2 }] };
    const annotated = annotateStage3Coverage(stage2, { items: [{ "Consecutivo interno": 1 }] });
    expect(annotated.items).toHaveLength(1);
    expect((annotated.control_calidad as Record<string, unknown>).estado_app).toBe("recibido_parcial");
  });

  it("fusiona items recibidos por miniagente y recalcula cobertura", () => {
    const stage2 = { items: [{ "Consecutivo interno": 1 }, { "Consecutivo interno": 2 }] };
    const current = { items: [{ "Consecutivo interno": 1, precio: 100 }] };
    const completion = { items: [{ "Consecutivo interno": 2, precio: 200 }] };
    const merged = mergeStage3Results(stage2, current, completion);
    expect(merged.items).toHaveLength(2);
    expect(((merged.control_calidad as Record<string, unknown>).cobertura_stage3 as Record<string, unknown>).completo).toBe(true);
  });

});
