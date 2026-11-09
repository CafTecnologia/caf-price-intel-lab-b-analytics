"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { createAndExecute } from "../_lib/run-actions";
import { useProviders, useWorkProfiles } from "../_lib/useWorkProfiles";
import {
  appPath,
  decisionLabel,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROVIDER,
  phaseLabel,
  statusLabel,
  type ExecutionPhase,
  type ProviderId
} from "../_lib/shared";

export default function ProfileLabPage() {
  const { profiles, runs, testCases, refresh } = useWorkProfiles(null, { withTestCases: true });
  const { providers, providersLoaded } = useProviders();
  const [profileId, setProfileId] = useState(DEFAULT_PROFILE_ID);
  const [providerId, setProviderId] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [testCaseId, setTestCaseId] = useState("");
  const [uploads, setUploads] = useState<File[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ExecutionPhase>("idle");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const profile = useMemo(() => profiles.find((entry) => entry.id === profileId) || null, [profiles, profileId]);
  const visibleRuns = useMemo(() => runs.filter((entry) => entry.profileId === profileId), [runs, profileId]);
  const run = useMemo(() => visibleRuns.find((e) => e.id === activeRunId) || visibleRuns[0] || null, [visibleRuns, activeRunId]);
  const caso = useMemo(() => testCases.find((entry) => entry.id === testCaseId) || null, [testCases, testCaseId]);
  const proveedor = useMemo(() => providers.find((entry) => entry.provider.id === providerId) || null, [providers, providerId]);

  const ctx = { connection: null, launch: null, setPhase, setNotice: setAviso, refresh };

  async function correr() {
    if (!profile) { setError("Elige una automatizacion."); return; }
    setBusy(true); setError(""); setAviso("");
    try {
      const id = await createAndExecute(ctx, { profile, providerId, uploads, driveFileIds: [], testCaseId: testCaseId || undefined });
      setActiveRunId(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setPhase("idle"); }
  }

  const artifact = run?.finalArtifact;
  const viabilidad = artifact?.contract === "caf-project-viability-screen/v1" ? artifact : null;
  const coincide = caso && viabilidad ? viabilidad.decision === caso.expectedDecision : null;

  return <main className="caf-clean">
    <header>
      <span className="overline">Laboratorio</span>
      <h1>Probar una automatizacion</h1>
      <p className="nota" style={{ marginTop: ".5rem" }}>Corre casos reales contra su resultado esperado. No afecta el trabajo de nadie.</p>
    </header>

    {error && <p className="aviso">{error}</p>}
    {aviso && <p className="aviso">{aviso}</p>}

    <section className="bloque">
      <span className="overline">Automatizacion</span>
      <div className="fila-acciones" style={{ marginTop: ".45rem" }}>
        {profiles.map((entry) => <button key={entry.id} className="secundaria"
          style={entry.id === profileId ? { borderColor: "var(--acento)", color: "var(--acento)" } : undefined}
          onClick={() => setProfileId(entry.id)}>{entry.label}</button>)}
      </div>
      {profile && <p className="nota" style={{ marginTop: ".6rem" }}>{profile.objective}</p>}
    </section>

    <section className="bloque">
      <span className="overline">Modelo</span>
      <div className="fila-acciones" style={{ marginTop: ".45rem" }}>
        {providers.map((entry) => <button key={entry.provider.id} className="secundaria"
          style={entry.provider.id === providerId ? { borderColor: "var(--acento)", color: "var(--acento)" } : undefined}
          onClick={() => setProviderId(entry.provider.id as ProviderId)}>
          {entry.provider.label}{entry.ok ? "" : " ·"}
        </button>)}
      </div>
      {providersLoaded && !providers.length && <p className="nota">No hay proveedores configurados.</p>}
      {proveedor && !proveedor.ok && <p className="aviso" style={{ marginTop: ".6rem" }}>
        <strong>{proveedor.diagnostic?.title}</strong><br />{proveedor.diagnostic?.detail}
        {proveedor.diagnostic?.userAction ? <><br />{proveedor.diagnostic.userAction}</> : null}
      </p>}
    </section>

    <section className="bloque">
      <span className="overline">Caso</span>
      <div style={{ marginTop: ".45rem" }}>
        {testCases.map((entry) => <label className="archivo" key={entry.id}>
          <input type="radio" name="caso" disabled={!entry.ready} checked={testCaseId === entry.id}
            onChange={() => { setTestCaseId(entry.id); setUploads([]); }} />
          <span style={{ flex: 1 }}>{entry.label}</span>
          <span className="overline">{entry.ready ? `${entry.fileCount} docs` : "no disponible"}</span>
        </label>)}
      </div>
      {caso && <p className="nota" style={{ marginTop: ".6rem" }}>
        {caso.processNumber} · control: {decisionLabel(caso.expectedDecision)} — {caso.expectedReason}
      </p>}
      <label className="secundaria" style={{ marginTop: ".8rem" }}>
        O cargar documentos
        <input type="file" multiple hidden onChange={(e) => { setUploads(Array.from(e.target.files || [])); setTestCaseId(""); }} />
      </label>
      {uploads.length > 0 && <p className="nota">{uploads.length} archivo(s)</p>}
    </section>

    <section className="bloque">
      <button className="accion" disabled={busy || !profile || (!uploads.length && !testCaseId)} onClick={() => void correr()}>
        {busy ? <><LoaderCircle className="spin" size={17} /> {phaseLabel(phase)}</> : "Ejecutar prueba"}
      </button>
    </section>

    {run && <section className="bloque">
      <span className="overline">Resultado · {statusLabel(run.status)}</span>
      {viabilidad && <div className={`conclusion ${viabilidad.decision}`} style={{ marginTop: ".5rem" }}>
        <strong>{decisionLabel(viabilidad.decision)}</strong>
        <p>{viabilidad.summary}</p>
      </div>}
      {coincide !== null && <p className="nota" style={{ marginTop: ".7rem" }}>
        {coincide ? "Coincide con el control." : `No coincide: obtuvo ${decisionLabel(viabilidad!.decision)} y el control dice ${decisionLabel(caso!.expectedDecision)}.`}
      </p>}
      <details style={{ marginTop: ".6rem" }}>
        <summary>Traza tecnica</summary>
        {run.skills.map((skill, index) => <p className="nota" key={`${skill.skillId}-${index}`}>
          {skill.skillId} · {statusLabel(skill.status)}{skill.error ? ` · ${skill.error}` : ""}
          {skill.warnings?.length ? <><br />{skill.warnings[0]}</> : null}
        </p>)}
        {run.documents.map((doc) => <p className="nota" key={doc.id}>{doc.name} · {doc.parser} · {doc.contentState}</p>)}
      </details>
      {visibleRuns.length > 1 && <details>
        <summary>Corridas anteriores</summary>
        {visibleRuns.map((entry) => <button className="archivo" key={entry.id} onClick={() => setActiveRunId(entry.id)}
          style={{ width: "100%", textAlign: "left", background: "none", border: 0, borderBottom: "1px solid var(--linea)", cursor: "pointer" }}>
          <span style={{ flex: 1 }}>{new Date(entry.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota", hourCycle: "h23" })}</span>
          <span className="overline">{statusLabel(entry.status)}</span>
        </button>)}
      </details>}
    </section>}

    <p className="nota"><Link href={appPath("/profiles")}>Volver al trabajo</Link> · <Link href={appPath("/profiles/manage")}>Automatizaciones</Link></p>
  </main>;
}
