import Link from "next/link";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export function RecentMarketAnalyses() {
  const runs = getMarketAnalysisService().listRuns(6);

  if (runs.length === 0) {
    return (
      <section id="recent-runs" className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Actividad</div>
            <h2>Análisis recientes</h2>
          </div>
        </div>
        <p className="muted">Aún no hay matrices de análisis de mercado. Cuando hagas la primera corrida, aparecerá aquí.</p>
      </section>
    );
  }

  return (
    <section id="recent-runs" className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Actividad</div>
          <h2>Análisis recientes</h2>
        </div>
        <span className="status-pill">{runs.length} visibles</span>
      </div>
      <div className="stack">
        {runs.map((run) => (
          <Link key={run.runId} href={`/market-analysis/${run.runId}/financial`} className="run-card">
            <div>
              <div className="eyebrow">Proyecto {run.projectCode}</div>
              <strong>{run.fileName}</strong>
              <div className="muted small">
                {run.rowCount} filas · {run.provider}/{run.model}
              </div>
              <div className="muted small">Última actualización: {new Date(run.updatedAt).toLocaleString("es-CO")}</div>
            </div>
            <div className="run-card-meta">
              <span className={`status-pill ${run.status === "completed" ? "status-completed" : "status-failed"}`}>
                {run.status}
              </span>
              <span className="small muted">{run.usage?.inputTokens ?? 0}/{run.usage?.outputTokens ?? 0} tok</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
