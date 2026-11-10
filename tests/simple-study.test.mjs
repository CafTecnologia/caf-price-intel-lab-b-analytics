import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {validateStudyProfile} from '../ai/study-profile-validation.mjs';
import {extractStudyDocuments} from '../ai/study-document-extractor.mjs';
import {findProgress,restoreProgress} from '../ai/study-progress.mjs';
const root=new URL('../',import.meta.url);
const runs=fs.readFileSync(new URL('../ai/study-runs.mjs',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../ai/server.mjs',import.meta.url),'utf8');
function fn(source,start,end,name,bindings={}){
 return new Function(...Object.keys(bindings),source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))).replace(/^export /gm,'')+'\nreturn '+name+';')(...Object.values(bindings));
}
const request=fn(runs,'export function validateStudyRequest','export const studyHash','validateStudyRequest',{validateInitialCatalogAccess:()=>assert.fail('Unexpected catalog'),validateFinancialScope:()=>assert.fail('Unexpected finance')});
const run=fn(server,'async function runInitialStudy(','\n\nasync function recoverSavedStudy','runInitialStudy',{callCodex:()=>assert.fail('Unexpected inference')});
const file=fn(runs,'function checkedFile(','const deliveryFiles','checkedFile',{fs,path});
const validate=fn(runs,'export async function validateStudyOutput','export async function dispatchStudy','validateStudyOutput',{fs,path,checkedFile:file,validateStudyProfile});
const base={externalRunId:'odoo:fixture:project:1:task:2:revision:1',project:{id:1,name:'Synthetic fixture'},taskId:2,prompt:'Run existing skill',documents:[{id:'a',name:'source.txt',text:'Complete synthetic source'}]};
const fixture={version:3,items:[{item:'A',name:'Synthetic product',description:'Synthetic source item',unit:'unit',quantity:null,ceiling_unit_price:null,notes:'PENDIENTE_COSTO: review source',deliverable_type:'product',price_sources:[{name:'Pending source',unit_price:0,currency:'COP',url:'',notes:'PENDIENTE_COSTO: source pending'}],data_organization:{version:1,original_capture:'legacy_fields_only',normalization:[],components:[]}}]};

test('folder input accepts 26 readable documents and larger text without changing bytes',()=>{
 const documents=Array.from({length:26},(_,i)=>({id:String(i),name:'doc'+i,text:'full source'}));documents[0].text='x'.repeat(350001);
 const got=request({...base,documents,model:'gpt-6.1-sol',reasoningEffort:'high'});
 assert.deepEqual(got.documents,documents);assert.equal(got.model,'gpt-6.1-sol');assert.equal(got.reasoningEffort,'high');
 assert.equal(request(base).model,undefined);
});
test('missing or ambiguous file identities still fail before dispatch',()=>{
 for(const documents of [[],[{id:'a',name:'a',text:''}],[base.documents[0],base.documents[0]]])assert.throws(()=>request({...base,documents}));
});
test('one skill execution can research and finish without an intermediate inventory',async()=>{
 let count=0;const task={prompt:'Full skill and source context',study:base};
 assert.equal(await run({owner:'study_worker',study:base},task,{kind:'codex'},'/fixture',{call:async(arg,p,wd)=>{count++;assert.strictEqual(arg,task);assert.equal(arg.inventory_only,undefined);return 'done';}}),'done');assert.equal(count,1);
 assert(!server.includes('FASE DOCUMENTAL PREVIA OBLIGATORIA'));
 assert(!server.includes("if(j.execution_phase==='inventory')"));
 assert(!server.includes('await completeProgress('));
});
test('initial output uses the actual Finance schema, even with absent or stale intermediate inventory',async()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-simple-output-'));
 try{
  fs.writeFileSync(path.join(wd,'resultado_finanzas.json'),JSON.stringify(fixture));
  fs.writeFileSync(path.join(wd,'inventory.json'),'stale intermediate, not a financial output');
  const got=await validate({study:base},wd);
  assert.equal(got.validation.ok,true);assert.equal(got.validation.schema_valid,true);assert.equal(got.validation.inventory_checked,false);assert.equal(got.json.items[0].quantity,null);
  fs.writeFileSync(path.join(wd,'resultado_finanzas.json'),'not json');
  await assert.rejects(validate({study:base},wd),e=>e.code==='STUDY_RESULT_FORMAT');
  fs.unlinkSync(path.join(wd,'resultado_finanzas.json'));
  await assert.rejects(validate({study:base},wd),e=>e.code==='STUDY_RESULT_MISSING');
 }finally{fs.rmSync(wd,{recursive:true,force:true});}
});
test('invalid final contract is rejected; a missing inventory is not substituted for a final result',async()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-simple-invalid-'));
 try{fs.writeFileSync(path.join(wd,'resultado_finanzas.json'),JSON.stringify({version:3,items:[{item:'A'}]}));await assert.rejects(validate({study:base},wd),e=>e.code==='STUDY_PROFILE_REJECTED');}
 finally{fs.rmSync(wd,{recursive:true,force:true});}
});
test('original extraction preserves more than 25 files',()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-simple-originals-'));
 try{const files=Array.from({length:26},(_,i)=>{const bytes=Buffer.from(i===0?'x'.repeat(350001):'Complete source '+i);return{id:'file'+i,name:'doc'+i+'.txt',mimeType:'text/plain',bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});const out=extractStudyDocuments(files,wd,process.getuid());assert.equal(out.documents.length,26);for(let i=0;i<26;i++)assert.equal(out.documents[i].text,files[i].bytes.toString());}
 finally{fs.rmSync(wd,{recursive:true,force:true});}
});
test('resume preserves unknown quantities and units without a second study engine',()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-simple-progress-'));const id='11111111-1111-4111-8111-111111111111';
 try{const prior=path.join(wd,id);fs.mkdirSync(prior);const rows=[{item:'A',description:'Unknown quantity and unit in source',quantity:null,unit:null}];fs.writeFileSync(path.join(prior,'inventory.json'),JSON.stringify(rows));fs.writeFileSync(path.join(prior,'research-checkpoint.json'),'[{"item":"A","pending":true}]');for(const name of ['captura_documental.json','investigacion_checkpoint.json'])fs.writeFileSync(path.join(prior,name),'{"saved":true}');const current={id:'22222222-2222-4222-8222-222222222222',owner:'study_worker',study:base};const old={...current,id,status:'failed',created_at:'2026-11-10T08:00:00Z'};const checkpoint=findProgress(current,[old],wd);assert(checkpoint);const target=path.join(wd,current.id);fs.mkdirSync(target);assert.deepEqual(restoreProgress(current,target,checkpoint),rows);assert.equal(fs.readFileSync(path.join(target,'research-checkpoint.json'),'utf8'),'[{"item":"A","pending":true}]');
 for(const name of ['captura_documental.json','investigacion_checkpoint.json'])assert.equal(fs.readFileSync(path.join(target,name),'utf8'),'{"saved":true}');
 const foreign={...current,study:{...base,externalRunId:'odoo:foreign:project:1:task:2:revision:1'}};assert.equal(findProgress(foreign,[old],wd),null);
 }finally{fs.rmSync(wd,{recursive:true,force:true});}
});

test('the real caller directory is sent on every central inference request',async()=>{
 const {centralCodex}=await import('../ai/central-routing.mjs');
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-routing-context-'));
 try{const token=path.join(wd,'fixture-token');fs.writeFileSync(token,'synthetic-not-a-credential');const cwd='/data/work/b273bb45-985a-400f-af03-37b388c01c45';const out=centralCodex({study:base},undefined,{CAF_AI_ROUTER_URL:'http://fixture.invalid/v1',CAF_AI_ROUTER_ALLOWED_DATABASES:'fixture',CAF_AI_ROUTER_EXCLUSIVE_DATABASE:'fixture',CAF_AI_ROUTER_TOKEN_FILE:token},cwd);assert.equal(out.enabled,true);const header=out.args.find(x=>x.startsWith('model_providers.cafcentral.http_headers='));assert(header.includes('X-CAF-Executor-Cwd'));assert(header.includes(cwd));assert(!header.includes('synthetic-not-a-credential'));}
 finally{fs.rmSync(wd,{recursive:true,force:true});}
});

test('Drive broker paginates more than 25 files and retains root authorization',async()=>{
 const {createDriveExpedientBroker}=await import('../ai/drive-expedient-broker.mjs');
 const rootId='root0000000001';const entries=Array.from({length:27},(_,i)=>({id:'file00000000'+String(i).padStart(2,'0'),name:'source'+i+'.txt',mimeType:'text/plain',size:'4',parents:[rootId]}));
 const broker=createDriveExpedientBroker({getAccessToken:async()=>'synthetic',fetchImpl:async(url)=>{const u=new URL(url);const id=u.pathname.split('/').at(-1);if(u.searchParams.get('alt')==='media')return new Response('data');if(id==='files'){return Response.json(u.searchParams.get('pageToken')?{files:entries.slice(25)}:{files:entries.slice(0,25),nextPageToken:'p2'});}return Response.json(id===rootId?{id:rootId,name:'Root',mimeType:'application/vnd.google-apps.folder'}:entries.find(e=>e.id===id));}});
 const out=await broker.readExpedient({rootFolderId:rootId});assert.equal(out.length,27);assert(out.every(f=>f.bytes.toString()==='data'));
 await assert.rejects(broker.list({rootFolderId:rootId,fileIds:['foreign0000001']}),/fuera del expediente/);
});


test('a complete saved delivery resumes without an intermediate inventory',async()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-final-only-'));const id='33333333-3333-4333-8333-333333333333';
 try{const prior=path.join(wd,id);fs.mkdirSync(prior);fs.writeFileSync(path.join(prior,'resultado_finanzas.json'),JSON.stringify(fixture));fs.writeFileSync(path.join(prior,'soporte.md'),'Existing source support');const current={id:'44444444-4444-4444-8444-444444444444',owner:'study_worker',study:base};const old={...current,id,status:'failed',created_at:'2026-11-10T08:00:00Z'};const checkpoint=findProgress(current,[old],wd);assert(checkpoint);const target=path.join(wd,current.id);fs.mkdirSync(target);assert.deepEqual(restoreProgress(current,target,checkpoint),fixture.items);assert.equal((await validate(current,target)).validation.ok,true);assert.equal(fs.readFileSync(path.join(target,'soporte.md'),'utf8'),'Existing source support');}
 finally{fs.rmSync(wd,{recursive:true,force:true});}
});

test('timeout accepts an already saved valid Finance delivery without inventory',async()=>{
 const recover=fn(server,'async function recoverTimedOutStudy(','\n\nimport','recoverTimedOutStudy',{fs,path,validateStudyOutput:validate});
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-timeout-final-'));
 try{const job={study:base};assert.equal(await recover(job,wd,{code:124}),null);fs.writeFileSync(path.join(wd,'resultado_finanzas.json'),JSON.stringify(fixture));assert.equal(typeof await recover(job,wd,{code:124}),'string');assert.equal(await recover(job,wd,{code:0}),null);fs.writeFileSync(path.join(wd,'resultado_finanzas.json'),'broken');assert.equal(await recover(job,wd,{code:124}),null);}
 finally{fs.rmSync(wd,{recursive:true,force:true});}
});
