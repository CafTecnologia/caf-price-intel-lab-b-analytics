# Contrato De Ingesta V2 - Simulador Financiero

Esta app recibe datos externos y calcula la oferta económica. No busca precios, no usa IA y no debe recibir cálculos finales.

## Idea central

La ingesta solo trae hechos externos:

- ítems;
- cantidades;
- unidades;
- precio techo unitario;
- fuentes de precio;
- servicios o costos asociados al ítem;
- costos generales conocidos del proyecto;
- notas útiles para el usuario.

La app crea su propio cálculo, ID y consecutivo. También calcula internamente costo mínimo, promedio, moderado, oferta, utilidad, margen, alertas y totales.

## Endpoint

```text
POST /api/import
Content-Type: application/json
```

Respuesta:

```json
{
  "calculationId": "uuid-creado-por-la-app",
  "url": "/calculations/uuid-creado-por-la-app"
}
```

## Campos del contrato

| Grupo | Campo | Nivel | Qué significa | Si viene vacío |
| --- | --- | --- | --- | --- |
| Sistema | `version` | Opcional | Versión del contrato. Usar `2`. | La app intenta normalizar el formato recibido. |
| Origen | `source.system` | Opcional | Sistema que envía datos. | Queda como ingesta manual/API. |
| Origen | `source.run_id` | Opcional | ID de la corrida que produjo los datos. | Sin vínculo a corrida. |
| Origen | `source.analysis_id` | Opcional | ID del análisis IA origen. | No se vincula a análisis. |
| Origen | `source.odoo_project_id` | Opcional | ID del proyecto Odoo. | No se vincula a proyecto. |
| Presupuesto | `settings.manual_reference_total` | Opcional | Presupuesto techo global bruto documentado, no un costo ni un techo por ítem. Admite cero; no negativos. | En una reimportación, la omisión conserva el techo existente; `null` explícito lo limpia. |
| Ítem | `items[].deliverable_type` | Opcional | `product` o `service`: concepto principal del entregable. La clasificación no impide registrar una cotización humana de servicios. | Sin clasificar; la omisión en revisiones conserva el dato previo. |
| Ítem | `items[].name` | Obligatorio | Descripción corta registrada; se muestra en la columna de datos recibidos. No acredita por sí sola literalidad del pliego. | La fila no es válida. |
| Ítem | `items[].item` | Opcional | Número o código del ítem. | La app puede numerar. |
| Ítem | `items[].description` | Opcional | Ficha técnica registrada, separada del nombre corto. Conservar texto documental cuando exista; si fue interpretada, indicarlo en notas o soporte. | Queda en blanco. |
| Origen literal | `items[].source_original` | Opcional | Transcripción separada de la interpretación: `description`, `technical_description`, `quantity`, `unit`, `ceiling_unit_price` como texto; `document` y `locator` identifican dónde contrastarla. La app presenta esto como transcripción aportada, sin certificarla automáticamente. | La pantalla indica que no recibió original literal; no inventa uno a partir de campos interpretados. |
| Anexo literal | `items[].technical_annex` | Opcional | Lista de `{document, locator, text}` con extractos literales de anexos técnicos aplicables al mismo entregable. Resolver familia y modalidad antes de cargar la sección; si están confirmadas, incluir solo el prólogo pertinente y la sección completa. No mezclar con la fila económica ni inferir correspondencia solo por el número de ítem. | No se muestra una ficha anexa. |
| Estado del costo | `items[].cost_basis_status` | Opcional | `conforming` para alcance comprobado; `comparable_scenario` para precio comercial útil con diferencias o supuestos explícitos; `partial` para una parte conocida; `pending` cuando no hay escenario útil. Los dos estados intermedios muestran utilidad de escenario, sin afirmar homologación. | La app conserva el comportamiento previo del costo. |
| Ítem | `items[].quantity` | Recomendado | Cantidad documental. | La app calcula una unidad asumida y la marca como tal; no cambia el dato original. |
| Ítem | `items[].unit` | Recomendado | Unidad de medida. | Se muestra sin unidad. |
| Ítem | `items[].ceiling_unit_price` | Recomendado | Precio techo unitario. | No compara contra techo. |
| Fuentes | `items[].price_sources` | Recomendado | Fuentes de precio. Ideal 1 a 3. | No calcula costo automático. |
| Fuentes | `price_sources[].id` | Opcional | Identificador estable y único dentro del ítem. | La app crea uno por orden. |
| Fuentes | `price_sources[].name` | Recomendado | Proveedor, tienda o fuente. | Se muestra como fuente sin nombre. |
| Fuentes | `price_sources[].unit_price` | Recomendado | Precio unitario encontrado. | Esa fuente no sirve para costo. |
| Fuentes | `price_sources[].currency` | Recomendado | `COP` o `USD`. | Asume `COP`. |
| Fuentes | `price_sources[].url` | Opcional | Link de trazabilidad. | Sin link. |
| Fuentes | `price_sources[].notes` | Opcional | Observaciones útiles. | Sin notas. |
| Fuentes | `price_sources[].trm` | Opcional | TRM específica si esa fuente está en USD. | Usa TRM interna/configurable o muestra alerta. |
| Ítem | `items[].has_associated_cost` | Opcional | Compatibilidad heredada para señalar un posible costo separado; evitarlo para obligaciones ordinarias ya incluidas. | Sin lista, crea una sugerencia sin precio que no se suma. |
| Ítem | `items[].additional_costs` | Opcional | Componentes separados y no incluidos en la fuente principal; admite varios. Una posibilidad con evidencia pero alcance incierto puede quedar sugerida. | Lista vacía; con `has_associated_cost: true` se crea una sugerencia. |
| Costo de ítem | `additional_costs[].id` | Opcional | ID externo estable del costo. | La app crea uno. |
| Costo de ítem | `additional_costs[].name` | Obligatorio por entrada | Nombre del servicio o costo. | La entrada no es válida. |
| Costo de ítem | `additional_costs[].category` | Opcional | `service`, `logistics` u `other`. | `service`. |
| Costo de ítem | `additional_costs[].mode` | Opcional | `fixed` una vez o `per_unit` por unidad. | `fixed`. |
| Costo de ítem | `additional_costs[].amount` | Opcional | Valor numérico o `null` si se conoce el servicio pero falta cotizar. | Pendiente; no se suma al total. `0` es cero confirmado. |
| Costo de ítem | `additional_costs[].review_status` | Opcional | `suggested` espera decisión humana y no se suma; `included` se suma; `excluded` conserva el descarte sin sumarlo. | `included` para mantener los cálculos ya guardados. |
| Costo de ítem | `additional_costs[].notes` | Opcional | Contexto de este costo. | Sin nota. |
| Proyecto | `general_costs` | Opcional | Costos de todo el cálculo, fuera de los ítems. | Lista vacía. |
| Costo general | `general_costs[].id` | Opcional | ID externo estable. | La app crea uno. |
| Costo general | `general_costs[].name` | Obligatorio por entrada | Nombre del costo general. | La entrada no es válida. |
| Costo general | `general_costs[].category` | Opcional | `service`, `logistics` u `other`. | `other`. |
| Costo general | `general_costs[].amount` | Obligatorio por entrada | Valor numérico no negativo, sumado una vez al proyecto. | La entrada no es válida. |
| Costo general | `general_costs[].notes` | Opcional | Contexto del costo. | Sin nota. |
| Ítem | `items[].notes` | Opcional | Notas generales del ítem. | Sin notas. |

`items` es obligatorio y debe contener al menos un ítem. Los campos numéricos aceptan números JSON o texto numérico; los precios de proveedor son unitarios. La fuente seleccionada, el modo de costo y la oferta se deciden dentro de la app, nunca en este contrato público.

## Ejemplo mínimo aceptable

```json
{
  "version": 2,
  "items": [
    { "name": "Taladro profesional" }
  ]
}
```

## Ejemplo recomendado

```json
{
  "version": 2,
  "source": {
    "system": "ia-stages-web",
    "analysis_id": "uuid-analisis",
    "odoo_project_id": "123"
  },
  "items": [
    {
      "item": "1",
      "name": "Taladro profesional",
      "description": "Taladro 1/2 pulg, uso profesional.",
      "unit": "UND",
      "quantity": 2,
      "ceiling_unit_price": 350000,
      "price_sources": [
        {
          "id": "proveedor-a",
          "name": "Proveedor A",
          "unit_price": 210000,
          "currency": "COP",
          "url": "https://example.com/a",
          "notes": "Producto comparable"
        },
        {
          "name": "Proveedor USA",
          "unit_price": 55,
          "currency": "USD",
          "url": "https://example.com/us",
          "trm": 4000
        }
      ],
      "has_associated_cost": true,
      "additional_costs": [
        { "name": "Instalación", "category": "service", "mode": "fixed", "amount": 30000 }
      ],
      "notes": "Revisar garantía mínima solicitada."
    }
  ],
  "general_costs": [
    { "name": "Póliza global", "category": "other", "amount": 15000 }
  ]
}
```

## No enviar en el contrato público

No enviar campos que la app calcula o que el usuario ajusta dentro del simulador:

- costo manual;
- costo mínimo, promedio o moderado;
- modo de costo seleccionado;
- fuente de precio seleccionada;
- modo de oferta;
- descuento;
- utilidad objetivo;
- oferta manual;
- IVA operativo;
- totales;
- utilidad;
- margen;
- alertas;
- estados.

## Compatibilidad

La app puede seguir aceptando formatos anteriores (`calculation`, `project`, `reference_unit`, `source_1_*`) para no romper datos viejos ni Excel heredado. Esos campos no son el contrato público recomendado.
## Actualizaciones Incrementales IA

Para nuevas escrituras de IA sobre un cálculo existente, usar `POST /api/projects/{calculationId}/operations`: permite comparar los campos esperados, conservar decisiones humanas y recuperar un recibo de reintento. `POST /api/import` crea el cálculo inicial; una reimportación conserva la lista de costos asociados que ya tenga el ítem, incluso si está vacía. Cambiarla requiere una operación explícita o edición humana.

La secuencia segura es: leer `GET /api/projects/{calculationId}/operations` con credencial de servicio; tomar `updatedAt`, `odooProjectId` y `editableFields` del ítem; enviar `POST` con `externalRunId`, `jobId`, `operationId` estable y `expectedUpdatedAt`. Cada `update_item` incluye en `expected` exactamente los campos que cambia en `patch`. Repetir el mismo `operationId` con el mismo contenido devuelve el recibo anterior; contenido distinto o valor humano cambiado devuelve conflicto. Consultar el recibo por `GET .../operations?operationId=...` tras un timeout. La IA solo debe enviar campos externos permitidos, no costo manual, oferta ni utilidad. Para `additional_costs`, comparar la lista completa antes de cambiarla y registrar solo componentes separados que no estén en el costo principal; las dudas con evidencia usan `review_status: suggested`. `add_item` acepta `source_original` y `technical_annex` cuando hay fragmentos localizados. En `update_item`, la IA puede agregar o corregirlos con `patch.source_original` o `patch.technical_annex`; debe enviar en `expected` el valor leído, o `null` si aún no había original. Una corrección humana posterior produce conflicto y la operación de IA no puede borrar el original con `null`.

El endpoint incremental heredado sigue documentado para clientes existentes en:

```text
apps/financial-offer-web/docs/IA_INCREMENTAL_UPDATES.md
```

Endpoint:

```text
POST /api/projects/{calculationId}/external-updates
```

Ese endpoint heredado actualiza solo hechos externos por ítem, pero su respuesta no es un recibo persistido y su lectura/guardado no protege toda la actualización frente a escrituras concurrentes. No usarlo como nueva vía de sincronización IA hasta migrarlo al motor de operaciones.

Resumen de reglas:

- `POST /api/import` crea el calculo inicial.
- `POST /api/projects/{calculationId}/operations` aplica cambios acotados con valores esperados y recibo idempotente; un conflicto no pisa una edición humana.
- Las fuentes se mergean por `source_id`, `id`, `url` o nombre.
- Si el usuario esta editando costo manual/oferta, esos campos se conservan.
- La UI abierta absorbe cambios externos seguros cada pocos segundos.

## Presupuesto global, costos parciales y tipo de entregable

El descuento de precios se compara con los techos unitarios multiplicados por las mismas cantidades incluidas en la oferta, antes del redondeo de presentación. `buildOfferPresentation().summary` expone `priceReferenceTotal`, `totalOfferBeforeRounding` y `priceDiscountPct`; sin oferta o techo comparable de todos los renglones del alcance, la comparación queda pendiente. La diferencia frente al presupuesto global se muestra como saldo y conserva sus alertas de exceso. El redondeo de oferta/IVA conserva su regla vigente y se identifica aparte; no crea un descuento aplicado. Los porcentajes históricos de `buildSimulation().summary` siguen expresando la relación con su referencia global y no deben usarse como descuento de precios.

El techo global reutiliza el campo manual del simulador. No se reparte entre filas ni se transforma en costo. Si faltan costos o datos de oferta, el resumen compara ese presupuesto con todos los componentes conocidos, incluidos los costos generales una sola vez, en tonos grises y con pendientes visibles. El saldo previo a pendientes no es utilidad ni oferta.

Un ítem `service` importado queda con costo seleccionado vacío y base `pending` si no trae un costo manual explícito; las fuentes se conservan como evidencia y los costos asociados llegan como sugerencias aunque el payload los marque incluidos. Una importación identificada por `ia_run_id` o `source_system` siempre queda pendiente, incluso si trae un valor de costo manual. Así, la simulación no suma cargos de IA sin confirmar ni muestra utilidad hasta que el usuario revise los costos. Una importación sin metadata IA puede conservar un costo manual explícito de confianza. Una reimportación coincidente conserva las decisiones humanas y los datos completos de una cotización seleccionada, además de las nuevas fuentes sin duplicar la elegida. Si se omite `deliverable_type`, se conserva el tipo previo y se aplica su regla de costo. Los ítems `product` mantienen el cálculo automático desde sus fuentes. Esta regla aplica al convertir importaciones y no modifica cálculos históricos al leerlos.

Cada fila conserva su entregable original y puede clasificarse como producto o servicio. En un entregable mixto, la fuente principal registra el producto conocido mientras `additional_costs` contiene el servicio separado, incluso con `amount: null` si falta precio. No se presentan esos componentes como fuentes alternativas ni se reemplaza toda la fila por cero. La utilidad se calcula con los costos conocidos y advierte los pendientes y sugeridos; estos no bloquean la evaluación. Una cotización humana de servicios sigue siendo utilizable.

La revisión IA puede cambiar el presupuesto mediante la operación acotada `set_project_reference`, con `manual_reference_total` y `expected.manual_reference_total`. Se conserva el control de versión del cálculo, los conflictos con edición humana y el recibo idempotente. El dato presupuestal y la clasificación forman parte de la base de costos versionada; la oferta humana permanece separada.
