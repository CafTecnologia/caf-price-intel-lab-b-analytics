import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { normalizeImportPayload, toCalculation } from "../lib/contract";
import { buildProjectExport, offerExportTable, offerTableCsv } from "../lib/export";
import { buildOfferDisplay, buildOfferScreen, originalForItem } from "../lib/offer-presentation";
import { OfferDisplayControls } from "../components/offer-display-controls";
import { importProject } from "../lib/store";
import { PATCH, GET as projectGET } from "../app/api/projects/[projectId]/route";
import { GET } from "../app/api/projects/[projectId]/export/route";
const payload = (separate = false): any => ({version:3, items:[{
 item:"7", name:"Nombre IA", description:"Descripción de trabajo IA", quantity:2, unit:"UND", ceiling_unit_price:1000,
 price_sources:[{name:"Tienda",unit_price:500,currency:"COP"}],
 source_original:{description:"Texto previo",document:"Anexo",locator:"fila7"},
 data_organization:{version:1,original_capture:"literal",original_row:{document:"Anexo",locator:"fila7",columns:[
 {id:"a",header:"Numeral",value:"007"},{id:"b",header:separate?"Nombre":"Nombre y descripción",value:"  Portátil original\ncon pantalla  "},
 ...(separate?[{id:"c",header:"Especificación",value:"Pantalla 24 pulgadas literal"}]:[]),
 {id:"q",header:"Cantidad",value:"02"}]},normalization:[
 {field:"item",column_ids:["a"],operation:"interpreted",note:"007 convertido a7 en análisis"},
 {field:"name",column_ids:["b"],operation:"split",note:"Separación interna"},
 ...(separate?[{field:"description",column_ids:["c"],operation:"copied",note:"Ficha"}]:[]),
 {field:"quantity",column_ids:["q"],operation:"interpreted",note:"Número"}],components:[]}
}]});
const make = (p=payload()) => toCalculation(normalizeImportPayload(p),"demo","2026-10-27T00:00:00Z");
const model = (p: ReturnType<typeof make>) => buildOfferDisplay(p,buildProjectExport(p).offer);
describe("presentación mínima de oferta",()=>{
 it("conecta originales a los espacios existentes sin alterar finanzas ni columnas de la pantalla",()=>{
  const p=make(payload(true));p.items[0]!.item="99";p.items[0]!.description="Análisis editado";
  const before=buildProjectExport(p).offer;const screen=buildOfferScreen(p,before);
  expect(screen.summary).toEqual(before.summary);expect(screen.rows[0]!.item).toBe("007");
  expect(screen.rows[0]!.description).toBe("  Portátil original\ncon pantalla  \nPantalla 24 pulgadas literal");
  const {item,description,unit,warnings,...numbers}=screen.rows[0]!;
  const {item:i,description:d,unit:u,warnings:w,...expected}=before.rows[0]!;expect(numbers).toEqual(expected);
  expect(originalForItem(p.items[0]!)?.quantity).toBe("02");
 });

 it("conserva títulos, ceros, espacios y celda combinada original tras editar el análisis",()=>{
  const p=make();p.items[0]!.description="Editado para cálculo";p.items[0]!.item="99";
  const m=model(p);expect(m.columns.map(c=>c.header)).toEqual(["Numeral","Nombre y descripción","Cantidad","Unit. sin IVA","Total sin IVA","IVA %","IVA unit.","IVA total","Unit. con IVA","Total con IVA"]);
  expect(m.rows[0]!.values.item).toBe("007");expect(m.rows[0]!.values.text).toBe("  Portátil original\ncon pantalla  ");expect(m.showUnit).toBe(false);
  expect(offerExportTable(buildProjectExport(p)).rows[0]!.slice(0,3)).toEqual(["007","  Portátil original\ncon pantalla  ",2]);
 });
 it("separa solo campos que realmente existen y permite combinarlos u ocultar ítem/unidad",()=>{
  const p=make(payload(true));let m=model(p);expect(m.columns.slice(0,3).map(c=>c.header)).toEqual(["Numeral","Nombre","Especificación"]);
  p.settings.offerDisplay={text:"combined",showItem:false,showUnit:false};m=model(p);
  expect(m.columns[0]!.header).toBe("Descripción");expect(m.rows[0]!.values.text).toBe("  Portátil original\ncon pantalla  \nPantalla 24 pulgadas literal");
  p.settings.offerDisplay.text="name";expect(model(p).rows[0]!.values.text).toBe("  Portátil original\ncon pantalla  ");
 });
 it("conserva el título original de cantidad también en Excel",()=>{
  const input=payload();input.items[0].data_organization.original_row.columns.at(-1).header="Cant.";
  const p=make(input);expect(model(p).columns.find(c=>c.key==="quantity")?.header).toBe("Cant.");
  expect(offerExportTable(buildProjectExport(p)).headers).toContain("Cant.");
 });
 it("no inventa ítem ni unidad cuando el formato no los trae",()=>{
  const input=payload();input.items[0].data_organization.original_row.columns.shift();input.items[0].data_organization.normalization.shift();
  const m=model(make(input));expect(m.columns.map(c=>c.key)).not.toContain("item");expect(m.columns.map(c=>c.key)).not.toContain("unit");
 });
 it("no cambia un solo cálculo financiero con cualquier configuración de presentación",()=>{
  const p=make();const before=buildProjectExport(p);
  for(const prefs of [{text:"combined"},{text:"separate",showItem:false},{original:false,showUnit:true},{text:"name"}] as any[]){
   p.settings.offerDisplay=prefs;const after=buildProjectExport(p);expect(after.simulation).toEqual(before.simulation);expect(after.offer).toEqual(before.offer);
  }
 });
 it("mantiene importes netos, IVA y brutos calculados, sin sumarlos por componentes",()=>{
  const p=make();p.items[0]!.offerMode="manual";p.items[0]!.manualOfferUnit=119;p.items[0]!.vatMode="included";p.items[0]!.vatRate=19;
  const e=buildProjectExport(p),m=buildOfferDisplay(p,e.offer);expect(m.rows[0]!.values.unitPriceWithoutVat).toBe(100);expect(m.rows[0]!.values.vatUnitValue).toBe(19);expect(m.rows[0]!.values.totalWithVat).toBe(238);
  const table=offerExportTable(e);expect(table.rows[0]![table.headers.indexOf("Total con IVA")]).toBe(238);
 });
 it("advierte cantidad cambiada sin mostrar cifras que no correspondan al cálculo",()=>{
  const p=make();p.items[0]!.quantity=3;const m=model(p);expect(m.rows[0]!.values.quantity).toBe(3);expect(m.rows[0]!.warnings[0]).toContain("original 02");
  expect(offerExportTable(buildProjectExport(p)).headers).toContain("Verificación");
 });
 it("conserva encabezados repetidos en matriz y CSV",()=>{
  const input=payload(true);input.items[0].data_organization.original_row.columns[1].header="Detalle";input.items[0].data_organization.original_row.columns[2].header="Detalle";
  const table=offerExportTable(buildProjectExport(make(input)));expect(table.headers.filter(h=>h==="Detalle")).toHaveLength(2);expect(offerTableCsv(table).split("\n")[0]).toContain('"Detalle","Detalle"');
 });
 it("configuración compacta muestra solo opciones de presentación",()=>{
  const m=model(make());const html=renderToStaticMarkup(<OfferDisplayControls value={{}} {...m} onChange={()=>{}}/>);
  expect(html).toContain("Presentación de la oferta");expect(html).toContain("Como en el original");expect(html).toContain("Mostrar unidad");
 });
 it("guarda por API, preserva el original ante edición y genera Excel con mismos campos y números",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"caf-offer-original-"));const cwd=vi.spyOn(process,"cwd").mockReturnValue(dir);
  try {
   const p=await importProject(payload(true));const items=structuredClone(p.items);items[0]!.description="Cambio interno";items[0]!.sourceOriginal!.description="Intento de sobrescribir original";
   const params={params:Promise.resolve({projectId:p.id})};
   const response=await PATCH(new Request(`http://localhost/api/projects/${p.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedUpdatedAt:p.updatedAt,expectedItemIds:p.items.map(i=>i.id),items,settings:{offerDisplay:{text:"combined",showItem:false}}})}),params);
   expect(response.status).toBe(200);const saved=(await response.json()).project;expect(saved.settings.offerDisplay).toEqual({text:"combined",showItem:false});expect(saved.items[0].dataOrganization).toEqual(p.items[0]!.dataOrganization);expect(saved.items[0].sourceOriginal).toEqual(p.items[0]!.sourceOriginal);
   const loaded=(await (await projectGET(new Request(`http://localhost/api/projects/${p.id}`),params)).json()).project;expect(loaded.settings.offerDisplay).toEqual(saved.settings.offerDisplay);
   const table=offerExportTable(buildProjectExport(loaded));const excel=await GET(new Request(`http://localhost/api/projects/${p.id}/export?format=offer-xlsx`),params);expect(excel.status).toBe(200);
   const wb=XLSX.read(new Uint8Array(await excel.arrayBuffer()),{type:"array"});const sheet=wb.Sheets["Oferta económica"]!;
   const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});expect(matrix).toEqual([table.headers,...table.rows]);expect(sheet["!autofilter"]?.ref).toBe("A1:I2");
   expect(buildProjectExport(loaded).simulation).toEqual(buildProjectExport({...p,items:loaded.items}).simulation);
  }finally{cwd.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
 });
});
