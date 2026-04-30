import Link from "next/link";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";
import type { MarketAnalysisRunStatus } from "@web/lib/market-analysis-store";

function statusClassName(status: MarketAnalysisRunStatus): string {
  if (status === "completed") return "status-completed";
  if (status === "failed") return "status-failed";
  return "status-completed_with_warnings";
}

export function RecentMarketAnalyses(props: {
  odooProjectId?: string;
  title?: string;
  emptyText?: string;
  limit?: number;
}) {
  const runs = getMarketAnalysisService()
    .listRuns(props.odooProjectId ? 100 : props.limit ?? 6)
    .filter((run) => !props.odooProjectId || String(run.odooProjectId ?? "") === props.odooProjectId)
    .slice(0, props.limit ?? 6);
  const title = props.title ?? "Proyectos vivos";

  if (runs.length === 0) {
    return (
      <section id="recent-runs" className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Actividad</div>
            <h2>{title}</h2>
          </div>
        </div>
        <p className="muted">{props.emptyText ?? "Aún no hay análisis creados."}</p>
      </section>
    );
  }

  return (
    <section id="recent-runs" className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Actividad</div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="stack">
        {runs.map((run) => (
          <Link key={run.runId} href={`/market-analysis/${run.runId}/financial`} className="run-card">
            <div>
              <div className="eyebrow">{run.odooProjectName ? "Proyecto Odoo" : `Proyecto ${run.projectCode}`}</div>
              <strong>{run.odooProjectName ?? run.fileName}</strong>
              {run.odooProjectName ? <div className="muted small">{run.fileName}</div> : null}
              <div className="muted small">{run.rowCount} filas · {new Date(run.updatedAt).toLocaleString("es-CO")}</div>
            </div>
            <div className="run-card-meta">
              <span className={`status-pill ${statusClassName(run.status)}`}>
                {run.status}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
