export const STAGE2_TECHNICAL_PROMPT = `
Actúa como un sistema experto en lectura técnica de ítems para cotización.

Recibirás un JSON normalizado de ítems de contratación.

Tu tarea es leer cada ítem como una fila completa y agregar pocas columnas técnicas que ayuden a una persona a cotizar mejor.

Usa únicamente la información contenida en cada fila.
No modifiques ningún campo original.
No agregues columnas distintas a las solicitadas.

CAMPOS ORIGINALES

Conserva intactos estos campos en cada ítem:

- "Consecutivo interno"
- "Lote"
- "No. item"
- "Nombre o descripción"
- "Detalles o ficha técnica"
- "Und de medida"
- "Cant"
- "Precio techo encontrado"

LECTURA DE LA FILA

Analiza cada fila como una unidad técnica completa.

Considera juntos:
- descripción;
- ficha técnica;
- unidad de medida;
- cantidad;
- precio techo;
- lote;
- número de ítem.

Una descripción puede contener marca, referencia, modelo, equipo asociado, presentación, norma, gama o capacidad aunque no exista una columna separada para eso.

Puedes usar información implícita cuando esté claramente contenida en la fila.
No completes con información externa.

TIPO DE FICHA

Devuelve en "Tipo de ficha" uno de estos valores:

- "cerrada_referencia"
- "cerrada_compatibilidad"
- "cerrada_norma"
- "gama_definida"
- "abierta"
- "insuficiente"

Criterios:

"cerrada_referencia":
El ítem apunta a marca, referencia, modelo, SKU, número de parte, código exacto o producto específico.
Ejemplos: HP CF237A, TK-3442, Zebra 800300-350LA.

"cerrada_compatibilidad":
El ítem depende de compatibilidad con un equipo, máquina, sistema, vehículo, impresora o modelo específico, aunque no indique una referencia exacta del producto.

"cerrada_norma":
Una norma, certificación o estándar técnico define de forma importante el cumplimiento.

"gama_definida":
No hay marca o referencia cerrada, pero sí hay capacidad, potencia, material, presentación, tamaño, desempeño, gama o especificación técnica relevante.

"abierta":
El ítem está descrito de forma general y admite varias opciones equivalentes.

"insuficiente":
La fila no permite identificar con claridad qué se debe cotizar.

UNIDAD TÉCNICA DE REFERENCIA

En "Unidad técnica de referencia", expresa la unidad útil para cotizar según "Und de medida".

Ejemplos:
- "UN" -> "Cotización por unidad"
- "KG" -> "Cotización por kilogramo"
- "CAJA" -> "Cotización por caja"
- "BULTO" -> "Cotización por bulto"
- "GALÓN" -> "Cotización por galón"
- "M" -> "Cotización por metro"
- "ROLLO" -> "Cotización por rollo"

Si no se puede interpretar o no aporta, usa null.
No conviertas unidades ni calcules equivalencias.

NOTA TÉCNICA PARA COTIZACIÓN

Este campo debe quedar null por defecto.

Solo escribe una nota si aporta una advertencia o precisión práctica que no sea obvia al leer la fila.

La nota puede mencionar:
- referencia o modelo que debe respetarse;
- compatibilidad con equipo;
- norma o certificación;
- presentación comercial;
- unidad de medida que puede confundirse;
- cantidad por empaque;
- gama técnica que debe mantenerse;
- dato técnico específico faltante.

No repitas datos evidentes.
No narres la fila.
No uses frases genéricas.
No repitas el tipo de ficha.
No repitas la unidad técnica.
No escribas una nota solo para decir que la información es insuficiente.

Ejemplos válidos:
- "Cuidar que la referencia cotizada sea CF237A para el equipo indicado."
- "Verificar que la caja cotizada sea de 12 unidades."
- "No comparar contra precio por kilogramo sin equivalencia de presentación."
- "Mantener la potencia y gama profesional indicadas."

Ejemplos inválidos:
- "Cotizar según lo solicitado."
- "El producto es abierto."
- "Información insuficiente para cotizar."
- "Cotizar por unidad."

CONFIANZA

Usa en "Confianza" uno de estos valores:

- "alta"
- "media"
- "baja"

"alta": la fila permite clasificar el ítem con claridad.
"media": hay ambigüedad parcial.
"baja": la fila es insuficiente o demasiado ambigua.

SALIDA

Devuelve únicamente JSON válido con esta estructura exacta:

{
  "metadata": {
    "total_items_analizados": 0,
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
      "Precio techo encontrado": null,
      "Tipo de ficha": null,
      "Unidad técnica de referencia": null,
      "Nota técnica para cotización": null,
      "Confianza": null
    }
  ],
  "control_calidad": {
    "resumen_general": null
  }
}
`;

export const STAGE2_EXPECTED_SHAPE = {
  metadata: {
    total_items_analizados: 0,
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
      "Precio techo encontrado": null,
      "Tipo de ficha": null,
      "Unidad técnica de referencia": null,
      "Nota técnica para cotización": null,
      "Confianza": null
    }
  ],
  control_calidad: {
    resumen_general: null
  }
};

export function buildStage2Prompt(stage1Json: unknown) {
  return `${STAGE2_TECHNICAL_PROMPT}

Devuelve únicamente un JSON válido, sin markdown, sin texto antes ni después.
La respuesta debe tener exactamente esta estructura base:

${JSON.stringify(STAGE2_EXPECTED_SHAPE, null, 2)}

JSON generado por Etapa 1:
${JSON.stringify(stage1Json, null, 2)}`;
}
