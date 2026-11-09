"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { appPath } from "@offer/lib/base-path";
import { formatBogotaDateTime } from "@offer/lib/date-format";
import { postVersionAction } from "@offer/lib/version-action-client";

type Scenario = {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  createdBy?: { id: string | null; name: string } | null;
  snapshot: { items: unknown[] };
};

function displayScenarioName(name: string): string {
  return name
    .replace(/^Foto automatica\b/i, "Escenario automatico")
    .replace(/^Foto\b/i, "Escenario");
}

export type ScenarioManagerHandle = { save: () => Promise<boolean> };
export const ScenarioManager = forwardRef<ScenarioManagerHandle, {
  projectId: string;
  onBeforeSnapshot: () => Promise<string | null>;
  runExclusive: (task: () => Promise<boolean>, label: string) => Promise<boolean>;
  globalBusy: boolean;
  onActionSaved: (updatedAt: string) => void;
  onError: (message: string) => void;
  actor?: { id: string | null; name: string } | null;
}>(function ScenarioManager(props, ref) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await fetch(appPath(`/api/projects/${props.projectId}/scenarios`), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudieron leer los escenarios.");
      setScenarios(data.scenarios ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudieron leer los escenarios.");
    }
  }

  useEffect(() => { void load(); }, [props.projectId]);

  async function create(): Promise<boolean> {
    return props.runExclusive(async () => {
      setBusy(true);
      setStatus("Guardando escenario...");
      try {
        const expectedUpdatedAt = await props.onBeforeSnapshot();
        if (!expectedUpdatedAt) throw new Error("Termina o cancela la edición actual y guarda el cálculo antes de continuar.");
        const data = await postVersionAction(appPath(`/api/projects/${props.projectId}/scenarios`), {
          operationId: crypto.randomUUID(), expectedUpdatedAt,
          name: `Escenario ${formatBogotaDateTime(new Date().toISOString())}`,
          createdBy: props.actor ?? null,
        });
        props.onActionSaved(data.updatedAt);
        setStatus(data.status === "no_changes" ? "Este escenario ya estaba guardado." : "Escenario guardado.");
        await load();
        window.setTimeout(() => setStatus(""), 2400);
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "No se pudo guardar el escenario.";
        setStatus(detail);
        props.onError(detail);
        return false;
      } finally {
        setBusy(false);
      }
    }, "Guardando escenario de oferta...");
  }
  useImperativeHandle(ref, () => ({ save: create }));

  async function restore(scenario: Scenario): Promise<boolean> {
    return props.runExclusive(async () => {
      setBusy(true);
      setStatus(`Abriendo ${displayScenarioName(scenario.name)}...`);
      try {
        const expectedUpdatedAt = await props.onBeforeSnapshot();
        if (!expectedUpdatedAt) throw new Error("Termina o cancela la edición actual y guarda el cálculo antes de continuar.");
        await postVersionAction(appPath(`/api/projects/${props.projectId}/scenarios/${scenario.id}`),
          { operationId: crypto.randomUUID(), expectedUpdatedAt });
        window.location.reload();
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "No se pudo abrir el escenario.";
        setStatus(detail);
        props.onError(detail);
        return false;
      } finally {
        setBusy(false);
      }
    }, "Abriendo escenario de oferta...");
  }

  async function archive(scenario: Scenario) {
    if (!window.confirm(`Ocultar el escenario "${displayScenarioName(scenario.name)}"? El calculo actual no se modificara.`)) return;
    setBusy(true);
    try {
      const response = await fetch(appPath(`/api/projects/${props.projectId}/scenarios/${scenario.id}`), { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo ocultar el escenario.");
      await load();
      setStatus("Escenario oculto.");
      window.setTimeout(() => setStatus(""), 2400);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo ocultar el escenario.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scenario-manager" aria-label="Escenarios del calculo">
      <label className="scenario-switcher">
        <span className="visually-hidden">Cambiar a un escenario de oferta guardado</span>
        <select
          value=""
          onChange={(event) => {
            const scenario = scenarios.find((entry) => entry.id === event.target.value);
            if (scenario) void restore(scenario);
          }}
          disabled={busy || props.globalBusy || scenarios.length === 0}
          aria-label="Cambiar a un escenario de oferta guardado"
        >
          <option value="">{scenarios.length ? `Escenarios de oferta (${scenarios.length})` : "Sin escenarios"}</option>
          {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{displayScenarioName(scenario.name)}</option>)}
        </select>
      </label>
      <details className="scenario-manage">
        <summary title="Administrar escenarios" aria-label="Administrar escenarios">...</summary>
        <div className="scenario-manager-body">
          <strong>Escenarios de oferta guardados</strong>
          <div className="scenario-list">
            {scenarios.length ? scenarios.map((scenario) => (
              <div key={scenario.id} className="scenario-row">
                <button className="scenario-open" type="button" onClick={() => restore(scenario)} disabled={busy || props.globalBusy}>
                  <strong>{displayScenarioName(scenario.name)}</strong>
                  <span>{scenario.snapshot.items.length} items</span>
                  {scenario.createdBy?.name ? <span>Por {scenario.createdBy.name}</span> : null}
                </button>
                <button className="scenario-archive" type="button" onClick={() => archive(scenario)} disabled={busy || props.globalBusy} title="Ocultar escenario" aria-label={`Ocultar ${displayScenarioName(scenario.name)}`}>x</button>
              </div>
            )) : <span className="scenario-empty">Guarda tu primer escenario de oferta con un clic.</span>}
          </div>
        </div>
      </details>
      {status ? <span className="scenario-status" role="status">{status}</span> : null}
    </div>
  );
});
