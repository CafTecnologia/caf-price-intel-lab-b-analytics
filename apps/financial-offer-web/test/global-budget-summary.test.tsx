import React from "react";
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeImportPayload, toCalculation } from '../lib/contract';
import { buildInitialOfferControls, buildOfferPresentation, buildSimulation, offerControlWithProfitPct } from '../lib/financial-engine';
import { OfferCompositionBar } from '../components/offer-composition-bar';
import { globalOfferCeilingComparison } from '../lib/financial-composition';

function project(items: unknown[], settings: Record<string, unknown> = { manual_reference_total: 13000000 }) {
  const result = toCalculation(normalizeImportPayload({ calculation: { name: 'Presupuesto servicios', currency: 'COP' }, items, settings }), 'qa-global', '2026-10-01T00:00:00.000Z');
  return { ...result, sourceSystem: 'odoo_caf', iaRunId: 'qa-global' };
}
const base = { description: 'Entregable', quantity: 1, unit: 'UN', vat_mode: 'included', selected_cost_mode: 'manual' };
function simulate(value: ReturnType<typeof project>) { return buildSimulation(value, buildInitialOfferControls(value)); }

describe('costos conocidos independientes de la oferta y presupuesto global', () => {
  it('muestra 3194759 conocidos de 14 items aunque ninguno tenga oferta o techo unitario', () => {
    const values = [null, null, null, 903559, 295900, 28700, 309600, 3250, 859900, 26900, null, null, 195000, null];
    const quantities = [1, 1, 2, 1, 1, 7, 1, 4, 1, 1, 1, 15, 3, 1];
    const input = project(values.map((cost, index) => ({ ...base, item: String(index + 1), quantity: quantities[index], manual_unit_cost: cost })));
    const { summary, rows } = simulate(input);
    expect(summary.knownCostTotal).toBe(3194759);
    expect(summary.knownCostCount).toBe(8);
    expect(summary.missingCostCount).toBe(6);
    expect(summary.costIsComplete).toBe(false);
    expect(summary.manualReferenceTotal).toBe(13000000);
    expect(summary.partial.evaluableCount).toBe(0);
    expect(rows.every(row => row.offerUnit === null && row.referenceUnit === null)).toBe(true);
  });
  it('conserva el producto y los asociados conocidos sin dar un servicio pendiente por gratuito', () => {
    const input = project([{ ...base, quantity: 2, manual_unit_cost: 100, manual_offer_unit: 300, offer_mode: 'manual', reference_unit: 400,
      additional_costs: [{ name: 'Instalacion pendiente', category: 'service', mode: 'per_unit', amount: null }, { name: 'Entrega', category: 'logistics', mode: 'fixed', amount: 20 }] }]);
    const { summary, rows } = simulate(input);
    expect(rows[0].knownCostTotal).toBe(220);
    expect(rows[0].status).toBe('viable');
    expect(rows[0].utilityValue).toBe(380);
    expect(rows[0].isFinanciallyEvaluable).toBe(true);
    expect(summary.knownCostTotal).toBe(220);
    expect(summary.missingCostCount).toBe(0);
    expect(summary.missingAssociatedCostCount).toBe(1);
    expect(summary.costIsComplete).toBe(true);
  });
  it('incluye asociados conocidos aun cuando la base no esta cotizada y generales una sola vez', () => {
    const input = project([{ ...base, manual_unit_cost: null, quantity: 2, additional_costs: [{ name: 'Transporte', category: 'logistics', mode: 'fixed', amount: 500 }, { name: 'Accesorio', category: 'other', mode: 'per_unit', amount: 50 }] }]);
    input.generalCosts = [{ id: 'general', name: 'Gasto general', category: 'other', amount: 30, notes: '' }];
    const { summary, rows } = simulate(input);
    expect(rows[0].costUnit).toBeNull();
    expect(rows[0].knownCostTotal).toBe(600);
    expect(summary.knownCostTotal).toBe(630);
    expect(summary.costIsComplete).toBe(false);
  });
  it('una cantidad cero no completa un costo con cargos fijos', () => {
    const input = project([{ ...base, quantity: 0, manual_unit_cost: 100, reference_unit: 200, additional_costs: [{ name: 'Fijo', category: 'other', mode: 'fixed', amount: 500 }] }]);
    const { summary, rows } = simulate(input);
    expect(rows[0].status).toBe('incomplete');
    expect(rows[0].isFinanciallyEvaluable).toBe(false);
    expect(rows[0].knownCostTotal).toBe(500);
    expect(summary.costIsComplete).toBe(false);
    expect(summary.total.isComplete).toBe(false);
    expect(summary.missingQuantityCount).toBe(1);
  });
  it('un servicio con cotizacion humana valida sigue siendo calculable', () => {
    const input = project([{ ...base, deliverable_type: 'service', manual_unit_cost: 100, manual_offer_unit: 200, offer_mode: 'manual' }]);
    const { summary } = simulate(input);
    expect(summary.knownCostTotal).toBe(100);
    expect(summary.costIsComplete).toBe(true);
    expect(summary.total.isComplete).toBe(true);
  });
  it('aplica utilidad humana a 52 de 55 costos sin techo unitario y deja tres pendientes', () => {
    const items = Array.from({ length: 55 }, (_, index) => index < 52
      ? { ...base, item: String(index + 1), manual_unit_cost: 100, selected_cost_mode: 'manual', cost_basis_status: index === 0 ? 'partial' : 'comparable_scenario' }
      : { ...base, item: String(index + 1), cost_weighted_unit: 999, selected_cost_mode: 'weighted', cost_basis_status: 'pending', price_sources: [{ name: 'Referencia IA pendiente', unit_price: 999, currency: 'COP' }] });
    const input = project(items, { manual_reference_total: 14_792_600 });
    const initialControls = buildInitialOfferControls(input);
    const initial = buildSimulation(input, initialControls);
    expect(initial.summary.knownCostCount).toBe(52);
    expect(initial.summary.missingCostCount).toBe(3);
    expect(initial.summary.knownOfferCount).toBe(0);
    expect(initial.summary.missingOfferCount).toBe(55);
    expect(initial.rows.every((row) => row.referenceUnit === null && row.offerUnit === null)).toBe(true);
    expect(initial.rows.slice(52).every((row) => row.costUnit === null)).toBe(true);
    const appliedControls = Object.fromEntries(initial.rows.map((row) => [row.rowKey, offerControlWithProfitPct(row.control, 20, { costUnit: row.costUnit, referenceUnit: row.referenceUnit, offerUnit: row.offerUnit }) ?? row.control]));
    const applied = buildSimulation(input, appliedControls);
    expect(applied.summary.knownOfferCount).toBe(52);
    expect(applied.summary.missingOfferCount).toBe(3);
    expect(applied.summary.knownOfferTotal).toBe(6_240); // Oferta bruta antes del redondeo de presentación.
    expect(buildOfferPresentation(applied, {}).summary.totalOfferWithVat).toBe(6_188); // 52 ofertas visibles de COP 119.
    expect(applied.summary.partial.evaluableCount).toBe(52);
    expect(applied.summary.manualReferenceTotal! - applied.summary.knownOfferTotal!).toBe(14_786_360);
    expect(applied.rows.every((row) => row.referenceUnit === null)).toBe(true);
    expect(applied.rows.slice(52).every((row) => row.offerUnit === null && row.costUnit === null)).toBe(true);
  });
  it('separa oferta bruta, retenciones y techo global aunque falte un costo', () => {
    const input = project([
      { ...base, item: '1', manual_unit_cost: 100, manual_offer_unit: 700, offer_mode: 'manual' },
      { ...base, item: '2', manual_unit_cost: null, manual_offer_unit: 500, offer_mode: 'manual', cost_basis_status: 'pending' },
    ], { manual_reference_total: 1000 });
    const simulation = simulate(input);
    const offer = buildOfferPresentation(simulation, {}, { stampTaxRate: 10 });
    expect(simulation.summary.referenceKnownTotal).toBe(1000);
    expect(simulation.summary.referenceKnownCount).toBe(0);
    expect(simulation.summary.knownOfferCount).toBe(2);
    expect(simulation.summary.total.isComplete).toBe(false);
    expect(offer.summary.totalOfferWithVat).toBe(1198); // Redondeo visible, no suma cruda de controles.
    expect(offer.summary.totalDeductions).toBeCloseTo(119.8, 8);
    expect(offer.summary.expectedNetCollection).toBeCloseTo(1078.2, 8);
    expect(globalOfferCeilingComparison({ ceiling: simulation.summary.referenceKnownTotal, grossOffer: offer.summary.totalOfferWithVat, offeredItemCount: simulation.summary.knownOfferCount, itemCount: simulation.summary.itemCount }))
      .toEqual({ status: 'exceeded', difference: -198, partial: false });
  });
  it('prefiere el techo global manual a la suma de techos unitarios', () => {
    const input = project([
      { ...base, item: '1', reference_unit: 900, manual_unit_cost: 100, manual_offer_unit: 700, offer_mode: 'manual' },
      { ...base, item: '2', reference_unit: 900, manual_unit_cost: 100, manual_offer_unit: 500, offer_mode: 'manual' },
    ], { manual_reference_total: 1000 });
    expect(simulate(input).summary.referenceKnownTotal).toBe(1000);
  });
  it('una oferta manual sin costo suma al techo global pero no a la utilidad parcial', () => {
    const input = project([{ ...base, item: '1', manual_unit_cost: 100, manual_offer_unit: 120, offer_mode: 'manual' }, { ...base, item: '2', manual_unit_cost: null, manual_offer_unit: 500, offer_mode: 'manual', cost_basis_status: 'pending' }], { manual_reference_total: 1_000 });
    const simulation = simulate(input);
    expect(simulation.summary.knownOfferTotal).toBe(620);
    expect(simulation.summary.knownOfferCount).toBe(2);
    expect(simulation.summary.partial.evaluableCount).toBe(1);
    expect(simulation.rows[1]?.utilityValue).toBeNull();
  });
  it('un pending permite una cotización elegida explícitamente', () => {
    const input = project([{ ...base, cost_basis_status: 'pending', selected_cost_mode: 'source', selected_price_source_id: 'humana', price_sources: [{ id: 'humana', name: 'Cotización confirmada', unit_price: 100, currency: 'COP' }] }]);
    expect(simulate(input).rows[0]?.costUnit).toBe(100);
  });
  it('no convierte ausencia de costos en cero ni inventa ofertas con presupuesto cero', () => {
    const input = project([{ ...base }], { manual_reference_total: 0 });
    const { summary, rows } = simulate(input);
    expect(summary.knownCostTotal).toBeNull();
    expect(summary.manualReferenceTotal).toBe(0);
    expect(rows[0].offerUnit).toBeNull();
  });
});

describe('comparación del costo con el techo global', () => {
  it('reconoce costos completos sin exigir techos ni ofertas unitarias', () => {
    const input = project([1, 2, 3].map((number) => ({ ...base, item: String(number), manual_unit_cost: 100 })), { manual_reference_total: 1000 });
    const { summary, rows } = simulate(input);
    expect(summary.costIsComplete).toBe(true);
    expect(summary.knownCostTotal).toBe(300);
    expect(summary.missingReferenceCount).toBe(3);
    expect(summary.missingOfferCount).toBe(3);
    expect(rows.every((row) => row.referenceUnit === null && row.offerUnit === null)).toBe(true);
  });
  it('usa una sola barra gris para costos parciales, sin atribuirles utilidad', () => {
    const html = renderToStaticMarkup(<OfferCompositionBar offer={null} ceiling={13000000} cost={null} netUtility={null} deductions={null} scope="Resumen" compact costOverview={{ knownCost: 3194759, knownCostCount: 8, knownOffer: 9000000, knownOfferCount: 10, itemCount: 14, pendingCostCount: 6, pendingOfferCount: 4, costComplete: false }} />);
    expect(html).toContain('budget-cost-overview is-preliminary');
    expect(html).toContain('budget-cost-fill');
    expect(html).not.toContain('budget-known-fill');
    expect(html).not.toContain('budget-offer-fill');
    expect(html).toContain('Saldo antes de costos pendientes');
    expect(html).toContain('offer-graphic-compact-legend');
    expect(html).toContain('budget-gap-fill');
    expect(html).toContain('4 sin oferta'); // El detalle permanece en la descripción accesible del gráfico.
    expect(html).not.toContain('class="budget-pending-note"');
    expect(html).not.toContain('Utilidad neta');
  });
  it('colorea el costo completo frente al techo aunque no haya oferta ni techos unitarios', () => {
    const html = renderToStaticMarkup(<OfferCompositionBar offer={null} ceiling={14000000} cost={null} netUtility={null} deductions={null} scope="Resumen" compact={false} costOverview={{ knownCost: 12000000, knownCostCount: 55, knownOffer: null, knownOfferCount: 0, itemCount: 55, pendingCostCount: 0, pendingOfferCount: 55, costComplete: true }} />);
    expect(html).toContain('budget-cost-overview is-cost-comparable');
    expect(html).toContain('budget-cost-fill');
    expect(html).toContain('Saldo frente al techo');
    expect(html).toContain('budget-cost-fill has-inside-label');
    expect(html).toContain('budget-gap-fill has-inside-label');
    expect(html).toContain('$ 2.000.000');
    expect(html).not.toContain('budget-offer-fill');
    expect(html).not.toContain('Utilidad neta');
    expect(html).not.toContain('Oferta registrada');
  });
  it('identifica cuando el costo completo supera el techo global', () => {
    const html = renderToStaticMarkup(<OfferCompositionBar offer={null} ceiling={1000000} cost={null} netUtility={null} deductions={null} scope="Resumen" compact costOverview={{ knownCost: 1200000, knownCostCount: 2, knownOffer: null, knownOfferCount: 0, itemCount: 2, pendingCostCount: 0, pendingOfferCount: 2, costComplete: true }} />);
    expect(html).toContain('Costo supera techo');
    expect(html).toContain('$ 200.000');
  });
  it('muestra la composición parcial con costo y utilidad de los mismos ítems', () => {
    const html = renderToStaticMarkup(<OfferCompositionBar offer={1200} ceiling={null} cost={800} netUtility={300} deductions={100} scope="Oferta parcial · 2/3 ítems" compact preliminary />);
    expect(html).toContain('offer-graphic-segment is-cost');
    expect(html).toContain('offer-graphic-segment is-utility');
    expect(html).toContain('Oferta parcial · 2/3 ítems');
    expect(html).not.toContain('budget-cost-overview');
  });
  it('recupera el grafico normal al completar los datos', () => {
    const html = renderToStaticMarkup(<OfferCompositionBar offer={1000} ceiling={1000} cost={600} netUtility={300} deductions={100} scope="Oferta total" compact />);
    expect(html).not.toContain('is-preliminary');
    expect(html).toContain('Valor a ofertar');
  });
});
