import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertCalculationAccess, ChatGPTAuthError, type ChatGPTActor } from "./chatgpt-auth";
import { createEmptyCalculation, getProject, saveProject } from "./store";
import { normalizeImportPayload, toCalculation, type FinancialOfferProject } from "./contract";
import { rpc } from "./odoo-project-context";
import { proxyOdooSession, isOdooLoginRedirect } from "./odoo-collaboration";
import {projectRpc} from "./chatgpt-project";
import { proxyStudyDocuments } from "./study-documents-proxy";

const Id=z.string().uuid();
export const ParallelCreateSchema=z.object({sourceCalculationId:Id.optional(),odooProjectId:z.number().int().positive().optional(),name:z.string().trim().min(1).max(100),operationId:Id}).strict();
export const ParallelReadSchema=z.object({calculationId:Id}).strict();
export const ParallelSaveSchema=z.object({calculationId:Id,expectedUpdatedAt:z.string().datetime(),operationId:Id,
  stage:z.enum(["documents_prepared","research_in_progress","completed"]),
  support:z.string().min(1).max(200000),checkpoint:z.record(z.string(),z.unknown()),
  result:z.record(z.string(),z.unknown()).optional()}).strict();
export const ResearchContextSchema=z.object({calculationId:Id.optional(),odooProjectId:z.number().int().positive().optional(),
  section:z.enum(["documents","document","members","study_documents","study_document","notes","tasks","purchases","catalog","supplier_lists","checklists","executions","deliverables","attachments"]),
  query:z.string().max(180).default(""),offset:z.number().int().min(0).max(100000).default(0),
  limit:z.number().int().min(1).max(100).default(30),documentId:z.number().int().positive().optional(),
  memberIndex:z.number().int().nonnegative().optional(),fileId:z.string().regex(/^[A-Za-z0-9_-]{10,200}$/).optional(),
  folder:z.string().regex(/^[A-Za-z0-9_-]{10,200}$/).optional(),page:z.string().max(500).optional(),
  byteOffset:z.number().int().nonnegative().default(0),byteLimit:z.number().int().min(1).max(196608).default(196608)}).strict();
type Meta={version:1;kind:"codex_local_parallel";sourceCalculationId:string|null;sourceUpdatedAt:string|null;sourceHash:string;
  odooProjectId:string;createdBy:{id:string;name?:string};operationId:string;stage:string;checkpoint:Record<string,unknown>;
  createdAt:string;support:string;researchResult?:Record<string,unknown>;saves:Record<string,{digest:string;updatedAt:string}>};
type CreateReceipt={digest:string;phase:string;offerId?:number;calculationId?:string;seedRevision?:string};
const fail=(message:string,status:401|403|404|409=409)=>new ChatGPTAuthError(status,"PARALLEL_EVALUATION",message);
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function parallelRoot(){const cwd=process.cwd();return path.join(/[\\/]apps[\\/]financial-offer-web$/.test(cwd)?path.resolve(cwd,"..",".."):cwd,"data","financial-offer","mcp-parallel");}
const identity=(a:ChatGPTActor)=>({id:a.id,name:a.name});
async function jsonFile<T>(file:string):Promise<T|null>{try{return JSON.parse(await readFile(file,"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
async function atomic(file:string,value:unknown){const tmp=file+".tmp";await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,file);}
async function locked<T>(key:string,fn:(dir:string)=>Promise<T>){const dir=parallelRoot();await mkdir(dir,{recursive:true,mode:0o700});const lock=path.join(dir,key+".lock");
  try{await mkdir(lock,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw fail("Hay una operación pendiente. Consulta el cálculo antes de reintentar con el mismo operationId.");throw e;}
  try{return await fn(dir);}finally{await rm(lock,{recursive:true});}}
function requestFor(actor:ChatGPTActor){if(!actor.sessionId||actor.sessionId.length>512||/[;\r\n]/.test(actor.sessionId))throw fail("Renueva la sesión Odoo.",401);
  return new Request(process.env.CHATGPT_MCP_RESOURCE!,{headers:{Cookie:`session_id=${actor.sessionId}`}});}
async function allowed(actor:ChatGPTActor,id:string,write=false){const p=await getProject(id);if(!p)throw fail("Cálculo no disponible.",404);await assertCalculationAccess(actor,p,write);return p;}
function writeScope(actor:ChatGPTActor){if(!actor.scopes.has("finance.write"))throw fail("La conexión no tiene permiso de escritura.",403);
  if(process.env.CHATGPT_SANDBOX==="true")throw fail("La evaluación paralela requiere Finanzas vigente.",403);}
function idOf(v:unknown){const id=Array.isArray(v)&&v.length===1?v[0]:v;if(!Number.isSafeInteger(id)||Number(id)<1)throw fail("Odoo no confirmó la identidad creada. Conserva operationId.");return Number(id);}
function publicMeta(meta:Meta){return {...meta,execution:{location:"Codex",onDemand:true,odooQueueUsed:false,automaticDeletion:false}};}
async function nativeCallback(actor:ChatGPTActor,p:FinancialOfferProject){
  if(!p.odooCallbackUrl)throw fail("Falta el vínculo nativo de la simulación.");
  const url=new URL(p.odooCallbackUrl);
  if(!/^\/caf_financial_offer_app\/callback\/[a-zA-Z0-9-]+$/.test(url.pathname)||url.searchParams.get("db")!==p.odooDb)throw fail("Vínculo nativo inválido.");
  const resource=new URL(process.env.CHATGPT_MCP_RESOURCE!);
  const response=await proxyOdooSession(requestFor(actor),url.pathname+url.search,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({calculationId:p.id,externalUrl:new URL(`../../calculations/${p.id}`,resource).href,name:p.name})});
  if(!response.ok||(await response.json()).ok!==true)throw fail("El cálculo está guardado; falta confirmar su vínculo Odoo. Consulta antes de reintentar.");
}
export async function createParallelEvaluation(actor:ChatGPTActor,raw:unknown){
  const input=ParallelCreateSchema.parse(raw);writeScope(actor);
  if(Boolean(input.sourceCalculationId)===Boolean(input.odooProjectId))throw fail("Indica calculo de origen o proyecto Odoo, solo uno.");
  const source=input.sourceCalculationId?await allowed(actor,input.sourceCalculationId):null;
  const native=input.odooProjectId?await projectRpc(actor,"caf_mcp_project_context",[[input.odooProjectId]]):null;
  const projectId=source?.odooProjectId??String(native?.project?.id??"");
  if(!projectId||(!source&&!native))throw fail("Proyecto no disponible.",404);
  if(source&&(!source.odooProjectId||!source.odooDb))throw fail("El cálculo de origen no está vinculado a un proyecto Odoo.");
  const request=requestFor(actor);const orm=(model:string,method:string,args:unknown[]=[],kwargs:object={})=>rpc(request,`/web/dataset/call_kw/${model}/${method}`,{model,method,args,kwargs});
  const session=await rpc(request,"/web/session/get_session_info",{});
  if(session.uid!==actor.odooUid||(source&&session.db!==source.odooDb))throw fail("La sesión y el proyecto no corresponden.",401);
  const sourceDb=source?.odooDb??session.db;
  const key=digest([sourceDb,actor.odooUid,input.operationId]);
  return locked(key,async dir=>{
    const file=path.join(dir,"create-"+key+".json");const hash=digest(input);
    const receipt=(await jsonFile<CreateReceipt>(file))??{digest:hash,phase:"new"};
    if(receipt.digest!==hash)throw fail("Ese operationId corresponde a otra creación.");
    const persist=()=>atomic(file,receipt);const title=`Paralelo local — ${input.name} [${input.operationId}]`;
    if(!receipt.offerId){
      const offers=await orm("caf.financial.offer","search_read",[[["project_id","=",Number(projectId)],["source_title","=",title]]],{fields:["id"],limit:2});
      if(!Array.isArray(offers)||offers.length>1)throw fail("No se pudo conciliar la simulación nativa.");
      if(offers.length)receipt.offerId=idOf(offers[0].id);
      else{if(receipt.phase!=="new")throw fail("Creación incierta: concilia el recibo antes de repetir.");receipt.phase="offer_pending";await persist();
        receipt.offerId=idOf(await orm("caf.financial.offer","create",[[{project_id:Number(projectId),name:title,source_title:title}]]));}
      receipt.phase="offer_created";await persist();
    }
    await orm("caf.financial.offer","action_open_external_app",[[receipt.offerId]]);
    const launch=await orm("caf.financial.offer","build_launch_payload",[[receipt.offerId]]);
    if(launch.odooDb!==sourceDb||String(launch.odooProjectId)!==projectId||String(launch.odooUserId)!==String(actor.odooUid)
      ||!launch.externalId||(source&&launch.externalId===source.externalId)||launch.iaRunId||launch.sourceAnalysisId)throw fail("La nueva simulación no está aislada del estudio automático.");
    // Odoo represents an empty field as false and a relation as [id, label].
    // Preserve unknown as null; only the real label belongs in the calculation.
    const entity=[source?.entity,native?.project?.entidad_licitante,native?.project?.lic_entidad,launch.odooEntityName]
      .map(value=>Array.isArray(value)?value[1]:value).find((value):value is string=>typeof value==="string"&&Boolean(value.trim()))??null;
    let p=receipt.calculationId?await getProject(receipt.calculationId):await createEmptyCalculation({...launch,name:title,entity});
    if(!p||p.id===source?.id)throw fail("No se pudo confirmar el cálculo paralelo.");
    if(!receipt.calculationId){receipt.calculationId=p.id;receipt.seedRevision=p.updatedAt;receipt.phase="calculation_created";await persist();}
    const metaFile=path.join(dir,p.id+".json");let meta=await jsonFile<Meta>(metaFile);
    if(!meta){meta={version:1,kind:"codex_local_parallel",sourceCalculationId:source?.id??null,sourceUpdatedAt:source?.updatedAt??null,sourceHash:digest(source??native.project),
      odooProjectId:projectId,createdBy:identity(actor),operationId:input.operationId,stage:"created",checkpoint:{},
      createdAt:new Date().toISOString(),support:source?"Copia inicial para evaluación local. Los precios conservados aún no son una investigación nueva.":"Evaluacion nueva desde proyecto, sin precios ni articulos inventados. Pendiente preparacion documental.",saves:{}};await atomic(metaFile,meta);}
    if(receipt.phase==="calculation_created"){
      const patch={items:source?.items??[],...(source?{settings:source.settings,generalCosts:source.generalCosts}:{}),notesDocument:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:meta.support}]}]}};
      if(p.updatedAt===receipt.seedRevision)p=(await saveProject(p.id,patch,receipt.seedRevision))!;
      else if(digest([p.items,p.settings,p.generalCosts])!==digest([source?.items??[],source?.settings??p.settings,source?.generalCosts??p.generalCosts]))throw fail("El paralelo cambió durante su preparación; conserva las ediciones humanas.");
      receipt.phase="seeded";await persist();
    }
    if(receipt.phase!=="complete"){await nativeCallback(actor,p);await assertCalculationAccess(actor,p,true);receipt.phase="complete";await persist();}
    else await assertCalculationAccess(actor,p,false);
    return {calculationId:p.id,odooProjectId:projectId,financialOfferId:receipt.offerId,updatedAt:p.updatedAt,
      url:new URL(`../../calculations/${p.id}`,process.env.CHATGPT_MCP_RESOURCE!).href,evaluation:publicMeta(meta),receipt:{operationId:input.operationId,status:"created"}};
  });
}
export async function readParallelEvaluation(actor:ChatGPTActor,raw:unknown){const input=ParallelReadSchema.parse(raw);const p=await allowed(actor,input.calculationId);
  const meta=await jsonFile<Meta>(path.join(parallelRoot(),p.id+".json"));if(!meta)throw fail("Este cálculo no es una evaluación local paralela.",404);
  if(meta.odooProjectId!==p.odooProjectId||meta.sourceCalculationId===p.id)throw fail("Identidad paralela inválida.");
  return {calculationId:p.id,updatedAt:p.updatedAt,evaluation:publicMeta(meta)};}
export async function saveParallelEvaluation(actor:ChatGPTActor,raw:unknown){const input=ParallelSaveSchema.parse(raw);writeScope(actor);
  if(Buffer.byteLength(JSON.stringify(input))>2000000)throw fail("Guarda el expediente por avances de hasta 2 MB; los originales se conservan en su biblioteca.");
  return locked(input.calculationId,async dir=>{let p=await allowed(actor,input.calculationId,true);const file=path.join(dir,p.id+".json");
    const meta=await jsonFile<Meta>(file);if(!meta||meta.sourceCalculationId===p.id||meta.odooProjectId!==p.odooProjectId)throw fail("Solo se guardan resultados en paralelos creados por esta vía.",403);
    const hash=digest(input);const previous=meta.saves[input.operationId];if(previous){if(previous.digest!==hash)throw fail("operationId ya usado con otro contenido.");return {calculationId:p.id,updatedAt:p.updatedAt,receipt:{operationId:input.operationId,status:"saved",savedUpdatedAt:previous.updatedAt,replayed:true}};}
    const journalFile=path.join(dir,`${p.id}-${input.operationId}.pending.json`);
    const journal=await jsonFile<{digest:string;notesHash:string;itemsHash:string;updatedAt?:string}>(journalFile);
    if(journal&&journal.digest!==hash)throw fail("Operación pendiente con otro contenido.");
    const notesDocument={type:"doc",content:input.support.split(/\n\n+/).map(text=>({type:"paragraph",content:[{type:"text",text}]}))};
    let items=p.items;
    if(input.result){
      if(input.result.version!==3)throw fail("El estudio debe usar el contrato público JSON versión 3.");
      const normalized=normalizeImportPayload(input.result as never);const candidate=toCalculation(normalized,p.id,p.createdAt);
      const oldKeys=p.items.map(i=>i.item);const newKeys=candidate.items.map(i=>i.item);
      const initialInventory=!meta.sourceCalculationId&&p.items.length===0;
      if(!initialInventory&&JSON.stringify(oldKeys)!==JSON.stringify(newKeys))throw fail("El estudio debe conservar todos los renglones y su orden. Concilia primero el inventario.");
      items=candidate.items.map((item,i)=>initialInventory?item:({...item,id:p.items[i].id,offerMode:p.items[i].offerMode,discountPct:p.items[i].discountPct,
        profitPct:p.items[i].profitPct,manualOfferUnit:p.items[i].manualOfferUnit,offerAdjustment:p.items[i].offerAdjustment}));
    }else if(input.stage==="completed")throw fail("Falta el resultado estructurado de los renglones.");
    const next={digest:hash,notesHash:digest(notesDocument),itemsHash:digest(items)};
    if(p.updatedAt!==input.expectedUpdatedAt){
      if(!journal||digest(p.notesDocument)!==journal.notesHash||digest(p.items)!==journal.itemsHash)throw fail("El paralelo cambió; relee y conserva las ediciones humanas.");
    }else{await atomic(journalFile,next);p=(await saveProject(p.id,{items,notesDocument},input.expectedUpdatedAt))!;}
    if(!p)throw fail("No se confirmó el guardado.");
    meta.stage=input.stage;meta.support=input.support;meta.checkpoint=input.checkpoint;if(input.result)meta.researchResult=input.result;
    meta.saves[input.operationId]={digest:hash,updatedAt:p.updatedAt};await atomic(file,meta);
    await rm(journalFile,{force:true});
    return {calculationId:p.id,updatedAt:p.updatedAt,evaluation:publicMeta(meta),receipt:{operationId:input.operationId,status:"saved",savedUpdatedAt:p.updatedAt}};
  });
}
export async function readResearchContext(actor:ChatGPTActor,raw:unknown){const a=ResearchContextSchema.parse(raw);
  if(Boolean(a.calculationId)===Boolean(a.odooProjectId))throw fail("Indica calculo o proyecto Odoo, solo uno.");
  const p=a.calculationId?await allowed(actor,a.calculationId):null;
  if(!p)await projectRpc(actor,"caf_mcp_project_context",[[a.odooProjectId]]);
  const request=requestFor(actor);const projectId=p?Number(p.odooProjectId):a.odooProjectId!;const params=new URLSearchParams({query:a.query,offset:String(a.offset),limit:String(a.limit)});
  const orm=(model:string,domain:unknown[],fields:string[],order="id desc")=>rpc(request,`/web/dataset/call_kw/${model}/search_read`,{model,method:"search_read",args:[domain],kwargs:{fields,offset:a.offset,limit:a.limit,order,context:{active_test:false}}});
  if(a.section==="notes"){
    const ids=await rpc(request,"/web/dataset/call_kw/project.task/search",{model:"project.task",method:"search",args:[[["project_id","=",projectId]]],kwargs:{limit:10001,context:{active_test:false}}});
    if(!Array.isArray(ids)||ids.length>10000)throw fail("El expediente requiere paginar sus tareas antes de conciliar las notas.");
    return {section:a.section,records:await orm("mail.message",["|","&",["model","=","project.project"],["res_id","=",projectId],"&",["model","=","project.task"],["res_id","in",ids]],["id","date","author_id","body","message_type","model","res_id","create_date","write_date"]),offset:a.offset};
  }
  if(a.section==="checklists")return {section:a.section,records:await orm("caf.work.task.check.line",[["project_id","=",projectId]],["id","task_id","name","required","answer_type","question_answer","check_status","answer_text","create_date","write_date"]),offset:a.offset};
  if(a.section==="executions")return {section:a.section,records:await orm("caf.work.task.execution",[["project_id","=",projectId]],["id","task_id","sequence","state","conclusion","conditions","checklist_snapshot","completed_at","completed_by_id","create_date","write_date"]),offset:a.offset};
  if(a.section==="deliverables")return {section:a.section,records:await orm("caf.work.deliverable",[["project_id","=",projectId]],["id","name","state","source_line_id","create_date","write_date"]),offset:a.offset};
  if(a.section==="attachments")return {section:a.section,records:await orm("ir.attachment",[["res_model","=","project.project"],["res_id","=",projectId]],["id","name","mimetype","file_size","checksum","url","create_date","write_date"]),offset:a.offset};
  if(a.section==="tasks")return {section:a.section,records:await orm("project.task",[["project_id","=",projectId]],["id","name","description","state","stage_id","write_date"]),offset:a.offset};
  if(a.section==="purchases")return {section:a.section,scope:"Compras visibles al usuario; verificar factura, unidad, impuestos y fecha antes de usar como costo actual.",records:await orm("purchase.order.line",[["state","in",["purchase","done"]],["name","ilike",a.query]],["id","order_id","product_id","name","product_qty","product_uom_id","price_unit","price_subtotal","price_total","currency_id","date_order","tax_ids","caf_price_tax_mode","caf_tax_rate_pct","caf_recoverable_tax_unit_cop","caf_nonrecoverable_tax_unit_cop"]),offset:a.offset};
  if(a.section==="catalog")return {section:a.section,scope:"Catálogo Odoo visible; list_price es venta, no lista de proveedor ni costo de compra.",records:await orm("product.product",[["purchase_ok","=",true],["name","ilike",a.query]],["id","display_name","default_code","uom_id","seller_ids","write_date"]),offset:a.offset};
  if(a.section==="supplier_lists")return {section:a.section,scope:"Tarifas de proveedor registradas en Odoo; comprobar vigencia, unidad, tramos e impuestos.",records:await orm("product.supplierinfo",[["product_name","ilike",a.query]],["id","partner_id","product_tmpl_id","product_name","product_code","price","currency_id","min_qty","date_start","date_end","write_date"]),offset:a.offset};
  let response:Response;
  if(a.section==="study_documents"||a.section==="study_document"){
    if(!p)throw fail("Para archivos preparados usa finance_project_context financial_inputs y Drive conectado con esos IDs.");
    const search=new URLSearchParams();if(a.folder)search.set("folder",a.folder);if(a.page)search.set("page",a.page);
    const req=new Request(new URL(`?${search}`,request.url),{headers:request.headers});
    if(a.section==="study_document"&&!a.fileId)throw fail("Falta fileId.");
    response=await proxyStudyDocuments(req,p.id,a.section==="study_document"?a.fileId:undefined);
  }else{
    let route=`/caf/library/${projectId}/documents`;
    if(a.section!=="documents"){if(!a.documentId)throw fail("Falta documentId.");route+=`/${a.documentId}/${a.section==="members"?"members":"content"}`;}
    if(a.memberIndex!==undefined)params.set("member_index",String(a.memberIndex));
    response=await proxyOdooSession(request,route+`?${params}`,{signal:AbortSignal.timeout(90000)});
  }
  if(isOdooLoginRedirect(response))throw fail("Renueva tu sesión Odoo.",401);
  if(!response.ok)throw fail(`La fuente documental no está disponible (${response.status}); no equivale a carpeta vacía.`,response.status===404?404:409);
  if(["documents","members","study_documents"].includes(a.section))return {section:a.section,data:await response.json()};
  const maxBytes=8*1024*1024;
  if(Number(response.headers.get("content-length"))>maxBytes){await response.body?.cancel();throw fail("Original mayor de 8 MB: recupéralo por la conexión Drive conservando su identidad y hash.");}
  const reader=response.body?.getReader();if(!reader)throw fail("El original no contiene datos.");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;
    if(size>maxBytes){await reader.cancel();throw fail("Original mayor de 8 MB: recupéralo por Drive sin tratar esta respuesta como completa.");}chunks.push(chunk.value);}
  const bytes=Buffer.concat(chunks);const sha=createHash("sha256").update(bytes).digest("hex");
  const expectedHash=response.headers.get("x-caf-sha256");if(expectedHash&&expectedHash!==sha)throw fail("La huella del original no coincide; no uses esta extracción.");
  if(a.byteOffset>bytes.length)throw fail("El desplazamiento excede el documento.");
  return {section:a.section,mimeType:response.headers.get("content-type"),disposition:response.headers.get("content-disposition"),sha256:sha,totalBytes:bytes.length,
    byteOffset:a.byteOffset,nextByteOffset:Math.min(bytes.length,a.byteOffset+a.byteLimit),complete:a.byteOffset+a.byteLimit>=bytes.length,
    encoding:"base64",content:bytes.subarray(a.byteOffset,a.byteOffset+a.byteLimit).toString("base64")};
}
