"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImportPanel } from "@offer/components/import-panel";
import { TrmCalculator } from "@offer/components/trm-calculator";
import { formatNumber } from "@offer/lib/financial-engine";

type RecentCalculation = {
  id: string;
  name: string;
  itemCount: number;
  sourceSystem: string | null;
  isInitialPlaceholder: boolean;
  updatedAt: string;
};

export function HomeDashboard(props: { calculations: RecentCalculation[] }) {
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const preparedCalculationId = searchParams.get("preparedCalculationId")?.trim() || null;
  const preparedCalculationName =
    props.calculations.find((calculation) => calculation.id === preparedCalculationId)?.name ??
    searchParams.get("preparedCalculationName")?.trim() ??
    null;
  const preparedCalculation = props.calculations.find((calculation) => calculation.id === preparedCalculationId);
  const preparedCallbackUrl = searchParams.get("preparedCallbackUrl")?.trim() || null;
  const preparedOdooDb = searchParams.get("preparedOdooDb")?.trim() || null;
  const resetStatus = searchParams.get("resetStatus") === "warning" ? "warning" : searchParams.get("resetStatus") === "success" ? "success" : null;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    function toggleSidebar() {
      setSidebarOpen((current) => !current);
    }

    window.addEventListener("financial-offer:toggle-history", toggleSidebar);
    return () => window.removeEventListener("financial-offer:toggle-history", toggleSidebar);
  }, []);

  if (searchParams.has("launchToken") || searchParams.has("odooCallbackUrl")) {
    return null;
  }

  return (
    <div className={`dashboard-shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      {sidebarOpen ? <button className="sidebar-scrim" type="button" aria-label="Cerrar borradores" onClick={() => setSidebarOpen(false)} /> : null}

      <aside className="history-sidebar" aria-label="Borradores recientes" aria-hidden={!sidebarOpen}>
        <div className="history-sidebar-head">
          <div>
            <h2>Borradores recientes</h2>
            <span className="muted">{formatNumber(props.calculations.length)} visibles</span>
          </div>
          <button className="modal-close-button" type="button" aria-label="Cerrar borradores" onClick={() => setSidebarOpen(false)}>
            x
          </button>
        </div>
        <div className="project-list sidebar-project-list">
          {props.calculations.length === 0 ? (
            <div className="status-line">Todavía no hay cálculos guardados.</div>
          ) : (
            props.calculations.map((calculation) => (
              <Link className="project-card" href={`/calculations/${calculation.id}`} key={calculation.id} onClick={() => setSidebarOpen(false)}>
                <strong>{calculation.name}</strong>
                <span className="muted">
                  {formatNumber(calculation.itemCount)} items - {calculation.sourceSystem || "manual/api"}
                </span>
                <small className="muted">Actualizado: {calculation.updatedAt}</small>
              </Link>
            ))
          )}
        </div>
      </aside>

      <div className="dashboard-utilities">
        <TrmCalculator />
      </div>

      <section className="launchpad-workspace" aria-label="Crear o importar cálculo">
        {preparedCalculation?.isInitialPlaceholder ? (
          <div className="status-line" role="status">
            Este es un borrador manual vacío. Para ver el estudio automatizado, abre «Abrir cálculo IA» desde el proyecto en Odoo.
          </div>
        ) : null}
        <ImportPanel
          targetCalculationId={preparedCalculationId}
          targetCalculationName={preparedCalculationName}
          targetCallbackUrl={preparedCallbackUrl}
          targetOdooDb={preparedOdooDb}
          resetStatus={resetStatus}
        />
      </section>
    </div>
  );
}
