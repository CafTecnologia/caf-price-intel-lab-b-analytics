import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

import { ProviderSettingsPanel } from "../components/provider-settings-panel";
import { getHomePageProviderSettings } from "../lib/server-data";

export const metadata: Metadata = {
  title: "analisis Financiero - B",
  description: "Analisis de mercado, simulacion financiera y oferta economica.",
};

export default function RootLayout(props: { children: React.ReactNode }) {
  const providerSettings = getHomePageProviderSettings();

  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark">OF</span>
                <div>
                  <strong>analisis Financiero - B</strong>
                  <div className="muted small">Analisis de mercado y oferta economica</div>
                </div>
              </Link>
              <nav className="topbar-nav">
                <Link href="/" className="topbar-link">
                  Inicio
                </Link>
                <details className="topbar-settings">
                  <summary className="topbar-link topbar-settings-trigger">Configuración IA</summary>
                  <div className="topbar-settings-menu">
                    <ProviderSettingsPanel initialSettings={providerSettings} surface="plain" compact />
                  </div>
                </details>
              </nav>
            </div>
          </header>
          <main className="page-shell">{props.children}</main>
        </div>
      </body>
    </html>
  );
}
