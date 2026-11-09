import "server-only";
import {z} from "zod";
import {ChatGPTAuthError,type ChatGPTActor} from "./chatgpt-auth";
import {rpc} from "./odoo-project-context";
export const ProjectFindSchema=z.object({query:z.string().max(180).default(""),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)}).strict();
export const ProjectContextSchema=z.object({odooProjectId:z.number().int().positive(),section:z.enum(["work","financial_inputs"]).default("work")}).strict();
export const ProjectActionSchema=z.object({odooProjectId:z.number().int().positive(),operationId:z.string().uuid(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),
 action:z.enum(["start_plan","sync_plan","register_event","task_state","task_reopen","task_save_conclusion","task_deliver","task_assign","task_confirm_previous","check_status","check_question","check_requirement","check_capability","check_note","check_result","check_deliverable","check_add", "check_rename", "check_remove", "deliverable_remove", "check_assign","deliverable_add","deliverable_name","deliverable_state","deliverable_assign","ensure_project_folder","ensure_financial_folder","register_document_delivery","queue_native_financial"]),
 values:z.record(z.string(),z.unknown()).default({})}).strict();
export function projectRequest(actor:ChatGPTActor){
 if(!actor.sessionId||actor.sessionId.length>512||/[;\r\n]/.test(actor.sessionId))throw new ChatGPTAuthError(401,"INVALID_SESSION","La sesion no es valida.");
 return new Request(process.env.CHATGPT_MCP_RESOURCE!,{headers:{Cookie:`session_id=${actor.sessionId}`}});
}
export async function projectRpc(actor:ChatGPTActor,method:string,args:unknown[],write=false){
 if(!actor.scopes.has("finance.read")||(write&&!actor.scopes.has("finance.write")))throw new ChatGPTAuthError(403,"INSUFFICIENT_SCOPE","La conexion no tiene el permiso necesario.");
 if(write&&process.env.CHATGPT_SANDBOX==="true")throw new ChatGPTAuthError(403,"LIVE_REQUIRED","Esta accion requiere Finanzas vigente.");
 const request=projectRequest(actor);const session=await rpc(request,"/web/session/get_session_info",{});
 if(session.uid!==actor.odooUid||!(process.env.CHATGPT_ODOO_DATABASES??"").split(",").map(s=>s.trim()).includes(session.db))throw new ChatGPTAuthError(401,"INVALID_SESSION","La identidad o base Odoo no corresponde.");
 return rpc(request,`/web/dataset/call_kw/project.project/${method}`,{model:"project.project",method,args,kwargs:{}});
}
export async function findOdooProjects(actor:ChatGPTActor,raw:unknown){const a=ProjectFindSchema.parse(raw);return projectRpc(actor,"caf_mcp_find_projects",[a.query,a.offset,a.limit]);}
export async function getOdooProjectContext(actor:ChatGPTActor,raw:unknown){const a=ProjectContextSchema.parse(raw);return projectRpc(actor,a.section==="work"?"caf_mcp_project_context":"caf_mcp_financial_inputs",[[a.odooProjectId]]);}
export async function runOdooProjectAction(actor:ChatGPTActor,raw:unknown){const a=ProjectActionSchema.parse(raw);return projectRpc(actor,"caf_mcp_project_action",[[a.odooProjectId],a.operationId,a.expectedRevision,a.action,a.values],true);}
