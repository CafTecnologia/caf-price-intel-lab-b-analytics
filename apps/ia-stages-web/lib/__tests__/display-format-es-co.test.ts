import { describe, expect, it } from "vitest";
import { formatNumberEsCO, formatScalarForUi, parseLooseNumber } from "@/lib/display-format-es-co";

describe("display-format-es-co", () => {
  it("formatea miles y decimales en es-CO", () => {
    expect(formatNumberEsCO(1234567.89)).toBe("1.234.567,89");
    expect(formatNumberEsCO(42)).toBe("42");
  });

  it("interpreta texto con coma decimal o punto decimal", () => {
    expect(parseLooseNumber("1.234,56")).toBe(1234.56);
    expect(parseLooseNumber("1234.56")).toBe(1234.56);
    expect(parseLooseNumber("1,5")).toBe(1.5);
    expect(parseLooseNumber("190.000")).toBe(190000);
    expect(parseLooseNumber("1,234")).toBe(1234);
  });

  it("formatScalarForUi deja texto no numérico intacto", () => {
    expect(formatScalarForUi("IVA 19%")).toBe("IVA 19%");
    expect(formatScalarForUi("abc")).toBe("abc");
  });

  it("formatScalarForUi numera cadenas puramente numéricas", () => {
    expect(formatScalarForUi("1000,5")).toBe("1.000,5");
    expect(formatScalarForUi("190.000")).toBe("190.000");
  });

  it("formatea textos de precio sin mutar textos no numericos", () => {
    expect(formatScalarForUi("$ 713,550.55")).toBe("$ 713.550,55");
    expect(formatScalarForUi("COP 190.000")).toBe("COP 190.000");
    expect(formatScalarForUi("IVA 19%")).toBe("IVA 19%");
  });

  it("permite mostrar valores crudos", () => {
    expect(formatScalarForUi("$ 713,550.55", { numberFormat: "raw" })).toBe("$ 713,550.55");
    expect(formatScalarForUi(123456, { numberFormat: "raw" })).toBe("123456");
  });
});
