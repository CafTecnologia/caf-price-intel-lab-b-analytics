import { ProviderSettingsPanel } from "../components/provider-settings-panel";
import { MarketAnalysisUploadForm } from "../components/market-analysis-upload-form";
import { RecentMarketAnalyses } from "../components/recent-market-analyses";
import { getHomePageProviderSettings, getHomePageUploadDefaults } from "../lib/server-data";

export const dynamic = "force-dynamic";

export default async function HomePage(props: { searchParams: Promise<{ settings?: string }> }) {
  const { settings } = await props.searchParams;
  const providerSettings = getHomePageProviderSettings();
  const uploadDefaults = getHomePageUploadDefaults();
  const activeConnection = providerSettings.connections[providerSettings.activeProvider];
  const settingsOpen = settings === "open";

  return (
    <div className="stack page-grid">
      <section className="hero panel hero-grid">
        <div className="hero-copy">
          <div className="eyebrow">Análisis de mercado AI-first</div>
          <h1>Sube un archivo y conviértelo en una matriz comercial lista para decidir cuánto ofertar.</h1>
          <p className="muted">
            Aquí el flujo queda claro: documento completo, prompt maestro, matriz única, simulador financiero y oferta económica
            final sin salirte del precio techo.
          </p>
          <div className="actions-row">
            <a href="#workspace-start" className="primary-button link-button">
              Empezar ahora
            </a>
            <a href="#recent-runs" className="secondary-button link-button">
              Ver procesos recientes
            </a>
          </div>
        </div>

        <div className="hero-steps">
          <article className="hero-step-card">
            <span className="hero-step-index">1</span>
            <div>
              <strong>Configura tu IA</strong>
              <p className="muted small">Proveedor, API key y modelo principal para todas las corridas nuevas.</p>
            </div>
          </article>
          <article className="hero-step-card">
            <span className="hero-step-index">2</span>
            <div>
              <strong>Genera la matriz</strong>
              <p className="muted small">Una sola tabla normalizada, auditable y exportable.</p>
            </div>
          </article>
          <article className="hero-step-card">
            <span className="hero-step-index">3</span>
            <div>
              <strong>Decide la oferta</strong>
              <p className="muted small">Ajustes por lote, IVA discriminado, topes y rescates rápidos.</p>
            </div>
          </article>
        </div>
      </section>

      <div id="workspace-start" className="grid layout-main">
        <div className="stack">
          <details id="ai-settings-drawer" className="settings-drawer" open={settingsOpen}>
            <summary className="settings-drawer-summary">
              <div>
                <div className="eyebrow">Motor activo</div>
                <strong>
                  {uploadDefaults.label} · {activeConnection.model}
                </strong>
                <div className="muted small">Abre este panel solo cuando quieras cambiar proveedor, modelo o API key.</div>
              </div>
              <span className="secondary-button link-button">Configuración IA</span>
            </summary>
            <div className="settings-drawer-body">
              <ProviderSettingsPanel initialSettings={providerSettings} surface="plain" />
            </div>
          </details>
          <MarketAnalysisUploadForm
            defaultProvider={uploadDefaults.provider}
            defaultModel={uploadDefaults.model}
            defaultProviderLabel={uploadDefaults.label}
          />
        </div>
        <RecentMarketAnalyses />
      </div>
    </div>
  );
}
