import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketAnalysisProcessingPanel } from "../../../components/market-analysis-processing-panel";
import { MarketAnalysisTabs } from "../../../components/market-analysis-tabs";
import { MarketAnalysisTable } from "../../../components/market-analysis-table";
import { ProcessTraceLog } from "../../../components/process-trace-log";
import { getMarketAnalysisService } from "../../../lib/market-analysis-service";
import type { MarketAnalysisRun } from "../../../lib/market-analysis-store";

const SOURCE_PRICE_FIELDS = ["Fuente 1 (Precio)", "Fuente 2 (Precio)", "Fuente 3 (Precio)"] as const;

function isTechnicalProcessMessage(message: string): boolean {
  return /STREAM_GEMINI|resumen\(es\) de pensamiento|Modelo IA efectivo|Flujo Gemini|Conteo previo Gemini|Auditoria local previa|Calculos financieros generados|FALLBACK_MODELO_IA|DIRECT_FILE_FALLBACK|DIRECT_TEXT_FALLBACK|STAGED_PIPELINE_FALLBACK|FULL_RUN_FALLBACK|PDF_NATIVO_FALLBACK|Quota exceeded|rate-limit|rate limit|google\.dev|QUALITY_GATE_STAGE_FAILURE|PROCESSING_STARTED/i.test(
    message,
  );
}

function simplifyUserMessage(message: string): string | null {
  if (/QUALITY_GATE_GROUNDING_NOT_VERIFIED/i.test(message)) {
    return "Las fuentes y precios quedaron disponibles, pero esta corrida no trajo verificacion automatica de grounding. Conviene revisar URLs y valores antes de tomar una decision final.";
  }

  const traceability = message.match(/QUALITY_GATE_SOURCE_TRACEABILITY:\s*([^.]*)/i);
  if (traceability) {
    return `${traceability[1]} no incluyen URL o dominio trazable. Revisar esas fuentes antes de cerrar la decision.`;
  }

  if (/Fuentes internacionales USD convertidas/i.test(message)) {
    return message;
  }

  if (isTechnicalProcessMessage(message)) {
    return null;
  }

  const cleaned = message.replace(/\s+/g, " ").trim();
  return cleaned && !/^n\/?d$/i.test(cleaned) ? cleaned : null;
}

function buildUserRunMessages(run: MarketAnalysisRun): string[] {
  const messages = [...run.result.warnings, ...run.result.provider_notes]
    .map(simplifyUserMessage)
    .filter((message): message is string => Boolean(message));

  return Array.from(new Set(messages));
}

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
  const hasPartialResult = run.status === "partial_review_required";
  const hasCompletedWarnings = run.status === "completed_with_warnings";
  const needsReview = run.status === "partial_review_required" || run.status === "completed_with_warnings";
  const groundingVerified = run.usage?.grounded === true && run.groundingSources.length > 0;
  const userRunMessages = buildUserRunMessages(run);
  const matrixTitle = isFailed
    ? "Analisis fallido"
    : hasPartialResult
      ? "Matriz parcial: requiere revision"
      : hasCompletedWarnings
        ? "Matriz con notas de revision"
        : "Matriz final";
  const matrixDescription = isFailed
    ? "La corrida no produjo una matriz util."
    : hasPartialResult
      ? "Resultado disponible, pero faltan validaciones o datos importantes antes de usarlo."
      : hasCompletedWarnings
        ? "Resultado disponible con notas relevantes para revisar antes de decidir."
        : "Una fila por item, columnas fijas, lista para Excel.";

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
          Resultado disponible con notas de revision. Antes de decidir, revisa el resumen para usuario.
        </div>
      ) : null}
      {isFailed ? (
        <div className="status-banner status-banner-error">
          El analisis fallo. Revisa la caja negra tecnica y reintenta; no se muestra como matriz final.
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

      {!focusMode && userRunMessages.length > 0 ? (
        <section className="panel warning-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Resumen para usuario</div>
              <h2>Notas relevantes de la corrida</h2>
              <p className="muted small">
                Solo se muestran alertas comerciales o documentales utiles para revisar el resultado.
              </p>
            </div>
          </div>
          <ul className="plain-list user-run-notes">
            {userRunMessages.map((message) => (
              <li key={message}>{message}</li>
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

      <section className={`panel table-stage ${focusMode ? "table-stage-focus" : ""}`}>
        <div className="panel-header">
          <div>
            <h2>{matrixTitle}</h2>
            <p className="muted small">{matrixDescription}</p>
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
