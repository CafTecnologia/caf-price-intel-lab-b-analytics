import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeImportPayload, toCalculation, preserveAdditionalCostsOnReimport } from "../lib/contract";
import { CalculationOperationsSchema, calculationOperationItemValues, applyCalculationOperationBatch } from "../lib/calculation-operations";
import { capturePriceBase, restorePriceBase, priceBaseRestoreImpact } from "../lib/price-base";
import { groupProcurementLots, groupedProcurementIndexes, procurementLotTotals } from "../lib/procurement-lots";
import { buildProjectExport, clientOfferRows } from "../lib/export";
import { groupCostVersions } from "../lib/cost-version-groups";
import { importProject, listPriceBaseVersions, saveProject, restorePriceBaseVersion, getProject, saveManualPriceBaseVersion } from "../lib/store";
const lot = (id: string) => ({ id, label: `Lote ${id}`, document: `lote-${id}.xlsx`, locator: "Hoja Oferta" });
const payload = () => ({version:2, items:[{item:"1", name:"Producto B",description:"Detalle B",quantity:2,unit:"UND",ceiling_unit_price:100,procurement_lot:lot("2"), price_sources:[{name:"Proveedor",unit_price:20,currency:"COP"}]},{item:"1",name:"Producto A",description:"Detalle A",quantity:3,unit:"UND",ceiling_unit_price:150,procurement_lot:lot("1"),cost_basis_status:"pending",price_sources:[{name:"Pendiente",unit_price:0,currency:"COP"}]}]});
function project() { return toCalculation(normalizeImportPayload(payload()),"calc","2026-10-14T00:00:00.000Z"); }
describe("lotes contractuales",()=>{
 it("conserva números repetidos y usa índices originales al agrupar/exportar",()=>{
  const p=project(); expect(p.items.map(i=>i.item)).toEqual(["1","1"]);
  expect(groupedProcurementIndexes(p.items)).toEqual([1,0]);
  const exp=buildProjectExport(p);expect(clientOfferRows(exp).map(r=>r["ID lote"])).toEqual(["1","2"]);
  const g=groupProcurementLots(p.items);const a=procurementLotTotals(g[0]!,exp.simulation.rows,exp.offer.rows);
  expect(a.count).toBe(1); expect(a.pendingCost).toBe(1);expect(a.ceiling).toBeGreaterThan(0);
  const b=procurementLotTotals(g[1]!,exp.simulation.rows,exp.offer.rows);expect(b.withCost).toBe(1);expect(b.knownCost).toBeGreaterThan(0);
 });
 it("reimportar reordenado conserva identidad y decisiones por lote",()=>{
  const old=project(); old.items[0]!.additionalCosts=[{id:"human",name:"Flete",category:"logistics",mode:"fixed",amount:77,notes:"Cotizado",reviewStatus:"included"}];
  const raw=payload();raw.items.reverse();const parsed=normalizeImportPayload(raw);const fresh=toCalculation(parsed,"calc","2026-10-14T00:00:01.000Z");
  const merged=preserveAdditionalCostsOnReimport(fresh,old,parsed).items;
  expect(merged[1]!.id).toBe(old.items[0]!.id);expect(merged[1]!.additionalCosts[0]!.amount).toBe(77);expect(merged[0]!.id).toBe(old.items[1]!.id);
 });
 it("insertar una fila de otro lote no duplica el ID preservado",()=>{
  const old=project(); old.items=old.items.slice(0,1);
  const raw=payload(); raw.items[1]!.procurement_lot=lot("3"); raw.items.reverse();
  const parsed=normalizeImportPayload(raw);const fresh=toCalculation(parsed,"calc","2026-10-14T00:00:01.000Z");
  const merged=preserveAdditionalCostsOnReimport(fresh,old,parsed);
  expect(new Set(merged.items.map(i=>i.id)).size).toBe(2);expect(merged.items[1]!.id).toBe(old.items[0]!.id);
 });
 it("IDs de lote que difieren en mayúsculas no heredan decisiones",()=>{
  const old=project();old.items=old.items.slice(0,1);old.items[0]!.procurementLot=lot("A");
  const raw=payload();raw.items=raw.items.slice(0,1);raw.items[0]!.procurement_lot=lot("a");
  const parsed=normalizeImportPayload(raw);const fresh=toCalculation(parsed,"calc","2026-10-14T00:00:01.000Z");
  expect(()=>preserveAdditionalCostsOnReimport(fresh,old,parsed)).toThrow(/ambig/);
 });
 it("MCP expone lote actual y exige expected al clasificar",()=>{
  const p=project();expect(calculationOperationItemValues(p.items[0]!).procurement_lot).toEqual(lot("2"));
  const raw={projectId:p.id,odooProjectId:"1972",externalRunId:"odoo:test:project:1972:task:1:revision:1",operationId:crypto.randomUUID(),jobId:crypto.randomUUID(),expectedUpdatedAt:p.updatedAt,operations:[{type:"update_item",itemId:p.items[0]!.id,patch:{procurement_lot:lot("3")},expected:{procurement_lot:lot("2")}}]};
  const valid=CalculationOperationsSchema.parse(raw);const preview=applyCalculationOperationBatch(p,valid);expect(preview).toBeTruthy();
  expect(()=>CalculationOperationsSchema.parse({...raw,operations:[{...raw.operations[0],patch:{procurement_lot:null}}]})).toThrow();
 });
 it("una versión heredada no borra clasificación contractual",()=>{
  const p=project();const base=capturePriceBase(p.items);for(const row of base)delete row.procurementLot;
  expect(restorePriceBase(p.items,base).map(i=>i.procurementLot)).toEqual(p.items.map(i=>i.procurementLot));
  const removed=priceBaseRestoreImpact(p.items,[]);expect(removed.lostPricedItemIds).toEqual([p.items[0]!.id]);expect(removed.removedItemIds).toHaveLength(2);
 });
 it("agrupa guardados por revisión sin borrar versiones ni ocultar restauraciones",()=>{
  const v=[{id:"a",source:"ai",jobId:"j"},{id:"b",source:"restore",jobId:null},{id:"c",source:"ai",jobId:"j"},{id:"d",source:"ai",jobId:"k"}];
  const groups=groupCostVersions(v);expect(groups).toHaveLength(3);expect(groups.flatMap(g=>g.versions)).toHaveLength(4);expect(groups[0]!.versions.map(v=>v.id)).toEqual(["a","c"]);
 });
 it("el servidor frena pérdida de costos y conserva datos hasta confirmación expresa",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"caf-lot-restore-"));const cwd=vi.spyOn(process,"cwd").mockReturnValue(dir);
  try {const raw:any=payload();raw.source={system:"odoo",odoo_project_id:"1972",run_id:"test"};const p=await importProject(raw);await saveManualPriceBaseVersion(p.id,p.updatedAt);const initial=(await listPriceBaseVersions(p.id))[0]!;
   const filled=await saveProject(p.id,{items:p.items.map((i,n)=>n===1?{...i,manualUnitCost:50,selectedCostMode:"manual" as const}:i)});
   await expect(restorePriceBaseVersion(p.id,initial.id,filled!.updatedAt)).rejects.toThrow(/confirm/);
   expect((await getProject(p.id))!.updatedAt).toBe(filled!.updatedAt);
   const restored=await restorePriceBaseVersion(p.id,initial.id,filled!.updatedAt,undefined,true);
   expect(restored!.project.items[1]!.manualUnitCost).toBeNull();expect(restored!.project.items[1]!.procurementLot).toEqual(lot("1"));
  }finally{cwd.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
 });
});
