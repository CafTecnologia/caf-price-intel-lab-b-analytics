# App B IA-first strategy for Gemini 3.1 Pro Preview

Fecha: 2026-04-28
Alcance: App B / Analisis Financiero B / Mesa de Oferta, integrada a Odoo DEV como modulo independiente.

## Premisa de producto

App B debe seguir siendo IA-first. Esto no significa que la IA deba hacer todo en una sola respuesta. Significa que la interpretacion documental, la normalizacion y el razonamiento comercial nacen del modelo. La aplicacion debe orquestar, validar, persistir y calcular de forma deterministica lo que no requiere juicio semantico.

Separacion obligatoria:

- IA: entiende el documento, detecta todos los items, reconstruye descripciones partidas, extrae cantidades, precios visibles, proveedores/fuentes y notas por item.
- App: cuenta tokens, elige estrategia de corrida, valida estructura, detecta omisiones, calcula optimista/moderado/ponderado/total, guarda resultados, muestra auditoria y permite reprocesar.
- IA con busqueda: solo para una fase posterior de enriquecimiento o benchmarking externo, no para la extraccion base del documento.

## Lectura clave de la documentacion de Google

Fuentes oficiales revisadas:

- Gemini 3.1 Pro Preview: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview?hl=es-419
- Guia para desarrolladores de Gemini 3: https://ai.google.dev/gemini-api/docs/gemini-3?hl=es-419
- Resultados estructurados: https://ai.google.dev/gemini-api/docs/structured-output?hl=es-419
- Comprension de documentos: https://ai.google.dev/gemini-api/docs/document-processing?hl=es-419
- Contexto largo: https://ai.google.dev/gemini-api/docs/long-context?hl=es-419
- Conteo de tokens: https://ai.google.dev/gemini-api/docs/tokens?hl=es-419
- Context caching: https://ai.google.dev/gemini-api/docs/caching?hl=es-419

Puntos que afectan directamente a App B:

1. `gemini-3.1-pro-preview` acepta texto, imagenes, video, audio y PDF, con 1,048,576 tokens de entrada y 65,536 tokens de salida. Esto permite trabajar documentos grandes y salidas largas, pero no elimina la necesidad de validar cobertura.
2. Google presenta Gemini 3.1 Pro Preview como mejor en razonamiento, eficiencia de tokens, coherencia factual y flujos de varios pasos. Para App B esto favorece un pipeline por fases, no un prompt unico sobrecargado.
3. Gemini 3.1 Pro Preview soporta resultados estructurados, pensamiento, cache, batch, herramientas, grounding y llamada a funciones. Debemos usarlos con roles claros.
4. Google recomienda instrucciones mas precisas y concisas para Gemini 3. Los prompts de App B deben ser mas cortos, directos y con contrato de salida fuerte.
5. Para documentos densos, Google recomienda probar `media_resolution_high`. App B debe evolucionar de texto extraido localmente a PDF nativo por File API cuando el archivo sea PDF.
6. Google advierte que el contexto largo rinde distinto cuando se buscan muchas piezas de informacion. Nuestro caso no busca una aguja: busca decenas o cientos de items. Por eso debe existir una fase de auditoria de cobertura.
7. Google recomienda colocar la pregunta/instruccion especifica al final cuando el contexto es largo. Si se usa documento completo, el prompt debe poner primero el contenido y al final el contrato operativo.
8. El conteo de tokens debe hacerse antes de generar contenido. App B debe decidir con `countTokens` si procesa en una sola solicitud, por chunks o por fases.
9. El context caching es adecuado cuando solicitudes cortas reutilizan un contexto grande. App B lo necesita para correr extraccion, validacion, analisis financiero y reprocesos sobre el mismo documento sin reenviar todo cada vez.
10. Los resultados estructurados aseguran JSON sintacticamente valido, pero Google aclara que no garantizan validez semantica. La app debe validar contenido, recuentos, duplicados, omisiones y valores imposibles.

## Pipeline recomendado para App B

### Fase 0 - Registro del archivo

Guardar archivo original, hash, nombre, tipo, proyecto Odoo asociado y configuracion IA usada. Si es PDF, subirlo por File API y conservar el `file_uri` o referencia interna de la corrida. Si es Excel o Word, conservar tambien la extraccion textual y metadatos.

### Fase 1 - Conteo y decision

Antes de llamar al modelo:

- Ejecutar conteo de tokens sobre el contenido que se enviara.
- Registrar tokens estimados, modelo, resolucion de medios y estrategia elegida.
- Si cabe de forma comoda, permitir una corrida completa.
- Si el documento es grande o hay muchas tablas, dividir por secciones logicas, hojas o paginas.
- Si hay PDF denso, preferir PDF nativo con `media_resolution_high` antes que depender solo de texto plano extraido.

### Fase 2 - Mapa documental

Pedir a Gemini que haga un mapa del documento:

- secciones detectadas,
- tablas o anexos con items,
- conteo estimado de items por seccion,
- columnas visibles de precios,
- riesgos de lectura.

Esta fase no crea la matriz final. Su funcion es dar una expectativa de cobertura para comparar contra la extraccion.

### Fase 3 - Extraccion base IA-first

Prompt corto y directo. Pedir solo:

- item,
- descripcion,
- ficha tecnica o descripcion tecnica,
- cantidad/unidad,
- fuente/precio 1,
- fuente/precio 2,
- fuente/precio 3,
- precio referencia/techo unitario si existe,
- notas por item.

No pedir calculos, ponderaciones ni margen en esta fase. La IA debe traer los datos base y la app calcula.

Contrato:

- JSON estricto.
- Sin markdown.
- Una fila por item visible.
- Prohibido devolver muestras, ejemplos o items representativos.
- Si no puede terminar, debe marcar la corrida como incompleta y explicar por que, no entregar una matriz parcial como si fuera final.

### Fase 4 - Auditoria IA-first

Usar el documento original o cacheado y la matriz extraida para pedir una validacion:

- items esperados vs items extraidos,
- posibles omisiones,
- duplicados,
- filas sin cantidad,
- filas con precio raro,
- secciones no cubiertas.

La app debe bloquear o marcar como "requiere revision" si la auditoria encuentra muestras, omisiones masivas o recuentos inconsistentes.

### Fase 5 - Calculo deterministico en la app

La app calcula:

- costo optimista: menor precio disponible por item,
- costo moderado: promedio simple de las fuentes/precios disponibles,
- costo ponderado unitario: promedio entre el costo optimista y el costo moderado,
- costo ponderado total: cantidad * costo ponderado unitario,
- viabilidad/margen contra precio techo cuando exista.

Esto sigue siendo IA-first porque la IA entrego el entendimiento documental; la aritmetica debe ser reproducible y auditable.

### Fase 6 - Benchmarking externo opcional

Solo despues de tener la matriz base:

- usar grounding/web search por lotes pequenos,
- buscar fuentes por item o por grupos tecnicos equivalentes,
- guardar URL, fecha, precio y confianza,
- no mezclar busqueda externa con extraccion base del documento.

## Prompt recomendado para la extraccion base

Principio: menos literatura, mas contrato.

Estructura sugerida:

1. Rol: extractor experto en contratacion estatal colombiana.
2. Objetivo: extraer todos los items visibles del documento.
3. Prohibiciones: no muestras, no resumen, no inventar, no calcular.
4. Campos exactos.
5. Reglas de incompletitud.
6. Documento/contexto.
7. Pregunta final anclada: "Segun la informacion anterior, extrae todos los items..."

Ejemplo conceptual:

```text
Eres un extractor IA-first para estudios de mercado y anexos de precios en contratacion estatal colombiana.

Extrae todos los items visibles del documento. No selecciones muestras. No hagas calculos. No hagas benchmarking externo.

Devuelve JSON estricto con rows[].
Cada row debe tener:
item, description, technical_description, quantity, source_1, source_2, source_3, reference_unit, notes.

Si una fuente/precio viene del documento, copiala. Si no existe, deja N/D.
Si el documento tiene 192 items, devuelve 192 filas.
Si no puedes completar todos los items, devuelve warnings con "INCOMPLETE_RUN" y explica la seccion faltante.

Segun la informacion anterior, extrae todos los items del documento completo.
```

## Cambios tecnicos que conviene implementar

Prioridad alta:

- Agregar soporte real para `gemini-3.1-pro-preview` en la configuracion del modulo.
- Probar `thinkingLevel` por etapa. En laboratorio, `high` aumento latencia/saturacion en Gemini 3.1 preview; `medium` quedo como valor operativo para analisis y `low` para prueba de conexion.
- Revisar la temperatura: Google recomienda no forzar temperaturas bajas en Gemini 3 para tareas complejas. Probar valor por defecto vs baja temperatura y medir cobertura.
- Implementar `countTokens` antes de cada corrida.
- Implementar PDF nativo con File API y probar `media_resolution_high` para PDFs con tablas.
- Mantener `responseMimeType: application/json` y `responseJsonSchema`.
- Agregar descripciones claras al schema de cada campo.
- Separar definitivamente extraccion documental y busqueda/grounding.

Prioridad media:

- Implementar context caching por archivo para corridas repetidas.
- Crear auditoria de cobertura con estado visual: completo, incompleto, requiere revision.
- Guardar prompt version, modelo, tokens, duracion, estrategia, errores y hash del archivo.
- Permitir reprocesar solo auditoria, solo calculos o solo enriquecimiento externo.
- Implementar batch o colas para documentos grandes y evitar esperas de 5 minutos sin progreso.

Prioridad baja:

- Usar `gemini-3.1-pro-preview-customtools` solo si se crea un flujo agente con herramientas propias. Para extraccion normal no deberia ser la primera opcion.
- Explorar Batch API para reprocesos nocturnos o cargas masivas, no para interaccion inmediata del usuario.

## Criterios de aceptacion para laboratorio

Un cambio de prompt o proveedor se acepta si cumple:

- El PDF real de prueba devuelve todos los items esperados, por ejemplo 192/192 en el caso validado.
- No aparecen frases tipo "muestra", "representativo", "por volumen" o "seleccionados".
- La matriz conserva cantidad, unidad, fuentes/precios visibles y precio techo cuando existan.
- Los calculos son hechos por la app y son repetibles.
- La auditoria no detecta secciones omitidas.
- La corrida guarda modelo, tokens, latencia, prompt version y warnings.
- El resultado puede abrirse desde Odoo y queda asociado al proyecto sin afectar otros modulos.

## Decision actual para App B

El camino correcto no es agregar mas logica local de interpretacion. El camino correcto es mejorar la relacion con Gemini:

- mejor entrada,
- PDF nativo cuando aplique,
- prompt mas simple,
- salida estructurada,
- auditoria de cobertura,
- calculos deterministas,
- trazabilidad completa.

Esta decision reemplaza cualquier intento anterior de resolver la calidad con parsers locales que interpreten semanticamente el documento.

## Implementacion DEV 2026-04-28

Se implemento y promovio desde sandbox a App B DEV:

- PDF nativo para Gemini: los PDFs se suben por File API y se envian al modelo como archivo, no solo como texto plano extraido.
- Conteo previo de tokens en Gemini cuando aplica.
- Prompt de extraccion documental mas corto y directo.
- Separacion estricta entre extraccion documental y grounding/busqueda externa.
- `thinkingLevel: medium` para Gemini 3.x en extraccion, porque `high` disparo errores de demanda alta y tiempos de espera en el preview.
- Para Gemini 3.x no se fuerza temperatura baja; se respeta la recomendacion de Google de usar el comportamiento por defecto.

## Ajuste DEV 2026-04-28 - conexion Gemini 3.1

Diagnostico:

- La API key y el modelo `gemini-3.1-pro-preview` son validos.
- El fallo observado no venia de Odoo ni de la llave, sino de latencia/saturacion intermitente del modelo preview.
- Las pruebas de texto simples con pensamiento por defecto podian quedar sin contenido o en `MAX_TOKENS`.

Cambios aplicados:

- La prueba de conexion usa una respuesta JSON minima con `responseMimeType: application/json`, schema estricto y `thinkingLevel: low`.
- Al guardar proveedor/modelo/API key se limpia cualquier prueba vieja; la UI solo muestra conexion confirmada cuando el test pertenece al modelo actual.
- El boton "Probar conexion" guarda tambien el proveedor/modelo probado para evitar estados mezclados.
- La extraccion con Gemini 3.x usa `thinkingLevel: medium` para reducir riesgo de alta demanda sin abandonar Gemini 3.1.

Prueba de laboratorio:

- Modelo: `gemini-3.1-pro-preview`.
- Archivo sintetico: Excel con 3 items y tres fuentes de precio por item.
- Resultado: corrida completada, 3/3 filas, calculos de optimista, moderado, ponderado unitario y ponderado total generados por la app.
- Schema JSON con descripciones de campos para guiar mejor la salida estructurada.
- Lista de modelos Gemini actualizada con `gemini-3.1-pro-preview`.
- Formula financiera actual: optimista = menor valor; moderado = promedio de fuentes; ponderado unitario = promedio entre optimista y moderado.

Pruebas de sandbox antes de promover:

- PDF real ferreteria:
  - Baseline anterior: `gemini-2.5-pro`, 192 filas, 18.209 tokens de entrada, 47.406 tokens de salida, 296.354 ms.
  - Candidato: `gemini-3.1-pro-preview` + PDF nativo, 192 filas, 5.470 tokens de entrada, 42.935 tokens de salida, 296.134 ms.
  - Resultado: misma cobertura 192/192, sin lenguaje de muestra, con menos tokens de entrada y ponderado corregido.
- Excel `sample-official-items.xlsx`:
  - 4 filas, sin warnings, sin lenguaje de muestra.

Riesgo pendiente:

- La auditoria de cobertura aun es basica. La siguiente mejora debe ser una fase IA separada de mapa/auditoria documental, especialmente para documentos donde el numero esperado de items no sea claro.
