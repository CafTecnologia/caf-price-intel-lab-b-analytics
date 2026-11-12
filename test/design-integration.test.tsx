import React from "react";
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { UnifiedItemDetail } from "../components/unified-item-detail";
import reference from "./fixtures/finance-design-reference.json";
import { normalizeImportPayload, toCalculation } from "../lib/contract";
import { buildInitialOfferControls, buildSimulation } from "../lib/financial-engine";

const p=toCalculation(normalizeImportPayload({version:2,items:[{item:"007",name:"Equipo",description:"Equipo de prueba",quantity:2,unit:"UND",ceiling_unit_price:1000,source_original:{document:"Anexo",locator:"Fila7",description:"Texto original",quantity:"2",unit:"UND"},price_sources:[{name:"Proveedor",unit_price:100,currency:"COP"}]}]}),"visual","2026-10-27T00:00:00Z");
const row=buildSimulation(p,buildInitialOfferControls(p)).rows[0]!;
const noop=()=>{};
describe("integración técnica respeta el diseño aprobado",()=>{
 it("CSS, barras, rejilla y filtros permanecen idénticos a la referencia",()=>{
  for(const [file, hash] of Object.entries(reference.sourceHashes))
   expect(createHash("sha256").update(readFileSync(file)).digest("hex"), file).toBe(hash);
 });
 for(const desktop of [false,true]) it(`detalle existente sin cambios de HTML en ${desktop?"PC":"móvil"}`,()=>{
  const props={item:p.items[0]!,row,index:0,count:1,desktop,onClose:noop,onEdit:noop,onAddCost:noop,onSetManualCost:noop,onSetAdditionalCost:noop,onUpdateAdditionalCost:noop,onRemoveAdditionalCost:noop,onNavigate:noop};
  expect(createHash("sha256").update(renderToStaticMarkup(<UnifiedItemDetail {...props}/>)).digest("hex"))
   .toBe(reference.detailHtml[desktop ? "desktop" : "mobile"]);
 });
 it("el espacio de documento original usa el texto literal y conserva la estructura",()=>{
  const item={...p.items[0]!,description:"Análisis interno",technicalDescription:"Técnica interna",dataOrganization:{original_capture:"literal",original_row:{document:"Pliego",locator:"Fila 7",columns:[{id:"n",header:"Nombre original",value:"Portátil original"},{id:"d",header:"Descripción original",value:"Pantalla adicional"}]},normalization:[{field:"name",column_ids:["n"],operation:"copied",note:"Literal"},{field:"description",column_ids:["d"],operation:"copied",note:"Literal"}]}} as any;
  const props={item,row,index:0,count:1,desktop:true,onClose:noop,onEdit:noop,onAddCost:noop,onSetManualCost:noop,onSetAdditionalCost:noop,onUpdateAdditionalCost:noop,onRemoveAdditionalCost:noop,onNavigate:noop};
  const html=renderToStaticMarkup(<UnifiedItemDetail {...props}/>);
  expect(html).toContain("Portátil original");expect(html).toContain("Pantalla adicional");
  expect(html).not.toContain("Técnica interna");
 });

});
