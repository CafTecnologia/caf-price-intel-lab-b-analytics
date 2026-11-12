# Guía breve del simulador financiero

## Para qué sirve

Convierte precios de referencia en una oferta trazable. Calcula costos, utilidad, IVA, retenciones y recaudo esperado sin ocultar las decisiones manuales.

## Flujo recomendado

1. **Carga:** importa Excel, CSV o JSON, o agrega ítems manualmente.

### Servicios y costos asociados en la carga

Las tres vistas editan el mismo cálculo. Un servicio o costo asociado pertenece a un ítem y se suma a su costo; los costos generales pertenecen al cálculo completo. Un costo sugerido por la IA no se suma hasta que el usuario decida Aplicar; también puede marcarlo No aplica. Un costo aplicado sin valor queda advertido para revisión, sin ocultar los costos y ofertas conocidos. El valor `0` significa cero confirmado, no pendiente.

En Excel/CSV se admiten las columnas opcionales `Tiene costo asociado` (`Sí`/`No`), `Servicio o costo asociado`, `Valor costo asociado`, `Tipo costo asociado` (`Servicio`, `Logística`, `Otro`) y `Aplicación costo asociado` (`Una vez` o `Por unidad`). Si se marca `Sí` sin valor, el usuario puede completarlo en cualquiera de las vistas. Las columnas antiguas siguen funcionando.

En JSON de versión 2 cada ítem puede incluir `has_associated_cost` y `additional_costs`. La lista admite varios costos por ítem y cada entrada usa `name`, `category` (`service`, `logistics`, `other`), `mode` (`fixed`, `per_unit`) y `amount` (número, texto numérico o `null`). Si `has_associated_cost` es `true` y no hay lista, se crea un costo pendiente. En JSON de versión 1 también se aceptan estos campos por ítem. Para varios servicios en Excel, conviene usar JSON porque la hoja de carga dispone de un solo par de columnas de servicio y valor por fila.

El botón de cotización abre el enlace de la **fuente elegida en la app para calcular el costo**, no el de la más barata. Selecciona el modo `Cotización elegida` y después el proveedor concreto; el precio normalizado de esa fuente alimenta el cálculo. En los demás modos (mínimo, promedio, moderado o manual), o si la fuente elegida no tiene URL o precio válido, el botón aparece desactivado. JSON y Excel aportan las fuentes disponibles, pero no eligen una por el usuario.
2. **Contrasta:** compara los datos registrados y la ficha técnica anexa con la investigación y sus fuentes.
3. **Costea:** elige mínimo, promedio, moderado, cotización elegida o costo manual; decide qué costos asociados aplican.
4. **Oferta:** usa descuento sobre techo unitario, utilidad sobre costo o valor manual. La utilidad sobre costo funciona si solo hay techo global.
5. **Comprueba:** revisa IVA, retenciones, estampillas, utilidad y techo total en Oferta económica.
6. **Conserva:** guarda el cálculo; usa escenarios de oferta o bases de costos para comparar alternativas.

## Cálculos principales

### Costos

- **Fuente USD normalizada:** `precio USD × TRM × (1 + importación %)`.
- **Mínimo:** menor fuente válida.
- **Promedio:** suma de fuentes válidas ÷ número de fuentes.
- **Moderado:** `(mínimo + promedio) ÷ 2`.
- **Cotización elegida:** precio de la fuente seleccionada para el ítem.
- **Manual:** costo base escrito por el usuario.
- **Costo con descuento:** `costo elegido × (1 − descuento %)`.

### Oferta y utilidad

- **Oferta por descuento:** `techo × (1 − descuento %)`.
- **Oferta por utilidad:** `costo × (1 + utilidad objetivo %)`.
- **Oferta total:** `oferta unitaria × cantidad`.
- **Utilidad bruta:** `oferta total − costo total`.
- **Margen sobre costo:** `utilidad bruta ÷ costo total × 100`.

### Estrategias de oferta en lote

Todas parten del descuento solicitado y calculan un factor por fila:

`descuento efectivo = descuento solicitado × factor`

- **Global:** aplica el mismo porcentaje a las filas elegibles.
- **Global protegido:** solo ajusta filas con utilidad positiva.
- **Por extremos:** asigna más ajuste a los ítems con mayor margen unitario; factor entre `0,25` y `1,80`.
- **Por peso total:** asigna más ajuste a los ítems de mayor valor total; factor entre `0,35` y `1,90`.
- **Por utilidad disponible:** asigna más ajuste donde `margen unitario × cantidad` es mayor; factor entre `0,20` y `1,60`.

El costo es siempre el límite inferior: ninguna estrategia lleva la oferta por debajo del costo. Si solicitas 10 % y el factor de una fila es 1,5, esa fila recibe 15 %, salvo que alcance primero su costo.

En la versión actual, **Global** y **Global protegido** respetan el mismo piso de costo; la segunda opción comunica explícitamente que solo se intervienen filas con utilidad positiva.

### IVA y recaudo

- **IVA incluido:** la app separa base e IVA.
- **IVA excluido:** suma el IVA a la base.
- **Exento:** IVA igual a cero.
- **Retención:** `base elegida × tasa %`.
- **Estampillas:** `oferta total con IVA × tasa %`.
- **Recaudo neto:** `oferta con IVA − retenciones − estampillas`.
- **Utilidad neta estimada:** `recaudo neto − costo total`.

Las retenciones pueden usar como base el valor antes de IVA, el IVA o el total con IVA. No cambian el costo ni la oferta: muestran cuánto se espera recibir.

## Escenarios

Un escenario guarda las decisiones y la configuración de oferta para comparar alternativas. Al activarlo conserva los costos y fuentes actuales; si cambió la lista de ítems, no se puede aplicar. La base de costos guarda versiones de costos, fuentes y referencias por separado. El menú Guardar reúne Guardar cálculo, Guardar escenario y Guardar base de costos.

## Pestaña Oferta económica

El techo total aparece primero como referencia. Después se presentan por separado el total sin IVA, IVA, total con IVA, retenciones y estampillas, y utilidad neta estimada. La comparación con el techo usa la oferta bruta con IVA, no el recaudo neto. Si la oferta supera el techo, se alerta de inmediato; si faltan ítems por ofertar, la diferencia favorable es provisional. El desglose de retenciones se puede desplegar.

## Lectura de resultados

- **Resumen total:** aparece cuando todas las filas necesarias son evaluables.
- **Resumen parcial:** usa solo filas completas y se identifica como parcial.
- **Viable:** cubre costo y tiene margen igual o superior al 10 %.
- **Ajustado:** cubre costo, pero el margen es menor al 10 %.
- **Sobre techo:** la oferta supera el precio de referencia.
- **Pérdida:** la oferta queda por debajo del costo.
- **Sin techo unitario:** calcula costo y oferta; si existe techo total, compara la oferta completa con esa referencia.
- **Incompleto:** falta cantidad, costo u oferta.

## Seguridad de enlaces

La vista previa solo consulta destinos HTTP/HTTPS publicos y bloquea localhost y redes privadas. Si un comercio impide la consulta, el enlace original sigue disponible.

La versión interactiva de esta guía está disponible en **Ayuda** dentro del simulador.
