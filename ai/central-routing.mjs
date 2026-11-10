import fs from 'node:fs';
// Server-only inference credential. Never pass an OpenAI key to an agent or its tools.
export function centralConnection(job={},env=process.env) {
 const base=env.CAF_AI_ROUTER_URL;
 if(!base)return null;
 const url=new URL(base);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid central inference destination');
 const allowed=(env.CAF_AI_ROUTER_ALLOWED_DATABASES||'').split(',').map(x=>x.trim()).filter(Boolean);
 const explicit=job.study?.financialScope?.odooDb||job.product_research?.database||job.supplier_format?.database||job.odoo_db||job.database;
 const exclusive=env.CAF_AI_ROUTER_EXCLUSIVE_DATABASE;
 if(exclusive&&(!allowed.includes(exclusive)||(explicit&&explicit!==exclusive)))throw Error('Exclusive central tenant mismatch');
 const database=explicit||exclusive||(env.CAF_AI_ROUTER_EXCLUSIVE_DEV==='1'?env.CAF_AI_ROUTER_DATABASE:null);
 if(!database)return null; // A shared worker must know the originating tenant.
 if(!allowed.includes(database))return null;
 if(!env.CAF_AI_ROUTER_TOKEN_FILE)throw Error('Missing central inference credential');
 const token=fs.readFileSync(env.CAF_AI_ROUTER_TOKEN_FILE,'utf8').trim();
 if(!token)throw Error('Empty central inference credential');
 return {base:url.href.replace(/\/$/,''),database,controlDatabase:env.CAF_AI_ROUTER_CONTROL_DATABASE||database,token};
}
export function centralStage(job={}) {
 if(job.product_research)return 'product_evidence';
 if(job.supplier_format)return 'supplier_format_agent';
 if(job.study?.financialScope)return 'financial_agent';
 if(job.study)return 'study_agent';
 return 'general_agent';
}
export function centralCodex(job={},stage=centralStage(job),env=process.env,cwd) {
 const connection=centralConnection(job,env);
 if(!connection)return {args:[],env:{},enabled:false};
 if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(stage))throw Error('Invalid central task');
 const values={
  model_provider:'cafcentral',
  'model_providers.cafcentral.name':'CAF · política central',
  'model_providers.cafcentral.base_url':connection.base+'/'+stage,
  'model_providers.cafcentral.env_key':'CAF_AI_ROUTER_TOKEN',
  'model_providers.cafcentral.wire_api':'responses',
  'model_providers.cafcentral.http_headers':{'X-Odoo-Database':connection.controlDatabase,'X-CAF-Origin-Database':connection.database,...(cwd?{'X-CAF-Executor-Cwd':cwd}:{})},
  'model_providers.cafcentral.requires_openai_auth':false,
  'model_providers.cafcentral.supports_websockets':false,
  // An uncertain inference must be reconciled, never replay a business tool loop.
  'model_providers.cafcentral.request_max_retries':0,
  'model_providers.cafcentral.stream_max_retries':0,
  'model_providers.cafcentral.stream_idle_timeout_ms':610000
 };
 const toml=value=>typeof value==='object'?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+JSON.stringify(v)).join(',')+'}':JSON.stringify(value);
 return {args:Object.entries(values).flatMap(([k,v])=>['-c',k+'='+toml(v)]),
         env:{CAF_AI_ROUTER_TOKEN:connection.token},enabled:true};
}
export async function centralResponse(job,stage,body,{fetchImpl=fetch,timeoutMs=180000,env=process.env}={}) {
 const connection=centralConnection(job,env);
 if(!connection)return null;
 if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(stage))throw Error('Invalid central task');
 const response=await fetchImpl(connection.base+'/'+stage+'/responses',{method:'POST',redirect:'error',
  headers:{Authorization:'Bearer '+connection.token,'X-Odoo-Database':connection.controlDatabase,'X-CAF-Origin-Database':connection.database,'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error('Central inference failed; inspect its durable usage receipt');
 return response.json();
}
export function centralText(response) {
 return (response.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[])
  .filter(x=>x.type==='output_text').map(x=>x.text||'').join('');
}
