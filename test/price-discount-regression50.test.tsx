import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {normalizeImportPayload,toCalculation} from '../lib/contract';
import {buildSimulation,buildInitialOfferControls,buildOfferPresentation,offerControlWithDiscountPct} from '../lib/financial-engine';
import {OfferReferenceSummary,OfferCompositionBar} from '../components/offer-composition-bar';

function calculate(discount=0) {
 const raw={version:3,source:{system:'odoo_caf',run_id:'regression50'},settings:{manual_reference_total:43971100},items:
  [[1,5939080,3902700],[6,358400,253100],[45,140200,92800],[57,76620,50800],[2,6678000,4750000],[50,17000,12150],[1,7263200,5199900],[1,280000,144619]].map(([quantity,ceiling,cost],index)=>({item:String(index+1),name:`Producto ${index+1}`,quantity,ceiling_unit_price:ceiling,price_sources:[{name:'Referencia de costo',unit_price:cost,currency:'COP'}]}))};
 const project=toCalculation(normalizeImportPayload(raw),'regression50','2026-11-12T22:00:00Z');
 const controls=buildInitialOfferControls(project);
 const initial=buildSimulation(project,controls);
 for(const row of initial.rows) controls[row.rowKey]=offerControlWithDiscountPct(row.control,discount,{costUnit:row.costUnit,referenceUnit:row.referenceUnit,offerUnit:row.offerUnit})!;
 const simulation=buildSimulation(project,controls);
 return {simulation,offer:buildOfferPresentation(simulation,{})};
}
describe('descuento de precios separado del presupuesto y del redondeo',()=>{
 it('conserva cero descuento en los ocho precios a techo del caso Villavicencio',()=>{
  const {simulation,offer}=calculate();
  expect(simulation.summary.manualReferenceTotal).toBe(43971100);
  expect(offer.summary.priceDiscountPct).toBe(0);
  expect(offer.summary.priceReferenceTotal).toBe(40515020);
  expect(offer.summary.totalOfferBeforeRounding).toBe(40515020);
  expect(offer.summary.totalOfferWithVat).toBe(40513817);
 });
 it('mide una rebaja real contra las mismas cantidades y precios, sin incluir saldo global',()=>{
  const {offer}=calculate(10);
  expect(offer.summary.priceDiscountPct).toBeCloseTo(10,8);
 });
 it('la vista plegada y la ampliada no convierten redondeo en descuento',()=>{
  const props={offer:40513817,offerBeforeRounding:40515020,ceiling:40515020,cost:27944919,netUtility:7131882,deductions:5437016,scope:'8 ítems',referenceBasis:'items' as const};
  const html=renderToStaticMarkup(<OfferReferenceSummary {...props}/>);
  expect(html).toMatch(/Descuento<\/dt><dd>\$\s*0<small.*?0\s*%/s);
  expect(html).toContain('Redondeo');
  const expanded=renderToStaticMarkup(<OfferCompositionBar {...props} compact={false}/>);
  expect(expanded).not.toContain('Descuento $');
  expect(expanded).toContain('Redondeo');
 });
 it('el presupuesto global se muestra como saldo, sin inventar descuento de precios',()=>{
  const props={offer:40513817,ceiling:43971100,cost:27944919,netUtility:7131882,deductions:5437016,scope:'8 ítems',referenceBasis:'budget' as const};
  for(const compact of [true,false]){
   const html=renderToStaticMarkup(<OfferCompositionBar {...props} compact={compact}/>);
   expect(html).not.toContain('Descuento');
   expect(html).toContain('Saldo');
  }
 });
});
