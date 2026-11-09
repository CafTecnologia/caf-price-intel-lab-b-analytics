"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { createAndExecute, resumeRun, saveRunReview } from "./_lib/run-actions";
import { useOdooLaunch, useWorkProfiles } from "./_lib/useWorkProfiles";
import {
  appPath,
  DEFAULT_PROVIDER,
  phaseLabel,
  candidatesForLaunch,
  resolveProfileForLaunch,
  type DriveFile,
  type ExecutionPhase,
  type WorkProfileRun
} from "./_lib/shared";

export default function EmployeeWorkPage() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { launch, connection, resolved } = useOdooLaunch(setError);
  const { profiles, runs, refresh } = useWorkProfiles(launch);

  const [selectedDriveIds, setSelectedDriveIds] = useState<string[]>([]);
  const [uploads, setUploads] = useState<File[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ExecutionPhase>("idle");
  const [nota, setNota] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(false);

  const driveFiles = useMemo(
    () => (launch?.drive?.files || []).filter((file: DriveFile) => !/\.ds_store$/i.test(file.name)),
    [launch?.drive?.files]
  );
  useEffect(() => { setSelectedDriveIds(driveFiles.map((file) => file.id)); }, [driveFiles]);

  const profile = useMemo(() => resolveProfileForLaunch(profiles, launch), [profiles, launch]);
  const candidatos = useMemo(() => candidatesForLaunch(profiles, launch), [profiles, launch]);
  const visibleRuns = useMemo(() => {
    if (!launch?.project) return activeRunId ? runs.filter((entry) => entry.id === activeRunId) : [];
    return profile ? runs.filter((entry) => entry.profileId === profile.id) : runs;
  }, [runs, profile, launch?.project, activeRunId]);
  const run = useMemo(
    () => visibleRuns.find((entry) => entry.id === activeRunId) || visibleRuns[0] || null,
    [visibleRuns, activeRunId]
  );

  const macroTask = launch?.project?.protocol?.currentMoment || "";
  const ctx = { connection, launch, setPhase, setNotice, refresh };
  const puedeAnalizar = Boolean(profile) && (selectedDriveIds.length > 0 || uploads.length > 0);

  async function guard(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setPhase("idle"); }
  }

  async function analizar() {
    if (!profile) { setError("Todavia no hay una automatizacion publicada para esta macrotarea."); return; }
    await guard(async () => {
      const id = await createAndExecute(ctx, {
        profile, providerId: DEFAULT_PROVIDER, uploads, driveFileIds: selectedDriveIds
      });
      setActiveRunId(id);
    });
  }

  const artifact = run?.finalArtifact;
  const viabilidad = artifact?.contract === "caf-project-viability-screen/v1" ? artifact : null;

  return <main className="caf-clean">
    <header>
      <span className="overline">{macroTask || "Apoyo IA"}</span>
      <h1>{launch?.project?.name || "Analisis sin proyecto vinculado"}</h1>
      <div className="dato">
        {launch?.project?.processNumber && <span>{launch.project.processNumber}</span>}
        {launch?.project?.entity && <span>{launch.project.entity}</span>}
        {launch?.project?.closingDate && <span>Cierre {launch.project.closingDate}</span>}
        {profile && <span>{profile.label}</span>}
      </div>
      {candidatos.length > 1 && <p className="nota" style={{ marginTop: ".5rem" }}>
        Hay {candidatos.length} automatizaciones publicadas para esta macrotarea. Se usa {profile?.label}.
      </p>}
    </header>

    {error && <p className="aviso">{error}</p>}
    {notice && <p className="aviso">{notice}</p>}

    {!run && <section className="bloque">
      {driveFiles.length > 0 ? <details>
        <summary>{selectedDriveIds.length} de {driveFiles.length} documentos del proyecto</summary>
        {driveFiles.map((file) => <label className="archivo" key={file.id}>
          <input
            type="checkbox"
            checked={selectedDriveIds.includes(file.id)}
            onChange={(event) => setSelectedDriveIds((current) =>
              event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))}
          />
          <span>{file.name}</span>
        </label>)}
      </details> : <>
        {resolved && launch && <p className="aviso">La carpeta del proyecto todavia no tiene documentos. Guarda ahi el pliego, los estudios previos y las adendas, y vuelve a pedir apoyo IA.</p>}
        {resolved && !launch && <p className="nota">Esta pantalla se abre desde la macrotarea del proyecto. Tambien puedes cargar documentos para una revision suelta.</p>}
        <label className="secundaria" style={{ marginTop: ".8rem" }}>
          Cargar documentos
          <input type="file" multiple hidden onChange={(event) => setUploads(Array.from(event.target.files || []))} />
        </label>
        {uploads.length > 0 && <p className="nota">{uploads.length} archivo(s): {uploads.map((f) => f.name).join(", ")}</p>}
      </>}

      <button className="accion" style={{ marginTop: "1.25rem" }} disabled={busy || !puedeAnalizar} onClick={() => void analizar()}>
        {busy ? <><LoaderCircle className="spin" size={17} /> {phaseLabel(phase)}</> : `Analizar ${(macroTask || "pre-evaluacion").toLowerCase()}`}
      </button>
      {busy && <p className="nota" style={{ marginTop: ".6rem" }}>{phaseLabel(phase)}. Puedes esperar aqui.</p>}
    </section>}

    {run && <Resultado
      run={run}
      busy={busy}
      nota={nota}
      corrigiendo={corrigiendo}
      onCorregir={() => setCorrigiendo((v) => !v)}
      onNota={setNota}
      onGuardar={(resuelta) => void guard(async () => {
        await saveRunReview(ctx, run.id, nota, resuelta);
        setCorrigiendo(false); setNota("");
      })}
      onReanudar={() => void guard(() => resumeRun(ctx, run.id))}
      onNuevo={() => { setActiveRunId(""); setNota(""); setCorrigiendo(false); }}
      viabilidad={viabilidad}
    />}

    {launch?.odooReturnUrl && <p><a className="secundaria" href={launch.odooReturnUrl}>Volver al proyecto</a></p>}
    <p className="nota"><Link href={appPath("/profiles/manage")}>Automatizaciones</Link></p>
  </main>;
}

type ResultadoProps = {
  run: WorkProfileRun;
  busy: boolean;
  nota: string;
  corrigiendo: boolean;
  viabilidad: { decision: string; summary: string; limitingRequirements?: unknown[]; missingInformation?: string[]; evidence?: unknown[] } | null;
  onCorregir: () => void;
  onNota: (value: string) => void;
  onGuardar: (resuelta: boolean) => void;
  onReanudar: () => void;
  onNuevo: () => void;
};

function Resultado({ run, busy, nota, corrigiendo, viabilidad, onCorregir, onNota, onGuardar, onReanudar, onNuevo }: ResultadoProps) {
  const enCurso = run.status === "running";
  const fallo = run.status === "failed";
  const limitantes = (viabilidad?.limitingRequirements || []) as Array<Record<string, string | undefined> & { evidence?: Array<Record<string, string>> }>;
  const faltantes = viabilidad?.missingInformation || [];
  const preparacion = run.skills.find((entry) => entry.kind === "document_map");

  const titulo = viabilidad?.decision === "viable" ? "Viable para continuar"
    : viabilidad?.decision === "not_viable" ? "No viable para continuar"
    : "Aun no se puede determinar";

  return <>
    <section className="bloque">
      {enCurso && <p className="estado"><LoaderCircle className="spin" size={16} /> Analizando los documentos del proyecto.</p>}

      {fallo && <>
        <p className="aviso">El analisis se interrumpio. Lo hecho hasta ahora se conservo.</p>
        <button className="accion" style={{ marginTop: ".9rem" }} disabled={busy} onClick={onReanudar}>Reanudar</button>
      </>}

      {viabilidad && <div className={`conclusion ${viabilidad.decision}`}>
        <span className="overline">Propuesta de la IA</span>
        <strong>{titulo}</strong>
        <p>{viabilidad.summary}</p>
      </div>}
    </section>

    {limitantes.length > 0 && <section className="bloque">
      <h2>Lo que cambia la decision</h2>
      {limitantes.map((entry, index) => {
        const cumple = String(entry.companyFit || "");
        const clase = cumple.includes("no") ? "no" : cumple.includes("unknown") || cumple.includes("missing") ? "duda" : "si";
        const marca = clase === "no" ? "✕" : clase === "duda" ? "?" : "✓";
        const fuente = entry.evidence?.[0];
        return <div className={`punto ${clase}`} key={String(entry.id || index)}>
          <span className="marca">{marca}</span>
          <span>{entry.title}</span>
          {fuente && <span className="fuente">{fuente.document}{fuente.location ? ` · ${fuente.location}` : ""}</span>}
        </div>;
      })}
    </section>}

    {faltantes.length > 0 && <section className="bloque">
      <h2>Falta comprobar</h2>
      {faltantes.map((entry) => <div className="punto duda" key={entry}><span className="marca">?</span><span>{entry}</span></div>)}
    </section>}

    {(viabilidad?.evidence?.length || preparacion) && <section className="bloque">
      {preparacion?.warnings?.length ? <p className="nota">{preparacion.warnings[0]}</p> : null}
      {viabilidad?.evidence?.length ? <details>
        <summary>Ver la evidencia citada</summary>
        {(viabilidad.evidence as Array<Record<string, string>>).map((entry, index) => <p className="nota" key={`${entry.document}-${index}`}>
          <strong>{entry.document}</strong> · {entry.location}<br />{entry.excerpt}
        </p>)}
      </details> : null}
    </section>}

    {!enCurso && <section className="bloque">
      <div className="fila-acciones">
        <button className="secundaria" disabled={busy} onClick={() => onGuardar(true)}>Aprobar</button>
        <button className="secundaria" onClick={onCorregir}>{corrigiendo ? "Cancelar" : "Corregir"}</button>
        <button className="secundaria" onClick={onNuevo}>Analizar de nuevo</button>
      </div>
      {corrigiendo && <div style={{ marginTop: ".9rem" }}>
        <textarea value={nota} onChange={(event) => onNota(event.target.value)} placeholder="Que esta mal o que falta. Tu correccion se guarda sin borrar lo que propuso la IA." />
        <div className="fila-acciones" style={{ marginTop: ".6rem" }}>
          <button className="secundaria" disabled={busy || !nota.trim()} onClick={() => onGuardar(false)}>Guardar observacion</button>
        </div>
      </div>}
      {run.review && <p className="nota" style={{ marginTop: ".7rem" }}>
        Revision {run.review.status === "resolved" ? "resuelta" : "abierta"} · {new Date(run.review.updatedAt).toLocaleString("es-CO", { timeZone: "America/Bogota", hourCycle: "h23" })}
      </p>}
    </section>}
  </>;
}
