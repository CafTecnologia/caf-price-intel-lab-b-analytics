"use client";

import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { AiProvider } from "@ai-first-contracts/enums";

type OdooProjectOption = {
  id: number;
  name: string;
};

type ProgressStatus = "idle" | "processing" | "completed" | "error";
const UPLOAD_CLIENT_TIMEOUT_MS = 12 * 60_000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildProgressState(elapsedMs: number, status: ProgressStatus) {
  if (status === "completed") {
    return {
      percent: 100,
      title: "Analisis completado",
      detail: "La app recibio la respuesta, calculo la matriz y esta abriendo los resultados.",
    };
  }

  if (status === "error") {
    return {
      percent: 100,
      title: "Revision requerida",
      detail: "La corrida no termino correctamente. Revisa el mensaje y el log cuando exista.",
    };
  }

  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 4) {
    return { percent: 12, title: "Preparando archivo", detail: "La app esta subiendo el documento y creando la corrida." };
  }
  if (seconds < 14) {
    return { percent: 28, title: "Leyendo documento", detail: "Se extrae texto, hojas, tablas y senales de items." };
  }
  if (seconds < 35) {
    return { percent: 46, title: "Consultando IA", detail: "Se envio el prompt y la app espera una respuesta estructurada." };
  }
  if (seconds < 90) {
    return {
      percent: 66,
      title: "IA trabajando",
      detail: "Gemini puede tardar. Si el modelo principal no responde, la app intenta fallback controlado.",
    };
  }
  if (seconds < 180) {
    return { percent: 82, title: "Validando respuesta", detail: "La app espera JSON valido, fuentes y trazabilidad." };
  }

  return {
    percent: 92,
    title: "Esperando cierre",
    detail: "El proceso sigue activo. No cierres esta ventana; al terminar veras la matriz.",
  };
}

export function MarketAnalysisUploadForm(props: {
  defaultProvider: AiProvider;
  defaultModel: string;
  defaultProviderLabel: string;
  odooProjectId?: string;
  odooProjectName?: string;
  focusedProjectMode?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressStatus, setProgressStatus] = useState<ProgressStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [projects, setProjects] = useState<OdooProjectOption[]>([]);
  const focusedProjectMode = Boolean(props.focusedProjectMode && props.odooProjectId);
  const [projectsStatus, setProjectsStatus] = useState<"loading" | "ready" | "error">(
    focusedProjectMode ? "ready" : "loading",
  );
  const [selectedProjectId, setSelectedProjectId] = useState(props.odooProjectId ?? "");
  const initialProjectName = props.odooProjectName ?? (props.odooProjectId ? `ID ${props.odooProjectId}` : "");

  useEffect(() => {
    if (!startedAt || progressStatus !== "processing") {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [progressStatus, startedAt]);

  useEffect(() => {
    if (focusedProjectMode) {
      setProjectsStatus("ready");
      return;
    }

    let active = true;

    fetch("/api/odoo/projects?limit=180")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("No fue posible cargar los proyectos.");
        }
        return (await response.json()) as { projects?: OdooProjectOption[] };
      })
      .then((payload) => {
        if (!active) {
          return;
        }
        setProjects(Array.isArray(payload.projects) ? payload.projects : []);
        setProjectsStatus("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setProjectsStatus("error");
      });

    return () => {
      active = false;
    };
  }, [focusedProjectMode]);

  const selectedProject = useMemo(() => {
    const numericId = Number(selectedProjectId);
    return projects.find((project) => project.id === numericId) ?? null;
  }, [projects, selectedProjectId]);

  const selectedProjectName = focusedProjectMode
    ? initialProjectName
    : selectedProject?.name ?? (selectedProjectId === props.odooProjectId ? initialProjectName : "");
  const projectOptions = useMemo(() => {
    if (!props.odooProjectId || !initialProjectName) {
      return projects;
    }
    const alreadyIncluded = projects.some((project) => String(project.id) === props.odooProjectId);
    return alreadyIncluded ? projects : [{ id: Number(props.odooProjectId), name: initialProjectName }, ...projects];
  }, [initialProjectName, projects, props.odooProjectId]);

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setIsSubmitting(true);
    setProgressStatus("processing");
    const submitStartedAt = Date.now();
    setStartedAt(submitStartedAt);
    setElapsedMs(0);
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => {
      controller.abort();
    }, UPLOAD_CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/market-analysis", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as { runId?: string; error?: string } | null;

      if (!response.ok) {
        if (payload?.runId) {
          setError(payload.error ?? "La corrida no termino correctamente. Se abrira el detalle del analisis.");
          setElapsedMs(Date.now() - submitStartedAt);
          setProgressStatus("error");
          setIsSubmitting(false);
          window.setTimeout(() => {
            window.location.assign(`/market-analysis/${payload.runId}`);
          }, 700);
          return;
        }

        throw new Error(payload?.error ?? "No se pudo ejecutar el analisis de mercado.");
      }

      if (!payload?.runId) {
        throw new Error("La API no devolvio un identificador de analisis.");
      }

      setElapsedMs(Date.now() - submitStartedAt);
      setProgressStatus("completed");
      window.setTimeout(() => {
        startTransition(() => {
          router.push(`/market-analysis/${payload.runId}`);
        });
      }, 900);
    } catch (submissionError) {
      setError(
        submissionError instanceof DOMException && submissionError.name === "AbortError"
          ? "La corrida supero el tiempo maximo de espera de la pantalla. Revisa los analisis recientes o intenta de nuevo."
          : submissionError instanceof Error
            ? submissionError.message
            : "Error inesperado.",
      );
      setProgressStatus("error");
      setIsSubmitting(false);
      return;
    } finally {
      window.clearTimeout(requestTimeout);
    }

    setIsSubmitting(false);
  }

  const progress = buildProgressState(elapsedMs, progressStatus);
  const showProgress = progressStatus !== "idle";

  return (
    <form
      className={`panel form-panel ${focusedProjectMode ? "focused-upload-form" : ""}`}
      onSubmit={handleFormSubmit}
      encType="multipart/form-data"
    >
      <div className="panel-header">
        <div>
          <div className="eyebrow">{focusedProjectMode ? "Proyecto seleccionado" : "Nuevo análisis"}</div>
          <h2>{focusedProjectMode ? "Cargar archivo" : "Crear análisis"}</h2>
        </div>
      </div>

      {focusedProjectMode ? (
        <input type="hidden" name="odoo_project_id" value={selectedProjectId} />
      ) : (
        <label className="field">
          <span>Proyecto Odoo asociado</span>
          <select
            name="odoo_project_id"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            <option value="">Sin asociar por ahora</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {!focusedProjectMode && selectedProjectId ? (
        <p className="status-pill status-completed">Asociado a proyecto Odoo: {selectedProjectName || `ID ${selectedProjectId}`}</p>
      ) : null}

      {selectedProjectId ? <input type="hidden" name="odoo_project_name" value={selectedProjectName} /> : null}

      {!focusedProjectMode && projectsStatus === "loading" ? <p className="muted small">Cargando proyectos de Odoo...</p> : null}
      {!focusedProjectMode && projectsStatus === "error" ? (
        <p className="error-text">No pude cargar el listado de proyectos. Puedes continuar sin asociar.</p>
      ) : null}

      <label className="field">
        <span>Archivo</span>
        <input type="file" name="file" accept=".pdf,.xlsx,.xls,.docx,.doc" required />
      </label>

      {error ? <p className="error-text">{error}</p> : null}

      {showProgress ? (
        <div className={`processing-panel processing-panel-${progressStatus}`} aria-live="polite">
          <div className="processing-donut" style={{ "--progress": `${progress.percent}%` } as CSSProperties}>
            <span>{progress.percent}%</span>
          </div>
          <div className="processing-copy">
            <div className="processing-topline">
              <strong>{progress.title}</strong>
              <span>{formatElapsed(elapsedMs)}</span>
            </div>
            <p>{progress.detail}</p>
            <div className="processing-bar">
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <small>Al terminar, el log de la matriz mostrara modelo usado, fallback, fuentes y advertencias.</small>
          </div>
        </div>
      ) : null}

      <button type="submit" className="primary-button" disabled={isSubmitting}>
        {isSubmitting ? "Procesando..." : focusedProjectMode ? "Procesar" : "Crear análisis"}
      </button>
    </form>
  );
}
