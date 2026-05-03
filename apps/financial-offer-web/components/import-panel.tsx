"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sampleImportPayload } from "@offer/lib/contract";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function ImportPanel() {
  const router = useRouter();
  const [payload, setPayload] = useState(pretty(sampleImportPayload()));
  const [manualName, setManualName] = useState("Cálculo sin título");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("Pega un JSON compatible, crea un borrador o descarga la plantilla.");

  async function importJson() {
    setStatus("loading");
    setMessage("Importando datos...");
    try {
      const body = JSON.parse(payload);
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo importar el JSON.");
      }
      setStatus("success");
      setMessage(`Cálculo importado: ${data.calculation?.name ?? data.project?.name ?? "sin nombre"}`);
      router.push(data.url);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "JSON invalido.");
    }
  }

  async function createManual() {
    setStatus("loading");
    setMessage("Creando borrador...");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: manualName }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo crear el calculo.");
      }
      setStatus("success");
      router.push(data.url);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No se pudo crear el calculo.");
    }
  }

  return (
    <section className="panel" id="importar">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Entrada universal</p>
          <h2>Crear o importar calculo</h2>
        </div>
        <button className="ghost-button" type="button" onClick={() => setPayload(pretty(sampleImportPayload()))}>
          Usar ejemplo
        </button>
      </div>
      <div className="form-grid">
        <div className="inline-form">
          <label>
            Nuevo calculo manual
            <input value={manualName} onChange={(event) => setManualName(event.target.value)} />
          </label>
          <button className="button" type="button" disabled={status === "loading"} onClick={createManual}>
            Crear borrador
          </button>
        </div>
        <label>
          JSON de calculo e items
          <textarea value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck={false} />
        </label>
        <div className={`status-line ${status === "error" ? "error" : status === "success" ? "success" : ""}`}>{message}</div>
        <div className="row-actions">
          <button className="button" type="button" disabled={status === "loading"} onClick={importJson}>
            Importar y abrir calculo
          </button>
          <a className="ghost-button" href="/api/template" target="_blank">
            Descargar Excel
          </a>
          <a className="ghost-button" href="#docs-api">
            Ver contrato
          </a>
        </div>
      </div>
    </section>
  );
}
