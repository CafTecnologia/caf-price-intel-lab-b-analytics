import "./globals.css";
import { Topbar } from "@offer/components/topbar";

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
          <Topbar />
          <main className="page-shell">{props.children}</main>
        </div>
      </body>
    </html>
  );
}
