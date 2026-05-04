"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const FinanzasEmbed = dynamic(() => import("./finanzas-embed"), {
  ssr: false,
  loading: () => <p className="muted">Cargando Simulador Financiero…</p>
});

export default function FinanzasPage() {
  return (
    <main className="page embedPage">
      <section className="embedBanner">
        <p className="muted">
          Simulador Financiero integrado en esta misma suite. Volvé a Extracción de datos estratégicos con el menú superior.
        </p>
      </section>
      <Suspense fallback={<p className="muted">Cargando vista del simulador…</p>}>
        <FinanzasEmbed />
      </Suspense>
    </main>
  );
}
