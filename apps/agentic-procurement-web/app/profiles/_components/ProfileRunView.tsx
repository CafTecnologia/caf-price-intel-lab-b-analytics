"use client";

import { useEffect, useState } from "react";
import { Beaker, CheckCircle2, LoaderCircle, Play } from "lucide-react";
import { decisionLabel, statusLabel, type TestCase, type WorkProfile, type WorkProfileRun } from "../_lib/shared";

type Mode = "employee" | "lab";

type Props = {
  run: WorkProfileRun;
  profile?: WorkProfile;
  testCase?: TestCase | null;
  busy: boolean;
  mode: Mode;
  onResume: () => void;
  onReview: (note: string, resolved: boolean) => void;
};

export function ProfileRunView({ run, profile, testCase, busy, mode, onResume, onReview }: Props) {
  const artifact = run.finalArtifact;
  const comparableTestCase = testCase?.processNumber === run.project.processNumber ? testCase : null;
  const failedSkill = run.skills.find((skill) => skill.status === "failed");
  const skillLabels = new Map(profile?.skills.map((skill) => [skill.id, skill.label]) || []);
  const [reviewNote, setReviewNote] = useState(run.review?.note || "");
  useEffect(() => setReviewNote(run.review?.note || ""), [run.id, run.review?.note]);

  return <section className="profile-card profile-result">
    <div className="profile-card-title">
      <div>
        <span className="eyebrow">RESULTADO</span>
        <h2>{run.status === "running" ? "Analisis en curso" : run.status === "completed" ? "Analisis terminado y validado" : run.status === "needs_review" ? "Ejecucion terminada; requiere revision" : run.status === "failed" ? "Ejecucion interrumpida" : "Ejecucion preparada"}</h2>
      </div>
      <span className={`profile-status ${run.status}`}>{statusLabel(run.status)}</span>
    </div>

    <div className="skill-progress">{run.skills.map((skill, index) => <div key={`${skill.skillId}-${index}`} className={skill.status}><span>{index + 1}</span><strong>{skillLabels.get(skill.skillId) || skill.skillId.replace(/_/g, " ")}</strong><small>{statusLabel(skill.status)}</small></div>)}</div>

    {failedSkill && <div className="profile-resume"><span><strong>Se conservo lo anterior.</strong><small>El reintento continuara desde {skillLabels.get(failedSkill.skillId) || failedSkill.skillId.replace(/_/g, " ")}.</small></span><button className="button primary compact" disabled={busy} onClick={onResume}>{busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} Reanudar</button></div>}

    {!artifact && <p className="muted">{run.status === "running" ? "Las skills estan procesando documentos y guardando sus resultados." : "Inicia la ejecucion para obtener el informe."}</p>}

    {artifact?.contract === "caf-project-initial-assessment/v1" && <>
      <div className="artifact-summary"><strong>{artifact.executiveSummary}</strong><span>{artifact.relevantRequirements.length} requisitos relevantes - {artifact.requestedScope.length} items - {artifact.humanQuestions.length} preguntas</span></div>
      <div className="artifact-columns">
        <section><h3>Requisitos que merecen atencion</h3>{artifact.relevantRequirements.length ? artifact.relevantRequirements.map((entry) => <article key={entry.id}><span className={`confidence ${entry.confidence}`}>{entry.confidence}</span><strong>{entry.title}</strong><p>{entry.requirement}</p><small>{entry.evidence[0]?.document} - {entry.evidence[0]?.location}</small></article>) : <p className="muted">No se encontraron requisitos sustentados para destacar.</p>}</section>
        <section><h3>Preguntas y faltantes</h3>{[...artifact.humanQuestions, ...artifact.missingInformation].length ? [...artifact.humanQuestions, ...artifact.missingInformation].map((entry) => <p className="artifact-question" key={entry}>{entry}</p>) : <p className="muted">No quedan preguntas abiertas.</p>}</section>
      </div>
      <details className="artifact-detail"><summary>Ver documentos, alcance y estructura economica</summary><h3>Autoridad documental</h3>{artifact.documentAuthority.map((entry) => <p key={`${entry.document}-${entry.role}`}><strong>{entry.document}</strong> - {entry.role} - {entry.authority}</p>)}<h3>Alcance solicitado ({artifact.requestedScope.length})</h3><div className="artifact-items">{artifact.requestedScope.map((entry, index) => <div key={`${entry.item}-${index}`}><span>{entry.lot || "-"}</span><span>{entry.item || index + 1}</span><strong>{entry.description}</strong><span>{entry.quantity || "-"} {entry.unit || ""}</span><span>{entry.ceilingPrice || "Sin precio"}</span></div>)}</div><h3>Estructura economica</h3><pre>{JSON.stringify(artifact.economicStructure, null, 2)}</pre></details>
    </>}

    {artifact?.contract === "caf-project-viability-screen/v1" && <>
      <section className={`viability-decision ${artifact.decision}`}>
        <span className="eyebrow">PRE-EVALUACION</span>
        <strong>{artifact.decision === "viable" ? "Viable para continuar" : artifact.decision === "not_viable" ? "No viable para continuar" : "Aun no se puede determinar"}</strong>
        <p>{artifact.summary}</p>
      </section>
      {mode === "lab" && comparableTestCase && <div className={`test-verdict ${artifact.decision === comparableTestCase.expectedDecision ? "match" : "mismatch"}`}><Beaker size={16} /><span><strong>{artifact.decision === comparableTestCase.expectedDecision ? "La prueba coincide con el control" : "La prueba requiere diagnostico"}</strong><small>Obtenido: {decisionLabel(artifact.decision)} · Control: {decisionLabel(comparableTestCase.expectedDecision)}</small></span></div>}
      {artifact.limitingRequirements.length > 0 && <section className="viability-limiters"><h3>Requisitos que cambian la decision</h3>{artifact.limitingRequirements.map((entry) => <article key={entry.id}><span className={`confidence ${entry.companyFit}`}>{entry.companyFit.replace(/_/g, " ")}</span><strong>{entry.title}</strong><p>{entry.requirement}</p><small>{entry.evidence[0]?.document} - {entry.evidence[0]?.location}</small></article>)}</section>}
      {artifact.missingInformation.length > 0 && <section className="viability-missing"><h3>Falta comprobar</h3>{artifact.missingInformation.map((entry) => <p key={entry}>{entry}</p>)}</section>}
      <details className="artifact-detail"><summary>Ver condiciones, novedades y evidencia</summary>{artifact.conditions.length > 0 && <><h3>Condiciones</h3>{artifact.conditions.map((entry) => <p key={entry}>{entry}</p>)}</>}{artifact.chatterSignals.length > 0 && <><h3>Novedades del proyecto</h3>{artifact.chatterSignals.map((entry, index) => <p key={`${entry.at}-${index}`}><strong>{entry.author || "Chatter"}</strong> - {entry.at || "sin fecha"}<br />{entry.text}<br /><small>{entry.relevance}</small></p>)}</>}{artifact.evidence.length > 0 && <><h3>Evidencia de la decision</h3>{artifact.evidence.map((entry, index) => <p key={`${entry.document}-${index}`}><strong>{entry.document}</strong> - {entry.location}<br />{entry.excerpt}</p>)}</>}</details>
    </>}

    {run.status === "needs_review" && <section className="profile-human-review"><div><h3>Revision humana</h3><p>Registra la conclusion sin sobrescribir lo que produjo la IA.</p></div><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Que esta bien, que falta o que debe corregirse..." /><div className="profile-review-actions"><button className="button secondary compact" disabled={busy || !reviewNote.trim()} onClick={() => onReview(reviewNote, false)}>Guardar observacion</button><button className="button primary compact" disabled={busy || !reviewNote.trim()} onClick={() => onReview(reviewNote, true)}><CheckCircle2 size={15} /> Marcar revision resuelta</button></div>{run.review && <small>Estado humano: {run.review.status === "resolved" ? "resuelta" : "abierta"} - actualizado {new Date(run.review.updatedAt).toLocaleString("es-CO", { timeZone: "America/Bogota", hourCycle: "h23" })}</small>}</section>}

    {mode === "lab" && <details className="technical-profile-log"><summary>Ver catalogo documental y traza tecnica</summary><h3>Catalogo documental reutilizable</h3>{run.documents.map((document) => <article key={document.id}><strong>{document.name}</strong><span>{document.parser} - {document.pageCount ? `${document.pageCount} pagina(s) - ` : ""}{document.itemCandidates} candidato(s) - {document.contentState || "sin estado"}</span>{document.warnings.map((warning) => <p key={warning}>{warning}</p>)}</article>)}<h3>Skills</h3>{run.skills.map((skill) => <article key={skill.skillId}><strong>{skill.skillId}</strong><span>{statusLabel(skill.status)} - {skill.promptHash.slice(0, 10)}</span>{skill.warnings.map((warning) => <p key={warning}>{warning}</p>)}{skill.error && <p>{skill.error}</p>}</article>)}</details>}
  </section>;
}
