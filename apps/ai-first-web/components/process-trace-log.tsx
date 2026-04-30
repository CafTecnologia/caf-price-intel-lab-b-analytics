import type { MarketAnalysisRun } from "@web/lib/market-analysis-store";
import type { MarketAnalysisStageTrace } from "@web/lib/market-analysis-trace";

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) {
    return "N/D";
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

function extractExpectedRows(sourceSummary: string): string | null {
  const match = sourceSummary.match(/Conteo local estimado de items:\s*(\d+)/i);
  return match?.[1] ?? null;
}

function extractEffectiveModel(run: MarketAnalysisRun): string {
  const messages = [...run.result.warnings, ...run.result.provider_notes];
  const explicit = messages
    .map((message) => message.match(/Modelo IA efectivo para esta corrida:\s*([A-Za-z0-9._-]+)/i)?.[1])
    .map((model) => model?.replace(/[.,;:]+$/, ""))
    .find(Boolean);

  return explicit ?? run.model;
}

function buildTraceItems(run: MarketAnalysisRun): Array<{ label: string; value: string }> {
  const expectedRows = extractExpectedRows(run.sourceSummary);
  const warnings = run.result.warnings.length;
  const notes = run.result.provider_notes.length;
  const effectiveModel = extractEffectiveModel(run);

  return [
    { label: "Estado", value: run.status },
    { label: "Proveedor", value: run.provider },
    { label: "Modelo usado", value: effectiveModel },
    { label: "Version del prompt", value: run.promptVersion },
    { label: "Tiempo IA/app", value: formatDuration(run.usage?.latencyMs) },
    { label: "Filas devueltas", value: expectedRows ? `${run.rowCount} de aprox. ${expectedRows}` : String(run.rowCount) },
    { label: "Grounding", value: run.usage?.grounded ? "Si, con fuentes reportadas" : "No reportado o no disponible" },
    { label: "Fuentes IA reportadas", value: String(run.groundingSources.length) },
    { label: "Tokens entrada", value: run.usage?.inputTokens === null || run.usage?.inputTokens === undefined ? "N/D" : String(run.usage.inputTokens) },
    { label: "Tokens salida", value: run.usage?.outputTokens === null || run.usage?.outputTokens === undefined ? "N/D" : String(run.usage.outputTokens) },
    { label: "Finish reason", value: run.usage?.finishReason ?? "N/D" },
    { label: "Warnings/notas", value: `${warnings} warning(s), ${notes} nota(s)` },
  ];
}

export function ProcessTraceLog(props: { run: MarketAnalysisRun; stages?: MarketAnalysisStageTrace[] }) {
  const { run, stages = [] } = props;
  const traceItems = buildTraceItems(run);
  const latestStages = stages.slice(-10);
  const allMessages = [
    run.errorMessage ? `ERROR: ${run.errorMessage}` : null,
    ...run.result.warnings,
    ...run.result.provider_notes,
  ].filter((message): message is string => Boolean(message));

  return (
    <details className="trace-log">
      <summary className="trace-log-summary">
        <span>
          <strong>Log del proceso</strong>
          <small>IA, fallback, fuentes y cobertura</small>
        </span>
        <span className="status-pill">{allMessages.length} evento(s)</span>
      </summary>

      <div className="trace-log-body">
        <div className="trace-log-grid">
          {traceItems.map((item) => (
            <div key={item.label} className="trace-log-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        {allMessages.length > 0 ? (
          <div className="trace-log-section">
            <h3>Eventos relevantes</h3>
            <ul className="plain-list">
              {allMessages.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted small">No hay advertencias registradas para esta corrida.</p>
        )}

        {latestStages.length > 0 ? (
          <div className="trace-log-section">
            <h3>Etapas registradas</h3>
            <ul className="plain-list">
              {latestStages.map((stage, index) => (
                <li key={`${stage.stage_name}-${stage.started_at}-${index}`}>
                  <strong>{stage.stage_name}</strong>: {stage.status}
                  {stage.model ? ` · ${stage.model}` : ""}
                  {stage.retry_count ? ` · retry ${stage.retry_count}` : ""}
                  {stage.duration_ms ? ` · ${formatDuration(stage.duration_ms)}` : ""}
                  {stage.error_message ? ` · ${stage.error_message}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="trace-log-section">
          <h3>Origen del archivo</h3>
          <pre className="code-block trace-log-code">{run.sourceSummary}</pre>
        </div>

        {run.groundingSources.length > 0 ? (
          <div className="trace-log-section">
            <h3>Fuentes reportadas por la IA</h3>
            <ul className="plain-list">
              {run.groundingSources.slice(0, 12).map((source, index) => (
                <li key={`${source.uri ?? source.title}-${index}`}>
                  {source.uri ? <a href={source.uri}>{source.title ?? source.uri}</a> : source.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
