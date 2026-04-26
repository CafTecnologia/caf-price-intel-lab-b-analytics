import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mesa de Trabajo de Oferta",
  description: "Análisis de mercado, simulación financiera y oferta económica en una sola estación local.",
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-inner">
              <Link href="/" className="brand">
                <span className="brand-mark">OF</span>
                <div>
                  <strong>Mesa de Oferta</strong>
                  <div className="muted small">Análisis de mercado, pricing y propuesta económica</div>
                </div>
              </Link>
              <nav className="topbar-nav">
                <Link href="/" className="topbar-link">
                  Inicio
                </Link>
                <Link href="/?settings=open#ai-settings-drawer" className="topbar-link">
                  Configuración IA
                </Link>
              </nav>
            </div>
          </header>
          <main className="page-shell">{props.children}</main>
        </div>
      </body>
    </html>
  );
}
