"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

type StageTrace = {
  stage_name: string;
  status: "started" | "completed" | "failed";
  error_message: string | null;
  started_at: string;
  duration_ms: number | null;
  model: string | null;
};

type RunStatus = "processing" | "completed" | "completed_with_warnings" | "partial_review_required" | "failed";

type RunPayload = {
  run?: {
    status: RunStatus;
    rowCount: number;
    result?: { warnings?: string[]; provider_notes?: string[] };
    errorMessage?: string | null;
  };
  stages?: StageTrace[];
  error?: string;
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function stageLabel(stageName: string): string {
  return stageName.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MarketAnalysisProcessingPanel(props: { runId: string; initialStartedAt: string }) {
  const [payload, setPayload] = useState<RunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const started = Date.parse(props.initialStartedAt);
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [props.initialStartedAt]);

  useEffect(() => {
    let active = true;
    let reloadScheduled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/market-analysis/${props.runId}`, { cache: "no-store" });
        const nextPayload = (await response.json()) as RunPayload;
        if (!active) return;
        if (!response.ok) {
          throw new Error(nextPayload.error ?? "No fue posible consultar el estado del analisis.");
        }
        setPayload(nextPayload);
        setError(null);

        if (nextPayload.run && nextPayload.run.status !== "processing" && !reloadScheduled) {
          reloadScheduled = true;
          window.setTimeout(() => window.location.reload(), 900);
        }
      } catch (pollError) {
        if (!active) return;
        setError(pollError instanceof Error ? pollError.message : "Error consultando estado.");
      }
    }

    poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [props.runId]);

  const stages = payload?.stages ?? [];
  const latestStage = useMemo(() => {
    return stages.slice().reverse().find((stage) => stage.status === "started") ?? stages.at(-1) ?? null;
  }, [stages]);
  const completed = stages.filter((stage) => stage.status === "completed").length;
  const failed = stages.filter((stage) => stage.status === "failed").length;
  const progress = Math.min(92, Math.max(10, 12 + completed * 9 + failed * 3));
  const messages = [
    ...(payload?.run?.result?.warnings ?? []),
    ...(payload?.run?.result?.provider_notes ?? []),
    payload?.run?.errorMessage ?? null,
  ].filter((message): message is string => Boolean(message));

  return (
    <section className="panel processing-workspace" aria-live="polite">
      <div className="processing-panel">
        <div className="processing-donut" style={{ "--progress": `${progress}%` } as CSSProperties}>
          <span>{progress}%</span>
        </div>
        <div className="processing-copy">
          <div className="processing-topline">
            <strong>Analisis en curso</strong>
            <span>{formatElapsed(elapsedMs)}</span>
          </div>
          <p>
            {latestStage
              ? `${stageLabel(latestStage.stage_name)}: ${latestStage.status}`
              : "La app recibio el archivo y esta preparando el seguimiento."}
          </p>
          <div className="processing-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            La pantalla se actualiza sola. Si una etapa falla o usa fallback, quedara visible en el log y el estado final.
          </small>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <details className="trace-log processing-trace-log" open>
        <summary className="trace-log-summary">
          <span>
            <strong>Trazabilidad</strong>
            <small>
              {completed} completada(s), {failed} fallida(s)
            </small>
          </span>
          <span className="status-pill">procesando</span>
        </summary>

        <div className="trace-log-body">
          <div className="trace-log-section">
            <ul className="plain-list">
              {stages.slice(-12).map((stage, index) => (
                <li key={`${stage.stage_name}-${stage.started_at}-${index}`}>
                  <strong>{stageLabel(stage.stage_name)}</strong>: {stage.status}
                  {stage.model ? ` · ${stage.model}` : ""}
                  {stage.duration_ms ? ` · ${formatElapsed(stage.duration_ms)}` : ""}
                  {stage.error_message ? ` · ${stage.error_message}` : ""}
                </li>
              ))}
            </ul>
            {stages.length === 0 ? <p className="muted small">Esperando primera etapa registrada...</p> : null}
          </div>

          {messages.length > 0 ? (
            <div className="trace-log-section">
              <h3>Eventos</h3>
              <ul className="plain-list">
                {messages.map((message, index) => (
                  <li key={`${message}-${index}`}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
