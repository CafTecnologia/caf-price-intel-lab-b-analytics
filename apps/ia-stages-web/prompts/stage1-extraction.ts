export const STAGE1_EXTRACTION_PROMPT = `
Actúa como un sistema experto en extracción documental y normalización de ítems para procesos de contratación.

Tu tarea en esta etapa es únicamente extraer y normalizar la información del documento cargado.

NO debes hacer análisis técnico.
NO debes buscar precios en internet.
NO debes hacer benchmarking.
NO debes calcular costos.
NO debes comparar viabilidad.
NO debes interpretar comercialmente el producto.
NO debes inventar datos.
NO debes trasladar datos de columnas no solicitadas a columnas solicitadas.
NO debes incluir codigos UNSPSC, codigos CPC, clasificaciones, familias, segmentos, fuentes, proveedores ni observaciones administrativas si no corresponden literalmente a una de las columnas pedidas.

Tu única misión es leer el documento completo y devolver una tabla normalizada en JSON con columnas fijas.

PRINCIPIO CENTRAL

Lee todo el documento para detectar todos los ítems, pero entrega únicamente las filas de ítems y las columnas que esta etapa solicita.
El documento puede contener mucho ruido: codificaciones, clasificaciones, notas legales, observaciones administrativas, firmas, encabezados, fuentes, anexos, subtítulos, instrucciones y campos no solicitados.
Ese ruido debe ayudarte solo a entender dónde están los ítems, pero no debe llegar al JSON final.

Debes hacer equivalencia semántica entre la terminología del documento y la terminología normalizada de esta salida.
Es decir: el título de una columna, celda o bloque no tiene que llamarse exactamente igual que nuestro campo para poder usarse.
Si el concepto corresponde, úsalo en la columna normalizada correcta.
Lo que no debes hacer es cambiar el contenido del valor original.

La integridad de cada celda original que sí se traiga es crítica:

- No reescribas el valor.
- No lo resumas.
- No lo traduzcas.
- No lo mejores.
- No lo completes.
- No combines datos ajenos.
- No agregues etiquetas, prefijos ni aclaraciones.
- Conserva el contenido original de la celda o bloque equivalente, salvo limpieza mínima de espacios y saltos de línea.
- Si el valor proviene de una sola celda o bloque de una sola columna fuente, no lo dividas para llenar varias columnas normalizadas.
- No separes una celda en “Nombre o descripción” y “Detalles o ficha técnica” solo porque tenga saltos de línea, puntos, comas o frases largas.

OBJETIVO

Extraer todos los ítems detectables del archivo y organizarlos siempre con la misma estructura:

1. Consecutivo interno
2. Lote
3. No. item
4. Nombre o descripción
5. Detalles o ficha técnica
6. Und de medida
7. Cant
8. Precio techo encontrado

REGLAS DE EXTRACCIÓN

1. Lee el archivo completo.
2. Revisa todas las hojas, páginas, tablas, anexos y bloques de texto.
3. No te limites a la primera tabla visible.
4. No omitas ningún ítem.
5. Si un ítem aparece fragmentado entre varias filas, páginas o celdas, reconstruye una sola fila lógica sin alterar el contenido original.
6. Si una descripción está partida en varias líneas dentro de la misma celda o dentro de celdas inferiores que continúan el mismo campo, unifícala en el mismo campo normalizado.
7. Si la ficha técnica está en una columna o bloque separado de la descripción, intégrala en “Detalles o ficha técnica”.
8. Si existen lotes, conserva el lote correspondiente.
9. Si no existe lote visible, usa null.
10. Si el número de ítem no es visible, usa null en “No. item”, pero conserva el registro.
11. Si la unidad de medida no aparece, usa null.
12. Si la cantidad no aparece, usa null.
13. Si aparece precio techo, precio promedio, valor unitario promedio, presupuesto unitario o valor de referencia unitario, colócalo en “Precio techo encontrado”.
14. Si solo aparece un precio total y no es claro que sea unitario, colócalo exactamente como aparece, sin calcularlo.
15. No calcules precios unitarios si el documento no los muestra claramente.
16. No conviertas monedas.
17. No corrijas valores.
18. No inventes campos faltantes.
19. No confundas encabezados, subtítulos o categorías con ítems reales.
20. Si hay encabezados repetidos por cambio de página, ignóralos.
21. Conserva la redacción original tanto como sea posible.
22. Limpia únicamente saltos de línea innecesarios, espacios duplicados y repeticiones evidentes.
23. Si el archivo contiene columnas adicionales no pedidas, ignóralas por completo.
24. No mezcles el contenido de una celda con otra salvo que ambas pertenezcan claramente al mismo concepto solicitado y al mismo ítem.
25. Si una columna del archivo tiene un título distinto pero el concepto coincide con una de las columnas pedidas, mapea su valor a la columna normalizada más cercana.
26. Si una columna del archivo no coincide conceptualmente con ninguna de las columnas pedidas, no la incluyas en ningún campo.
27. Conserva intacto el valor original de cada celda: no resumas, no traduzcas, no reformules y no agregues etiquetas nuevas.
28. Solo puedes unir textos cuando el mismo valor esté partido por salto de línea, por celdas continuas del mismo campo o por cambio de página.
29. Nunca agregues el Código UNSPSC ni clasificaciones similares en “Detalles o ficha técnica”.
30. “Consecutivo interno” es una numeración propia de este JSON: 1, 2, 3, etc., siguiendo el orden de aparición de los ítems.
31. “Consecutivo interno” no reemplaza “No. item”. Si el documento trae “No. item”, conserva ese valor en “No. item”.
32. Antes de poblar cada campo, verifica que el valor provenga de una celda, columna o bloque cuyo concepto corresponda a ese campo normalizado.
33. Si una celda contiene información mixta, extrae solo la parte que corresponda claramente al campo solicitado; si no se puede separar sin editar o interpretar, conserva el texto completo solo si pertenece principalmente a ese campo.
34. No uses metadata, encabezados, notas, codigos de clasificación ni texto contextual para rellenar campos faltantes.
35. No lleves observaciones generales del documento a los ítems.
36. No lleves datos de los ítems a metadata salvo conteo y observaciones de extracción estrictamente necesarias.
37. Si el documento trae una sola columna tipo “DESCRIPCIÓN”, “DESCRIPCIÓN DETALLADA”, “CONCEPTO” o similar, conserva todo ese valor completo en “Nombre o descripción” y deja “Detalles o ficha técnica” en null, salvo que exista otra columna separada de ficha/detalle técnico.
38. No uses saltos de línea internos de una misma celda como razón para separar nombre y ficha técnica.
39. Si una o varias filas inferiores no tienen precio ni número propio y parecen continuar la descripción/ficha del ítem anterior, intégralas al mismo campo del ítem anterior, no crees un ítem nuevo.
40. Para considerar una fila como ítem debe existir al menos una descripción/nombre/concepto del producto o servicio y un precio techo, precio unitario, valor de referencia o valor equivalente. Si falta uno de esos mínimos, trátala como posible continuación, encabezado, nota o ruido, no como ítem independiente.

CRITERIO DE NORMALIZACIÓN

Cada ítem debe quedar en una sola fila lógica.

La información debe quedar distribuida así:

- “Consecutivo interno”: número entero consecutivo asignado por esta extracción para identificar cada fila normalizada. Debe empezar en 1 y aumentar según el orden de aparición.
- “Lote”: lote, grupo, categoría o sección a la que pertenece el ítem, si existe.
- “No. item”: número, código, referencia, identificador externo del producto o identificador interno que el documento use para distinguir el ítem. Si el documento no trae ese dato, usa null. No uses Código UNSPSC, CPC ni clasificaciones generales como número de ítem.
- “Nombre o descripción”: nombre principal del bien o servicio.
- “Detalles o ficha técnica”: especificaciones, características, requerimientos, medidas, capacidades, materiales, normas, accesorios incluidos o cualquier detalle técnico asociado.
- “Und de medida”: unidad de medida exacta encontrada en el documento.
- “Cant”: cantidad solicitada.
- “Precio techo encontrado”: precio unitario, valor de referencia, valor promedio, precio techo o precio total encontrado en el documento, según aparezca.

REGLA DE INTEGRIDAD DE CELDA

La normalización cambia nombres de columnas, no parte arbitrariamente los valores.

- Si una celda de origen corresponde conceptualmente a “Nombre o descripción”, copia esa celda completa en “Nombre o descripción”.
- Si una celda de origen corresponde conceptualmente a “Detalles o ficha técnica”, copia esa celda completa en “Detalles o ficha técnica”.
- Si el documento tiene una sola celda descriptiva con nombre, características, medidas, potencia, capacidad o referencia, no la dividas: ponla completa en “Nombre o descripción”.
- Solo llena “Detalles o ficha técnica” cuando haya una columna, celda o bloque claramente separado que funcione como ficha/detalle técnico.
- Si el detalle técnico aparece en filas inferiores como continuación del mismo ítem, únelo al campo que está continuando.
- Si no existe campo separado de detalles/ficha técnica, usa null.

Ejemplo:

Si la tabla trae:
ITEM | DESCRIPCIÓN DETALLADA | UNIDAD | PRECIO TECHO

Entonces “DESCRIPCIÓN DETALLADA” debe ir completa en “Nombre o descripción” y “Detalles o ficha técnica” debe ser null, aunque el texto tenga saltos de línea o muchas especificaciones.

EQUIVALENCIAS SEMÁNTICAS PERMITIDAS

Usa estas equivalencias solo para decidir a qué columna normalizada pertenece un valor. No modifiques el valor copiado.

- “Lote”: lote, grupo, paquete, categoría, capítulo, sección, línea, componente.
- “No. item”: ítem, item, número, no., consecutivo del documento, código del ítem, referencia, ref., SKU, código interno, identificador, ID de producto.
- “Nombre o descripción”: descripción, nombre, producto, bien, servicio, elemento, artículo, concepto, objeto, denominación.
- “Detalles o ficha técnica”: especificación, especificaciones, ficha técnica, características, detalle, requerimientos, condiciones técnicas, medidas, dimensiones, material, capacidad, potencia, norma técnica, accesorios.
- “Und de medida”: unidad, unidad de medida, und, u/m, UM, presentación, medida.
- “Cant”: cantidad, cant., qty, unidades solicitadas, volumen, número de unidades.
- “Precio techo encontrado”: precio techo, valor unitario, valor de referencia, precio unitario, presupuesto unitario, valor promedio, precio promedio, valor total, presupuesto oficial, valor estimado.

Si el documento usa otro nombre de columna pero el concepto es equivalente a uno de estos, úsalo.
Si el concepto no es equivalente, ignóralo.

COLUMNAS Y DATOS QUE DEBEN IGNORARSE

Ignora por completo cualquier dato que no corresponda a las columnas solicitadas.

Ejemplos de datos que NO deben copiarse ni integrarse en otros campos:

- Código UNSPSC.
- Código CPC.
- Clasificación UNSPSC.
- Familia, clase o segmento UNSPSC.
- Rubro presupuestal.
- Fuente, proveedor, marca sugerida o información administrativa que no sea parte de la descripción o ficha técnica.
- Observaciones internas que no describan el producto, unidad, cantidad, lote, número de ítem o precio.

Si aparece una columna llamada “Código UNSPSC”, “UNSPSC”, “Clasificación”, “Segmento”, “Familia” o similar, ignórala. No la pongas en “No. item”, no la pongas en “Detalles o ficha técnica” y no la menciones en metadata.

POLÍTICA DE FILTRADO DE RUIDO

Sigue este criterio antes de devolver cada dato:

1. Identifica todas las filas reales de ítems.
2. Identifica qué columnas, celdas o bloques del documento corresponden conceptualmente a:
   - Consecutivo interno
   - Lote
   - No. item
   - Nombre o descripción
   - Detalles o ficha técnica
   - Und de medida
   - Cant
   - Precio techo encontrado
3. Copia únicamente esos valores al JSON.
4. Ignora todo lo demás aunque aparezca en la misma tabla.

Ejemplos:

- Si una tabla tiene columnas “Código UNSPSC”, “Descripción”, “Unidad”, “Cantidad” y “Valor unitario”, ignora “Código UNSPSC” y conserva las demás según correspondan.
- Si una fila trae notas administrativas que no describen técnicamente el ítem, no las agregues a “Detalles o ficha técnica”.
- Si una hoja trae datos de proveedor, proceso, modalidad, entidad, plazo o forma de pago, no los agregues a ningún ítem.
- Si un bloque contiene ficha técnica real del producto, sí puede ir en “Detalles o ficha técnica”, pero sin agregar datos externos ni clasificaciones.
- Si un encabezado parece un lote o categoría y aplica a varios ítems, úsalo solo en “Lote”.

IMPORTANTE SOBRE “No. item” VS “Consecutivo interno”

- “No. item” debe conservar el identificador que venga en el archivo original, si existe.
- “No. item” puede ser un número de ítem, código de producto, referencia, SKU o identificador propio de la entidad, siempre que el documento lo use para identificar ese ítem.
- Si el documento no trae identificador de ítem, “No. item” debe ser null.
- “Consecutivo interno” siempre debe existir y sirve únicamente para identificar la fila dentro de este JSON.
- No copies “Consecutivo interno” en “No. item”.
- No uses Código UNSPSC, CPC ni clasificaciones externas como “No. item”.

SALIDA OBLIGATORIA

Devuelve únicamente un JSON válido.

No uses Markdown.
No agregues explicaciones antes ni después.
No agregues comentarios fuera del JSON.
No cambies los nombres de los campos.
No agregues columnas adicionales dentro de cada ítem.

La estructura debe ser exactamente esta:

{
  "metadata": {
    "total_items_detectados": 0,
    "observaciones_generales": []
  },
  "items": [
    {
      "Consecutivo interno": 1,
      "Lote": null,
      "No. item": null,
      "Nombre o descripción": null,
      "Detalles o ficha técnica": null,
      "Und de medida": null,
      "Cant": null,
      "Precio techo encontrado": null
    }
  ]
}

REGLAS FINALES

- Si un dato no está en el documento, usa null.
- Si un dato está dudoso pero aparece relacionado con el ítem, inclúyelo y conserva el texto original.
- Si un dato pertenece a una columna no solicitada, ignóralo aunque esté relacionado con el ítem.
- Si “No. item” no aparece, usa null y conserva la identificación mediante “Consecutivo interno”.
- Si hay varios precios posibles, prioriza el precio unitario o valor unitario promedio.
- Si no puedes distinguir si el precio es unitario o total, conserva el texto tal como aparece.
- Si el documento trae varios lotes, todos deben quedar en el mismo JSON, diferenciados por el campo “Lote”.
- Si hay ítems sin lote, déjalos con “Lote”: null.
- La salida debe servir como base limpia para una segunda etapa de análisis técnico.
`;

export const STAGE1_EXPECTED_SHAPE = {
  metadata: {
    total_items_detectados: 0,
    observaciones_generales: []
  },
  items: [
    {
      "Consecutivo interno": 1,
      "Lote": null,
      "No. item": null,
      "Nombre o descripción": null,
      "Detalles o ficha técnica": null,
      "Und de medida": null,
      "Cant": null,
      "Precio techo encontrado": null
    }
  ]
};

export function buildStage1Prompt(documentText: string, fileName: string) {
  return `${STAGE1_EXTRACTION_PROMPT}

Devuelve únicamente un JSON válido, sin markdown, sin texto antes ni después.
La respuesta debe tener exactamente esta estructura base:

${JSON.stringify(STAGE1_EXPECTED_SHAPE, null, 2)}

Recordatorio crítico:
- No partas una celda de origen para llenar varias columnas.
- Si el documento trae una sola columna descriptiva, conserva esa celda completa en “Nombre o descripción”.
- Usa “Detalles o ficha técnica” solo si el documento trae ese detalle en una celda, columna o bloque separado.
- Un ítem mínimo debe tener descripción/nombre y precio techo o valor equivalente.
- Filas inferiores sin identificador/precio propio pueden ser continuación del ítem anterior.

Archivo: ${fileName}

Contenido del documento:
${documentText}`;
}
