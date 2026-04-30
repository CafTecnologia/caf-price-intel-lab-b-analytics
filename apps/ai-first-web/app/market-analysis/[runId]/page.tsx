import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketAnalysisProcessingPanel } from "../../../components/market-analysis-processing-panel";
import { MarketAnalysisTabs } from "../../../components/market-analysis-tabs";
import { MarketAnalysisTable } from "../../../components/market-analysis-table";
import { ProcessTraceLog } from "../../../components/process-trace-log";
import { TokenUsagePanel } from "../../../components/token-usage-panel";
import { getMarketAnalysisService } from "../../../lib/market-analysis-service";
import { isMarketSourcePrice } from "../../../lib/market-source-pricing";

const SOURCE_PRICE_FIELDS = ["Fuente 1 (Precio)", "Fuente 2 (Precio)", "Fuente 3 (Precio)"] as const;

export default async function MarketAnalysisResultPage(props: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { runId } = await props.params;
  const { focus } = await props.searchParams;
  const service = getMarketAnalysisService();
  const run = service.getRun(runId);
  const focusMode = focus === "table";

  if (!run) {
    notFound();
  }
  const stages = service.getRunStages(runId);
  const isFailed = run.status === "failed";
  const needsReview = run.status === "partial_review_required" || run.status === "completed_with_warnings";
  const hasReportedSourceValues = run.result.rows.some((row) =>
    SOURCE_PRICE_FIELDS.some((field) => {
      const value = row[field]?.trim();
      return Boolean(value && !/^n\/?d$/i.test(value));
    }),
  );
  const hasRecognizedMarketSources = run.result.rows.some((row) => SOURCE_PRICE_FIELDS.some((field) => isMarketSourcePrice(row[field])));
  const groundingVerified = run.usage?.grounded === true && run.groundingSources.length > 0;

  if (run.status === "processing") {
    return (
      <div className="stack">
        <section className="panel workspace-hero workspace-hero-compact">
          <MarketAnalysisTabs
            runId={runId}
            projectCode={run.projectCode}
            fileName={run.fileName}
            status={run.status}
            current="matrix"
          />
        </section>
        <MarketAnalysisProcessingPanel runId={runId} initialStartedAt={run.createdAt} />
      </div>
    );
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

      {needsReview ? (
        <div className="status-banner status-banner-warning">
          Esta matriz requiere revision: la app conserva el resultado, pero detecto fallas, fallback o advertencias internas.
        </div>
      ) : null}
      {isFailed ? (
        <div className="status-banner status-banner-error">
          El analisis fallo. Revisa el log y reintenta; no se muestra como matriz final.
        </div>
      ) : null}
      {hasReportedSourceValues && !groundingVerified ? (
        <div className="status-banner status-banner-warning">
          Fuentes no verificadas por grounding: pueden ser reales, pero Gemini no entrego trazabilidad verificable. Revisa URLs,
          precios y costos antes de decidir.
        </div>
      ) : null}
      {hasRecognizedMarketSources && !groundingVerified ? (
        <div className="status-banner status-banner-warning">
          Los costos fueron calculados con precios reportados por IA sin grounding verificable; el resultado queda como insumo de
          revision, no como cierre definitivo.
        </div>
      ) : null}

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
              <strong>{groundingVerified ? "verificado" : "no verificado"}</strong>
            </div>
          </div>

          {!isFailed && run.rowCount > 0 ? (
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
          ) : null}
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
            <h2>Fuentes verificadas por grounding</h2>
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
            <h2>{isFailed ? "Analisis fallido" : needsReview ? "Matriz parcial: requiere revision" : "Matriz final"}</h2>
            <p className="muted small">
              {isFailed
                ? "La corrida no produjo una matriz util."
                : needsReview
                  ? "Resultado disponible con advertencias visibles en el log."
                  : "Una fila por item, columnas fijas, lista para Excel."}
            </p>
          </div>
        </div>
        {!focusMode ? <ProcessTraceLog run={run} stages={stages} /> : null}
        {!isFailed ? (
          <MarketAnalysisTable run={run} openInNewTabHref={!focusMode ? `/market-analysis/${runId}?focus=table` : undefined} />
        ) : null}
      </section>
    </div>
  );
}
