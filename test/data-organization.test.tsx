import {UnifiedItemDetail} from "../components/unified-item-detail";
import {capturePriceBase, restorePriceBase} from "../lib/price-base";
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeImportPayload, toCalculation, preserveAdditionalCostsOnReimport } from "../lib/contract";
import { DataOrganizationSchema } from "../lib/data-organization";
import { OriginalRowDetail, CompositionDetail } from "../components/data-organization-detail";
import { buildSimulation, buildInitialOfferControls } from "../lib/financial-engine";
import * as baseline from "/opt/caf-dev/storage/alineacion-dev-prod-20261027/finance-candidate/lib/contract";
import * as baselineEngine from "/opt/caf-dev/storage/alineacion-dev-prod-20261027/finance-candidate/lib/financial-engine";

const root = "/opt/caf-dev/storage/finance-organization-20261027";
const deliveries = JSON.parse(readFileSync(root + "/original-deliveries.json", "utf8"));
const now = "2026-10-27T00:00:00.000Z";
const make = (input: unknown) => toCalculation(normalizeImportPayload(input), "same-id", now);
const simulate = (p: ReturnType<typeof make>) => buildSimulation(p, buildInitialOfferControls(p));
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = (v: any) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const report: any[] = [];
const review: any[] = [];
describe("26 entregas originales: referencia vs contrato nuevo", () => {
  for (const delivery of deliveries) it(delivery.run_id, () => {
    expect(digest(delivery.payload)).toBe(delivery.sha256);
    const old = baseline.toCalculation(baseline.normalizeImportPayload(delivery.payload), "same-id", now);
    const compatible = make(delivery.payload);
    expect(compatible).toEqual(old);
    const upgraded = { ...delivery.payload, version: 3, items: delivery.payload.items.map((item: any) => ({
      ...item, data_organization: {version: 1, original_capture: "legacy_fields_only", normalization: [], components: []},
    })) };
    const next = make(upgraded);
    expect(next.items.map(({dataOrganization, ...item}) => item)).toEqual(old.items);
    const oldResult = baselineEngine.buildSimulation(old, baselineEngine.buildInitialOfferControls(old));
    const nextResult = simulate(next);
    // The supplied new design adds one display-only counter; validate it independently.
    nextResult.rows.forEach((row, index) => expect(row.associatedCostCount).toBe((next.items[index]!.additionalCosts ?? []).length));
    const comparableResult = { ...nextResult, rows: nextResult.rows.map(({associatedCostCount, ...row}) => row) };
    expect(comparableResult).toEqual(oldResult);
    report.push({run_id: delivery.run_id, job_id: delivery.job_id, input_sha256: delivery.sha256,
      rows: next.items.length, project_id: delivery.payload.source?.odoo_project_id ?? null,
      unchanged_legacy_reception: true, unchanged_financial_fields: true, unchanged_financial_simulation: true, added_display_metadata: "associatedCostCount",
      baseline_simulation_sha256: digest(oldResult), candidate_simulation_sha256: digest(comparableResult),
      original_capture: "legacy_fields_only", literal_original_headers_available: false});
    review.push({run_id: delivery.run_id, baseline: old, candidate: next, baseline_result: oldResult});
  });
  it("concilia toda la población y guarda evidencia", () => {
    expect(report).toHaveLength(26);
    expect(report.reduce((n,x) => n+x.rows,0)).toBe(628);
    writeFileSync(root+"/replay-results.json", JSON.stringify({baseline_commit:"f76bcb6fc7fbe9affee4f9f9e59dae59b968edc5", scope:"exact_original_deliveries_not_human_edits", cases:report},null,2));
    writeFileSync(root+"/review-data.json", JSON.stringify(review));
  });
});

const literal: any = {
 version:1, original_capture:"literal",
 original_row:{document:"Anexo ejemplo",locator:"Fila 7",columns:[
  {id:"a",header:"Numeral",value:"007"},
  {id:"b",header:"Nombre y descripción",value:`  Portátil Ryzen 5
con monitor de 24 pulgadas  `},
  {id:"c",header:"Cantidad",value:"02"},
  {id:"d",header:"Cantidad",header_path:["Información contractual"],value:null},
 ]},
 normalization:[{field:"name",column_ids:["b"],operation:"split",note:"Nombre separado de la descripción conservando la celda original."}],
 components:[
  {id:"pc",name:"Portátil",type:"product",quantity_per_deliverable:1,relationship:"included",reason:"Producto principal del entregable."},
  {id:"monitor",name:"Pantalla adicional 24 pulgadas",type:"product",quantity_per_deliverable:1,relationship:"separate",reason:"Exigida como pieza adicional; aún no valorada aparte."},
  {id:"install",name:"Instalación en sitio",type:"service",quantity_per_deliverable:1,relationship:"separate",reason:"Servicio exigido en sitio con costo identificado.",additional_cost_id:"install"},
 ],
};
function payload(organization: any = literal): any { return {version:3,items:[{item:"007",name:"Portátil",description:"Con monitor adicional e instalación",quantity:2,unit:"UND",ceiling_unit_price:5000000,deliverable_type:"product",price_sources:[{id:"a",name:"Alternativa A completa",unit_price:3000000,currency:"COP"},{id:"b",name:"Alternativa B completa",unit_price:4000000,currency:"COP"}],additional_costs:[{id:"install",name:"Instalación en sitio",category:"service",mode:"per_unit",amount:50000,review_status:"included"}],data_organization:structuredClone(organization)}]}; }
describe("organización nueva sin alterar decisiones financieras", () => {
 it("retiene encabezados repetidos, orden, espacios, ceros y celdas vacías; separa datos normalizados", () => {
  const p=make(payload()); const d=p.items[0].dataOrganization!;
  expect(d.original_row).toEqual(literal.original_row);
  expect(p.items[0].item).toBe("007"); expect(p.items[0].quantity).toBe(2);
  const html=renderToStaticMarkup(<OriginalRowDetail item={p.items[0]} />);
  expect(html).toContain("Nombre y descripción"); expect(html).toContain("Celda vacía");
  expect(html).toContain("Cómo se organizaron estos datos");
 });
 it("la ficha reconoce el documento del contrato nuevo sin exigir el campo antiguo", () => {
  const p=make(payload());const html=renderToStaticMarkup(<UnifiedItemDetail item={p.items[0]} row={simulate(p).rows[0]} index={0} count={1} onClose={()=>{}} onEdit={()=>{}} onAddCost={()=>{}} onSetManualCost={()=>{}} onSetAdditionalCost={()=>{}} onUpdateAdditionalCost={()=>{}} onRemoveAdditionalCost={()=>{}} onNavigate={()=>{}}/>);
  expect(html).toContain("Anexo ejemplo");expect(html).not.toContain("Documento no identificado");expect(html).not.toContain("Origen documental no aportado");expect(html).not.toContain("Cantidad no aportada");
 });
 it("componentes no se suman ni convierten alternativas en piezas", () => {
  const extended=make(payload()); const input=payload();delete input.items[0].data_organization;input.version=2;
  expect(simulate(extended)).toEqual(simulate(make(input)));
  expect(simulate(extended).rows[0].additionalCostTotal).toBe(100000);
 });
 it("un conjunto de fábrica sigue siendo un solo componente", () => {
  const d=structuredClone(literal);d.components=[{id:"bundle",name:"PC referencia de fábrica",type:"product",quantity_per_deliverable:1,relationship:"included",factory_bundle:true,included_parts:["Torre","Pantalla 24","Teclado","Mouse"],reason:"La referencia comercial incluye estas piezas."}];
  const p=make(payload(d)); expect(p.items).toHaveLength(1);expect(p.items[0].dataOrganization!.components).toHaveLength(1);
  expect(renderToStaticMarkup(<CompositionDetail item={p.items[0]}/>)).toContain("Conjunto de fábrica");
 });
 it("servicio principal con producto complementario conserva guardia de precio pendiente", () => {
  const input=payload(); input.items[0].deliverable_type="service";
  input.items[0].name="Mantenimiento correctivo";
  input.items[0].data_organization.components=[{id:"screen",name:"Pantalla nueva 14 pulgadas",type:"product",quantity_per_deliverable:1,relationship:"included",reason:"Repuesto exigido dentro del mantenimiento."}];
  const p=make(input);expect(p.items[0].costBasisStatus).toBe("pending");expect(p.items[0].manualUnitCost).toBeNull();
  expect(p.items[0].additionalCosts[0].reviewStatus).toBe("suggested");
 });
 it("rechaza componentes duplicados, vínculos inválidos y doble atribución", () => {
  const bad=structuredClone(literal);bad.components.push({...bad.components[2],id:"other"});
  expect(()=>make(payload(bad))).toThrow();
  bad.components.pop();bad.components[2].additional_cost_id="missing";expect(()=>make(payload(bad))).toThrow();
  bad.components[2].additional_cost_id="install";bad.components[2].relationship="included";expect(()=>make(payload(bad))).toThrow();
  bad.components[2].relationship="separate";bad.components.push(bad.components[0]);expect(()=>make(payload(bad))).toThrow();
 });
 it("rechaza encabezados inventados para legado y referencias a columnas inexistentes", () => {
  expect(()=>DataOrganizationSchema.parse({...literal,original_capture:"legacy_fields_only"})).toThrow();
  expect(()=>DataOrganizationSchema.parse({...literal,original_row:undefined})).toThrow();
  const bad=structuredClone(literal);bad.normalization[0].column_ids=["missing"];expect(()=>make(payload(bad))).toThrow();
 });
 it("retiene tabla y composición al restaurar una fila eliminada", () => {
  const p=make(payload());const snapshot=capturePriceBase(p.items);
  const restored=restorePriceBase([],snapshot);
  expect(restored[0].dataOrganization).toEqual(p.items[0].dataOrganization);
  expect(restored[0].additionalCosts).toEqual(p.items[0].additionalCosts);
 });
 it("conserva organización al reimportar y serializar sin copiar ajustes humanos al ensayo", () => {
  const p=make(payload());const plain=payload();delete plain.items[0].data_organization;plain.version=2;
  const merged=preserveAdditionalCostsOnReimport(make(plain),p,normalizeImportPayload(plain));
  expect(JSON.parse(JSON.stringify(merged)).items[0].dataOrganization).toEqual(p.items[0].dataOrganization);
 });
});
