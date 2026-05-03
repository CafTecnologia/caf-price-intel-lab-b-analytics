import { ImportPanel } from "@offer/components/import-panel";
import { TrmCalculator } from "@offer/components/trm-calculator";
import { listCalculations } from "@offer/lib/store";
import { formatBogotaDateTime } from "@offer/lib/date-format";
import { formatNumber } from "@offer/lib/financial-engine";
import Link from "next/link";

export default async function HomePage() {
  const calculations = await listCalculations();

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Suite de análisis técnico y financiero · Simulador Financiero</p>
          <h1>Calcula costos y arma ofertas sin depender de IA.</h1>
          <p>
            Esta app no gestiona proyectos ni extrae documentos. Recibe datos, permite ajustar costos y prepara una oferta
            económica como borrador retomable.
          </p>
          <div className="hero-actions">
            <a className="button" href="#importar">
              Importar datos
            </a>
            <a className="ghost-button" href="/api/template" target="_blank">
              Descargar plantilla
            </a>
          </div>
        </div>
        <div className="mini-grid">
          <div className="step">
            <strong>1. Carga datos</strong>
            <span className="muted">JSON/API, plantilla o modo 100% manual.</span>
          </div>
          <div className="step">
            <strong>2. Ajusta costos</strong>
            <span className="muted">Minimo, promedio, moderado o manual.</span>
          </div>
          <div className="step">
            <strong>3. Exporta el borrador</strong>
            <span className="muted">JSON o CSV para seguir trabajando.</span>
          </div>
        </div>
      </section>

      <div className="utility-grid">
        <TrmCalculator />
      </div>

      <div className="content-grid">
        <ImportPanel />
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Borradores</p>
              <h2>Cálculos recientes</h2>
            </div>
            <span className="status-pill no_ceiling">{formatNumber(calculations.length)} visibles</span>
          </div>
          <div className="project-list">
            {calculations.length === 0 ? (
              <div className="status-line">Todavía no hay cálculos guardados.</div>
            ) : (
              calculations.map((calculation) => (
                <Link className="project-card" href={`/calculations/${calculation.id}`} key={calculation.id}>
                  <strong>{calculation.name}</strong>
                  <span className="muted">
                    {formatNumber(calculation.items.length)} items - {calculation.sourceSystem || "manual/api"}
                  </span>
                  <small className="muted">Actualizado: {formatBogotaDateTime(calculation.updatedAt)}</small>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="panel docs-panel" id="docs-api">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Ingesta API</p>
            <h2>Contrato minimo para conectar otra app</h2>
          </div>
          <a className="ghost-button" href="/api/validate" target="_blank">
            Validar por API
          </a>
        </div>
        <div className="docs-grid">
          <div>
            <h3>Explicacion simple</h3>
            <p>
              Otra app debe enviar un JSON con nombre del calculo, lista de items, cantidades, precio techo y hasta tres
              fuentes de precio por item. Esta calculadora no busca precios: calcula minimo, promedio y moderado desde los
              datos recibidos.
            </p>
            <p>
              Si no tienes archivo, crea un borrador y escribe los items directamente en la tabla. Los campos calculados quedan protegidos.
            </p>
            <p>
              Por defecto, todos los precios se interpretan como valores normalizados para cotizar. La calculadora se encarga de aplicar sus reglas internas.
            </p>
          </div>
          <pre className="code-sample">{`POST /api/import
Content-Type: application/json

{
  "version": 1,
  "calculation": {
    "name": "Calculo oferta ferreteria",
    "source_system": "app-b",
    "currency": "COP"
  },
  "items": [
    {
      "item": "1",
      "description": "Taladro profesional",
      "quantity": 2,
      "unit": "UND",
              "reference_unit": 350000,
              "price_sources": [
                { "name": "Proveedor A", "unit_price": 210000, "currency": "COP" },
                { "name": "Proveedor USA", "unit_price": 55, "currency": "USD" }
              ]
    }
  ],
  "settings": {
    "usd_to_cop_rate": 4000
  }
}`}</pre>
        </div>
      </section>
    </>
  );
}
