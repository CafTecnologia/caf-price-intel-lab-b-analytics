import { MarketAnalysisUploadForm } from "../components/market-analysis-upload-form";
import { RecentMarketAnalyses } from "../components/recent-market-analyses";
import { fetchOdooProjectOptionById } from "../lib/odoo-projects";
import { getHomePageUploadDefaults } from "../lib/server-data";

export const dynamic = "force-dynamic";

export default async function HomePage(props: {
  searchParams: Promise<{ settings?: string; odoo_project_id?: string; odoo_project_name?: string; view?: string }>;
}) {
  const { odoo_project_id, odoo_project_name, view } = await props.searchParams;
  const uploadDefaults = getHomePageUploadDefaults();
  const isProjectIntake = Boolean(odoo_project_id);
  const resolvedOdooProject = isProjectIntake && !odoo_project_name && odoo_project_id
    ? await fetchOdooProjectOptionById(odoo_project_id).catch(() => null)
    : null;
  const resolvedOdooProjectName = odoo_project_name || resolvedOdooProject?.name || "";
  const projectLabel = resolvedOdooProjectName || (odoo_project_id ? `Proyecto Odoo ${odoo_project_id}` : "");
  const projectQuery = odoo_project_id ? `odoo_project_id=${encodeURIComponent(odoo_project_id)}` : "";

  if (isProjectIntake && view === "analyses") {
    return (
      <div className="stack project-intake-page">
        <section className="panel project-intake-hero">
          <div className="eyebrow">analisis Financiero - B</div>
          <h1>Analisis del proyecto.</h1>
          <div className="project-lock-card">
            <span className="project-lock-label">Proyecto</span>
            <strong>{projectLabel}</strong>
          </div>
          <div className="actions-row">
            <a className="primary-button link-button" href={`/?${projectQuery}`}>
              Nuevo analisis
            </a>
          </div>
        </section>

        <RecentMarketAnalyses
          odooProjectId={odoo_project_id}
          title="Analisis realizados"
          emptyText="Este proyecto aun no tiene analisis guardados."
          limit={12}
        />

        <footer className="engine-footnote">
          Motor: {uploadDefaults.label} · {uploadDefaults.model}
        </footer>
      </div>
    );
  }

  if (isProjectIntake) {
    return (
      <div className="stack project-intake-page">
        <section className="panel project-intake-hero">
          <div className="eyebrow">analisis Financiero - B</div>
          <h1>Carga el archivo del proyecto.</h1>
          <div className="project-lock-card">
            <span className="project-lock-label">Proyecto</span>
            <strong>{projectLabel}</strong>
          </div>
        </section>

        <div id="workspace-start" className="project-intake-workspace">
          <MarketAnalysisUploadForm
            defaultProvider={uploadDefaults.provider}
            defaultModel={uploadDefaults.model}
            defaultProviderLabel={uploadDefaults.label}
            odooProjectId={odoo_project_id}
            odooProjectName={resolvedOdooProjectName}
            focusedProjectMode
          />
        </div>
        <footer className="engine-footnote">
          Motor: {uploadDefaults.label} · {uploadDefaults.model}
        </footer>
      </div>
    );
  }

  return (
    <div className="stack page-grid compact-home">
      <div id="workspace-start" className="grid layout-main">
        <div className="stack">
          <MarketAnalysisUploadForm
            defaultProvider={uploadDefaults.provider}
            defaultModel={uploadDefaults.model}
            defaultProviderLabel={uploadDefaults.label}
            odooProjectId={odoo_project_id}
            odooProjectName={resolvedOdooProjectName}
          />
        </div>
        <RecentMarketAnalyses />
      </div>
      <footer className="engine-footnote">
        Motor: {uploadDefaults.label} · {uploadDefaults.model}
      </footer>
    </div>
  );
}
