import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertCalculationAccess, ChatGPTAuthError, type ChatGPTActor } from "./chatgpt-auth";
import { rpc, ContextError } from "./odoo-project-context";
import { proxyOdooSession } from "./odoo-collaboration";
import { createEmptyCalculation, getProject, saveProject } from "./store";

export const ExperimentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  operationId: z.string().uuid(),
  items: z.array(z.object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(100000),
    unitCost: z.number().nonnegative().max(1e12),
    referenceUnit: z.number().positive().max(1e12),
  }).strict()).min(1).max(20),
}).strict();
type Receipt = { digest:string; phase:string; projectId?:number; offerId?:number; calculationId?:string; seedRevision?:string; updatedAt?:string };
const conflict = () => new ChatGPTAuthError(409,"EXPERIMENT_PENDING","La creación sigue pendiente. Conserva operationId y consulta antes de repetir.");
function singleId(value:unknown):number {
  const id=Array.isArray(value)&&value.length===1?value[0]:value;
  if(!Number.isSafeInteger(id)||Number(id)<1)throw conflict();
  return Number(id);
}
/** User-session ORM, existing launch/callback bridge; no service account or new ACL. */
export async function createFinanceExperiment(actor:ChatGPTActor, raw:unknown) {
  const input=ExperimentSchema.parse(raw);
  if(!actor.scopes.has("finance.write"))throw new ChatGPTAuthError(403,"INSUFFICIENT_SCOPE","La conexión no tiene permiso de escritura. Vuelve a autorizarla.");
  if(process.env.CHATGPT_SANDBOX==="true")throw new ChatGPTAuthError(403,"LIVE_REQUIRED","La creación de proyectos requiere Finanzas vigente.");
  if(!actor.sessionId||actor.sessionId.length>512||/[;\r\n]/.test(actor.sessionId))throw new ChatGPTAuthError(401,"INVALID_SESSION","La sesión no es válida.");
  const resource=new URL(process.env.CHATGPT_MCP_RESOURCE!);
  const request=new Request(resource,{headers:{Cookie:`session_id=${actor.sessionId}`}});
  const orm=(model:string,method:string,args:unknown[]=[],kwargs:object={})=>rpc(request,`/web/dataset/call_kw/${model}/${method}`,{model,method,args,kwargs});
  const session=await rpc(request,"/web/session/get_session_info",{});
  const allowed=(process.env.CHATGPT_ODOO_DATABASES??"").split(",").map(s=>s.trim());
  if(session?.uid!==actor.odooUid||!allowed.includes(session?.db))throw new ChatGPTAuthError(401,"INVALID_SESSION","La identidad o la base de Odoo ya no coincide.");
  if(!await orm("project.project","has_access",[[],"create"]))throw new ChatGPTAuthError(403,"PROJECT_CREATE_DENIED","Tu usuario puede trabajar cálculos, pero no tiene permiso de crear proyectos en Odoo.");
  const cwd=process.cwd();
  const root=/[\\/]apps[\\/]financial-offer-web$/.test(cwd)?path.resolve(cwd,"..",".."):cwd;
  const dir=path.join(root,"data","financial-offer","mcp-experiments");
  await mkdir(dir,{recursive:true,mode:0o700});
  const key=createHash("sha256").update(JSON.stringify([session.db,actor.odooUid,input.operationId])).digest("hex");
  const file=path.join(dir,key+".json"),lock=path.join(dir,key+".lock");
  try{await mkdir(lock,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw conflict();throw e;}
  try {
    const digest=createHash("sha256").update(JSON.stringify(input)).digest("hex");
    let receipt:Receipt={digest,phase:"new"};
    try{receipt=JSON.parse(await readFile(file,"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    if(receipt.digest!==digest)throw new ChatGPTAuthError(409,"EXPERIMENT_CONFLICT","Ese operationId ya corresponde a otra creación.");
    const persist=async()=>{const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(receipt),{mode:0o600});await rename(tmp,file);};
    const projectName=`Experimento MCP — ${input.name} [${input.operationId}]`;
    if(!receipt.projectId){
      const found=await orm("project.project","search_read",[[["name","=",projectName],["create_uid","=",actor.odooUid]]],{fields:["id"],limit:2});
      if(!Array.isArray(found)||found.length>1)throw conflict();
      if(found.length)receipt.projectId=singleId(found[0].id);
      else {
        if(receipt.phase!=="new")throw conflict();
        const workspaces=await orm("caf.project.workspace","search_read",[[["code","=","commercial"]]],{fields:["id"],limit:2});
        if(!Array.isArray(workspaces)||workspaces.length!==1)throw new ChatGPTAuthError(403,"WORKSPACE_UNAVAILABLE","Tu usuario no tiene un área comercial disponible para crear el experimento.");
        const workspaceId=singleId(workspaces[0].id);
        receipt.phase="project_pending";await persist();
        receipt.projectId=singleId(await orm("project.project","create",[[{name:projectName,user_id:actor.odooUid,privacy_visibility:"followers",caf_workspace_id:workspaceId,allow_timesheets:false}]]));
      }
      receipt.phase="project_created";await persist();
    }
    if(!receipt.offerId){
      const found=await orm("caf.financial.offer","search_read",[[["project_id","=",receipt.projectId],["source_title","=",projectName]]],{fields:["id"],limit:2});
      if(!Array.isArray(found)||found.length>1)throw conflict();
      if(found.length)receipt.offerId=singleId(found[0].id);
      else {
        if(receipt.phase!=="project_created")throw conflict();
        receipt.phase="offer_pending";await persist();
        receipt.offerId=singleId(await orm("caf.financial.offer","create",[[{project_id:receipt.projectId,name:projectName,source_title:projectName}]]));
      }
      receipt.phase="offer_created";await persist();
    }
    // Rechecks native live-operation permissions and records the actual opener.
    await orm("caf.financial.offer","action_open_external_app",[[receipt.offerId]]);
    const launch=await orm("caf.financial.offer","build_launch_payload",[[receipt.offerId]]);
    if(launch.odooDb!==session.db||String(launch.odooProjectId)!==String(receipt.projectId)||String(launch.odooUserId)!==String(actor.odooUid)
       ||typeof launch.externalId!=="string"||!launch.externalId||typeof launch.odooCallbackUrl!=="string")throw conflict();
    const callback=new URL(launch.odooCallbackUrl);
    if(!/^\/caf_financial_offer_app\/callback\/[a-zA-Z0-9-]+$/.test(callback.pathname)||callback.searchParams.get("db")!==session.db)throw conflict();
    let project=receipt.calculationId?await getProject(receipt.calculationId):await createEmptyCalculation({...launch,name:projectName,entity:"Experimento sintético MCP"});
    if(!project)throw conflict();
    if(!receipt.calculationId){receipt.calculationId=project.id;receipt.seedRevision=project.updatedAt;receipt.phase="calculation_created";await persist();}
    if(project.odooProjectId!==String(receipt.projectId)||project.odooDb!==session.db)throw conflict();
    if(receipt.phase==="calculation_created"){
      const items=input.items.map((seed,index)=>({...project!.items[0],id:`${input.operationId}-${index+1}`,item:String(index+1),
        description:seed.description,technicalDescription:"Datos sintéticos para experimentación; no son cotizaciones.",
        quantity:seed.quantity,unit:"UND",selectedCostMode:"manual" as const,manualUnitCost:seed.unitCost,
        referenceUnit:seed.referenceUnit,referenceUnitCeilingEnabled:true,priceSources:[],additionalCosts:[],
        costBasisStatus:"conforming" as const,notes:"Datos sintéticos proporcionados para esta prueba del MCP."}));
      if(project.updatedAt!==receipt.seedRevision){
        if(JSON.stringify(project.items)!==JSON.stringify(items))throw conflict();
      }else project=await saveProject(project.id,{items},receipt.seedRevision);
      if(!project)throw conflict();
      receipt.phase="seeded";receipt.updatedAt=project.updatedAt;await persist();
    }
    if(receipt.phase!=="complete"){
      const response=await proxyOdooSession(request,callback.pathname+callback.search,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({calculationId:project.id,externalUrl:new URL(`../../calculations/${project.id}`,resource).href,sourceTitle:projectName,status:"linked",odooProjectId:String(receipt.projectId)})});
      if(!response.ok||(await response.json()).ok!==true)throw conflict();
      await assertCalculationAccess(actor,project,true);
      receipt.phase="complete";await persist();
    }else await assertCalculationAccess(actor,project,true);
    return {calculationId:project.id,odooProjectId:receipt.projectId,financialOfferId:receipt.offerId,name:project.name,
      url:new URL(`../../calculations/${project.id}`,resource).href,updatedAt:project.updatedAt,
      receipt:{operationId:input.operationId,status:"created",createdBy:{id:actor.id,name:actor.name},synthetic:true},
      agent:{available:false,reason:"Experimento manual nuevo: no tiene un estudio IA vinculado; no se inició trabajo IA."}};
  }catch(e){
    if(e instanceof ContextError)throw new ChatGPTAuthError(e.status as 401|404|409,"ODOO_CREATION_UNAVAILABLE",e.message);
    throw e;
  }finally{await rm(lock,{recursive:true});}
}
