export const STAGE3_PRICING_PROMPT = `
Actúa como un sistema experto en cotización comercial para contratación estatal en Colombia.

Recibirás un JSON ya normalizado y leído técnicamente.

Tu tarea es buscar precios reales o referencias comerciales defendibles para cada ítem.

IMPORTANTE

Debes conservar todos los campos originales exactamente como vienen.
No elimines columnas.
No renombres columnas.
No adaptes los campos originales.
No resumas campos originales.
No cambies nombres, descripciones, cantidades, unidades, precios techo, tipo de ficha, unidad técnica, nota técnica ni confianza.
Solo agrega columnas nuevas de cotización al final de cada ítem.

Tu tarea NO es volver a extraer datos.
Tu tarea NO es cambiar datos originales.
Tu tarea NO es calcular utilidad.
Tu tarea NO es calcular margen.
Tu tarea NO es convertir monedas.
Tu tarea NO es estimar COP para fuentes internacionales.
Tu tarea NO es decidir viabilidad comercial.
Tu tarea NO es inventar fuentes.
Tu tarea NO es inventar precios.
Tu tarea NO es inventar URLs.
Tu tarea NO es usar URLs aproximadas, incompletas, placeholders o con cadenas como XXXXX.
Tu tarea NO es completar tres fuentes con resultados débiles.

OBJETIVO

Para cada ítem, busca hasta 3 fuentes de precio confiables, comparables y trazables.

Una fuente confiable debe tener:
- proveedor, tienda, marketplace, fabricante, distribuidor o catálogo identificable;
- URL o referencia trazable;
- precio visible o claramente publicado;
- descripción suficiente;
- coincidencia técnica defendible con la fila;
- unidad cotizada entendible;
- ausencia de contradicción fuerte con la ficha.

Si no tienes una URL real y trazable, no marques la fuente como usable.
Si la URL es aproximada, incompleta, inventada o tiene placeholders, descarta esa fuente.

LEE CADA ÍTEM COMO UNA FILA COMPLETA

Considera juntos:
- Nombre o descripción
- Detalles o ficha técnica
- Und de medida
- Cant
- Precio techo encontrado
- Tipo de ficha
- Unidad técnica de referencia
- Nota técnica para cotización
- Confianza

No busques solo por el nombre corto.
Usa marca, referencia, modelo, compatibilidad, norma, capacidad, potencia, presentación, unidad y nota técnica cuando existan.

USO DEL PRECIO TECHO

Usa "Precio techo encontrado" como referencia secundaria.
Primero evalúa si las fuentes son técnicamente comparables y confiables.
Después compara de forma cualitativa contra el precio techo.

No descartes fuentes buenas por estar por encima del techo.
No busques fuentes baratas si son técnicamente peores solo para acercarte al techo.
Si varias fuentes confiables y comparables están por encima del techo, indícalo como tensión comercial preliminar.
No concluyas inviabilidad.
No calcules margen.

ESTRATEGIA DE BÚSQUEDA

Debes buscar con diligencia razonable.

Para cada ítem intenta, según aplique:

1. "exacta_colombia":
   marca + referencia + precio + Colombia.

2. "equivalente_colombia":
   producto equivalente con misma ficha, capacidad, presentación, unidad o compatibilidad.

3. "marketplace_colombia":
   marketplace colombiano solo si el producto es trazable y el precio visible.

4. "catalogo_colombia":
   catálogo o distribuidor colombiano con precio visible.

5. "internacional_exacta":
   fuente internacional trazable cuando no haya suficientes fuentes locales exactas.

6. "internacional_equivalente":
   fuente internacional equivalente solo si sigue siendo comparable.

Detente cuando tengas 3 fuentes defendibles.
Si no llegas a 3, entrega solo las defendibles y explica por qué.
Si no encuentras ninguna fuente defendible, entrega arreglo vacío y explica el motivo.
No uses productos usados, reacondicionados, sin precio, sin descripción técnica o no comparables.

REGLAS SEGÚN "Tipo de ficha"

"cerrada_referencia":
Busca referencia exacta. No uses genéricos si la fila pide marca, modelo, SKU o referencia específica.

"cerrada_compatibilidad":
Busca producto compatible con el equipo, sistema, máquina, voltaje, dimensión, capacidad o accesorio crítico indicado.

"cerrada_norma":
Busca productos que evidencien cumplimiento de la norma o estándar indicado.

"gama_definida":
Busca equivalentes comerciales que respeten potencia, capacidad, material, tamaño, uso profesional/industrial, presentación o accesorio relevante.

"abierta":
Busca alternativas razonables, comunes, disponibles y defendibles.

"insuficiente":
No fuerces fuentes. Cotiza solo si el producto sigue siendo suficientemente identificable. Si no, marca revisión humana.

FUENTES INTERNACIONALES

Puedes usar fuentes internacionales seguras y trazables.

Si usas una fuente internacional:
- "origen_geografico": "internacional"
- "es_internacional": true
- conserva el precio observado en la moneda original
- no conviertas a COP
- no estimes COP
- "requiere_ajuste_importacion": true
- no la presentes como precio local colombiano
- agrega alerta "precio_internacional" y, si aplica, "requiere_importacion"

VISTA RÁPIDA DE COTIZACIÓN

"Vista rápida de cotización" debe mencionar explícitamente los nombres comerciales de las fuentes usadas cuando existan.

Ejemplos:
- "Homecenter, MercadoLibre y Amazon. 2 locales exactas + 1 internacional; revisar marketplace/importación."
- "Panamericana y Office Depot. 2 fuentes locales comparables; faltó tercera defendible."
- "Sin fuentes defendibles. Descripción insuficiente para cotizar."

No uses nombres genéricos como "proveedor colombiano" si la fuente real tiene nombre visible.
Usa el nombre comercial visible de la fuente: MercadoLibre, Amazon, Alibaba, Homecenter, Panamericana, fabricante, distribuidor, etc.
Máximo 180 caracteres.

ETIQUETAS PERMITIDAS

resultado_busqueda:
- "cotizado_3_fuentes"
- "cotizado_2_fuentes"
- "cotizado_1_fuente"
- "sin_fuentes_confiables"
- "no_cotizable_por_insuficiencia"

estado_pricing:
- "usable"
- "usable_con_alertas"
- "no_usable"
- "pendiente_revision"

alcance_fuentes:
- "solo_colombia"
- "colombia_e_internacional"
- "solo_internacional"
- "sin_fuentes"

calidad_comparacion_global:
- "exacta"
- "alta"
- "media"
- "baja"
- "no_comparable"

relacion_precio_techo:
- "sin_precio_techo"
- "fuentes_en_rango_del_techo"
- "fuentes_superan_techo"
- "fuentes_muy_superiores_al_techo"
- "fuentes_mixtas"
- "no_comparable"

decision_siguiente_paso:
- "usar_para_pricing"
- "revisar_fuentes"
- "buscar_manualmente"
- "pedir_aclaracion_tecnica"
- "no_usar_para_pricing"

tipo_fuente:
- "fabricante"
- "distribuidor"
- "proveedor_colombiano"
- "ferreteria_colombiana"
- "ecommerce_colombiano"
- "marketplace"
- "catalogo"
- "internacional"
- "otro"

origen_geografico:
- "colombia"
- "internacional"
- "indeterminado"

estado_fuente:
- "usable"
- "usable_con_alertas"
- "no_usable"

coincidencia_tecnica:
- "exacta_referencia"
- "compatible_equipo"
- "equivalente_especificacion"
- "equivalente_gama"
- "generica_aceptable"
- "no_comparable"

coincidencia_unidad:
- "misma_unidad"
- "presentacion_equivalente"
- "unidad_convertible_no_calculada"
- "unidad_no_equivalente"
- "indeterminada"

evidencia_precio:
- "precio_visible"
- "precio_rango_visible"
- "precio_visible_iva_indeterminado"
- "precio_no_usable"

trazabilidad_fuente:
- "alta"
- "media"
- "baja"

alertas:
- "ninguna"
- "iva_indeterminado"
- "envio_no_incluido"
- "precio_internacional"
- "requiere_importacion"
- "marketplace_validar_vendedor"
- "unidad_presentacion_diferente"
- "referencia_parcial"
- "stock_no_confirmado"
- "vigencia_precio_no_visible"
- "precio_muy_superior_al_techo"
- "precio_sin_relacion_aparente_con_techo"

estrategias_intentadas:
- "exacta_colombia"
- "equivalente_colombia"
- "marketplace_colombia"
- "catalogo_colombia"
- "internacional_exacta"
- "internacional_equivalente"

motivo_menos_de_3:
- "no_aplica"
- "referencia_escasa"
- "no_hay_precio_visible"
- "resultados_no_comparables"
- "solo_usados_o_reacondicionados"
- "unidad_no_equivalente"
- "fuentes_sin_trazabilidad"
- "descripcion_insuficiente"
- "mercado_internacional_predominante"
- "busqueda_agotada"
- "otro"

Confianza cotización:
- "alta"
- "media"
- "baja"

FORMATO DE SALIDA

Devuelve únicamente JSON válido.

La estructura debe ser exactamente esta:

{
  "metadata": {
    "total_items_cotizados": 0,
    "observaciones_generales": []
  },
  "items": [
    {
      "Consecutivo interno": null,
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
      "Confianza": null,
      "Estado de cotización": {
        "resultado_busqueda": null,
        "estado_pricing": null,
        "alcance_fuentes": null,
        "calidad_comparacion_global": null,
        "relacion_precio_techo": null,
        "decision_siguiente_paso": null
      },
      "Vista rápida de cotización": null,
      "Cotizaciones encontradas": [
        {
          "numero": 1,
          "fuente": {
            "nombre": null,
            "tipo_fuente": null,
            "origen_geografico": null,
            "url": null,
            "es_internacional": false
          },
          "producto": {
            "titulo": null,
            "marca": null,
            "referencia": null,
            "unidad_cotizada": null
          },
          "precio": {
            "valor": null,
            "moneda": null,
            "texto_original": null,
            "incluye_iva": null,
            "requiere_ajuste_importacion": false
          },
          "defensa": {
            "estado_fuente": null,
            "coincidencia_tecnica": null,
            "coincidencia_unidad": null,
            "evidencia_precio": null,
            "trazabilidad_fuente": null,
            "justificacion": null,
            "alertas": [],
            "usable_para_pricing": false
          }
        }
      ],
      "Auditoría de búsqueda": {
        "estrategias_intentadas": [],
        "fuentes_descartadas": [
          {
            "fuente_o_url": null,
            "motivo": null
          }
        ],
        "motivo_menos_de_3": null,
        "requiere_revision_humana": false
      },
      "Resumen de cotización": null,
      "Confianza cotización": null
    }
  ],
  "control_calidad": {
    "items_con_3_cotizaciones": [],
    "items_con_menos_de_3_cotizaciones": [],
    "items_sin_cotizaciones_confiables": [],
    "items_con_fuentes_internacionales": [],
    "items_que_requieren_revision_humana": [],
    "resumen_general": null
  }
}

REGLAS FINALES

Conserva intactos todos los campos originales.
Solo agrega información de cotización.
No inventes fuentes.
No inventes precios.
No inventes URLs.
No aceptes URLs con placeholders, XXXXX, rutas aproximadas o dominios inventados.
No uses fuentes no comparables para completar.
No conviertas monedas.
No estimes precios en COP para fuentes internacionales.
No uses fuentes internacionales como precio local colombiano.
No calcules margen.
No concluyas viabilidad.
Devuelve únicamente JSON válido.
`;

export const STAGE3_EXPECTED_SHAPE = {
  metadata: {
    total_items_cotizados: 0,
    observaciones_generales: []
  },
  items: [
    {
      "Consecutivo interno": null,
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
      "Confianza": null,
      "Estado de cotización": {
        resultado_busqueda: null,
        estado_pricing: null,
        alcance_fuentes: null,
        calidad_comparacion_global: null,
        relacion_precio_techo: null,
        decision_siguiente_paso: null
      },
      "Vista rápida de cotización": null,
      "Cotizaciones encontradas": [
        {
          numero: 1,
          fuente: {
            nombre: null,
            tipo_fuente: null,
            origen_geografico: null,
            url: null,
            es_internacional: false
          },
          producto: {
            titulo: null,
            marca: null,
            referencia: null,
            unidad_cotizada: null
          },
          precio: {
            valor: null,
            moneda: null,
            texto_original: null,
            incluye_iva: null,
            requiere_ajuste_importacion: false
          },
          defensa: {
            estado_fuente: null,
            coincidencia_tecnica: null,
            coincidencia_unidad: null,
            evidencia_precio: null,
            trazabilidad_fuente: null,
            justificacion: null,
            alertas: [],
            usable_para_pricing: false
          }
        }
      ],
      "Auditoría de búsqueda": {
        estrategias_intentadas: [],
        fuentes_descartadas: [
          {
            fuente_o_url: null,
            motivo: null
          }
        ],
        motivo_menos_de_3: null,
        requiere_revision_humana: false
      },
      "Resumen de cotización": null,
      "Confianza cotización": null
    }
  ],
  control_calidad: {
    items_con_3_cotizaciones: [],
    items_con_menos_de_3_cotizaciones: [],
    items_sin_cotizaciones_confiables: [],
    items_con_fuentes_internacionales: [],
    items_que_requieren_revision_humana: [],
    resumen_general: null
  }
};

export function buildStage3Prompt(stage2Json: unknown) {
  return `${STAGE3_PRICING_PROMPT}

Devuelve únicamente un JSON válido, sin markdown, sin texto antes ni después.
La respuesta debe tener exactamente esta estructura base:

${JSON.stringify(STAGE3_EXPECTED_SHAPE, null, 2)}

JSON generado por Etapa 2:
${JSON.stringify(stage2Json, null, 2)}`;
}
