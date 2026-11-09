"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./lab-stage3.module.css";

type JsonRecord = Record<string, unknown>;

type ModelOption = { value: string; label: string };

type LabConfig = {
  fixturePath: string;
  stage2Json: unknown;
  prompt: string;
  finalPrompt?: string;
  defaultModels: { google: string; supervisor: string; urlContext: string };
  models: { google: ModelOption[]; supervisor: ModelOption[]; urlContext: ModelOption[] };
};

type Notice = { type: "ok" | "warn" | "error"; text: string } | null;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getItems(result: unknown): JsonRecord[] {
  if (!isRecord(result) || !Array.isArray(result.items)) return [];
  return result.items.filter(isRecord);
}

function quoteFor(item: JsonRecord): JsonRecord | null {
  const quotes = item["Cotizaciones encontradas"];
  return Array.isArray(quotes) && isRecord(quotes[0]) ? quotes[0] : null;
}

function sourceIdFor(item: JsonRecord, index: number) {
  const key = text(item["Consecutivo interno"]) || text(item["No. item"]) || String(index + 1);
  return `${key}#1`;
}

function sourceInfo(item: JsonRecord) {
  const quote = quoteFor(item);
  const fuente = quote && isRecord(quote.fuente) ? quote.fuente : {};
  const precio = quote && isRecord(quote.precio) ? quote.precio : {};
  const defensa = quote && isRecord(quote.defensa) ? quote.defensa : {};
  return {
    proveedor: text(fuente.nombre) || text(quote?.proveedor),
    url: text(fuente.url) || text(quote?.url),
    precio: text(precio.texto_original) || text(precio.valor) || text(quote?.precio),
    moneda: text(precio.moneda) || text(quote?.moneda),
    notas: text(defensa.justificacion) || text(quote?.evidencia_corta)
  };
}

function validationMap(value: unknown) {
  const result = isRecord(value) && isRecord(value.result) ? value.result : value;
  const fuentes = isRecord(result) && Array.isArray(result.fuentes) ? result.fuentes.filter(isRecord) : [];
  return new Map(fuentes.map((row) => [text(row.sourceId), row]));
}

function supervisorMap(value: unknown) {
  const supervision = isRecord(value) && isRecord(value.supervision) ? value.supervision : null;
  const fuentes = supervision && Array.isArray(supervision.fuentes) ? supervision.fuentes.filter(isRecord) : [];
  return new Map(fuentes.map((row) => [text(row.sourceId), row]));
}

function evidenceMap(value: unknown) {
  const evidence = isRecord(value) && Array.isArray(value.evidence) ? value.evidence.filter(isRecord) : [];
  return new Map(evidence.map((row) => [text(row.sourceId), row]));
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }
  if (!res.ok) {
    const message = isRecord(data) ? text(data.error) || text(data.diagnostic) || raw : raw;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return data;
}

export default function LabStage3Client() {
  const [config, setConfig] = useState<LabConfig | null>(null);
  const [stage2Text, setStage2Text] = useState("");
  const [prompt, setPrompt] = useState("");
  const [googleModel, setGoogleModel] = useState("gemini:gemini-3.5-flash");
  const [urlContextModel, setUrlContextModel] = useState("gemini:gemini-3.5-flash");
  const [supervisorModel, setSupervisorModel] = useState("deepseek:deepseek-v4-pro");
  const [maxSources, setMaxSources] = useState(12);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [runId, setRunId] = useState(`human-lab-${Date.now()}`);
  const [googleResult, setGoogleResult] = useState<JsonRecord | null>(null);
  const [urlContext, setUrlContext] = useState<JsonRecord | null>(null);
  const [linkEvidence, setLinkEvidence] = useState<JsonRecord | null>(null);
  const [domainEvidence, setDomainEvidence] = useState<JsonRecord | null>(null);
  const [supervisor, setSupervisor] = useState<JsonRecord | null>(null);
  const [master, setMaster] = useState<JsonRecord | null>(null);
  const [conversationResult, setConversationResult] = useState<JsonRecord | null>(null);

  useEffect(() => {
    fetch("/api/stage3/human-lab")
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "No se pudo cargar laboratorio.");
        setConfig(data);
        setStage2Text(JSON.stringify(data.stage2Json, null, 2));
        setPrompt(data.prompt || "");
        setGoogleModel(data.defaultModels.google);
        setUrlContextModel(data.defaultModels.urlContext);
        setSupervisorModel(data.defaultModels.supervisor);
      })
      .catch((error) => setNotice({ type: "error", text: error instanceof Error ? error.message : String(error) }));
  }, []);

  const stage2Json = useMemo(() => {
    try {
      return JSON.parse(stage2Text);
    } catch {
      return null;
    }
  }, [stage2Text]);

  const finalPrompt = useMemo(() => {
    if (!stage2Json) return prompt;
    const parsedItems = getItems(stage2Json).map((item, index) => {
      const itemKey = text(item["Consecutivo interno"]) || text(item["No. item"]) || String(index + 1);
      return [
        `ITEM ${itemKey}`,
        `Nombre: ${text(item["Nombre o descripcion"]) || text(item["Nombre o descripci?n"])}`,
        `Descripcion: ${text(item["Detalles o ficha tecnica"]) || text(item["Detalles o ficha t?cnica"])}`,
        `Und de medida: ${text(item["Und de medida"])}`,
        `Cant: ${text(item.Cant)}`,
        `Precio techo unitario: ${text(item["Precio techo encontrado"])}`,
        "",
        "Lectura tecnica:",
        `Tipo de ficha: ${text(item["Tipo de ficha"])}`,
        `Resumen comprable: ${text(item["Resumen comprable"]) || text(item["Nota tecnica para cotizacion"])}`,
        `Atributos obligatorios: ${JSON.stringify(item["Atributos obligatorios"] ?? item["Atributos criticos"] ?? "")}`,
        `Guia para busqueda: ${JSON.stringify(item["Guia para cotizacion"] ?? item["Guia para busqueda"] ?? "")}`
      ].join("\n");
    }).join("\n\n");
    return [
      prompt.trim(),
      "",
      "## Items a evaluar",
      "",
      "A continuacion vienen los items de la etapa a evaluar. Usa sus datos originales y su lectura tecnica como fuente principal para decidir la busqueda.",
      "",
      parsedItems
    ].join("\n");
  }, [prompt, stage2Json]);

  const items = getItems(googleResult?.result);
  const validations = validationMap(urlContext);
  const supervisions = supervisorMap(supervisor);
  const linkEvidences = evidenceMap(linkEvidence);
  const domainEvidences = evidenceMap(domainEvidence);

  async function runStep<T>(name: string, action: () => Promise<T>, okText: string) {
    setBusy(name);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ type: "ok", text: okText });
      return result;
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function runGoogle() {
    if (!stage2Json) {
      setNotice({ type: "error", text: "El JSON de datos no es v?lido." });
      return null;
    }
    return runStep("google", async () => {
      const data = await postJson("/api/stage3/google-lab", {
        stage2Json,
        model: googleModel,
        runId,
        promptOverride: finalPrompt
      }) as JsonRecord;
      setGoogleResult(data);
      setUrlContext(null);
      setLinkEvidence(null);
      setDomainEvidence(null);
      setSupervisor(null);
      setMaster(null);
      setConversationResult(null);
      return data;
    }, "Google Lab ejecutado.");
  }

  async function runUrlContext(target = googleResult) {
    if (!target?.result) return null;
    return runStep("url-context", async () => {
      const data = await postJson("/api/stage3-review", {
        action: "googleUrlContext",
        stage3Result: target.result,
        model: urlContextModel,
        maxSources,
        runId
      }) as JsonRecord;
      setUrlContext(data);
      return data;
    }, "URL Context ejecutado.");
  }

  async function runLinkEvidence(target = googleResult) {
    if (!target?.result) return null;
    return runStep("link-evidence", async () => {
      const data = await postJson("/api/stage3-review", {
        action: "linkEvidence",
        stage3Result: target.result,
        maxSources
      }) as JsonRecord;
      setLinkEvidence(data);
      return data;
    }, "Auditor?a de links ejecutada.");
  }

  async function runDomainEvidence(target = googleResult) {
    if (!target?.result) return null;
    return runStep("domain-evidence", async () => {
      const data = await postJson("/api/stage3-review", {
        action: "domainEvidence",
        stage3Result: target.result,
        maxSources
      }) as JsonRecord;
      setDomainEvidence(data);
      return data;
    }, "Auditor?a de dominios ejecutada.");
  }

  async function runSupervisor(target = googleResult, validation = urlContext) {
    if (!target?.result) return null;
    return runStep("supervisor", async () => {
      const data = await postJson("/api/stage3-review", {
        action: "sourceSupervisor",
        stage3Result: target.result,
        urlContextResult: validation?.result,
        model: supervisorModel,
        maxSources,
        runId
      }) as JsonRecord;
      setSupervisor(data);
      return data;
    }, "Supervisor ejecutado.");
  }

  async function runMaster() {
    if (!stage2Json || !googleResult?.result) return null;
    return runStep("master", async () => {
      const rows = items.map((item, index) => {
        const info = sourceInfo(item);
        const sourceId = sourceIdFor(item, index);
        const sup = supervisions.get(sourceId);
        return {
          item: text(item["Consecutivo interno"]) || text(item["No. item"]),
          proveedor: info.proveedor,
          url: info.url,
          precio: info.precio,
          moneda: info.moneda,
          tipoReferencia: sup ? text(sup.estado) : info.notas,
          defensa: sup ? text(sup.comentario) : info.notas,
          veredictoLab: sup ? text(sup.estado) : "pendiente_supervisor",
          evidencia: sup ? text(sup.comentario) : info.notas,
          validacion: validations.get(sourceId) || null,
          auditoria: {}
        };
      });
      const data = await postJson("/api/stage3/master-table", {
        stage2Json,
        attempts: [{ id: runId, label: runId, provider: "gemini", model: googleModel, rows }],
        runId,
        save: true
      }) as JsonRecord;
      setMaster(data);
      return data;
    }, "Tabla maestra creada.");
  }

  async function runFullCycle() {
    const g = await runGoogle();
    if (!g) return;
    const u = await runUrlContext(g);
    await runLinkEvidence(g);
    await runDomainEvidence(g);
    const s = await runSupervisor(g, isRecord(u) ? u : null);
    if (s) await runMaster();
  }

  async function runConversationalCycle() {
    if (!stage2Json) {
      setNotice({ type: "error", text: "El JSON de datos no es valido." });
      return null;
    }
    return runStep("conversational-lab", async () => {
      const data = await postJson("/api/stage3/conversational-lab", {
        stage2Json,
        instructionPrompt: prompt,
        googleModel,
        auditorModel: supervisorModel,
        maxAttempts: 3,
        runId
      }) as JsonRecord;
      setConversationResult(data);
      return data;
    }, "Ciclo conversacional ejecutado.");
  }

  function resetRun() {
    setRunId(`human-lab-${Date.now()}`);
    setGoogleResult(null);
    setUrlContext(null);
    setLinkEvidence(null);
    setDomainEvidence(null);
    setSupervisor(null);
    setMaster(null);
    setConversationResult(null);
    setNotice({ type: "ok", text: "Nueva corrida lista." });
  }

  const cost = isRecord(googleResult?.cost) ? googleResult.cost : null;
  const search = isRecord(isRecord(googleResult?.details) ? googleResult.details.search : null) ? (googleResult?.details as JsonRecord).search as JsonRecord : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Modo administrador</p>
          <h1>Laboratorio humano Stage 3</h1>
          <p className={styles.subtitle}>Prompt, datos, ejecuci?n, URL Context, auditor?a y supervisor en una sola mesa de pruebas.</p>
        </div>
        <a className={styles.linkButton} href="/" target="_blank" rel="noreferrer">Abrir app principal</a>
      </header>

      {notice ? <div className={`${styles.notice} ${styles[notice.type]}`}>{notice.text}</div> : null}

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label>Google
            <select value={googleModel} onChange={(event) => setGoogleModel(event.target.value)}>
              {(config?.models.google ?? []).map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
            </select>
          </label>
          <label>URL Context
            <select value={urlContextModel} onChange={(event) => setUrlContextModel(event.target.value)}>
              {(config?.models.urlContext ?? []).map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
            </select>
          </label>
          <label>Supervisor
            <select value={supervisorModel} onChange={(event) => setSupervisorModel(event.target.value)}>
              {(config?.models.supervisor ?? []).map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
            </select>
          </label>
          <label>Fuentes m?x.
            <input type="number" min={1} max={50} value={maxSources} onChange={(event) => setMaxSources(Number(event.target.value) || 12)} />
          </label>
          <label>Run
            <input value={runId} onChange={(event) => setRunId(event.target.value)} />
          </label>
        </div>
        <div className={styles.actions}>
          <button onClick={runConversationalCycle} disabled={Boolean(busy) || !stage2Json}>Ciclo conversacional Gemini + Auditor DeepSeek</button>
          <button onClick={runFullCycle} disabled={Boolean(busy) || !stage2Json}>Ciclo completo manual</button>
          <button onClick={runGoogle} disabled={Boolean(busy) || !stage2Json}>1. Ejecutar Google</button>
          <button onClick={() => runUrlContext()} disabled={Boolean(busy) || !googleResult}>2. URL Context</button>
          <button onClick={() => runLinkEvidence()} disabled={Boolean(busy) || !googleResult}>Links</button>
          <button onClick={() => runDomainEvidence()} disabled={Boolean(busy) || !googleResult}>Dominios</button>
          <button onClick={() => runSupervisor()} disabled={Boolean(busy) || !googleResult}>3. Supervisor</button>
          <button onClick={runMaster} disabled={Boolean(busy) || !googleResult}>4. Tabla maestra</button>
          <button className={styles.secondary} onClick={resetRun} disabled={Boolean(busy)}>Nueva corrida</button>
        </div>
        {busy ? <p className={styles.busy}>Procesando: {busy}...</p> : null}
      </section>

      <section className={styles.gridTwo}>
        <article className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2>Prompt base editable</h2>
            <span>{prompt.length.toLocaleString("es-CO")} caracteres</span>
          </div>
          <textarea className={styles.textarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </article>
        <article className={styles.panel}>
          <div className={styles.sectionHead}>
            <h2>Datos a procesar</h2>
            <span>{config?.fixturePath ?? "fixture"}</span>
          </div>
          <textarea className={styles.textarea} value={stage2Text} onChange={(event) => setStage2Text(event.target.value)} />
        </article>
      </section>

      <details className={styles.panel}>
        <summary>Prompt final enviado (solo lectura)</summary>
        <pre>{finalPrompt}</pre>
      </details>

      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <h2>Ciclo conversacional</h2>
          <span>{text(isRecord(conversationResult?.summary) ? conversationResult.summary.state : null) || "sin correr"} | USD {text(isRecord(conversationResult?.cost) ? conversationResult.cost.totalUsd : null) || "0"}</span>
        </div>
        <div className={styles.kpis}>
          <span>Modelo busqueda: {text(conversationResult?.googleModel) || googleModel}</span>
          <span>Auditor: {text(conversationResult?.auditorModel) || supervisorModel}</span>
          <span>Intentos: {Array.isArray(conversationResult?.attempts) ? conversationResult.attempts.length : 0}/3</span>
          <span>Con fuente: {text(isRecord(conversationResult?.summary) ? conversationResult.summary.rowsWithAnySource : null) || "0"}</span>
          <span>Pendientes auditor: {text(isRecord(conversationResult?.summary) ? conversationResult.summary.pendingByAuditor : null) || "0"}</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr><th>Item</th><th>Nombre</th><th>Proveedor</th><th>Precio</th><th>URL</th><th>Intento</th><th>Senales app</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {(Array.isArray(conversationResult?.accumulatedRows) ? conversationResult.accumulatedRows.filter(isRecord) : []).map((row, index) => <tr key={`${text(row.itemKey)}-${index}`}>
                <td>{text(row.itemKey)}</td>
                <td>{text(row.name)}</td>
                <td>{text(row.provider) || <span className={styles.muted}>sin proveedor</span>}</td>
                <td>{text(row.price)} {text(row.currency)}</td>
                <td>{text(row.url) ? <a href={text(row.url)} target="_blank" rel="noreferrer">abrir</a> : <span className={styles.muted}>sin URL</span>}</td>
                <td>{text(row.attempt)}</td>
                <td>{Array.isArray(row.signals) ? row.signals.join(", ") : ""}</td>
                <td>{text(row.providerNotes) || text(row.itemNotes)}</td>
              </tr>)}
              {!conversationResult ? <tr><td colSpan={8} className={styles.empty}>Ejecuta el ciclo conversacional para ver la tabla acumulada.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <details className={styles.inlineDetails}>
          <summary>Auditor DeepSeek y trazabilidad del ciclo</summary>
          <pre>{JSON.stringify({ summary: conversationResult?.summary, auditorReviews: conversationResult?.auditorReviews, attempts: conversationResult?.attempts }, null, 2)}</pre>
        </details>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <h2>Resultado normalizado</h2>
          <span>{items.length} item(s) | Modelo: {text(googleResult?.model) || "sin correr"} | USD {text(isRecord(cost) ? cost.totalUsd : null) || "0"}</span>
        </div>
        <div className={styles.kpis}>
          <span>Grounding: {text(search?.groundedPrompt) || "n/a"}</span>
          <span>Queries: {text(search?.searchQueries) || "0"}</span>
          <span>Parse: {text(isRecord(googleResult?.details) ? googleResult.details.parseMode : null) || "n/a"}</span>
          <span>URL Context: {text(isRecord(isRecord(googleResult?.details) ? googleResult.details.urlContext : null) ? (googleResult?.details as JsonRecord).urlContext : null)}</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr><th>Item</th><th>Nombre</th><th>Proveedor</th><th>Precio</th><th>URL</th><th>URL Context</th><th>Link evidence</th><th>Supervisor</th><th>Acci?n</th></tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const info = sourceInfo(item);
                const sourceId = sourceIdFor(item, index);
                const validation = validations.get(sourceId);
                const evidence = linkEvidences.get(sourceId) || domainEvidences.get(sourceId);
                const sup = supervisions.get(sourceId);
                return <tr key={sourceId}>
                  <td>{text(item["Consecutivo interno"]) || text(item["No. item"])}</td>
                  <td>{text(item["Nombre o descripcion"])}</td>
                  <td>{info.proveedor}</td>
                  <td>{info.precio} {info.moneda}</td>
                  <td>{info.url ? <a href={info.url} target="_blank" rel="noreferrer">abrir</a> : <span className={styles.muted}>sin URL</span>}</td>
                  <td>{validation ? `${text(validation.estado_fuente)} / ${text(validation.cumple_ficha)}` : "-"}</td>
                  <td>{evidence ? `${text(evidence.status)} ${text(isRecord(evidence.diagnostics) ? evidence.diagnostics.level : "")}` : "-"}</td>
                  <td>{sup ? `${text(sup.estado)} / ${text(sup.confianza)}` : "-"}</td>
                  <td>{sup ? text(sup.accion_sugerida) : "-"}</td>
                </tr>;
              })}
              {!items.length ? <tr><td colSpan={9} className={styles.empty}>Ejecuta Google para ver resultados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.gridTwo}>
        <details className={styles.panel} open>
          <summary>Supervisor</summary>
          <pre>{JSON.stringify(isRecord(supervisor?.supervision) ? supervisor.supervision : supervisor, null, 2)}</pre>
        </details>
        <details className={styles.panel}>
          <summary>Tabla maestra</summary>
          <pre>{JSON.stringify(isRecord(master?.table) ? master.table : master, null, 2)}</pre>
        </details>
        <details className={styles.panel}>
          <summary>URL Context</summary>
          <pre>{JSON.stringify(urlContext, null, 2)}</pre>
        </details>
        <details className={styles.panel}>
          <summary>Resultado crudo Google</summary>
          <pre>{text(googleResult?.raw) || JSON.stringify(googleResult, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
