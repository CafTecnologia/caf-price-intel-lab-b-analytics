import type { MarketAnalysisRun } from "@web/lib/market-analysis-store";

function formatInteger(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/D";
  }

  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDurationMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/D";
  }

  if (value >= 1000) {
    return `${new Intl.NumberFormat("es-CO", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value / 1000)} s`;
  }

  return `${formatInteger(value)} ms`;
}

export function TokenUsagePanel(props: { run: MarketAnalysisRun }) {
  const usage = props.run.usage;
  const totalTokens =
    usage && (usage.inputTokens !== null || usage.outputTokens !== null)
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : null;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Consumo IA</div>
          <h2>Informe de tokens por proceso</h2>
          <p className="muted small">
            Este bloque no altera la lógica del análisis: solo te muestra lo que el proveedor reportó para medir consumo y
            costo.
          </p>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">Tokens de entrada</span>
          <strong>{formatInteger(usage?.inputTokens ?? null)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Tokens de salida</span>
          <strong>{formatInteger(usage?.outputTokens ?? null)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Tokens totales</span>
          <strong>{formatInteger(totalTokens)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Latencia</span>
          <strong>{formatDurationMs(usage?.latencyMs ?? null)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Finish reason</span>
          <strong>{usage?.finishReason ?? "N/D"}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Grounding</span>
          <strong>{usage?.grounded ? "Sí" : "No / no reportado"}</strong>
        </div>
      </div>

      {usage?.inputTokens === null && usage?.outputTokens === null ? (
        <p className="muted small">
          Este proveedor o esta llamada no devolvió conteo de tokens. Cuando sí venga reportado, lo verás aquí sin tocar el
          resto del proceso.
        </p>
      ) : null}
    </section>
  );
}
