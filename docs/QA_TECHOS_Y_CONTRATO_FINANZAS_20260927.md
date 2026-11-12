# Techos y contrato IA–Finanzas — 27 septiembre 2026

## Contratos comprobados

1. El techo de entrada es unitario bruto ofertable, con IVA cuando corresponde; no un total de línea ni el neto previo a IVA.
2. La adaptación del techo no cambia fuentes de compra, cantidades, costos manuales ni decisiones de oferta.
3. La IA entrega hechos y evidencia. Finanzas calcula conversiones, importación, alternativas de costo, oferta, redondeo, impuestos, retenciones y márgenes.
4. Un costo desconocido conserva `PENDIENTE_COSTO`; USD sin TRM sigue pendiente para la app, sin conversión inventada.
5. Nuevas corridas requieren evidencia documental por techo y segunda auditoría fiscal. Un importe desconocido se declara nulo y se explica.
6. Una actualización del techo reancla únicamente controles automáticos sin editar; no modifica ajustes locales o persistidos. Respuestas antiguas del sondeo no pueden revertir una revisión más reciente.

## Causa y corrección real en DEV

R2 exportó la columna antes de IVA. El importador público v2 la recibió como `included`, por lo que el techo mostrado era inferior al presupuesto. Cambiar el modo a `excluded` habría aumentado también los costos: ese modo es compartido por costo y techo.

Se extrajeron las 27 filas originales de `3. PRESUPUESTO OFICIAL- PRECIOS DE REFERENCIA.xlsx`, documento `1mSvgyaQw_-nQ9b1zx3Gnm2k2QQS-Z2fF`, usando la columna explícita `Vr IVA INCLUIDO`. Decimal verificó en las 27 filas neto + IVA = bruto. La tasa 19 % se comprobó en este archivo; no se impone como regla universal de extracción.

| Ejemplo | Neto anterior | IVA fuente | Techo bruto corregido |
|---|---:|---:|---:|
| Caneca, fila 1 | 4.269.818,50 | 811.265,515 | 5.081.084,015 |
| Filtro, fila 2 | 20.606,50 | 3.915,235 | 24.521,735 |

El cálculo existente `42a16f94-eebc-49d9-9ec2-ba6e5add8b46` se corrigió mediante la API de actualizaciones externas. Antes de escribir se comprobó revisión intacta y controles sin editar; se guardó respaldo. Los demás campos de cada ítem quedaron idénticos. Repetir el mismo parche devolvió `changed:false`. No se creó otro cálculo ni se reimportó encima de decisiones humanas.

Se corrigieron también JSON, inventario y soporte del job `3c957bc6-bdab-4744-ae92-8e553a27213d`, ejecutor `076b3125-6e79-4666-a10a-199f0bf6becc`. La recuperación repitió solo la auditoría documental, sin nueva investigación comercial. La respuesta independiente confirmó los 27 techos y dejó tres advertencias sustentadas. Hubo un falso rechazo porque las citas eran subfragmentos literales de la misma fila; se corrigió el comprobador y se reaplicó al resultado original retenido, sin modificarlo ni pagar otra auditoría. Los tres archivos auditados coincidieron byte por byte con los entregables revalidados.

SHA-256 de la respuesta auditora retenida: `9f60eac5c755e3a63c2768a552301074fd036f03967dbe421f3452d0c7fcf473`.

El job principal y el trabajador terminaron `completed`, con `ceiling_tax_checked:true`, `ceiling_basis:gross`, `ceiling_tax_status:verified` y `document_coverage:ai_reviewed`. Odoo DEV tarea4491 conserva el mismo cálculo y estado `listo_para_revisar`; resultado, soporte y avance fueron sincronizados mediante ORM, sin nueva publicación ni mensajes al equipo.

## Límites que permanecen visibles

- Silicona: presupuesto cantidad6, ficha cantidad1. Los techos brutos por cantidad suman COP27.432.683,25; el agregado publicado COP27.300.132,13 usa una silicona. No se impuso un techo global ni se cambió la cantidad.
- R2 conserva siete costos pendientes y tres fuentes USD sin TRM; el resumen sigue siendo parcial17/27. No es aprobación de oferta ni costo final puesto en destino.
- El contrato público no separa bases fiscales por fuente: su modo incluido/19 y el recargo USD por defecto30 % requieren atención si el documento tiene otra tasa o el precio ya incluye importación. La instrucción del agente exige explicitarlo, sin duplicar cargos.
- La semántica de unidad frente a total y de la evidencia documental depende de la segunda revisión IA; la aritmética y las citas se comprueban de forma determinística.
- Los trabajos históricos sin marcador fiscal conservan compatibilidad. Los nuevos trabajos se marcan fuera del hash de la solicitud y no se publican con validación fiscal parcial.
- En la edición simultánea, techo/fuentes/notas mantienen la política preexistente de aceptar los hechos externos. El parche conserva controles de oferta, no implementa edición colaborativa completa.

## QA y responsables

| Rol | Modelo solicitado | Alcance | Resultado |
|---|---|---|---|
| Contrato/dominio | gpt-5.6-sol, high | Motor, contrato, fuentes, IVA, persistencia | Matriz documentada; 58 pruebas enfocadas |
| Implementación fiscal | gpt-5.6-sol, high | Evidencia y auditoría por fila | Suite IA26/26 |
| Implementación UX | gpt-5.6-terra, high | Controles automáticos y ajustes humanos | Pruebas y revisión de tipos |
| Revisión fiscal independiente | gpt-5.6-sol, high | Casos adversos, reanudación, históricos | Sin P1/P2; borde de IVA sin tasa anotado |
| Revisión UX independiente | gpt-5.6-terra, medium | Estado, concurrencia y sondeo | Hallazgo de respuestas atrasadas corregido; sin P1/P2 pendientes |

La suite financiera tras las correcciones pasó80/80. El informe de contrato completo está en `CONTRATO_IA_APP_FINANCIERA_AUDITORIA_20260927.md`; distingue el flujo CAFstudy vigente del adaptador legado Stage3. No se migraron ni repararon callers ajenos a este flujo.

Verificación de despliegue: Finanzas compiló y arrancó correctamente; CAF IA respondió `health:ok`. Navegador real confirmó los techos 5.081.084,015 y 24.521,735, resumen parcial17/27 y ausencia de errores JavaScript. Captura `qa-20260927/financial-r2-gross-ceilings.png`. Se observaron solapes en la cabecera del resumen ya ajenos al cambio de datos; no se declara una auditoría integral del diseño.

Prueba de integración de sondeo: en Chrome aislado se simularon respuestas de la API fuera de orden, adelantando el sondeo a500ms para ejercitar controles todavía vírgenes. El autoguardado simulado mantuvo la revisión más reciente, el techo nuevo y la oferta inicial reanclada; conservó fuentes y otra fila. Todas las escrituras se interceptaron dentro del navegador y la API real se comparó antes/después: cálculo DEV intacto. Un primer intento de la prueba recibió un autoguardado previo al sondeo; se corrigió la temporización del escenario, no la lógica para ocultar el resultado.

Los controles ya materializados por un guardado se preservan conservadoramente: no se deduce que siguen siendo automáticos solo porque coinciden con un techo anterior. Recargar el cálculo reparado permite ver su estado persistido vigente.

## Archivos y reversión

- Canónico IA: `/opt/caf-dev/repos/caf-ai-service/study-runs.mjs`, `server.mjs`, `tests/study-runs.test.mjs`.
- Canónico Finanzas: `components/project-workspace.tsx`, `lib/offer-controls-sync.ts`, `test/offer-controls-sync.test.ts` y el informe de contrato.
- Respaldo privado de datos originales, entregables y estado Odoo: `/opt/caf-dev/backups/ai-study-financial-20260927/gross-ceiling-repair/`.
- Revertir datos exige cotejar primero la revisión actual y conservar cualquier edición humana posterior. No restaurar el JSON completo encima de cambios nuevos.
- Producción no fue modificada. No se hicieron commits amplios sobre los repositorios con cambios concurrentes.
