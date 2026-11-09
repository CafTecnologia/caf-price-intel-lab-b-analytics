import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createFinanceMcpServer } from "../lib/chatgpt-mcp";
import { importProject, getProject } from "../lib/store";
import type { ChatGPTActor } from "../lib/chatgpt-auth";
vi.mock("../lib/chatgpt-auth",()=>({
  assertCalculationAccess:vi.fn(async(_actor:ChatGPTActor,project:{name:string},write:boolean)=>{
    if(write&&!_actor.scopes.has("finance.write"))throw Object.assign(new Error("Falta finance.write"),{name:"ChatGPTAuthError",challenge:'Bearer error="insufficient_scope",scope="finance.write"'});
    if(project.name==="Privado")throw new Error("Forbidden");
  })
}));
let dir="",cwd:ReturnType<typeof vi.spyOn>,client:Client,server:ReturnType<typeof createFinanceMcpServer>;
let calculationId="",revision="";
const actor:ChatGPTActor={id:"qa-profile",name:"QA MCP",odooUid:42,sessionId:"qa-session-not-exported",scopes:new Set(["finance.read","finance.write"])};
async function openClient(scopes=actor.scopes) {
  server=createFinanceMcpServer({...actor,scopes});
  client=new Client({name:"QA MCP Client",version:"1.0"});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
}
function body(result:Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as Record<string,any>;
}
beforeEach(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"caf-chatgpt-mcp-"));
  cwd=vi.spyOn(process,"cwd").mockReturnValue(dir);
  const p=await importProject({version:2,source:{system:"odoo_caf",odoo_project_id:"990001"},calculation:{name:"QA ChatGPT"},items:[{
    item:"1",name:"Equipo QA",description:"RAM 16 GB",quantity:2,unit:"UND",ceiling_unit_price:1000,
    price_sources:[{id:"a",name:"A",unit_price:100,currency:"COP"},{id:"b",name:"B",unit_price:200,currency:"COP"},{id:"c",name:"C",unit_price:900,currency:"COP"}]
  }]});
  calculationId=p.id;revision=p.updatedAt;await openClient();
});
afterEach(async()=>{await client?.close();await server?.close();cwd?.mockRestore();await rm(dir,{recursive:true,force:true});});
describe("Contrato MCP ChatGPT con almacén y motor reales",()=>{
 it("descubre herramientas y recurso MCP Apps sin credenciales en datos",async()=>{
   const tools=await client.listTools();
   // Current shared production catalog includes bounded project workflow and
   // independent local evaluations. Exact identities detect removal or exposure.
   const expectedTools = [
     "finance_get_profile", "finance_list_analyses", "finance_open_analysis",
     "finance_preview_changes", "finance_save_scenario", "finance_list_scenarios",
     "finance_compare_scenarios", "finance_accept_scenario", "finance_undo_acceptance",
     "finance_open_workspace", "finance_render_view", "finance_get_view",
     "finance_filter_view", "finance_select_item", "finance_show_scenario", "finance_preview_in_view",
     "finance_get_context", "finance_send_message", "finance_find_projects",
     "finance_project_context", "finance_project_action", "finance_create_experiment",
     "finance_create_parallel_evaluation", "finance_save_parallel_evaluation",
     "finance_get_parallel_evaluation", "finance_research_context",
   ];
   expect(tools.tools.map(t => t.name).sort()).toEqual(expectedTools.sort());
   const writes = new Set(["finance_save_scenario", "finance_accept_scenario", "finance_undo_acceptance",
     "finance_send_message", "finance_project_action", "finance_create_experiment",
     "finance_create_parallel_evaluation", "finance_save_parallel_evaluation"]);
   for (const descriptor of tools.tools) {
     expect(descriptor.annotations?.readOnlyHint, descriptor.name).toBe(!writes.has(descriptor.name));
     expect(descriptor._meta?.securitySchemes, descriptor.name).toEqual([{type: "oauth2", scopes: writes.has(descriptor.name) ? ["finance.read", "finance.write"] : ["finance.read"]}]);
   }
   expect(JSON.stringify(tools)).not.toContain(actor.sessionId);
   const open=tools.tools.find(t=>t.name==="finance_open_analysis")!;
   expect(open.annotations?.readOnlyHint).toBe(true);
   expect(open._meta?.ui).toBeUndefined();
   const visual=tools.tools.find(t=>t.name==="finance_open_workspace")!;
   expect((visual._meta?.ui as {resourceUri?:string})?.resourceUri).toBe("ui://caf-finanzas/analysis-v1.html");
   const widgetCalls=[
     "finance_open_workspace","finance_get_view","finance_filter_view","finance_select_item",
     "finance_show_scenario","finance_preview_in_view","finance_save_scenario",
     "finance_accept_scenario","finance_undo_acceptance",
   ];
   for(const name of widgetCalls){
     const descriptor=tools.tools.find(t=>t.name===name)!;
     expect(descriptor._meta?.["openai/widgetAccessible"],name).toBe(true);
     expect((descriptor._meta?.ui as {visibility?:string[]})?.visibility,name).toEqual(["model","app"]);
   }
   expect(tools.tools.filter(t=>t._meta?.["openai/widgetAccessible"]===true).map(t=>t.name).sort())
     .toEqual([...widgetCalls].sort());
   const filter=tools.tools.find(t=>t.name==="finance_filter_view")!;
   expect((filter._meta?.ui as {resourceUri?:string})?.resourceUri).toBeUndefined();
   const resource=await client.readResource({uri:"ui://caf-finanzas/analysis-v1.html"});
   expect(resource.contents[0].mimeType).toContain("html");
   expect(JSON.stringify(resource)).not.toContain(actor.sessionId);
   const profile=body(await client.callTool({name:"finance_get_profile",arguments:{}}));
   expect(profile).toEqual({id:actor.id,name:actor.name});
 });
 it("abre datos completos y calcula mediana con el motor existente",async()=>{
   const opened=body(await client.callTool({name:"finance_open_analysis",arguments:{calculationId}}));
   expect(opened.analysis.items[0].priceSources).toHaveLength(3);
   expect(opened.simulation.rows[0].costBreakdown.median).toBe(200);
 });
 it("previsualiza sin escribir y rechaza revisiones antiguas",async()=>{
   const before=await getProject(calculationId);
   const changes=[{type:"set_margin",kind:"exploration",reason:"Comparar margen",itemIds:[],marginPctOnCost:20}];
   const preview=await client.callTool({name:"finance_preview_changes",arguments:{calculationId,expectedUpdatedAt:revision,changes}});
   expect(preview.isError).not.toBe(true);
   expect(await getProject(calculationId)).toEqual(before);
   const stale=await client.callTool({name:"finance_preview_changes",arguments:{calculationId,expectedUpdatedAt:"2000-01-01T00:00:00.000Z",changes}});
   expect(stale.isError).toBe(true);
 });
 it("guarda escenario una vez, acepta, reabre en otro cliente y deshace",async()=>{
   const before=await getProject(calculationId);
   const args={calculationId,name:"Margen QA",expectedUpdatedAt:revision,operationId:randomUUID(),changes:[{type:"set_margin",kind:"exploration",reason:"Comparar margen",itemIds:[],marginPctOnCost:20}]};
   const saved=body(await client.callTool({name:"finance_save_scenario",arguments:args}));
   expect(saved.receipt.operationId).toBe(args.operationId);
   const repeated=body(await client.callTool({name:"finance_save_scenario",arguments:args}));
   expect(repeated.scenario.id).toBe(saved.scenario.id);
   expect(await getProject(calculationId)).toEqual(before);
   const acceptId=randomUUID();
   const accepted=body(await client.callTool({name:"finance_accept_scenario",arguments:{calculationId,scenarioId:saved.scenario.id,expectedUpdatedAt:revision,operationId:acceptId}}));
   expect(accepted.receipt.operationId).toBe(acceptId);
   expect(accepted.baseline).toEqual(saved.baseline);
   const compared=body(await client.callTool({name:"finance_compare_scenarios",arguments:{calculationId,rightScenarioId:saved.scenario.id}}));
   expect(compared.baseline).toEqual(saved.baseline);
   expect(accepted.baseline.summary.knownOfferTotal).not.toBe(accepted.simulation.summary.knownOfferTotal);
   expect((await getProject(calculationId))?.updatedAt).not.toBe(revision);
   await client.close();await server.close();await openClient();
   const reopened=body(await client.callTool({name:"finance_list_scenarios",arguments:{calculationId}}));
   expect(reopened.scenarios[0].status).toBe("accepted");
   const undo=await client.callTool({name:"finance_undo_acceptance",arguments:{calculationId,scenarioId:saved.scenario.id,acceptanceOperationId:acceptId,expectedUpdatedAt:reopened.analysis.updatedAt,operationId:randomUUID()}});
   expect(undo.isError).not.toBe(true);
   expect((await getProject(calculationId))?.items).toEqual(before?.items);
   const replay=await client.callTool({name:"finance_accept_scenario",arguments:{calculationId,scenarioId:saved.scenario.id,expectedUpdatedAt:revision,operationId:acceptId}});
   expect(body(replay).scenario.status).toBe("undone");
   expect(JSON.stringify(replay.content)).toContain("deshecho");
   expect((await getProject(calculationId))?.items).toEqual(before?.items);
 });
 it("aplica margen al costo final del lote con independencia del orden",async()=>{
   const before=await getProject(calculationId),itemId=before!.items[0].id;
   const margin={type:"set_margin",kind:"exploration",reason:"Margen final explícito",itemIds:[itemId],marginPctOnCost:20};
   const dataChanges=[
    {type:"set_cost_statistic",kind:"criterion",reason:"Usar mediana",itemId,statistic:"median"},
    {type:"set_item_fields",kind:"correction",reason:"Cantidad confirmada",itemId,expected:{quantity:2},patch:{quantity:4}},
    {type:"add_additional_cost",kind:"correction",reason:"Transporte confirmado",itemId,cost:{id:"qa-transporte",name:"Transporte",category:"logistics",mode:"fixed",amount:50,notes:"QA"}}
   ];
   const preview=async(changes:unknown[])=>body(await client.callTool({name:"finance_preview_changes",arguments:{calculationId,expectedUpdatedAt:revision,changes}}));
   const first=await preview([margin,...dataChanges]),last=await preview([...dataChanges,margin]);
   expect(first.simulation).toEqual(last.simulation);
   expect(first.simulation.rows[0].marginPctOnCost).toBeCloseTo(20,8);
   expect(await getProject(calculationId)).toEqual(before);
 });
 it("rechaza todas las escrituras del widget con alcance solo lectura",async()=>{
   await client.close();await server.close();await openClient(new Set(["finance.read"]));
   const before=await getProject(calculationId);
   const scenarioId=randomUUID(),acceptanceOperationId=randomUUID();
   const writes=[
     {name:"finance_save_scenario",arguments:{calculationId,name:"No permitido",expectedUpdatedAt:revision,operationId:randomUUID(),changes:[{type:"set_margin",kind:"exploration",reason:"Sin permiso",itemIds:[],marginPctOnCost:20}]}},
     {name:"finance_accept_scenario",arguments:{calculationId,scenarioId,expectedUpdatedAt:revision,operationId:randomUUID()}},
     {name:"finance_undo_acceptance",arguments:{calculationId,scenarioId,acceptanceOperationId,expectedUpdatedAt:revision,operationId:randomUUID()}},
   ];
   for(const write of writes){
     const denied=await client.callTool(write);
     expect(denied.isError,write.name).toBe(true);
     expect(denied._meta?.["mcp/www_authenticate"],write.name).toEqual(['Bearer error="insufficient_scope",scope="finance.write"']);
   }
   expect(await getProject(calculationId)).toEqual(before);
 });
 it("filtra análisis ajenos y rechaza su apertura y escritura sin mutación",async()=>{
   const deniedProject=await importProject({version:2,source:{system:"odoo_caf",odoo_project_id:"990999"},calculation:{name:"Privado"},items:[{item:"1",name:"Reservado",description:"Dato sintético privado",quantity:1,unit:"UND"}]});
   const before=await getProject(deniedProject.id);
   const list=await client.callTool({name:"finance_list_analyses",arguments:{}});
   expect(JSON.stringify(list)).not.toContain(deniedProject.id);
   expect(JSON.stringify(list)).not.toContain("Privado");
   const opened=await client.callTool({name:"finance_open_analysis",arguments:{calculationId:deniedProject.id}});
   expect(opened.isError).toBe(true);
   const saved=await client.callTool({name:"finance_save_scenario",arguments:{calculationId:deniedProject.id,name:"No autorizado",expectedUpdatedAt:deniedProject.updatedAt,operationId:randomUUID(),changes:[{type:"set_margin",kind:"exploration",reason:"Intento sin permiso",itemIds:[],marginPctOnCost:20}]}});
   expect(saved.isError).toBe(true);
   expect(await getProject(deniedProject.id)).toEqual(before);
 });
 it("comparte vista, filtro de pérdida, selección documental y simulación sin tocar la base",async()=>{
   await new Promise((done)=>setTimeout(done,5));
   const newest=await importProject({version:2,source:{system:"odoo_caf",odoo_project_id:"990014"},
     calculation:{name:"Cálculo real reciente"},
     items:[{item:"14",name:"Portátil 512 GB",description:"Portátil 512 GB",quantity:1,unit:"UND",
       ceiling_unit_price:500,price_sources:[{id:"s14",name:"Referencia",unit_price:700,currency:"COP"}],
       source_original:{description:"Portátil 512 GB",document:"Lista económica",locator:"fila 14"},
       technical_annex:[{document:"Anexo OCR",locator:"página 14",text:"Portátil 612 GB"}],
       cost_basis_status:"comparable_scenario"}]});
   await new Promise((done)=>setTimeout(done,5));
   await importProject({version:1,calculation:{name:"Demo reciente",source_system:"demo"},items:[{item:"1",description:"Ejemplo",quantity:1,unit:"UND"}]});
   const opened=body(await client.callTool({name:"finance_open_workspace",arguments:{}}));
   expect(opened.analysis.id).toBe(newest.id);
   expect(opened.view.filter).toBe("all");
   expect(opened.rows).toHaveLength(1);
   const filtered=body(await client.callTool({name:"finance_filter_view",arguments:{
     filter:"loss",expectedViewVersion:opened.view.version}}));
   expect(filtered.evidence).toMatchObject({stateApplied:true,hostRendered:false,filter:"loss",visibleCount:1});
   expect(filtered.rows[0].item).toBe("14");
   const stale=await client.callTool({name:"finance_select_item",arguments:{item:"14",expectedViewVersion:opened.view.version}});
   expect(stale.isError).toBe(true);
   const selected=body(await client.callTool({name:"finance_select_item",arguments:{
     item:"14",expectedViewVersion:filtered.view.version}}));
   expect(selected.view.selectedItemId).toBe(newest.items[0].id);
   expect(selected.selected.discrepancies).toEqual([expect.objectContaining({left:"512 GB",right:"612 GB"})]);
   expect(selected.selected.item.sourceOriginal.document).toBe("Lista económica");
   const before=await getProject(newest.id);
   const preview=body(await client.callTool({name:"finance_preview_in_view",arguments:{
     expectedViewVersion:selected.view.version,expectedUpdatedAt:newest.updatedAt,
     changes:[{type:"set_margin",kind:"exploration",reason:"Sensibilidad QA",itemIds:[newest.items[0].id],marginPctOnCost:15}]}}));
   expect(preview.view.selectedItemId).toBe(newest.items[0].id);
   expect(preview.diff.length).toBeGreaterThan(0);
   expect(await getProject(newest.id)).toEqual(before);
   await client.close();await server.close();await openClient();
   const restored=body(await client.callTool({name:"finance_get_view",arguments:{}}));
   expect(restored.view.filter).toBe("loss");
   expect(restored.view.selectedItemId).toBe(newest.items[0].id);
   expect(restored.draftChanges).toHaveLength(1);
   const saved=body(await client.callTool({name:"finance_save_scenario",arguments:{
     calculationId:newest.id,name:"Escenario visual QA",expectedUpdatedAt:newest.updatedAt,operationId:randomUUID(),
     changes:restored.draftChanges}}));
   expect(saved.scenario.status).toBe("draft");
   expect(saved.view.scenarioId).toBe(saved.scenario.id);
   expect(saved.analysis?.items).toBeUndefined();
   expect(await getProject(newest.id)).toEqual(before);
   const afterSave=body(await client.callTool({name:"finance_get_view",arguments:{}}));
   expect(afterSave.view.scenarioId).toBe(saved.scenario.id);
   expect(afterSave.draftChanges).toHaveLength(0);
   expect(afterSave.baseline).toBeTruthy();
   const accepted=body(await client.callTool({name:"finance_accept_scenario",arguments:{
     calculationId:newest.id,scenarioId:saved.scenario.id,expectedUpdatedAt:newest.updatedAt,operationId:randomUUID()}}));
   expect(accepted.scenario.status).toBe("accepted");
   const afterAccept=body(await client.callTool({name:"finance_get_view",arguments:{}}));
   expect(afterAccept.view.scenarioId).toBe(saved.scenario.id);
   expect(afterAccept.scenario.status).toBe("accepted");
   expect((await getProject(newest.id))?.updatedAt).not.toBe(newest.updatedAt);
   expect((await stat(path.join(dir,"data","financial-offer","chatgpt-view-state.json"))).mode & 0o777).toBe(0o600);
   await client.close();await server.close();
   server=createFinanceMcpServer({...actor,id:"other-profile"});
   client=new Client({name:"Other profile",version:"1.0"});
   const [otherA,otherB]=InMemoryTransport.createLinkedPair();
   await server.connect(otherA);await client.connect(otherB);
   expect(body(await client.callTool({name:"finance_get_view",arguments:{}})).view).toBeNull();
 });
 it("no publica la sesión Odoo en las respuestas",async()=>{
   const opened=await client.callTool({name:"finance_open_analysis",arguments:{calculationId}});
   expect(JSON.stringify(opened)).not.toContain(actor.sessionId);
   expect(JSON.stringify(opened)).not.toContain("sessionCiphertext");
 });
});