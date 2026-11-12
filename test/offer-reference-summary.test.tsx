import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfferReferenceSummary } from "../components/offer-composition-bar";
const base = { offer: 1000, cost: 600, deductions: 100, netUtility: 300, ceiling: 1200, scope: "3 ítems" };
describe("referencia financiera plegada", () => {
  it("conserva la cinta proporcional y vincula importes completos a sus colores", () => {
    const html = renderToStaticMarkup(createElement(OfferReferenceSummary, base));
    expect(html).toContain('role="img"');
    expect(html).toContain('width:60%');
    expect(html).toContain('width:30%');
    expect(html).toContain('width:10%');
    expect(html).toMatch(/summary-color-key is-cost.*?Costo.*?600/s);
    expect(html).toMatch(/summary-color-key is-utility.*?Utilidad.*?300/s);
    expect(html).toMatch(/summary-color-key is-deductions.*?Retenciones.*?100/s);
    expect(html).toMatch(/summary-color-key is-discount.*?Descuento.*?200/s);
    expect(html).toContain("3 ítems. Valores en pesos colombianos (COP)");
  });
  it("distingue pérdida, exceso y pendiente sin presentar cero como utilidad conocida", () => {
    const loss = renderToStaticMarkup(createElement(OfferReferenceSummary, { ...base, cost: 1000, netUtility: -100, ceiling: 900 }));
    expect(loss).toMatch(/summary-color-key is-loss.*?Pérdida.*?-100/s);
    expect(loss).toContain("Exceso");
    const pending = renderToStaticMarkup(createElement(OfferReferenceSummary, { ...base, preliminary: true, netUtility: null, cost: null }));
    expect(pending).toContain("Oferta parcial");
    expect(pending).toMatch(/Utilidad<\/dt><dd>Pendiente<small.*?<\/small><\/dd>/s);
  });
});
