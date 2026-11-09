import { describe, expect, it } from "vitest";
import { parseTrmDatasetRow } from "@/lib/official-trm";

describe("parseTrmDatasetRow", () => {
  it("parsea valor string con punto decimal", () => {
    expect(parseTrmDatasetRow({ valor: "3637.51" })).toBe(3637.51);
  });

  it("acepta coma como separador decimal", () => {
    expect(parseTrmDatasetRow({ valor: "4000,5" })).toBe(4000.5);
  });

  it("devuelve null si falta valor o no es positivo", () => {
    expect(parseTrmDatasetRow(undefined)).toBeNull();
    expect(parseTrmDatasetRow({})).toBeNull();
    expect(parseTrmDatasetRow({ valor: "0" })).toBeNull();
    expect(parseTrmDatasetRow({ valor: "x" })).toBeNull();
  });
});
