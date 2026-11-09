import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAF · Laboratorio agéntico",
  description: "Piloto trazable para extracción, análisis técnico y referencias de mercado."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
