import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sampleImportPayload } from "../lib/contract";
import { applyPriceBaseRevision, importProject, listPriceBaseVersions, saveManualPriceBaseVersion } from "../lib/store";
import { GET as calculationGet } from "../app/api/projects/[projectId]/route";
import { GET as mcpBasesGet } from "../app/api/projects/[projectId]/price-bases/route";
import { POST as actionPost } from "../app/api/projects/[projectId]/price-bases/actions/route";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("conserva la identidad elegida al aplicar, recargar, alternar bases iguales y recibir otra edición IA",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"caf-selected-base-"));const cwd=vi.spyOn(process,"cwd").mockReturnValue(dir);
 try {
  vi.stubEnv("ODOO_INTERNAL_BASE_URL","http://odoo.test");vi.stubEnv("FINANCIAL_PRICE_BASE_TOKEN","test-service-token-longer-than-thirty-two-characters");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:204})));
  const payload=sampleImportPayload() as any;payload.calculation.odoo_project_id="1972";
  const original=await importProject(payload);const first=(await saveManualPriceBaseVersion(original.id,original.updatedAt))!.version;
  const params={params:Promise.resolve({projectId:original.id})};const url=`http://localhost:3000/api/projects/${original.id}`;
  const reload=async(expected:string)=>{
   const a=await (await calculationGet(new Request(url),params)).json();
   const b=await (await mcpBasesGet(new Request(url+"/price-bases",{headers:{Authorization:"Bearer test-service-token-longer-than-thirty-two-characters"}}),params)).json();
   expect(a.costVersions.filter((v:any)=>v.active).map((v:any)=>v.id)).toEqual([expected]);
   expect(b.versions.filter((v:any)=>v.active).map((v:any)=>v.id)).toEqual([expected]);
   expect(a.costVersions.map((v:any)=>v.sequence)).toEqual(Array.from({length:a.costVersions.length},(_,i)=>a.costVersions.length-i));
   return a;
  };
  const select=async(versionId:string,updatedAt:string,operationId=crypto.randomUUID())=>{
   const response=await actionPost(new Request(url+"/price-bases/actions",{method:"POST",headers:{Cookie:"session_id=normal-test",Origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({action:"restore",versionId,expectedUpdatedAt:updatedAt,operationId,allowCostLoss:true})}),params);
   expect(response.status).toBe(200);return {body:await response.json(),operationId};
  };
  const edited=(await applyPriceBaseRevision({projectId:original.id,odooProjectId:"1972",jobId:crypto.randomUUID(),expectedUpdatedAt:original.updatedAt,items:[{id:original.items[0]!.id,item:original.items[0]!.item,referenceUnit:98765}]}))!;
  await reload(edited.version.id);
  await select(first.id,edited.project.updatedAt);
  let a=await reload(first.id);expect(a.project.items[0].referenceUnit).toBe(original.items[0]!.referenceUnit);
  const offers=(p:any)=>p.items.map((i:any)=>[i.id,i.quantity,i.offerMode,i.discountPct,i.manualOfferUnit]);expect(offers(a.project)).toEqual(offers(original));
  await select(edited.version.id,a.project.updatedAt);a=await reload(edited.version.id);expect(a.project.items[0].referenceUnit).toBe(98765);
  const copy=a.costVersions[0];expect(copy.restoredFromVersionId).toBe(edited.version.id);expect(copy.active).toBe(false);
  // Same costs, different user-selected identity must survive a fresh disk/API read.
  const physicalItems=structuredClone(a.project.items);const selectedAt=a.project.updatedAt;const result=await select(copy.id,selectedAt);a=await reload(copy.id);expect(a.project.items).toEqual(physicalItems);
  const count=a.costVersions.length;const replay=await select(copy.id,selectedAt,result.operationId);expect(replay.body).toEqual(result.body);expect(await listPriceBaseVersions(original.id)).toHaveLength(count);
  await select(edited.version.id,a.project.updatedAt);a=await reload(edited.version.id);
  const nextAI=(await applyPriceBaseRevision({projectId:original.id,odooProjectId:"1972",jobId:crypto.randomUUID(),expectedUpdatedAt:a.project.updatedAt,items:[{id:original.items[0]!.id,item:original.items[0]!.item,referenceUnit:98766}]}))!;
  a=await reload(nextAI.version.id);expect(a.project.items[0].referenceUnit).toBe(98766);expect(offers(a.project)).toEqual(offers(original));
  const stale=await actionPost(new Request(url+"/price-bases/actions",{method:"POST",headers:{Cookie:"session_id=normal-test",Origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({action:"restore",versionId:first.id,expectedUpdatedAt:original.updatedAt,operationId:crypto.randomUUID()})}),params);
  expect(stale.status).toBe(409);await reload(nextAI.version.id);
 } finally {cwd.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
});
