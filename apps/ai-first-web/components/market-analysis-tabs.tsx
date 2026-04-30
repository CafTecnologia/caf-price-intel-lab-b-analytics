import Link from "next/link";

import type { MarketAnalysisRunStatus } from "@web/lib/market-analysis-store";

function statusClassName(status: MarketAnalysisRunStatus): string {
  if (status === "completed") return "status-completed";
  if (status === "failed") return "status-failed";
  return "status-completed_with_warnings";
}

export function MarketAnalysisTabs(props: {
  runId: string;
  projectCode: string;
  fileName: string;
  status: MarketAnalysisRunStatus;
  current: "matrix" | "financial" | "offer";
}) {
  const links = [
    { key: "matrix", href: `/market-analysis/${props.runId}`, label: "Matriz" },
    { key: "financial", href: `/market-analysis/${props.runId}/financial`, label: "Simulador financiero" },
    { key: "offer", href: `/market-analysis/${props.runId}/offer`, label: "Oferta económica a presentar" },
  ] as const;

  return (
    <div className="workspace-project-header">
      <div className="workspace-project-meta">
        <div className="eyebrow">Proyecto {props.projectCode}</div>
        <div className="workspace-project-title-row">
          <strong className="workspace-project-title">{props.fileName}</strong>
          <span className={`status-pill ${statusClassName(props.status)}`}>
            {props.status}
          </span>
        </div>
      </div>

      <div className="tab-bar-shell">
        <nav className="tab-bar tab-bar-links">
          {links.map((link) => (
            <Link key={link.key} href={link.href} className={link.key === props.current ? "tab active" : "tab"}>
              {link.label}
            </Link>
          ))}
        </nav>
        <Link href="/" className="tab-close-link" aria-label="Cerrar proyecto y volver al inicio">
          X
        </Link>
      </div>
    </div>
  );
}
