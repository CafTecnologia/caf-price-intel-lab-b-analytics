import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketAnalysisTabs } from "../../../components/market-analysis-tabs";
import { MarketAnalysisTable } from "../../../components/market-analysis-table";
import { ProcessTraceLog } from "../../../components/process-trace-log";
import { TokenUsagePanel } from "../../../components/token-usage-panel";
import { getMarketAnalysisService } from "../../../lib/market-analysis-service";

export default async function MarketAnalysisResultPage(props: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { runId } = await props.params;
  const { focus } = await props.searchParams;
  const run = getMarketAnalysisService().getRun(runId);
  const focusMode = focus === "table";

  if (!run) {
    notFound();
  }

  return (
    <div className={`stack ${focusMode ? "focus-workspace" : ""}`}>
      <section className={`panel workspace-hero ${focusMode ? "workspace-hero-compact" : ""}`}>
        <MarketAnalysisTabs
          runId={runId}
          projectCode={run.projectCode}
          fileName={run.fileName}
          status={run.status}
          current="matrix"
        />
      </section>

      {!focusMode ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Matriz de análisis de mercado</div>
              <h2>{run.projectCode}</h2>
              <p className="muted small">{run.runId}</p>
            </div>
          </div>

          <div className="project-trace-grid">
            <div className="metric-card">
              <span className="metric-label">Archivo fuente cargado</span>
              <strong>{run.fileName}</strong>
              <div className="muted small trace-path">{run.uploadedFilePath}</div>
            </div>
            <div className="metric-card">
              <span className="metric-label">Resumen de origen</span>
              <div className="muted small trace-path">{run.sourceSummary}</div>
            </div>
          </div>

          <div className="metric-grid project-metrics-grid">
            <div className="metric-card">
              <span className="metric-label">Filas</span>
              <strong>{run.rowCount}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Proveedor</span>
              <strong>{run.provider}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Modelo</span>
              <strong>{run.model}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Grounding</span>
              <strong>{run.usage?.grounded ? "sí" : "no / no reportado"}</strong>
            </div>
          </div>

          <div className="actions-row matrix-actions-row">
            <a href={`/api/market-analysis/${runId}/export?format=xlsx`} className="primary-button link-button">
              Descargar XLSX
            </a>
            <a href={`/api/market-analysis/${runId}/export?format=csv`} className="secondary-button link-button">
              Descargar CSV
            </a>
            <a href={`/api/market-analysis/${runId}/export?format=json`} className="secondary-button link-button">
              Descargar JSON
            </a>
          </div>
        </section>
      ) : (
        <section className="panel subtle">
          <div className="actions-row">
            <Link href={`/market-analysis/${runId}`} className="secondary-button link-button">
              Volver a vista normal
            </Link>
          </div>
        </section>
      )}

      {!focusMode && run.errorMessage ? (
        <section className="panel warning-panel">
          <h2>Error del proveedor</h2>
          <p>{run.errorMessage}</p>
        </section>
      ) : null}

      {!focusMode && (run.result.warnings.length > 0 || run.result.provider_notes.length > 0) ? (
        <section className="panel warning-panel">
          <div className="panel-header">
            <h2>Advertencias</h2>
          </div>
          <ul className="plain-list">
            {[...run.result.warnings, ...run.result.provider_notes].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!focusMode && run.groundingSources.length > 0 ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Fuentes reportadas por Gemini</h2>
          </div>
          <ul className="plain-list">
            {run.groundingSources.slice(0, 20).map((source, index) => (
              <li key={`${source.uri ?? source.title}-${index}`}>
                {source.uri ? <a href={source.uri}>{source.title ?? source.uri}</a> : source.title}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!focusMode ? <TokenUsagePanel run={run} /> : null}

      <section className={`panel table-stage ${focusMode ? "table-stage-focus" : ""}`}>
        <div className="panel-header">
          <div>
            <h2>Matriz final</h2>
            <p className="muted small">Una fila por ítem, 15 columnas fijas, lista para Excel.</p>
          </div>
        </div>
        {!focusMode ? <ProcessTraceLog run={run} /> : null}
        <MarketAnalysisTable run={run} openInNewTabHref={!focusMode ? `/market-analysis/${runId}?focus=table` : undefined} />
      </section>
    </div>
  );
}
