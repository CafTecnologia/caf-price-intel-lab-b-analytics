import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {validateFinancialScope} from './study-finance-broker.mjs';
import {validateStudyRequest,studyHash} from './study-runs.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function validateDialogueContext(body){
 const context=body.initialContext;
 if(!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).some(k=>!['scope','project','conversationId','output'].includes(k)))throw new Error('Contexto financiero invalido');
 const scope=validateFinancialScope(context.scope,body.projectId);
 if(Object.keys(scope).some(k=>!['calculationId','odooDb','externalRunId','taskId'].includes(k))||
    !UUID.test(body.jobId||'')||!UUID.test(context.conversationId||'')||
    !Number.isSafeInteger(body.dossierRevision)||body.dossierRevision<1||
    scope.taskId!==body.taskId||scope.externalRunId!==body.externalRunId||
    scope.externalRunId!==`odoo:${scope.odooDb}:project:${body.projectId}:task:${body.taskId}:revision:${body.dossierRevision}`||
    context.project?.id!==body.projectId||typeof context.project?.name!=='string'||context.project.name.length>300)throw new Error('Vinculo del contexto financiero invalido');
 const output=context.output;
 if(!output||output.validation?.ok!==true||output.json?.version!==2||!Array.isArray(output.json.items)||!output.json.items.length||
    JSON.stringify(output.json).length>3000000||typeof output.support!=='string'||output.support.length>2000000)throw new Error('Estudio previo no validado');
 return {scope,context,output};
}
export async function ensureDialogueContext({body,settings,getJob,save,readConversation,writeConversation,fetchImpl=fetch}){
 const {scope,context,output}=validateDialogueContext(body);
 const checkExisting=()=>{
  const job=getJob(body.jobId);if(!job)return false;
  if(job.owner!=='odoo'||job.review_of||job.study?.project?.id!==body.projectId||job.study?.taskId!==body.taskId||
     job.study?.externalRunId!==scope.externalRunId||job.study?.dossierRevision!==body.dossierRevision||job.conversation_id!==context.conversationId||
     (Object.hasOwn(job,'_financial_context_calculation_id')&&job._financial_context_calculation_id!==scope.calculationId))throw new Error('Estudio previo vinculado a otra tarea');
  if(job._financial_context_calculation_id===scope.calculationId)return true;
  if(job.status!=='completed'||job.output?.validation?.ok!==true)throw new Error('Estudio inicial no completado y validado');
  return false;
 };
 const setting=settings[scope.odooDb];if(!setting)throw new Error('Entorno financiero no habilitado');
 if(checkExisting())return false;
 const token=fs.readFileSync(setting.tokenFile,'utf8').trim();if(token.length<32)throw new Error('Credencial financiera no configurada');
 const response=await fetchImpl(setting.base.replace(/\/$/,'')+'/api/projects/'+scope.calculationId+'/operations',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){const error=new Error('No se pudo validar el calculo del contexto');error.httpStatus=response.status;throw error;}
 const current=(await response.json()).calculation;
 if(!current||current.id!==scope.calculationId||String(current.odooProjectId)!==String(body.projectId)||current.externalId!==scope.externalRunId)throw new Error('Calculo del contexto vinculado a otra tarea');
 if(checkExisting())return false;
 const old=readConversation(context.conversationId);
 const existing=getJob(body.jobId);
 if(existing){
  // A native initial study already owns its durable job and conversation.
  // Verify the live calculation before attaching only the missing binding.
  if(!old||old.owner!=='odoo'||old.project?.id!==body.projectId||old.turns?.[0]?.job_id!==body.jobId)throw new Error('La conversacion ya contiene otro estudio');
  if(!isDeepStrictEqual(existing.output.json,output.json)||existing.output.support!==output.support)throw new Error('El contexto no coincide con el estudio inicial validado');
  save({...existing,_financial_context_calculation_id:scope.calculationId});
  return true;
 }
 if(old&&(old.owner!=='odoo'||old.project?.id!==body.projectId||old.turns?.length!==1||old.turns[0].job_id!==body.jobId))throw new Error('La conversacion ya contiene otro estudio');
 const documents=[];for(let i=0;i<output.support.length;i+=350000)documents.push({id:'validated-support-'+i,name:'Soporte validado del estudio',text:output.support.slice(i,i+350000)});
 if(!documents.length)documents.push({id:'validated-context',name:'Contexto del calculo',text:'El estudio validado se conserva en previousStudy. Lee los datos vigentes mediante las herramientas financieras.'});
 const study=validateStudyRequest({externalRunId:scope.externalRunId,project:context.project,taskId:body.taskId,dossierRevision:body.dossierRevision,prompt:'Continuar el estudio validado de Odoo sobre su calculo financiero vinculado.',documents,model:'gpt-6-sol',reasoningEffort:'medium'});
 const now=new Date().toISOString();
 const job={id:body.jobId,owner:'odoo',status:'completed',created_at:now,updated_at:now,prompt:study.prompt,provider:'codex',skill:'caf-estudio-mercado',requested_model:'gpt-6-sol',reasoning_effort:'medium',result:'Estudio validado conservado desde Odoo.',error:null,study,study_hash:studyHash(study),study_contract:'gross-ceiling-v1',conversation_id:context.conversationId,conversationId:context.conversationId,_financial_context_calculation_id:scope.calculationId,events:[],output:{json:output.json,support:output.support,validation:output.validation,manifest:output.manifest||[]}};
 if(!old)writeConversation({id:context.conversationId,owner:'odoo',title:context.project.name,kind:'odoo',source:'odoo',project:context.project,created_at:now,updated_at:now,turns:[{job_id:job.id,prompt:job.prompt,provider:'codex',requested_model:'gpt-6-sol',reasoning_effort:'medium',skill:job.skill,created_at:now}]});
 save(job);return true;
}
