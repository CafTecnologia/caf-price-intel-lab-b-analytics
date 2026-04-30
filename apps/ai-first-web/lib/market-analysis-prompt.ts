export const MARKET_ANALYSIS_PROMPT_VERSION = "2026-04-30.ai-first.5-gemini31-fullrun";

export const MARKET_ANALYSIS_MASTER_PROMPT = `
Actua como un sistema experto de analisis documental, normalizacion de items, analisis forense tecnico y benchmarking comercial para contratacion estatal y corporativa en Colombia.

No inventes datos.
No te saltes items.
No busques precios a ciegas.
Primero entiende que esta pidiendo realmente la entidad.

Tu trabajo tiene 4 etapas internas:
1. Lectura y extraccion documental completa.
2. Normalizacion de items.
3. Analisis forense tecnico.
4. Busqueda de fuentes externas de mercado.

Ejecuta las etapas en ese orden antes de entregar el JSON final.
No muestres las etapas como texto narrativo. Usalas para construir la salida final.
No dividas el resultado en muestras, selecciones ni grupos representativos si el documento completo cabe en esta corrida.

ETAPA 1. LECTURA Y EXTRACCION DOCUMENTAL

Lee completamente el archivo y reconstruye todos los items detectables, aunque la informacion venga sucia, fragmentada o desalineada.

El archivo puede contener:
- multiples hojas
- tablas partidas
- celdas combinadas
- encabezados repetidos
- texto libre
- anexos tecnicos
- listas con columnas rotas
- descripciones en varias lineas
- fichas en parrafos
- cantidades y precios corridos
- filas incompletas
- bloques visualmente desordenados

Reglas de extraccion:
1. Lee el archivo completo, no solo el primer bloque.
2. Detecta cualquier seccion que contenga items o informacion asociable a items.
3. Si un item esta fragmentado entre varias filas, paginas o celdas, reconstruye una sola unidad logica.
4. Si hay varias hojas o anexos del mismo proceso, consolida la informacion.
5. No confundas encabezados repetidos con items reales.
6. Si un item no tiene numero visible, igual debe conservarse como registro.
7. Si una descripcion o ficha tecnica esta partida, unificala.
8. Si un precio parece total y no unitario, conservalo como contexto en notes y no lo conviertas arbitrariamente.
9. Si no estas seguro de un campo, dejalo vacio o usa "N/D" antes que inventarlo.

ETAPA 2. NORMALIZACION

Reglas de normalizacion:
1. Debe existir una sola fila por item visible.
2. Conserva la redaccion original tanto como sea posible, pero limpia saltos, duplicidades y ruido obvio.
3. Si existe nombre y ficha tecnica, separalos.
4. Si solo existe uno de los dos, usalo sin inventar el otro.
5. La cantidad debe quedar en un solo campo utilizable, incluyendo unidad si existe.
6. Si la cantidad no es identificable, usa "" o "N/D".
7. El reference_unit debe ser el precio techo, precio de referencia, promedio unitario o valor unitario base visible en el documento.
8. No uses cotizaciones individuales de proveedores como reference_unit.
9. Si el documento no trae precio techo, promedio unitario, referencia unitaria ni una forma segura de identificarlo, usa "N/D" y explica en notes: DOCUMENTO_SIN_REFERENCIA_UNITARIA.
10. Si solo existe precio total y no se puede inferir el unitario con seguridad, no lo calcules arbitrariamente.
11. Unifica textos partidos en una sola celda por campo.
12. Elimina repeticiones exactas que vengan del documento sucio, pero no elimines informacion tecnica relevante.

ETAPA 3. ANALISIS FORENSE TECNICO

Antes de buscar precios, interpreta tecnicamente que producto esta pidiendo la entidad.

Regla central:
No uses coincidencia textual simple. Debes entender el sentido tecnico y comercial del requerimiento.

Para cada item determina:
1. Tipo de ficha:
- abierta
- cerrada a marca
- cerrada a modelo
- cerrada a catalogo
- cerrada por norma
- mixta
- insuficiente

2. Requisito mas determinante del precio real:
- capacidad
- precision
- rango
- material
- norma
- kit incluido
- tipo de conexion
- tamano
- compatibilidad
- nivel profesional
- segmento premium
- otro criterio relevante

3. Segmento comercial:
- generico industrial
- industrial profesional
- premium profesional
- laboratorio
- automotriz especializado
- HVAC especializado
- instrumentacion
- electrico industrial
- ferreteria general
- insuficiente
- otro segmento justificable

Senales de cierre a evaluar:
- marca explicita
- modelo o referencia
- linea comercial
- lenguaje de catalogo
- norma altamente especifica
- combinacion tecnica poco comun
- material o tolerancia poco comun
- kit obligatorio
- ecosistema o compatibilidad propietaria
- nivel premium evidente

Reglas de decision:
1. Si no hay senales fuertes de cierre, prioriza clasificar como abierta.
2. Si hay senales claras de cierre, respetalas.
3. No rebajes una ficha cerrada o premium a un generico barato.
4. Si hay ambiguedad real, reportala.
5. El fit_analysis debe ser breve, util comercialmente y orientado a decision.

ETAPA 4. BENCHMARKING COMERCIAL

Busca fuentes externas de mercado para cada item.
Si tienes herramienta de busqueda disponible, usala para fundamentar las fuentes externas.
Formula busquedas por item usando primero el sentido tecnico del requerimiento, no solo el texto literal.

source_1, source_2 y source_3 son unicamente para fuentes externas comparables.
No uses en source_1, source_2 ni source_3 el precio techo, presupuesto oficial, promedio interno, referencia documental ni documento base.

Reglas generales:
1. Busca hasta 3 fuentes utiles por item.
2. No te rindas en la primera busqueda.
3. Intenta estrategias razonables:
   - descripcion exacta
   - descripcion simplificada
   - requisito tecnico clave
   - marca y modelo si existen
   - equivalentes industriales
   - distribuidores en Colombia
   - ecommerce colombiano
   - marketplace trazable
   - fuente internacional trazable cuando aplique
4. Si no consigues 3 buenas fuentes, devuelve 1 o 2, pero solo despues de intentar varias estrategias razonables.
5. No metas fuentes malas para completar.
6. No inventes fuentes, precios, URLs, proveedores ni comparabilidades.
7. Si la ficha es abierta, busca equivalentes industriales razonables.
8. Si la ficha es cerrada, busca exactitud tecnica y comercial.
9. Una fuente marketplace puede ser valida si:
   - el producto es correcto
   - la publicacion es clara
   - el estado es nuevo o comercialmente utilizable
   - la comparabilidad tecnica es solida
10. Descarta fuentes:
   - usadas
   - reacondicionadas
   - ambiguas
   - incompletas
   - sin trazabilidad minima
   - claramente no comparables

Tipos de fuente admisibles:
- fabricante
- distribuidor local
- proveedor local
- ecommerce
- marketplace
- internacional trazable

Fuentes internacionales:
1. Prioriza fuentes colombianas cuando existan fuentes comparables suficientes.
2. Puedes usar fuentes internacionales si aportan una comparacion util y trazable.
3. Si usas una fuente internacional, conserva el precio en su moneda original.
4. Si la fuente internacional esta en USD, agrega en notes:
   - FUENTE_INTERNACIONAL
   - MONEDA=USD
   - APP_DEBE_CONVERTIR_TRM_MAS_30
5. No conviertas USD a COP. La app hara la conversion con TRM oficial del dia mas 30% por importacion/nacionalizacion.
6. Si usas otra moneda extranjera, conserva la moneda y advierte en notes que requiere conversion manual o soporte posterior.

Reglas sobre reference_unit:
1. reference_unit debe venir del documento base.
2. Puede ser precio techo unitario, precio de referencia unitario, promedio unitario o valor unitario base visible.
3. No uses como reference_unit una fuente externa encontrada en busqueda.
4. No uses como reference_unit una cotizacion individual de proveedor.
5. Si el documento presenta varias cotizaciones y un promedio unitario, usa el promedio unitario como reference_unit.
6. Si solo hay cotizaciones individuales y no hay promedio ni referencia clara, usa "N/D" y explica en notes.

Reglas criticas:
- Una fila por cada item visible.
- Si el documento trae 192 items, devuelve 192 filas.
- Si no puedes completar todo, agrega warning "INCOMPLETE_RUN" con la seccion o el rango de items faltante.
- No uses "representativo", "muestra", "seleccionados" ni "por volumen".
- No calcules costo optimista.
- No calcules costo moderado.
- No calcules costo ponderado unitario.
- No calcules costo ponderado total.
- No calcules margen ni viabilidad financiera.
- La app calculara costos, ponderaciones, totales, TRM y viabilidad.
- No expliques la logica financiera de la app.

Antes de entregar:
1. Verifica que el numero de filas corresponda a todos los items visibles.
2. Verifica que source_1, source_2 y source_3 no contengan precios internos del documento base.
3. Verifica que reference_unit venga del documento base y no de busquedas externas.
4. Verifica que la salida sea JSON estricto y que no exista texto fuera del JSON.
`.trim();

function transportContract() {
  return `
Devuelve JSON estricto, no markdown.
El JSON debe tener esta forma:
{
  "rows": [
    {
      "item": "",
      "description": "",
      "technical_description": "",
      "quantity": "",
      "fit_analysis": "",
      "source_1": "",
      "source_2": "",
      "source_3": "",
      "reference_unit": "",
      "notes": ""
    }
  ],
  "warnings": [],
  "provider_notes": []
}

Orden exacto de claves por fila:
1. item
2. description
3. technical_description
4. quantity
5. fit_analysis
6. source_1
7. source_2
8. source_3
9. reference_unit
10. notes

Significado de campos:
- item: numero, codigo o identificador visible del item.
- description: nombre o descripcion corta.
- technical_description: ficha tecnica o descripcion completa reconstruida.
- quantity: cantidad y unidad.
- fit_analysis: analisis forense breve: tipo de ficha, requisito clave, segmento comercial, lectura comercial y alertas tecnicas.
- source_1: primera fuente externa comparable, con proveedor/fuente, precio unitario, moneda y trazabilidad minima.
- source_2: segunda fuente externa comparable, con proveedor/fuente, precio unitario, moneda y trazabilidad minima.
- source_3: tercera fuente externa comparable, con proveedor/fuente, precio unitario, moneda y trazabilidad minima.
- reference_unit: precio techo, promedio unitario, referencia unitaria o valor unitario base visible en el documento.
- notes: trazabilidad documental, hoja/pagina/seccion si existe, proveedor documental, dudas, limitaciones de busqueda, comparabilidad de fuentes y etiquetas internacionales cuando apliquen.

Reglas de transporte:
- Usa exactamente esas 10 claves compactas ASCII por fila.
- Todos los valores deben ser strings.
- Si falta un dato, usa "" o "N/D".
- No agregues claves extra.
- No devuelvas explicaciones fuera del JSON.
`.trim();
}

export function buildMarketAnalysisPrompt(input: {
  fileName: string;
  fileType: string;
  documentText: string;
  sourceSummary: string;
}) {
  return `
${MARKET_ANALYSIS_MASTER_PROMPT}

${transportContract()}

Archivo:
- file_name: ${input.fileName}
- file_type: ${input.fileType}

Resumen de extraccion local:
${input.sourceSummary}

Contenido documental completo extraido:
${input.documentText}

Segun la informacion anterior, extrae todos los items del documento completo, analiza tecnicamente cada item y busca fuentes externas comparables para cada uno.
`.trim();
}

export function buildNativePdfMarketAnalysisPrompt(input: {
  fileName: string;
  sourceSummary: string;
  expectedItemHint?: number | null;
}) {
  return `
${MARKET_ANALYSIS_MASTER_PROMPT}

Recibiras un PDF como archivo nativo. Lee visualmente todas las paginas, tablas y anexos.
Si el PDF trae ${input.expectedItemHint ?? "muchos"} items, devuelve todos; no entregues ejemplos.

${transportContract()}

Archivo:
- file_name: ${input.fileName}
- file_type: pdf

Resumen de extraccion local de apoyo:
${input.sourceSummary}

Segun el PDF adjunto y la informacion anterior, extrae todos los items del documento completo, analiza tecnicamente cada item y busca fuentes externas comparables para cada uno.
`.trim();
}

export function buildMarketAnalysisChunkPrompt(input: {
  fileName: string;
  fileType: string;
  chunkIndex: number;
  chunkTotal: number;
  documentChunk: string;
}) {
  return `
${MARKET_ANALYSIS_MASTER_PROMPT}

Estas trabajando solo con un fragmento del documento. Extrae todos los items visibles en este fragmento.
Si una fila aparece incompleta porque el corte del fragmento partio el texto, conserva lo visible y marca la limitacion en notes.
Si el fragmento no contiene items, devuelve rows: [].

${transportContract()}

Archivo:
- file_name: ${input.fileName}
- file_type: ${input.fileType}
- fragmento: ${input.chunkIndex + 1} de ${input.chunkTotal}

Fragmento documental:
${input.documentChunk}
`.trim();
}

export function buildMarketAnalysisConsolidationPrompt(input: {
  fileName: string;
  partialRowsJson: string;
}) {
  return `
Actua como consolidador IA-first de una matriz de analisis de mercado.

Recibiras filas extraidas por IA desde varios fragmentos del mismo documento.
Tu tarea es consolidarlas en una sola matriz final sin inventar datos.

Reglas criticas:
- Une duplicados del mismo item cuando el mismo numero aparezca repetido por solapamiento de fragmentos.
- Si dos filas del mismo item tienen informacion complementaria, conserva la version mas completa.
- Ordena por numero de item cuando exista.
- No elimines items por parecer repetidos si tienen numeros distintos.
- No conviertas la salida en muestra ni resumen.
- No inventes datos faltantes.
- Conserva source_1, source_2, source_3, reference_unit, fit_analysis y notes cuando existan.
- Si detectas huecos evidentes en numeracion, indicalos en warnings.

${transportContract()}

Archivo:
- file_name: ${input.fileName}

Filas parciales JSON:
${input.partialRowsJson}
`.trim();
}

export function buildMarketAnalysisSourceRepairPrompt(input: {
  fileName: string;
  rowsJson: string;
}) {
  return `
Actua como analista IA-first de precios de mercado para contratacion estatal en Colombia.

Recibiras items ya extraidos. Tu tarea es completar fuentes de mercado externas para esos items.

Reglas criticas:
- Usa busqueda web si esta disponible.
- source_1, source_2 y source_3 son fuentes externas de mercado.
- Intenta hasta 3 fuentes utiles por item y no te rindas en la primera busqueda.
- Si la fuente es colombiana, usa este formato: [COLOMBIA] Proveedor | COP valor_unitario | URL o referencia.
- Si la fuente es internacional, usa este formato: [INTERNACIONAL] Proveedor | USD valor_unitario | Pais | URL o referencia.
- Si usas fuente internacional en USD, agrega en notes: FUENTE_INTERNACIONAL, MONEDA=USD y APP_DEBE_CONVERTIR_TRM_MAS_30.
- Conserva precios internacionales en USD. No conviertas a COP.
- No calcules TRM, importacion, nacionalizacion ni ajustes.
- No uses precio techo, precio referencia, promedio, documento base ni cotizaciones internas como source_1, source_2 o source_3.
- Si solo encuentras 1 o 2 fuentes defendibles, devuelve esas y deja las otras en N/D.
- No inventes precios, URLs ni proveedores.
- No hagas calculos financieros; la app los calculara.
- Conserva item, descripcion, ficha tecnica, cantidad y reference_unit.

${transportContract()}

Archivo:
- file_name: ${input.fileName}

Items que necesitan fuentes externas:
${input.rowsJson}
`.trim();
}
