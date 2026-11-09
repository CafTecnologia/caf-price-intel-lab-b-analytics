import { App } from "@modelcontextprotocol/ext-apps";
const app = new App({name:"Mesa financiera CAF",version:"0.2.0"},{},{autoResize:true});
const root = document.getElementById("app");
let data = {}, pending = false, draft = [], retry = null, scenarioName = "Exploración financiera", connected = false, polling = false, notice = "", noticeError = false;
let lastRoundtripMs = null, lastRenderFrameMs = null;
async function serverTool(name,args) {const started=performance.now();try{return await app.callServerTool({name,arguments:args});}finally{lastRoundtripMs=Math.round(performance.now()-started);}}
const money = value => value == null || !Number.isFinite(Number(value)) ? "Pendiente" : new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(value);
const exact = value => value == null ? "Pendiente" : new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(value);
const dateLabel = value => {if(!value)return "No registrada";const d=new Date(value);return Number.isNaN(d.getTime())?"No registrada":new Intl.DateTimeFormat("es-CO",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Bogota"}).format(d);};
const originalPrice = source => source.unitPrice==null?"Pendiente":new Intl.NumberFormat("es-CO",{maximumFractionDigits:2}).format(source.unitPrice)+" "+(source.currency||"Moneda no registrada");
const statuses = {viable:"Viable",tight:"Ajustado",over_ceiling:"Sobre techo",loss:"Pérdida",no_ceiling:"Sin techo",incomplete:"Pendiente"};
const bases = {conforming:"Conforme",ready:"Listo",pending:"Pendiente",partial:"Parcial",comparable_scenario:"Escenario comparable"};
function el(tag,text,cls) { const n=document.createElement(tag); if(text!=null)n.textContent=text; if(cls)n.className=cls;return n; }
function button(label,handler,cls="") { const n=el("button",label,cls);n.disabled=pending;n.onclick=handler;return n; }
function line(label,value) { const n=el("div",null,"metric");n.append(el("small",label),el("strong",money(value)));return n; }
function message(text,error=false) {notice=text;noticeError=error;const n=document.getElementById("notice");if(n){n.textContent=text;n.className=error?"error":"notice";}}
function current() {return data.analysis;}
function viewArgs(extra={}) {return {expectedViewVersion:data.view?.version,...extra};}
async function publishContext() {
 if(!data.view)return;
 try {await app.updateModelContext({structuredContent:{calculationId:data.view.calculationId,scenarioId:data.view.scenarioId,viewVersion:data.view.version,filter:data.view.filter,sort:data.view.sort,selectedItemId:data.view.selectedItemId,visibleCount:data.view.displayedItemIds?.length,updatedAt:current()?.updatedAt},content:[{type:"text",text:"Mesa CAF: "+(current()?.name||"")+" · "+data.view.filter+" · ítem seleccionado "+(data.selected?.item?.item||"ninguno")}]});} catch {/* Context is optional in hosts without support. */}
}
function adopt(next) {
 if(!next||!("view" in next))return false;
 if(next.view===null){data={view:null};draft=[];return true;}
 if(!next.view)return false;
 if(data.view&&next.view.version<data.view.version)return true;
 data=next;draft=data.draftChanges||[];return true;
}
async function call(name,args={},manual=true) {
 if(pending)return;
 pending=true;render();message("Actualizando…");
 try {
  const result=await serverTool(name,args);
  if(result.isError)throw new Error(result.content?.find(x=>x.type==="text")?.text||"No se pudo completar.");
  retry=null;
  if(!adopt(result.structuredContent)) {
   const fresh=await serverTool("finance_get_view",{});
   if(fresh.isError)throw new Error("Operación recibida; actualiza la mesa para verificar el estado.");
   adopt(fresh.structuredContent);
  }
  notice="";noticeError=false;
 } catch(e) {message(e.message||"No se pudo completar la solicitud.",true);}
 pending=false;render();if(manual)await publishContext();
}
function mutate(name,args) {
 const fingerprint=JSON.stringify({name,args});
 if(!retry||retry.fingerprint!==fingerprint)retry={fingerprint,operationId:crypto.randomUUID()};
 return call(name,{...args,operationId:retry.operationId});
}
function preview(changes) {return call("finance_preview_in_view",viewArgs({expectedUpdatedAt:current().updatedAt,changes}));}
function safeLink(url,label) {
 try {const u=new URL(url);if(!["https:","http:"].includes(u.protocol))return el("span",label);const n=el("a",label);n.href=u.href;n.target="_blank";n.rel="noopener noreferrer";return n;}catch{return el("span",label);}
}
function savedUi() {
 const active=document.activeElement;
 return {scroll:root.querySelector(".table-wrap")?.scrollTop||0,rootScroll:document.scrollingElement?.scrollTop||0,focus:active?.dataset?.focus,selection:typeof active?.selectionStart==="number"?[active.selectionStart,active.selectionEnd]:null,open:[...root.querySelectorAll("details[open][data-key]")].map(n=>n.dataset.key),values:[...root.querySelectorAll("input[data-focus]")].map(n=>[n.dataset.focus,n.value]),identity:(root.dataset.identity||"")};
}
function restoreUi(state) {
 const same=state.identity===(root.dataset.identity||"");
 if(same){
  for(const [key,value] of state.values){const n=[...root.querySelectorAll("input[data-focus]")].find(n=>n.dataset.focus===key);if(n)n.value=value;}
  for(const n of root.querySelectorAll("details[data-key]"))if(state.open.includes(n.dataset.key))n.open=true;
  const wrap=root.querySelector(".table-wrap");if(wrap)wrap.scrollTop=state.scroll;
  if(document.scrollingElement)document.scrollingElement.scrollTop=state.rootScroll;
  const n=[...root.querySelectorAll("[data-focus]")].find(n=>n.dataset.focus===state.focus);
  if(n){n.focus({preventScroll:true});if(state.selection&&n.type!=="number")try{n.setSelectionRange(...state.selection);}catch{}}
 }
}
function input(key,placeholder,type="text") {const n=el("input");n.dataset.focus=key;n.placeholder=placeholder;n.type=type;n.disabled=pending;return n;}
function addPair(parent,label,value) {const n=el("div",null,"detail-pair");n.append(el("small",label),el("strong",value));parent.append(n);}
function renderSelected(parent) {
 const selected=data.selected;if(!selected)return;
 const {item,row}=selected;
 const detail=el("section",null,"selected-detail");detail.setAttribute("aria-label","Detalle del ítem "+item.item);
 const heading=el("div",null,"detail-heading");heading.append(el("h3","Ítem "+item.item+" · "+item.description));detail.append(heading);
 if(!(data.view?.displayedItemIds||[]).includes(item.id))detail.append(el("small","Ítem seleccionado fuera del filtro actual.","muted"));
 const metrics=el("div",null,"detail-metrics");
 addPair(metrics,"Costo unitario",exact(row.costUnit));addPair(metrics,"Oferta unitaria",exact(row.offerUnit));addPair(metrics,"Oferta total",exact(row.offerTotal));addPair(metrics,"Utilidad del ítem",exact(row.utilityValue));
 addPair(metrics,"Costo total",exact(row.costTotal));addPair(metrics,"Techo unitario",exact(row.referenceUnit));addPair(metrics,"Referencia oficial unitaria",exact(item.officialReferenceUnit));addPair(metrics,"Base del costo",bases[item.costBasisStatus]||item.costBasisStatus||"Sin definir");
 addPair(metrics,"Margen sobre costo",row.marginPctOnCost==null?"Pendiente":new Intl.NumberFormat("es-CO",{maximumFractionDigits:2}).format(row.marginPctOnCost)+" %");
 detail.append(metrics);
 if(row.quantityAssumed)detail.append(el("p","Cantidad provisional: 1 unidad asumida.","notice"));
 if(row.hasPendingAssociatedCosts)detail.append(el("p","Hay servicios sin valorar: la utilidad puede ser provisional.","notice"));
 if(item.technicalDescription)detail.append(el("p",item.technicalDescription,"technical"));
 for(const d of selected.discrepancies||[]){const left=typeof d.left==="object"?JSON.stringify(d.left):String(d.left??"Sin dato");const right=typeof d.right==="object"?JSON.stringify(d.right):String(d.right??"Sin dato");detail.append(el("p",d.label+": "+left+" ↔ "+right,"notice discrepancy"));}
 if(item.technicalAnnex?.length){const annex=el("details");annex.dataset.key="annex-"+item.id;annex.append(el("summary","Anexo técnico"));for(const excerpt of item.technicalAnnex)for(const [key,value]of Object.entries(excerpt))if(value&&typeof value==="string")annex.append(el("p",value));detail.append(annex);}
 const original=item.sourceOriginal;
 if(original&&Object.values(original).some(Boolean)){const sec=el("details");sec.dataset.key="original-"+item.id;sec.append(el("summary","Documento original"));for(const [key,value]of Object.entries(original))if(value)sec.append(el("p",({document:"Documento",locator:"Ubicación",description:"Descripción",technical_description:"Especificación",quantity:"Cantidad",unit:"Unidad",ceiling_unit_price:"Techo"}[key]||key)+": "+value));detail.append(sec);}
 const refs=el("details");refs.dataset.key="sources-"+item.id;refs.open=true;refs.append(el("summary","Fuentes · "+(item.priceSources||[]).length));
 for(const source of item.priceSources||[]){
  const normalized=row.costBreakdown?.sources?.find(s=>s.id===source.id);
  const excluded=(item.analysisExcludedPriceSourceIds||[]).includes(source.id);
  const sourceBox=el("div",null,"source-box"),ref=el("div",null,"source");
  ref.append(safeLink(source.url,source.label||"Referencia"),el("span",exact(normalized?.normalizedUnit)),el("small",excluded?"Excluida":"Incluida"));
  if(!current().readOnly)ref.append(button(excluded?"Reincluir":"Excluir",()=>preview([...draft,{type:"exclude_price_source",kind:"criterion",reason:excluded?"Referencia reincluida por el usuario":"Referencia no comparable, excluida por el usuario",itemId:item.id,sourceId:source.id,excluded:!excluded}])));
  sourceBox.append(ref,el("small","Precio original: "+originalPrice(source)+" · Fecha: "+dateLabel(source.date||source.observedAt)));
  if(source.notes)sourceBox.append(el("p",source.notes,"muted source-notes"));
  if(normalized?.warning||source.warning)sourceBox.append(el("p",normalized?.warning||source.warning,"notice source-notes"));
  refs.append(sourceBox);
 }
 const stats=el("div",null,"stats");stats.append(el("small","Promedio "+money(row.costBreakdown?.average)+" · Mediana "+money(row.costBreakdown?.median)));
 if(!current().readOnly)for(const [label,statistic]of[["Usar promedio","average"],["Usar mediana","median"]])stats.append(button(label,()=>preview([...draft,{type:"set_cost_statistic",kind:"exploration",reason:"Comparación de estadística de referencias",itemId:item.id,statistic}])));
 refs.append(stats);detail.append(refs);
 const costs=el("details");costs.dataset.key="costs-"+item.id;costs.open=true;costs.append(el("summary","Servicios y costos asociados"));
 for(const c of item.additionalCosts||[])costs.append(el("p",c.name+" · "+exact(c.amount)+" · "+(c.mode==="per_unit"?"por unidad":"una vez")+" · "+({suggested:"Sugerido · no sumado",excluded:"Excluido · no sumado",included:"Incluido"}[c.reviewStatus||"included"]||"Por revisar")));
 if(!(item.additionalCosts||[]).length)costs.append(el("small","Sin costos asociados separados"));
 if(!current().readOnly){
  const add=el("div",null,"source"),name=input("cost-name-"+item.id,"Transporte, instalación…"),amount=input("cost-amount-"+item.id,"Valor pendiente","number"),mode=el("select");amount.min="0";amount.step="0.01";name.setAttribute("aria-label","Concepto del costo");amount.setAttribute("aria-label","Valor del costo");mode.append(new Option("Una vez","fixed"),new Option("Por unidad","per_unit"));
  add.append(name,amount,mode,button("Añadir costo",()=>{const value=amount.value===""?null:Number(amount.value);if(!name.value.trim()||(value!==null&&(!Number.isFinite(value)||value<0)))return message("Indica concepto y valor válido.",true);preview([...draft,{type:"add_additional_cost",kind:"correction",reason:"Costo adicional indicado por el usuario",itemId:item.id,cost:{id:crypto.randomUUID(),name:name.value.trim(),category:"service",mode:mode.value,amount:value,notes:""}}]);}));costs.append(add);
 }
 detail.append(costs);
 if(row.warnings?.length)detail.append(el("p",row.warnings.join(" "),"notice"));
 parent.append(detail);
}
function render() {
 const renderStarted=performance.now();
 const state=savedUi();root.replaceChildren();root.dataset.identity=(data.view?.calculationId||"")+":"+(data.view?.selectedItemId||"");
 const head=el("header");head.append(el("span","CAF","brand"),el("h1","Mesa financiera"),button("Actualizar",()=>call("finance_get_view",{})));root.append(head);
 const n=el("p",notice,noticeError?"error":"notice");n.id="notice";n.setAttribute("role","status");root.append(n);
 const a=current();
 if(!a){root.append(button("Abrir cálculo activo",()=>call("finance_open_workspace",{}),"primary"));return;}
 const title=el("section",null,"title");title.append(el("h2",a.name),el("small",[a.odooProcessNumber,a.odooEntityName].filter(Boolean).join(" · ")));
 const scenario=data.scenarios?.find(s=>s.id===data.view?.scenarioId)||data.scenario;
 title.append(el("span",scenario?scenario.name+" · "+({draft:"Guardado · sin aceptar",accepted:"Aceptado",undone:"Deshecho"}[scenario.status]||scenario.status):draft.length?"Vista previa · sin guardar":"Cálculo actual","badge"));
 title.append(el("small","Revisión del cálculo: "+dateLabel(a.updatedAt),"source-notice"));
 if(data.view?.sourceNotice)title.append(el("small",data.view.sourceNotice,"source-notice"));
 if(data.view?.staleDraft)title.append(el("p","La base cambió; vuelve a preparar la vista previa.","notice"));
 if(a.readOnly)title.append(el("span","Solo lectura","badge"));root.append(title);
 const s=data.summary,p=data.presentation;
 if(s){const metrics=el("section",null,"metrics");metrics.append(line("Costo conocido",s.knownCostTotal),line(p?"Oferta con IVA":"Oferta total",p?.totalOfferWithVat??s.knownOfferTotal),line("Utilidad evaluable",s.partial?.totalMargin));root.append(metrics);if(s.incompleteCount||s.nonFinalCostBasisCount)root.append(el("p",s.incompleteCount+" ítems pendientes · "+s.nonFinalCostBasisCount+" con costo no final","notice"));}
 if(p){const fiscal=el("details",null,"fiscal");fiscal.dataset.key="fiscal";fiscal.append(el("summary","Desglose fiscal y recaudo"));const grid=el("div",null,"detail-metrics");for(const [label,key]of[["Oferta sin IVA","totalOfferWithoutVat"],["IVA","totalVat"],["Retefuente","reteFuente"],["ReteIVA","reteIva"],["ReteICA","reteIca"],["Estampillas","stampTax"],["Deducciones","totalDeductions"],["Recaudo estimado","expectedNetCollection"],["Utilidad neta estimada","estimatedNetUtility"]])addPair(grid,label,money(p[key]));fiscal.append(grid);root.append(fiscal);}
 const toolbar=el("div",null,"toolbar"),selector=el("select");selector.setAttribute("aria-label","Escenario");selector.disabled=pending;selector.append(new Option("Cálculo actual",""));for(const sc of data.scenarios||[])selector.append(new Option(sc.name+" · "+({draft:"Sin aceptar",accepted:"Aceptado",undone:"Deshecho"}[sc.status]||sc.status),sc.id));selector.value=data.view?.scenarioId||"";selector.onchange=()=>call("finance_show_scenario",viewArgs(selector.value?{scenarioId:selector.value}:{}));toolbar.append(selector);
 if(!a.readOnly){const margin=input("margin","Margen sobre costo %","number");margin.min="0";margin.max="1000";margin.step="0.1";margin.setAttribute("aria-label","Margen sobre costo (%)");toolbar.append(margin,button("Probar margen",()=>{const value=Number(margin.value);if(margin.value===""||!Number.isFinite(value)||value<0||value>1000)return message("Indica un margen válido.",true);preview([...draft,{type:"set_margin",kind:"exploration",reason:"Prueba de margen desde la mesa",itemIds:[],marginPctOnCost:value}]);}));}
 root.append(toolbar);
 const filters=el("div",null,"filters");filters.setAttribute("role","group");filters.setAttribute("aria-label","Filtrar ítems");
 for(const [key,label,count]of[["all","Todos",data.counts?.all??s?.itemCount],["loss","Pérdidas",data.counts?.loss??s?.lossCount],["pending","Pendientes",data.counts?.pending??s?.incompleteCount],["over_ceiling","Sobre techo",data.counts?.over_ceiling??s?.overCeilingCount]]){const b=button(label+(count==null?"":" · "+count),()=>call("finance_filter_view",viewArgs({filter:key,sort:data.view?.sort||"item"})),data.view?.filter===key?"active":"");b.setAttribute("aria-pressed",String(data.view?.filter===key));filters.append(b);}
 const sort=el("select");sort.setAttribute("aria-label","Orden de ítems");sort.disabled=pending;for(const [key,label]of[["item","Orden del ítem"],["utility_asc","Menor utilidad"],["utility_desc","Mayor utilidad"]])sort.append(new Option(label,key));sort.value=data.view?.sort||"item";sort.onchange=()=>call("finance_filter_view",viewArgs({filter:data.view?.filter||"all",sort:sort.value}));filters.append(sort);
 const find=input("item-find","Ítem, p. ej. 14");find.setAttribute("aria-label","Número del ítem");const selectItem=()=>find.value.trim()?call("finance_select_item",viewArgs({item:find.value.trim()})):message("Indica el número del ítem.",true);find.onkeydown=e=>{if(e.key==="Enter")selectItem();};filters.append(find,button("Ver ítem",selectItem));root.append(filters);
 const table=el("table",null,"items"),thead=el("thead"),hr=el("tr");for(const label of["Ítem / descripción","Cant.","Costo unit.","Oferta unit.","Resultado","Base del costo"])hr.append(el("th",label));thead.append(hr);table.append(thead);const body=el("tbody");
 const changed=new Set((data.diff||[]).map(d=>d.itemId));
 for(const row of data.rows||[]){const tr=el("tr",null,(row.id===data.view?.selectedItemId?"selected ":"")+(changed.has(row.id)?"changed ":"")+"status-"+row.status);tr.dataset.itemId=row.id;const cell=el("td");const select=button(row.item+" · "+row.description,()=>call("finance_select_item",viewArgs({item:String(row.item)})),"item-link");select.setAttribute("aria-pressed",String(row.id===data.view?.selectedItemId));cell.append(select);if(changed.has(row.id))cell.append(el("small","Modificado","change-mark"));tr.append(cell,el("td",row.quantity==null?"Pendiente":String(row.quantity)),el("td",money(row.costUnit)),el("td",money(row.offerUnit)));const result=el("td");result.append(el("strong",money(row.utilityValue)),el("small",statuses[row.status]||"Pendiente"));tr.append(result,el("td",bases[row.costBasisStatus]||row.costBasisStatus||"Sin definir"));body.append(tr);}
 if(!data.rows?.length){const tr=el("tr"),cell=el("td","No hay ítems en este filtro.","muted");cell.colSpan=6;tr.append(cell);body.append(tr);}table.append(body);const wrap=el("section",null,"table-wrap");wrap.append(table);root.append(wrap);
 renderSelected(root);
 if(data.baseline){const compare=el("section",null,"comparison");compare.append(el("h3","Base → escenario"));const m=el("div",null,"detail-metrics");for(const [label,key]of[["Costo","knownCostTotal"],["Oferta","knownOfferTotal"]])addPair(m,label,money(data.baseline[key])+" → "+money(s?.[key]));compare.append(m);root.append(compare);}
 if(data.diff?.length){const changes=el("details",null,"changes");changes.dataset.key="diff";changes.open=true;changes.append(el("summary","Cambios · "+data.diff.length));const labels={quantity:"Cantidad",referenceUnit:"Techo unitario",officialReferenceUnit:"Referencia oficial unitaria",budgetLimits:"Máximos documentados",profitPct:"Margen sobre costo (%)",manualOfferUnit:"Oferta unitaria",additionalCosts:"Costos asociados",analysisExcludedPriceSourceIds:"Fuentes excluidas",analysisCostStatistic:"Criterio del costo",description:"Descripción",technicalDescription:"Especificación",notes:"Notas",offerMode:"Criterio de oferta",discountPct:"Descuento (%)"};const fmt=(v,field)=>v==null?"Sin definir":typeof v==="number"?["referenceUnit","manualOfferUnit"].includes(field)?money(v):String(v):Array.isArray(v)?v.map(x=>typeof x==="object"?(x.label||x.name)+": "+money(x.maximum??x.amount):String(x)).join("; ")||"Ninguna":typeof v==="object"?v.label||JSON.stringify(v):String(v);for(const d of data.diff){const item=data.rows?.find(r=>r.id===d.itemId);changes.append(el("p",(item?"Ítem "+item.item+" · ":"")+(labels[d.field]||d.field)+": "+fmt(d.before,d.field)+" → "+fmt(d.after,d.field)));}root.append(changes);}
 if(data.budgetCompliance?.length){const caps=el("details",null,"fiscal");caps.append(el("summary","Máximos documentados"));for(const cap of data.budgetCompliance){caps.append(el("p",cap.label+" · Máximo "+money(cap.maximum)+" · Oferta con impuestos "+money(cap.knownOfferTotal)+" · "+({exceeded:"Excede en "+money(cap.excess),within_limit:"Dentro del máximo",pending:"Pendiente: oferta incompleta"}[cap.status]||"Pendiente")),el("small",cap.document+" · "+cap.locator));}root.append(caps);}
 const footer=el("footer");
 if(draft.length&&!a.readOnly&&!scenario){const name=input("scenario-name","Nombre del escenario");name.value=scenarioName;name.maxLength=120;name.oninput=()=>scenarioName=name.value;name.setAttribute("aria-label","Nombre del escenario");footer.append(name,button("Guardar escenario",()=>mutate("finance_save_scenario",{calculationId:a.id,name:name.value,changes:draft,expectedUpdatedAt:a.updatedAt}),"primary"));}
 if(scenario&&!a.readOnly){if(scenario.status==="draft")footer.append(button("Aceptar cambios",()=>mutate("finance_accept_scenario",{calculationId:a.id,scenarioId:scenario.id,expectedUpdatedAt:a.updatedAt}),"primary"));if(scenario.status==="accepted")footer.append(button("Deshacer aceptación",()=>mutate("finance_undo_acceptance",{calculationId:a.id,scenarioId:scenario.id,acceptanceOperationId:scenario.acceptanceOperationId,expectedUpdatedAt:a.updatedAt})));}
 const telemetry=el("small");telemetry.id="view-telemetry";
 const updateTelemetry=()=>{telemetry.textContent="Vista "+(data.view?.version??"—")+" · "+(data.rows?.length||0)+" ítems visibles"+(data.timings?.serverMs!=null?" · Servidor "+data.timings.serverMs+" ms":"")+(lastRoundtripMs!=null?" · Ida/vuelta "+lastRoundtripMs+" ms":"")+(lastRenderFrameMs!=null?" · Render→frame "+lastRenderFrameMs+" ms":"");};
 updateTelemetry();footer.append(telemetry);root.append(footer);restoreUi(state);
 requestAnimationFrame(()=>{if(telemetry.isConnected){lastRenderFrameMs=Math.round(performance.now()-renderStarted);updateTelemetry();}});
}
async function poll() {
 if(!connected||pending||polling||document.visibilityState!=="visible")return;
 polling=true;
 try {const result=await serverTool("finance_get_view",{});if(!result.isError&&result.structuredContent&&("view" in result.structuredContent)&&JSON.stringify(result.structuredContent.view)!==JSON.stringify(data.view)){adopt(result.structuredContent);render();}}
 catch {/* Keep the last verified view visible during transient polling errors. */}
 finally {polling=false;}
}
app.ontoolresult=result=>{if(adopt(result.structuredContent)){notice="";noticeError=false;render();void publishContext();}};
app.onhostcontextchanged=ctx=>{if(ctx.theme)document.documentElement.dataset.theme=ctx.theme;};
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")poll();});
setInterval(poll,30000);
render();app.connect().then(()=>{connected=true;return call("finance_get_view",{},false);}).catch(()=>message("Abre esta mesa desde un cliente compatible con MCP Apps.",true));
