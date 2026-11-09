"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import {
  changeWorkProfileOutputContract,
  createWorkProfileDraftFromDocumentFoundation,
  type WorkProfileOutputContractId
} from "@/lib/work-profile-contract";
import { BUILTIN_WORK_PROTOCOLS, type WorkProtocolDefinition } from "@/lib/work-protocol-catalog";
import { useWorkProfiles } from "../_lib/useWorkProfiles";
import { appPath, DEFAULT_PROVIDER, type WorkProfile } from "../_lib/shared";

const LINEAS = (valor: string) => valor.split("\n").map((entry) => entry.trim()).filter(Boolean);

export default function ManageProfilesPage() {
  const { profiles, refresh } = useWorkProfiles(null);
  const [draft, setDraft] = useState<WorkProfile | null>(null);
  const [modo, setModo] = useState<"crear" | "editar">("editar");
  const [mensaje, setMensaje] = useState("");
  const [propuesta, setPropuesta] = useState<{ summary?: string; risks?: string[]; proposedProfile?: WorkProfile } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const protocolos = useMemo(() => [...new Map(BUILTIN_WORK_PROTOCOLS.map((e) => [e.id, e])).values()], []);
  const secuencia = useMemo(
    () => (draft?.skills || []).filter((skill) => skill.kind !== "document_map"),
    [draft?.skills]
  );

  function nuevo() {
    setDraft(createWorkProfileDraftFromDocumentFoundation());
    setModo("crear"); setMensaje(""); setPropuesta(null); setError(""); setAviso("");
  }

  function abrir(entry: WorkProfile) {
    setDraft(structuredClone(entry));
    setModo("editar"); setMensaje(""); setPropuesta(null); setError(""); setAviso("");
  }

  function set<K extends keyof WorkProfile>(campo: K, valor: WorkProfile[K]) {
    if (!draft) return;
    setDraft({ ...draft, [campo]: valor });
  }

  async function pedirPropuesta() {
    if (!draft || !mensaje.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(appPath("/api/work-profiles/assist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft, message: mensaje, providerId: DEFAULT_PROVIDER })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "El asistente no pudo preparar la propuesta.");
      setPropuesta(data.proposal);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function guardar(publicar: boolean) {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(appPath("/api/work-profiles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft, publish: publicar })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
      setDraft(data.profile); setModo("editar"); setPropuesta(null);
      await refresh();
      setAviso(publicar ? "Publicada. Ya puede usarse desde la macrotarea." : "Borrador guardado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const protocolo = protocolos.find((entry) => entry.id === draft?.protocolScope?.protocolId);

  return <main className="caf-clean">
    <header>
      <span className="overline">Automatizaciones</span>
      <h1>{draft ? (draft.label || "Nueva automatizacion") : "Ensenarle a la IA"}</h1>
      {!draft && <p className="nota" style={{ marginTop: ".5rem" }}>
        Cada automatizacion resuelve una macrotarea. Describila en tus palabras: el sistema arma los pasos.
      </p>}
    </header>

    {error && <p className="aviso">{error}</p>}
    {aviso && <p className="aviso">{aviso}</p>}

    {!draft && <section className="bloque">
      {profiles.map((entry) => <button className="archivo" key={entry.id} onClick={() => abrir(entry)}
        style={{ width: "100%", textAlign: "left", background: "none", border: 0, borderBottom: "1px solid var(--linea)", cursor: "pointer" }}>
        <span style={{ flex: 1 }}>{entry.label}</span>
        <span className="overline">{entry.status === "published" ? "publicada" : "borrador"}</span>
      </button>)}
      <button className="accion" style={{ marginTop: "1.25rem" }} onClick={nuevo}>Crear automatizacion</button>
    </section>}

    {draft && <>
      <section className="bloque">
        <Pregunta n={1} titulo="Que trabajo debe resolver">
          <textarea value={draft.objective} onChange={(e) => set("objective", e.target.value)}
            placeholder="Decidir si vale la pena preparar oferta para un proceso de minima cuantia." />
        </Pregunta>

        <Pregunta n={2} titulo="Que documentos consulta">
          <textarea value={draft.documentGuidance || ""} onChange={(e) => set("documentGuidance", e.target.value)}
            placeholder="Pliego definitivo, estudios previos, adendas y anexos tecnicos de la carpeta del proyecto." />
        </Pregunta>

        <Pregunta n={3} titulo="Como se reconoce una respuesta correcta">
          <textarea value={(draft.successCriteria || []).join("\n")} onChange={(e) => set("successCriteria", LINEAS(e.target.value))}
            placeholder={"Una condicion por linea.\nCada afirmacion cita documento, pagina y texto literal."} />
        </Pregunta>

        <Pregunta n={4} titulo="Que nunca debe hacer">
          <textarea value={draft.guardrails.join("\n")} onChange={(e) => set("guardrails", LINEAS(e.target.value))}
            placeholder={"Una regla por linea.\nSuponer capacidades de CAF que no esten en el conocimiento empresarial."} />
        </Pregunta>

        <Pregunta n={5} titulo="Que resultado entrega">
          <div className="fila-acciones">
            {([
              ["caf-project-viability-screen/v1", "Una decision: viable, no viable o sin determinar"],
              ["caf-project-initial-assessment/v1", "Un informe estructurado del proceso"]
            ] as Array<[WorkProfileOutputContractId, string]>).map(([id, texto]) => <button
              key={id}
              className="secundaria"
              style={draft.outputContract.id === id ? { borderColor: "var(--acento)", color: "var(--acento)" } : undefined}
              onClick={() => draft.outputContract.id !== id && setDraft(changeWorkProfileOutputContract(draft, id))}
            >{texto}</button>)}
          </div>
        </Pregunta>
      </section>

      <section className="bloque">
        <h2>En que macrotarea ayuda</h2>
        <div className="fila-acciones">
          <button className="secundaria" style={!draft.protocolScope ? { borderColor: "var(--acento)", color: "var(--acento)" } : undefined}
            onClick={() => set("protocolScope", undefined)}>Sin macrotarea</button>
          {protocolos.map((entry) => <button key={entry.id} className="secundaria"
            style={draft.protocolScope?.protocolId === entry.id ? { borderColor: "var(--acento)", color: "var(--acento)" } : undefined}
            onClick={() => set("protocolScope", { protocolId: entry.id, protocolName: entry.label, macroStages: [] })}>{entry.label}</button>)}
        </div>
        {protocolo && <div style={{ marginTop: ".8rem" }}>
          {protocolo.macroStages.map((stage) => {
            const marcada = draft.protocolScope?.macroStages.some((e) => e.id === stage.id) || false;
            return <label className="archivo" key={stage.id}>
              <input type="checkbox" checked={marcada} onChange={(event) => {
                const actuales = draft.protocolScope?.macroStages || [];
                const macroStages = event.target.checked
                  ? [...actuales.filter((e) => e.id !== stage.id), stage]
                  : actuales.filter((e) => e.id !== stage.id);
                set("protocolScope", { protocolId: protocolo.id, protocolName: protocolo.label, macroStages });
              }} />
              <span>{stage.label}</span>
            </label>;
          })}
        </div>}
      </section>

      <section className="bloque">
        <h2>Lo que hara, en orden</h2>
        <ol className="nota" style={{ paddingLeft: "1.2rem", margin: 0 }}>
          <li>Preparar documentos <span className="overline">lo hace el sistema</span></li>
          {secuencia.map((skill) => <li key={skill.id}>{skill.label}</li>)}
        </ol>
      </section>

      <section className="bloque">
        <h2>Disenalo conmigo</h2>
        <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)}
          placeholder="Explica en lenguaje normal que deberia hacer distinto." />
        <div className="fila-acciones" style={{ marginTop: ".6rem" }}>
          <button className="secundaria" disabled={busy || !mensaje.trim()} onClick={() => void pedirPropuesta()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : null} Pedir propuesta
          </button>
        </div>
        {propuesta && <div style={{ marginTop: ".8rem" }}>
          <p className="nota">{propuesta.summary}</p>
          {propuesta.risks?.map((risk) => <p className="nota" key={risk}>Riesgo: {risk}</p>)}
          {propuesta.proposedProfile && <button className="secundaria" onClick={() => {
            const p = propuesta.proposedProfile!;
            setDraft({ ...p, status: "draft", version: modo === "crear" ? 1 : p.version });
            setPropuesta(null);
          }}>Aplicar al borrador</button>}
        </div>}
      </section>

      <section className="bloque">
        <details>
          <summary>Configuracion avanzada</summary>
          <label className="nota" style={{ display: "block", marginTop: ".7rem" }}>
            Nombre
            <input value={draft.label} onChange={(e) => set("label", e.target.value)}
              style={{ width: "100%", marginTop: ".3rem", padding: ".6rem .7rem", border: "1px solid var(--linea)", borderRadius: "8px", font: "inherit" }} />
          </label>
          <p className="nota" style={{ marginTop: ".9rem" }}>
            Pasos generados: {secuencia.map((s) => s.label).join(" · ") || "ninguno"}
          </p>
          <p className="nota">Contrato de salida: {draft.outputContract.id}</p>
        </details>
      </section>

      <section className="bloque">
        <div className="fila-acciones">
          <button className="secundaria" disabled={busy} onClick={() => void guardar(false)}>Guardar borrador</button>
          <button className="accion" style={{ width: "auto" }} disabled={busy} onClick={() => void guardar(true)}>Publicar</button>
          <button className="secundaria" onClick={() => setDraft(null)}>Volver</button>
        </div>
      </section>
    </>}

    <p className="nota"><Link href={appPath("/profiles")}>Volver al trabajo</Link> · <Link href={appPath("/profiles/lab")}>Laboratorio</Link></p>
  </main>;
}

function Pregunta({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: "1.6rem" }}>
    <span className="overline">{n} · {titulo}</span>
    <div style={{ marginTop: ".45rem" }}>{children}</div>
  </div>;
}
