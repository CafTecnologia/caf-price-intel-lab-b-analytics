import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {documentIdentity} from '../study-progress.mjs';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const helper=source.slice(source.indexOf('async function runInitialStudyWithCheckpoint('),source.indexOf('\n\n',source.indexOf('async function runInitialStudyWithCheckpoint(')));
const run=new Function('fs','path','crypto','documentIdentity',helper+';return runInitialStudyWithCheckpoint;')(fs,path,crypto,documentIdentity);
const base={owner:'study_worker',started_at:'1970-01-01T00:00:00.000Z',study:{externalRunId:'odoo:CafTest:project:1:task:2:revision:1',project:{id:1},taskId:2,documents:[{id:'doc',name:'price.pdf',text:'Original unknown quantity, not one'}]}};
const rows=[{item:'001',description:'Literal description',quantity:null,unit:null}];
test('main initial study cannot research before inventory persistence; original instructions and unknowns remain',async()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-inventory-first-'));const calls=[];const events=[];const job=structuredClone(base);const task={prompt:'Original full skill instructions',skill:'original',study:job.study};
 try{
  const result=await run(job,task,{kind:'codex'},wd,{now:()=>1000,saveJob:()=>{},emit:(t,m)=>events.push(m),call:async(arg)=>{
   calls.push(arg);assert(arg.prompt.startsWith(task.prompt));assert.equal(arg.skill,task.skill);
   if(arg.inventory_only){assert.equal(job.execution_phase,'inventory');assert(!fs.existsSync(path.join(wd,'inventory-first-receipt.json')));fs.writeFileSync(path.join(wd,'inventory.json'),JSON.stringify(rows));return 'Inventory saved';}
   assert.equal(job.execution_phase,'executing');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(wd,'inventory.json'))),rows);assert(fs.existsSync(path.join(wd,'inventory-first-receipt.json')));return 'Original study result';
  }});
  assert.equal(result,'Original study result');assert.equal(calls.length,2);assert.equal(calls[0].executionDeadline,calls[1].executionDeadline);assert.equal(calls[1].inventory_only,undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(wd,'inventory-first-receipt.json'))).documentIdentity,documentIdentity(job.study));assert.equal(events.length,2);
 }finally{fs.rmSync(wd,{recursive:true,force:true});}
});
test('missing, malformed, empty and symlink inventories never reach research',async()=>{
 for(const kind of ['missing','malformed','empty','symlink']){
  const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-inventory-fail-'));let calls=0;
  try{await assert.rejects(run(structuredClone(base),{prompt:'original'},{kind:'codex'},wd,{now:()=>1000,saveJob:()=>{},emit:()=>{},call:async()=>{calls++;const f=path.join(wd,'inventory.json');if(kind==='malformed')fs.writeFileSync(f,'bad');if(kind==='empty')fs.writeFileSync(f,'[]');if(kind==='symlink'){fs.writeFileSync(path.join(wd,'other'),'[]');fs.symlinkSync(path.join(wd,'other'),f);}return 'Done';}}));assert.equal(calls,1);}finally{fs.rmSync(wd,{recursive:true,force:true});}
 }
});
test('other scopes keep their single existing provider call and never change phase',async()=>{
 for(const patch of [{study:null},{owner:'human'},{study:{...base.study,externalRunId:'pilot:lost-contract'}},{study:{...base.study,financialScope:{}}},{study:{...base.study,pilot:{}}},{review_of:'prior'},{study:{...base.study,_catalogAccess:{}}}]){
  const job={...structuredClone(base),...patch};let calls=0;
  assert.equal(await run(job,{prompt:'unchanged'},{kind:'codex'},'/nonexistent',{saveJob:()=>assert.fail('Unrelated write'),call:async arg=>{calls++;assert.equal(arg.prompt,'unchanged');return 'same';}}),'same');assert.equal(calls,1);assert.equal(job.execution_phase,undefined);
 }
});
test('inventory and research share the original deadline; timeout preserves inventory',async()=>{
 const wd=fs.mkdtempSync(path.join(os.tmpdir(),'caf-inventory-budget-'));let calls=0;let clock=1000;
 try{await assert.rejects(run(structuredClone(base),{prompt:'same'},{kind:'codex'},wd,{now:()=>clock,saveJob:()=>{},emit:()=>{},call:async()=>{calls++;fs.writeFileSync(path.join(wd,'inventory.json'),JSON.stringify(rows));clock+=Number(process.env.AI_JOB_TIMEOUT_MS||2400000);return 'saved';}}),/plazo/);assert.equal(calls,1);assert(fs.existsSync(path.join(wd,'inventory.json')));}finally{fs.rmSync(wd,{recursive:true,force:true});}
});
test('served call disables web only in inventory phase and retains browser block and budget',()=>{
 assert(source.includes("if(job.inventory_only)args.push('-c','web_search=disabled')"));
 assert(source.includes("if(j.execution_phase==='inventory')return err(res,409"));
 assert(source.includes('job.executionDeadline-Date.now()'));
 assert(source.includes('!job.inventory_only&&r.code===124'));
});
