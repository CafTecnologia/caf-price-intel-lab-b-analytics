import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Simulador Financiero",
  description:
    "Parte de la Suite de análisis técnico y financiero: ingerir JSON vía API o plantilla, simular costos y preparar oferta económica.",
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="topbar-inner">
              <Link className="brand" href="/">
                <span className="brand-mark">OF</span>
                <span>
                  <strong>Simulador Financiero</strong>
                  <small>Oferta económica desde JSON</small>
                </span>
              </Link>
              <nav className="topbar-nav">
                <Link className="topbar-link" href="/">
                  Cálculos
                </Link>
                <a className="topbar-link" href="/api/projects" target="_blank">
                  API
                </a>
              </nav>
            </div>
          </header>
          <main className="page-shell">{props.children}</main>
        </div>
      </body>
    </html>
  );
}
