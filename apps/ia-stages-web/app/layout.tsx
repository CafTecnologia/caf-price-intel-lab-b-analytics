import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Extracción de datos estratégicos",
  description:
    "Parte de la Suite de análisis técnico y financiero: flujo por etapas (extracción, análisis técnico y cotización) con motor IA."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
