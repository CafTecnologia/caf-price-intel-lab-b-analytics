import { Suspense } from "react";

import { FinanzasEmbed } from "./finanzas-embed";

export default function FinanzasPage() {
  return (
    <main className="page embedPage">
      <section className="embedBanner">
        <p className="muted">
          Simulador Financiero integrado en esta misma suite. Volvé a Extracción de datos estratégicos con el menú superior.
        </p>
      </section>
      <Suspense fallback={<p className="muted">Cargando Simulador Financiero…</p>}>
        <FinanzasEmbed />
      </Suspense>
    </main>
  );
}
