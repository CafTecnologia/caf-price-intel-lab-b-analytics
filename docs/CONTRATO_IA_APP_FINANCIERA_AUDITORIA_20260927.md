# Auditoría del contrato IA → Simulador Financiero

Fecha: 2026-09-27  
Entorno revisado: DEV, `apps/financial-offer-web` y adaptador `apps/ia-stages-web`  
Alcance: lectura de contrato, normalización, motor, persistencia, actualizaciones incrementales, carga manual y pruebas. No se modificó código ni datos.

## Conclusión operativa

La frontera correcta es sencilla: la IA entrega hechos externos y trazabilidad; el simulador calcula y conserva las decisiones financieras. En el contrato público v2 la IA debe entregar ítems, cantidad, unidad, techo unitario ofertable, cotizaciones sin agregarlas, costos asociados conocidos y notas. El simulador normaliza monedas, construye alternativas de costo, aplica costos adicionales, inicia la oferta, compara contra el techo, descompone IVA, redondea, calcula utilidad, retenciones y totales.

Para el caso CAF revisado, `ceiling_unit_price` debe ser el valor unitario bruto realmente ofertable, con IVA incluido cuando el documento lo incluye. El adaptador no debe enviar el valor neto esperando que la app le agregue IVA. Tampoco debe enviar costos calculados, fuente seleccionada, margen, oferta, descuento, utilidad ni totales.

El contrato vigente tiene cuatro brechas materiales:

1. El público v2 fuerza internamente `vat_mode = included` y no documenta con precisión la base tributaria de techos y fuentes. Cambiar a `excluded` no es una corrección segura porque el mismo modo transforma el costo y el techo.
2. Toda fuente USD recibe por defecto un recargo de importación de 30 %, pero el contrato público no puede indicar `import_pct` ni declarar si el precio ya es puesto en Colombia.
3. El adaptador de `ia-stages-web` incluye una TRM global en `settings.usd_to_cop_rate`, pero el esquema público v2 la descarta. Solo sobrevive la TRM enviada dentro de cada fuente.
4. El adaptador legado de Stage 3 revisado no envía `create_once`. Un reintento desde ese caller puede reconstruir el cálculo existente y reemplazar decisiones humanas; la preservación especial actual cubre costos adicionales, no toda la edición financiera. Este hallazgo no se traslada al flujo CAFstudy actual, que sí envía `create_once` según la evidencia operativa de la sesión.

## Matriz de responsabilidades

| Tema | La IA entrega | La app calcula o decide | Riesgo vigente y regla operativa |
| --- | --- | --- | --- |
| Identidad | `version: 2`; `source.system`, `analysis_id`, `run_id`, `odoo_project_id`; `external_id` estable si aplica | UUID y consecutivo propios; enlaces con Odoo | Los callers que crean una vez deben usar `create_once: true` en nivel superior con `external_id`/`run_id` estable. CAFstudy ya lo hace; el adaptador legado Stage 3 revisado no. `source.create_once` está declarado pero no participa en la protección persistente. |
| Ítem | Código, nombre, ficha, cantidad y unidad como hechos del documento | Cantidad efectiva 1 para totales cuando falta cantidad y existen valores; no modifica el dato original | Cantidad faltante puede producir un total provisional con 1. No inventar cantidad. |
| Techo | `ceiling_unit_price` unitario bruto ofertable | Multiplica por cantidad; compara oferta; calcula descuento/exceso | No enviar total de línea en campo unitario. No enviar neto cuando el documento publica IVA incluido. No fijar silenciosamente un `manualReferenceTotal` para reconciliar inconsistencias. |
| Fuentes | Hasta tres fuentes trazables: ID estable, nombre, precio unitario, moneda, URL, notas y TRM específica si existe | Valida/normaliza, calcula mínimo, promedio y costo moderado; el usuario elige fuente o modo | El adaptador actual no envía IDs y trunca a tres. Un precio 0 sin marcador es un cero real y puede sesgar el costo. |
| COP | Precio unitario COP comparable con condiciones de la fuente | Lo usa directamente como valor normalizado | Criterio CAF para precios comerciales colombianos: sin indicación fiscal, presumir que el precio anunciado ya incluye IVA y registrar que es un supuesto; no adicionarlo de nuevo. Si se anuncia «+ IVA»/«sin IVA», conservar el neto y documentar un bruto solo con tasa verificada; si falta tasa, dejar el precio final pendiente. Separar esta regla de la base fiscal del techo oficial y del IVA de oferta que calcula Finanzas. Documentar flete; no convertir otra moneda a COP en la IA sin trazabilidad. |
| USD y TRM | Precio unitario USD crudo; TRM por fuente cuando sea un hecho disponible | `USD × TRM × (1 + importPct/100)` | La TRM global enviada actualmente se pierde en v2. Sin TRM por fuente, el costo queda `null` con alerta. |
| Importación | Hechos de importación o transporte conocidos, sin calcular el costo normalizado | Aplica `importPct` específico o el global, hoy 30 % por defecto | El público v2 no admite `import_pct`; puede haber doble conteo si la cotización USD ya incluye nacionalización o si el mismo transporte entra en costos asociados. |
| IVA | Precio techo y precio de fuente en una base explícita y coherente; notas cuando la fuente no informa IVA | Convierte `excluded` a bruto; descompone una oferta bruta en neto e IVA; `exempt` usa tasa 0 | Hoy v2 fuerza `included/19`. No exponer todavía `vat_mode/vat_rate` sin separar el efecto sobre costo y techo. |
| Costo asociado al ítem | `additional_costs[]`: nombre, categoría, `fixed` o `per_unit`, monto conocido o `null`; o `has_associated_cost: true` | Suma por unidad o una vez; reparte el fijo sobre la cantidad para costo unitario; alerta pendientes | `null` significa pendiente y no se suma. Cero significa cero confirmado. Un negativo de costo de ítem termina limitado a cero; debe rechazarse antes de enviar. |
| Transporte | Un costo trazable `category: logistics`, con modo correcto, cuando no está incluido en la fuente | Lo agrega una vez o por unidad | No plegarlo a la cotización y además enviarlo como costo asociado. La categoría no controla la fórmula; la controla `mode`. |
| Costos generales | `general_costs[]` con nombre, categoría, monto no negativo y nota | Los suma una sola vez al costo total del proyecto | No asignarlos artificialmente a cada ítem. El contrato público sí rechaza generales incompletos o negativos. |
| Costo base | Cotizaciones individuales, sin mínimo/promedio/moderado calculado | Mínimo; promedio; moderado = `(mínimo + promedio) / 2`; costo manual o fuente elegida por usuario | El modo interno llamado `weighted` usa el costo moderado, no una ponderación por confiabilidad. La IA no debe enviar `cost_*` ni seleccionar proveedor. |
| Oferta | Ninguna oferta, descuento, utilidad objetivo o modo comercial | Inicia en el techo cuando existe; permite descuento, utilidad o manual; mantiene la oferta corriente como verdad | `manualOfferUnit` es un nombre histórico: guarda la oferta corriente incluso en modos no manuales. No tratarlo como un dato externo. |
| Redondeo | Valores con su precisión original | Redondea el neto hacia abajo: paso 1 para valores menores a 1.000 y paso 10 desde 1.000; trunca IVA a entero; protege no exceder techo | La IA no debe redondear previamente. La oferta presentada puede quedar ligeramente por debajo del techo original. |
| Retenciones y estampilla | Nada en el contrato público | Usuario/configuración de app define tasas y bases; la app calcula recaudo neto | No son costos de proveedor ni deben entrar en el JSON de IA. |
| Pendientes | `null` para precio desconocido y una nota clara; para compatibilidad CAF puede usarse precio 0 con marcador exacto `PENDIENTE_COSTO` | Excluye ese cero de costos y muestra alerta | Precio 0 sin marcador se considera válido. Texto como “pendiente” sin el marcador exacto no activa la protección. |
| Carga humana | Excel/CSV/pegado entrega los mismos hechos; el usuario puede editar costo manual, fuente, oferta e IVA dentro de la app | Normaliza formatos colombianos y conserva controles humanos | La carga para agregar ítems anexa; no es idempotente por sí misma. El pegado de actualización puede cambiar techo y costo manual. |
| Update IA | Solo campos externos permitidos: techo, fuentes, notas y datos base puntuales | Mergea fuentes; conserva costo manual y oferta persistidos | `idempotency_key` solo se devuelve; no hay libro de recibos. La idempotencia depende de IDs/URL/nombres estables. No existe borrado de fuentes. |

## Flujo vigente y evidencia de código

### Contrato público y normalización

- `lib/contract.ts:109-146` define fuente e ítem públicos. La fuente pública acepta `unit_price`, `currency`, URL, notas y TRM; no acepta `import_pct`.
- `lib/contract.ts:246-255` define el público v2. Acepta `create_once` superior, pero no `settings`.
- `lib/contract.ts:450-506` transforma el público al contrato interno: `ceiling_unit_price → reference_unit`, elimina decisiones financieras y fuerza `vat_mode = included`.
- `lib/contract.ts:597-621` construye metadatos desde `source` y devuelve `settings: {}`. Por esto se descarta `settings.usd_to_cop_rate` que el adaptador cree enviar.
- `lib/contract.ts:704-793` materializa el cálculo persistido, con IVA 19 % e importación 30 % por defecto.
- `docs/API_CONTRACT.md:136-153` ya prohíbe enviar costo manual, agregados de costo, selección, oferta, IVA operativo, totales y utilidad.

### Adaptador legado Stage 3 inspeccionado

- `apps/ia-stages-web/lib/stage3-to-financial-ingest.ts:1-5` declara correctamente que la app financiera calcula.
- `stage3-to-financial-ingest.ts:96-114` copia techo y fuentes sin corregir su base tributaria.
- `stage3-to-financial-ingest.ts:117-130` añade una TRM global en `settings`, campo que el público v2 descarta.
- `stage3-to-financial-ingest.ts:135-185` toma hasta tres fuentes, pero no conserva un ID estable ni `import_pct`.
- `apps/ia-stages-web/app/api/financial-offer/import/route.ts:27-40` envía el payload sin `create_once`. Es un caller legado distinto del flujo CAFstudy actual.
- El tipo del adaptador no transporta `additional_costs` ni `general_costs`, aunque el simulador sí los admite.
- El contrato público financiero sí admite `general_costs` en el nivel superior (`lib/contract.ts:246-255`). Que un runtime estricto genere solo `version/items` limita a ese caller, no al contrato receptor.

### Motor de costos, IVA y oferta

- `lib/financial-engine.ts:314-343` maneja pendientes y normaliza fuentes COP/USD.
- `lib/financial-engine.ts:349-445` calcula mínimo, promedio, moderado y selección de costo.
- `lib/financial-engine.ts:225-244` aplica IVA: `excluded` multiplica la entrada; `included` y `exempt` dejan el bruto recibido.
- `lib/financial-engine.ts:493-533` inicia controles y da precedencia absoluta a `manualOfferUnit` como oferta corriente.
- `lib/financial-engine.ts:655-742` agrega costos por unidad, fijos y generales y construye techo, oferta, margen y alertas.
- `lib/financial-engine.ts:247-300` redondea hacia abajo la presentación de oferta y limita contra el techo.
- `lib/financial-engine.ts:825-923` descompone IVA, calcula retenciones, recaudo y utilidad.

### Persistencia e idempotencia

- `lib/store.ts:251-309` implementa `create_once` con recibo y huella SHA-256. Un reintento idéntico retorna el cálculo existente; contenido distinto se rechaza.
- Sin `create_once`, el mismo `external_id` reconstruye el cálculo. `lib/contract.ts:798-825` conserva costos adicionales ya completados, pero no ofrece una preservación equivalente para costo manual, selección y oferta.
- `lib/store.ts:224-248` y `app/api/projects/[projectId]/route.ts:266-285` protegen guardados humanos con `expectedUpdatedAt` y responden 409 en conflicto.
- `app/api/projects/[projectId]/external-updates/route.ts:8-31` no usa `expectedUpdatedAt`; lee, mezcla y guarda una lista completa de ítems. Dos updates concurrentes pueden perder el cambio del otro.
- `docs/IA_INCREMENTAL_UPDATES.md:222-224` reconoce que `idempotency_key` no se persiste y que la idempotencia práctica depende del matching de fuentes.

## Caso 1930: techo neto y oferta anclada

Las dos corridas comparadas tienen 27 ítems. En cada fila `R1 = R2 × 1,19`, con desviación máxima menor a `3e-10`. La suma unitaria pasa de `22.941.287,50` a `27.300.132,125`. Los 27 ítems de R2 están persistidos en `included/19` y sus cuatro campos de oferta siguen nulos; `updatedAt` coincide con `createdAt`.

Esto prueba que R2 entregó netos dentro de un contrato que interpreta el techo como bruto incluido. La reparación de datos debe actualizar el techo unitario bruto y dejar intactos costos, fuentes, aprobación y fórmulas. El total ponderado por cantidad da `27.432.683,25` porque el ítem 16 tiene cantidad 6; el documento publicado suma una unidad por línea. Ese conflicto no se resuelve fijando un techo global oculto.

## Riesgos priorizados

| Severidad | Riesgo | Efecto |
| --- | --- | --- |
| Alta | Un caller reimporta la misma corrida sin `create_once` | Puede reemplazar decisiones humanas del cálculo existente. No aplica al CAFstudy actual si conserva su `create_once`. |
| Alta | Corregir techo por update externo con la pantalla abierta | El techo cambia, pero el control conserva la oferta inicial vieja; el autoguardado la persiste como descuento involuntario. |
| Alta | Precio USD ya nacionalizado + recargo automático 30 % | Duplica importación y sobredimensiona costo. |
| Alta | Usar `excluded` para convertir un techo neto | También incrementa cotizaciones/costo por el mismo IVA. |
| Media | TRM global del adaptador descartada | Fuente USD queda sin costo, salvo que la propia fuente traiga TRM. |
| Media | Precio 0 sin `PENDIENTE_COSTO` | Se convierte en costo mínimo real y contamina promedio/moderado. |
| Media | Updates externos concurrentes sin control de versión | Un update puede sobrescribir otro porque ambos guardan todos los ítems. |
| Media | Fuentes sin ID estable | Cambios de nombre/URL u orden pueden crear duplicados. |
| Media | IVA o flete no informado en la fuente | La app carece de una base separada por fuente; el costo puede no ser comparable con el techo. |
| Baja | Cantidad vacía con valores | La app usa 1 para totales provisionales; puede parecer un total definitivo. |
| Baja | Costo asociado negativo | Se limita a cero en vez de rechazarse en el contrato de ítem. |

## Parche propuesto para polling de controles vírgenes

No se propone reinicializar todos los controles cuando llega un update. Eso borraría descuentos, utilidad objetivo u ofertas manuales del usuario. La corrección debe actuar solo sobre la fila cuyo techo cambió y solo si el control continúa exactamente en su estado inicial.

Algoritmo propuesto para `components/project-workspace.tsx`:

1. Cambiar `mergeIncomingExternalFacts` para devolver `{ items, changedReferences }`, donde cada cambio incluya índice, `rowKey`, techo anterior y techo nuevo.
2. Antes de fusionar, determinar si la oferta persistida de la fila es virgen: `offerMode`, `discountPct`, `profitPct` y `manualOfferUnit` son todos `null`.
3. Calcular el control inicial esperado sobre el proyecto local anterior usando `buildInitialOfferControls`; no duplicar las fórmulas en el componente.
4. Reanclar solo cuando el control actual coincide con ese control inicial esperado. Esta segunda condición protege una edición local aún no guardada.
5. Para esas filas, volver a ejecutar `buildInitialOfferControls` sobre el proyecto con el techo nuevo y reemplazar únicamente ese `rowKey`.
6. Preservar todos los demás controles y todos los controles de IVA. Actualizaciones de fuentes, notas, cantidad o unidad no deben reanclar oferta.
7. Aplicar ítems y controles desde el mismo snapshot vigente, antes de marcar el workspace para autoguardado. No usar `props.project` como snapshot porque puede estar obsoleto.
8. Mantener el 409 de `expectedUpdatedAt` como última defensa. El update externo también debería recibir una revisión o guardar por parche de campo, pero eso es una mejora separada.

Pseudocódigo de la decisión por fila:

```ts
const persistedVirgin =
  local.offerMode === null &&
  local.discountPct === null &&
  local.profitPct === null &&
  local.manualOfferUnit === null;

const oldInitial = buildInitialOfferControls(oldProject)[rowKey];
const controlStillInitial = sameOfferControl(currentControls[rowKey], oldInitial);

if (referenceChanged && persistedVirgin && controlStillInitial) {
  nextControls[rowKey] = buildInitialOfferControls(nextProject)[rowKey];
}
```

Pruebas mínimas del parche:

1. Techo virgen `100 → 119`: oferta `119`, descuento 0.
2. Oferta manual 90: techo cambia a 119 y oferta permanece 90.
3. Descuento o utilidad editados sin guardar: permanecen intactos.
4. Update de fuente o nota sin cambio de techo: oferta no cambia.
5. Dos filas: solo la fila virgen corregida se reancla.
6. IVA/control tributario editado localmente: no se reinicia.
7. Update recibido durante una edición local: el control ya divergente evita el reanclaje.
8. Autoguardado posterior persiste el techo y la oferta reanclada con la misma revisión remota.

## Decisiones que deben mantenerse fuera de la IA

- No calcular mínimo, promedio, costo moderado o costo aplicado.
- No elegir proveedor ni modo de costo.
- No convertir USD a COP antes de enviar una fuente USD.
- No aplicar el 30 % de importación ni agregar transporte dos veces.
- No fijar descuento, utilidad objetivo, oferta manual o total de oferta.
- No redondear la oferta ni el IVA.
- No calcular retenciones, recaudo neto o utilidad.
- No resolver discrepancias entre cantidad, total publicado y suma de líneas sin evidencia del documento.

En esta vuelta no se propone reformar el motor de IVA. El límite documentado queda así: `vatMode` sigue compartido por costo y techo, y las fuentes USD siguen usando 30 % de importación cuando no existe un porcentaje específico. Antes de cambiar cualquiera de esos contratos se requiere evidencia de compatibilidad con costos históricos y callers activos.

## Validación ejecutada

En DEV pasaron 58 pruebas de contrato, costos adicionales e importación `create_once`:

- `test/financial-offer-contract.test.ts`: 42.
- `test/additional-costs.test.ts`: 14.
- `test/import-create-once.test.ts`: 2.

Estas pruebas confirman el comportamiento descrito. No cubren todavía el reanclaje de un control virgen durante polling, la pérdida concurrente entre dos updates externos ni la compatibilidad de bases IVA distintas entre techo y cotizaciones.


## Nota de cierre posterior a la auditoria

Los datos y propuestas de la inspeccion inicial anterior se conservan como evidencia temporal. Al cierre se corrigieron los 27 techos de R2, se sincronizaron chat/Odoo y se desplego el reanclaje conservador de controles junto con la proteccion de respuestas atrasadas. Suite financiera 80/80. Ver QA_TECHOS_Y_CONTRATO_FINANZAS_20260927.md para evidencia final y limites; no inferir del estado inicial updatedAt=createdAt que la correccion siga pendiente.
