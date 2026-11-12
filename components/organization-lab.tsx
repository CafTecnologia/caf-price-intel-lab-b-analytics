 "use client";
import React, {useState} from "react";
import type { FinancialOfferProject } from "../lib/contract";
import { buildSimulation, buildInitialOfferControls } from "../lib/financial-engine";
import { UnifiedItemDetail } from "./unified-item-detail";
type Case = {run_id:string; baseline:FinancialOfferProject; candidate:FinancialOfferProject};
export function OrganizationLab({cases}: {cases: Case[]}) {
 const [caseIndex,setCaseIndex]=useState(0);
 const [mode,setMode]=useState<"baseline"|"candidate">("candidate");
 const [index,setIndex]=useState(0);
 const selected=cases[caseIndex]; const project=selected[mode];
 const simulation=buildSimulation(project,buildInitialOfferControls(project));
 return <section className="organization-lab">
  <h1>Finanzas · ensayo temporal DEV</h1>
  <p>26 entregas originales del skill · 628 renglones · sin ajustes posteriores de Carlos.</p>
  <p><strong>26 de 26 conservan todos sus datos financieros y el resultado completo del cálculo.</strong></p>
  <p>La versión nueva añade organización y trazabilidad. Las entregas antiguas no incluyen los encabezados completos ni una composición explícita; no se reconstruyen automáticamente.</p>
  <div style={{display:"flex",gap:16,flexWrap:"wrap",margin:"20px 0"}}>
   <label>Entrega <select aria-label="Entrega original" value={caseIndex} onChange={e=>{setCaseIndex(Number(e.target.value));setIndex(0);}}>{cases.map((c,i)=><option key={c.run_id} value={i}>{i+1}. {c.run_id.replace("odoo:CafTest:project:","Proyecto ")} · {c.candidate.items.length} renglones</option>)}</select></label>
   <label>Versión <select aria-label="Versión de recepción" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="baseline">Original</option><option value="candidate">Contrato nuevo</option></select></label>
  </div>
  <p>Consulta de comparación: los controles de escritura están ocultos en esta vista.</p>
  <div className="lab-comparison-detail"><UnifiedItemDetail item={project.items[index]} row={simulation.rows[index]} index={index} count={project.items.length} onNavigate={setIndex} onClose={()=>{}} onEdit={()=>{}} onAddCost={()=>{}} onSetManualCost={()=>{}} onSetAdditionalCost={()=>{}} onUpdateAdditionalCost={()=>{}} onRemoveAdditionalCost={()=>{}} /></div>
  <style>{".lab-comparison-detail .unified-detail-actions,.lab-comparison-detail .unified-working-cost>button,.lab-comparison-detail .unified-associated-price button{display:none}"}</style>
 </section>;
}
