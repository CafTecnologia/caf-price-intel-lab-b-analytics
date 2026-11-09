"use client";

import { useState } from "react";

type HelpView = "start" | "calculations" | "control";

const flowSteps = [
  ["Carga", "Importa una lista o crea ítems. Si viene de Odoo o la IA, confirma su origen."],
  ["Contrasta", "Compara los datos recibidos y la ficha anexa con la investigación y las fuentes."],
  ["Decide costos", "Elige una fuente o un costo manual; revisa los costos asociados sugeridos."],
  ["Prepara oferta", "Usa utilidad sobre costo, descuento sobre techo unitario o valor manual."],
  ["Comprueba", "Revisa IVA, retenciones, utilidad neta y techo total antes de exportar."],
  ["Conserva", "Guarda el cálculo y, si necesitas comparar, un escenario o una base de costos."],
];

const calculationGroups = [
  {
    title: "Costo unitario",
    summary: "Compara fuentes en COP o USD y deja elegir una cotización o un costo manual.",
    lines: [
      "Fuente COP = precio publicado.",
      "Fuente USD normalizada = precio USD × TRM × (1 + importación %).",
      "Mínimo = menor fuente válida.",
      "Promedio = suma de fuentes válidas ÷ número de fuentes.",
      "Moderado = (mínimo + promedio) ÷ 2.",
      "Cotización elegida = precio de la fuente seleccionada para ese ítem.",
      "Manual = costo base escrito por el usuario.",
    ],
    note: "El descuento de costo por ítem o lote se aplica después. Si hay servicios aplicados, se suman al costo base; la fuente elegida sigue visible para contrastarla.",
  },
  {
    title: "Oferta",
    summary: "Prepara precios unitarios con descuento, utilidad sobre costo o valor manual.",
    lines: [
      "Por descuento = precio techo × (1 − descuento %).",
      "Por utilidad = costo × (1 + utilidad objetivo %).",
      "Manual = oferta unitaria escrita por el usuario.",
      "Oferta total = oferta unitaria × cantidad.",
      "Utilidad bruta = oferta total − costo total.",
      "Margen sobre costo = utilidad bruta ÷ costo total × 100.",
    ],
    note: "Aplicar utilidad sobre costo con IVA funciona aunque solo exista techo global. Descuento y restablecimiento desde techo requieren techo por ítem; las filas sin costo quedan pendientes cuando se usa utilidad.",
  },
  {
    title: "IVA",
    summary: "Hace comparables los precios y presenta valores antes y después de IVA.",
    lines: [
      "Incluido: valor sin IVA = valor total ÷ (1 + tasa de IVA).",
      "Excluido: valor con IVA = valor base × (1 + tasa de IVA).",
      "Exento: IVA = 0.",
      "IVA = valor antes de IVA × tasa de IVA.",
    ],
    note: "La presentación redondea hacia abajo para evitar que el valor final supere el techo por efecto del redondeo.",
  },
  {
    title: "Retenciones y estampillas",
    summary: "Separa oferta bruta, deducciones, recaudo y utilidad neta.",
    lines: [
      "Cada retención = base elegida × tasa %.",
      "Bases disponibles: antes de IVA, valor del IVA o total con IVA.",
      "Estampillas = oferta total con IVA × tasa %.",
      "Descuentos de recaudo = ReteFuente + ReteIVA + ReteICA + estampillas.",
      "Recaudo neto esperado = oferta con IVA − descuentos de recaudo.",
      "Utilidad neta estimada = recaudo neto esperado − costo total.",
    ],
    note: "Las retenciones y estampillas se muestran en valor y con desglose en Oferta económica. No reducen el importe bruto usado para compararlo con el techo.",
  },
  {
    title: "Techo total y alertas",
    summary: "Contrasta la oferta con IVA con la referencia total y los techos de cada ítem.",
    lines: [
      "Techo total = techo global registrado; si no existe, suma de techos unitarios completos.",
      "Comparación global = techo total − oferta registrada con IVA.",
      "Oferta mayor que techo total = exceso cierto, incluso si faltan ítems por ofertar.",
      "Oferta parcial por debajo del techo = diferencia provisional; todavía no es un descuento final.",
      "La comparación por ítem usa el techo unitario y es independiente del techo total.",
    ],
    note: "En Oferta económica, el techo total aparece primero como referencia. Si el pliego no indica cantidad, la app puede calcular con una unidad asumida y lo advierte para que la confirmes.",
  },
  {
    title: "Oferta económica",
    summary: "Reúne el entregable para revisar y exportar.",
    lines: [
      "Muestra total sin IVA, IVA y total con IVA de los ítems con oferta registrada.",
      "Retenciones y estampillas se pueden desplegar por tipo.",
      "Utilidad neta estimada = oferta con IVA − deducciones − costos conocidos.",
      "El techo total se compara con la oferta bruta con IVA, no con el recaudo neto.",
    ],
    note: "El encabezado indica cuántos ítems tienen oferta. Un exceso del techo total se alerta de inmediato; una diferencia favorable con ofertas faltantes se marca provisional.",
  },
];

const offerStrategies = [
  {
    name: "Global",
    method: "Aplica el mismo porcentaje solicitado a todas las filas elegibles.",
    use: "Cuando quieres una reducción uniforme y fácil de explicar.",
  },
  {
    name: "Global protegido",
    method: "Solo ajusta filas que todavía tienen utilidad positiva y conserva el costo como límite inferior.",
    use: "Cuando la prioridad es no empujar filas ajustadas hacia pérdida.",
  },
  {
    name: "Por extremos",
    method: "Da más descuento a los ítems con mayor margen unitario. El factor crece entre 0,25 y 1,80 según su distancia frente al mayor margen del grupo.",
    use: "Cuando algunos ítems tienen mucho más espacio unitario que otros.",
  },
  {
    name: "Por peso total",
    method: "Da más descuento a los ítems que más pesan en el valor total de la oferta. El factor se limita entre 0,35 y 1,90.",
    use: "Cuando quieres que los ítems de mayor impacto económico absorban más ajuste.",
  },
  {
    name: "Por utilidad disponible",
    method: "Reparte más descuento donde existe mayor utilidad total: margen unitario por cantidad. El factor se limita entre 0,20 y 1,60.",
    use: "Cuando buscas consumir utilidad de manera proporcional sin tratar igual ítems muy distintos.",
  },
];

export function HelpCenter() {
  const [view, setView] = useState<HelpView>("start");

  return (
    <>
      <nav className="help-view-switch" aria-label="Secciones de ayuda">
        <button type="button" className={view === "start" ? "active" : ""} onClick={() => setView("start")}>
          Cómo empezar
        </button>
        <button type="button" className={view === "calculations" ? "active" : ""} onClick={() => setView("calculations")}>
          Qué calcula
        </button>
        <button type="button" className={view === "control" ? "active" : ""} onClick={() => setView("control")}>
          Guardado y control
        </button>
      </nav>

      {view === "start" ? (
        <section className="help-panel" aria-labelledby="help-start-title">
          <div className="help-section-heading">
            <p>Flujo recomendado</p>
            <h2 id="help-start-title">De los datos a una oferta revisable</h2>
          </div>
          <ol className="help-flow">
            {flowSteps.map(([title, description], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><strong>{title}</strong><p>{description}</p></div>
              </li>
            ))}
          </ol>
          <div className="help-entry-grid">
            <article><strong>Mesa de ítems</strong><p>Revisa cada renglón, filtra pendientes y despliega su detalle. El resumen financiero se compacta al bajar para dejar más espacio a la tabla.</p></article>
            <article><strong>Edición en bloque</strong><p>Ajusta varios ítems y costos desde la tabla cuando ya conoces qué campos debes corregir.</p></article>
            <article><strong>Datos recibidos e investigación</strong><p>En el detalle, compara a la izquierda la descripción y ficha registradas con las fuentes, costos y notas de trabajo a la derecha. Abre la ficha técnica anexa completa cuando exista.</p></article>
            <article><strong>Costos asociados</strong><p>Una sugerencia de la IA no se suma. Elige Aplicar o No aplica; puedes editar su precio o eliminarla. Los costos generales se suman una sola vez al cálculo.</p></article>
          </div>
          <div className="help-callout">
            <strong>Regla práctica</strong>
            <p>Los totales de oferta se muestran con los ítems que ya tienen precio; la utilidad necesita también costos. Un costo pendiente no debe ocultar la oferta registrada. Revisa la cobertura antes de interpretar una diferencia frente al techo.</p>
          </div>
        </section>
      ) : null}

      {view === "calculations" ? (
        <section className="help-panel" aria-labelledby="help-calculations-title">
          <div className="help-section-heading">
            <p>Motor determinístico</p>
            <h2 id="help-calculations-title">Funciones de cálculo</h2>
          </div>
          <div className="help-formula-list">
            {calculationGroups.map((group, index) => (
              <details key={group.title} open={index === 0}>
                <summary>
                  <span><strong>{group.title}</strong><small>{group.summary}</small></span>
                  <i aria-hidden="true">+</i>
                </summary>
                <div className="help-formula-body">
                  <ul>{group.lines.map((line) => <li key={line}><code>{line}</code></li>)}</ul>
                  <p>{group.note}</p>
                </div>
              </details>
            ))}
          </div>
          <details className="help-offer-strategies">
            <summary>
              <span><strong>Estrategias de oferta en lote</strong><small>Cómo distribuyen el descuento entre los ítems seleccionados.</small></span>
              <i aria-hidden="true">+</i>
            </summary>
            <div className="help-strategy-methods">
              <div className="help-strategy-rule">
                <code>Descuento efectivo por fila = descuento solicitado × factor de la estrategia</code>
                <p>Ninguna estrategia reduce la oferta por debajo del costo. Una fila sin utilidad disponible se conserva sin cambios.</p>
              </div>
              {offerStrategies.map((strategy) => (
                <article key={strategy.name}>
                  <strong>{strategy.name}</strong>
                  <p>{strategy.method}</p>
                  <small>{strategy.use}</small>
                </article>
              ))}
              <p className="help-strategy-example"><strong>Ejemplo:</strong> si solicitas 10 % y una fila recibe factor 1,5, el ajuste calculado para esa fila es 15 %, limitado siempre por su costo.</p>
              <p className="help-strategy-caveat"><strong>Nota actual:</strong> Global y Global protegido respetan el mismo piso de costo; la segunda opción hace explícito que solo se intervienen filas con utilidad positiva.</p>
            </div>
          </details>
        </section>
      ) : null}

      {view === "control" ? (
        <section className="help-panel" aria-labelledby="help-control-title">
          <div className="help-section-heading">
            <p>Trazabilidad</p>
            <h2 id="help-control-title">Trabaja sin perder cambios</h2>
          </div>
          <div className="help-control-list">
            <article><strong>Guardar cálculo</strong><p>Conserva los cambios actuales. También se guardan automáticamente mientras trabajas; comprueba el indicador antes de salir.</p></article>
            <article><strong>Escenario de oferta</strong><p>Guarda las decisiones de oferta y su configuración para compararlas. Al activarlo se mantienen los costos y fuentes actuales; si cambió la lista de ítems, no se puede aplicar.</p></article>
            <article><strong>Base de costos</strong><p>Guarda una versión de costos, fuentes y referencias. Puedes cambiar de base sin reemplazar la oferta. Guardar y activar bases requiere un cálculo vinculado a Odoo.</p></article>
            <article><strong>Deshacer y rehacer</strong><p>Revierte cambios recientes desde la barra de la mesa sin restaurar todo el cálculo.</p></article>
            <article><strong>Fuentes y costos manuales</strong><p>Consulta proveedor, precio y enlace; elige una cotización concreta o escribe un costo base. Los servicios investigados pueden llegar sin costo automático y requieren decisión humana.</p></article>
            <article><strong>Importar y exportar</strong><p>Revisa el diagnóstico antes de incorporar Excel, CSV o JSON. En Oferta económica puedes exportar la tabla a Excel.</p></article>
            <article><strong>Acceso Odoo</strong><p>Debes tener sesión activa y permiso de edición en Odoo para trabajar en Finanzas y guardar versiones vinculadas.</p></article>
          </div>
          <details className="help-status-details">
            <summary>Cómo leer los estados financieros</summary>
            <dl>
              <div><dt>Viable</dt><dd>Oferta con costo, cantidad y techo válidos; margen igual o superior al 10 %.</dd></div>
              <div><dt>Ajustado</dt><dd>La oferta cubre el costo, pero el margen es menor al 10 %.</dd></div>
              <div><dt>Sobre techo</dt><dd>La oferta supera el precio de referencia.</dd></div>
              <div><dt>Pérdida</dt><dd>La oferta queda por debajo del costo.</dd></div>
              <div><dt>Sin techo</dt><dd>La fila no tiene techo unitario; si existe techo total, la oferta completa sí se compara con él.</dd></div>
              <div><dt>Incompleto</dt><dd>Falta cantidad, costo u oferta para cerrar la fila. La oferta ya registrada y los costos conocidos pueden seguir mostrándose por separado.</dd></div>
            </dl>
          </details>
        </section>
      ) : null}
    </>
  );
}
