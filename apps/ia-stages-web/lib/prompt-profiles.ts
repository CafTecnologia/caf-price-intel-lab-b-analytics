import type { AiProvider, AiStage } from "@/lib/config";

type PromptProfileInput = {
  provider: AiProvider;
  model: string;
  stage?: AiStage;
};

export function applyAiPromptProfile(prompt: string, input: PromptProfileInput) {
  const additions = getPromptProfileAdditions(input);

  if (!additions) {
    return prompt;
  }

  return `${prompt}

${additions}`;
}

function getPromptProfileAdditions({ provider, model, stage }: PromptProfileInput) {
  const additions: string[] = [];

  if (!isEconomicalModel(provider, model)) {
    return "";
  }

  if (stage === "stage1") {
    additions.push(ECONOMICAL_STAGE1_PROFILE);

    if (provider === "deepseek") {
      additions.push(DEEPSEEK_STAGE1_SURGICAL_PROFILE);
    }
  }

  if (stage === "stage2") {
    additions.push(ECONOMICAL_STAGE2_PROFILE);

    if (provider === "deepseek") {
      additions.push(DEEPSEEK_STAGE2_SURGICAL_PROFILE);
    }
  }

  return additions.join("\n\n");
}

function isEconomicalModel(provider: AiProvider, model: string) {
  const normalized = model.toLowerCase();

  if (provider === "deepseek") {
    return /deepseek-v4-(flash|pro)/.test(normalized);
  }

  return /gemini-2\.5-flash(-lite)?/.test(normalized);
}

const ECONOMICAL_STAGE1_PROFILE = `
AJUSTE OPERATIVO PARA MODELOS ECONOMICOS

Este ajuste refuerza reglas ya existentes. No cambia la estructura de salida.

1. Devuelve solo un JSON valido y completo. No agregues texto fuera del JSON.
2. Si el documento trae una columna o numeracion visible llamada Item, Item, No., N, Codigo, Consecutivo, ID, Referencia o similar, copia ese valor original en "No. item".
3. "No. item" puede coincidir numericamente con "Consecutivo interno" cuando el documento si trae esa numeracion visible. Eso no es inventar.
4. Solo usa null en "No. item" cuando el documento no trae ningun identificador visible para la fila.
5. No copies "Consecutivo interno" en "No. item" si el documento no trae identificador visible.
6. En PDFs con tablas partidas, puede ocurrir que Item, Cant, Und/Med y Precio aparezcan en un bloque, y las descripciones aparezcan debajo o en otra zona visual. Reconstruye por orden de aparicion cuando la relacion sea clara.
7. Si la tabla continua en otra pagina, conserva el orden y sigue alineando item/cantidad/precio con la descripcion correspondiente.
8. Manten cada valor copiado lo mas intacto posible. No reformules ni completes celdas.
9. Si ves un encabezado como "Item Cant. Und/Med Historico/Secop Promedio Aritm." y filas como "1 12 Unidad 840.000 $ 840.000 $", interpreta asi: "No. item" = 1, "Cant" = 12, "Und de medida" = Unidad, "Precio techo encontrado" = 840.000 o el valor equivalente observado.
10. En ese patron, nunca dejes "No. item" en null: el primer numero de cada fila numerica es el item original del documento.
`;

const ECONOMICAL_STAGE2_PROFILE = `
AJUSTE OPERATIVO PARA MODELOS ECONOMICOS

Este ajuste busca reducir respuestas largas y evitar truncamientos. No cambia la estructura de salida.

1. Devuelve solo un JSON valido y completo. No agregues texto fuera del JSON.
2. Conserva intactos todos los campos originales de cada item.
3. "Nota tecnica para cotizacion" debe ser maximo una frase corta.
4. Si no hay una recomendacion tecnica realmente util, usa null en "Nota tecnica para cotizacion".
5. No repitas informacion que ya esta clara en Nombre, Detalles, Unidad, Cantidad o Precio.
6. En "Unidad tecnica de referencia", usa una frase muy corta orientada a la unidad/presentacion relevante para cotizar.
7. Prioriza completar todos los items con texto compacto en vez de escribir analisis largos.
8. Si recibes mas de 40 items, activa modo compacto: "Unidad tecnica de referencia" maximo 6 palabras y "Nota tecnica para cotizacion" maximo 12 palabras o null.
9. No uses frases completas cuando una etiqueta corta sea suficiente.
`;

const DEEPSEEK_STAGE1_SURGICAL_PROFILE = `
AJUSTE QUIRURGICO PARA DEEPSEEK - ETAPA 1

Este ajuste solo aclara como responder con documentos largos o tablas repetidas. No cambia la estructura de salida.

1. Antes de cerrar el JSON, verifica mentalmente cobertura por secciones: todas las hojas, todos los lotes, todos los bloques y todas las paginas con items.
2. Si un archivo tiene varias secciones de items, no termines al completar la primera seccion. Continua hasta la ultima seccion con precios.
3. Si una hoja trae FERRETERIA y ELECTRICIDAD, ambas son secciones de items. Deben salir en el mismo arreglo "items".
4. Si una tabla trae varias cotizaciones y un bloque PROMEDIO, usa el valor promedio mas cercano a precio unitario con IVA cuando exista. No uses total general, subtotal de fila ni valor sin IVA si existe un promedio unitario con IVA.
5. Si el precio aparece como VALOR UNITARIO IVA INCLUIDO, TOTAL PROMEDIO, PRECIO PROMEDIO o equivalente unitario, prioriza ese valor.
6. Si el documento trae una solicitud tecnica agrupada y mas abajo una tabla economica expandida con precios por renglon, conserva los renglones economicos con precio como items cotizables y usa la ficha tecnica relacionada solo si alinea claramente con el mismo item.
7. No crees items a partir de filas sin precio propio salvo que sean continuacion clara del item anterior.
8. No agregues filas de totales, subtotales, IVA, mantenimiento excluido o notas de no incluir.
9. Si el documento trae 80, 100 o mas items, sigue respondiendo compacto hasta completar todos los items. Es preferible dejar campos no encontrados en null que cortar la salida.
10. El JSON completo vale mas que una descripcion perfecta: no alargues campos para explicar.
`;

const DEEPSEEK_STAGE2_SURGICAL_PROFILE = `
AJUSTE QUIRURGICO PARA DEEPSEEK - ETAPA 2

Este ajuste busca mejorar clasificacion tecnica sin alargar la respuesta. No cambia la estructura de salida.

1. Copia exactamente todos los campos originales recibidos. No cambies tildes, mayusculas, numeros, unidades, precios ni descripciones.
2. Agrega solo "Tipo de ficha", "Unidad tecnica de referencia", "Nota tecnica para cotizacion" y "Confianza".
3. Si hay mas de 40 items, escribe notas solo cuando sean realmente utiles. En los demas casos usa null.
4. "servicio_definido" gana cuando la fila representa mantenimiento, instalacion, alquiler, medicion, intervencion, mano de obra o servicio sobre un equipo, aunque mencione marca, modelo o referencia del equipo atendido.
5. "cerrada_referencia" exige que la marca, modelo, referencia, SKU o numero de parte sea el producto a comprar o entregar, no solo el equipo objeto de un servicio.
6. "cerrada_velada" aplica cuando la fila parece apuntar a una referencia concreta por medidas, compatibilidad, capacidad, redaccion de catalogo o equipo asociado, pero no exige explicitamente una referencia exacta como producto a entregar.
7. "gama_definida" aplica cuando hay capacidad, potencia, calibre, medida, material, norma o desempeno claro, pero varias marcas/referencias podrian cumplir.
8. "abierta_generica" aplica cuando el item es comun y cotizable sin especificacion fuerte.
9. "insuficiente" aplica cuando faltan datos tecnicos minimos para saber que cotizar. No tengas confianza alta en un item insuficiente.
10. Si no hay una advertencia practica nueva, deja "Nota tecnica para cotizacion" en null. No escribas "informacion insuficiente" como nota.
11. No conviertas una fila en cerrada solo porque reconoces una posible marca o referencia si esa referencia no esta exigida claramente por la fila.
12. Completa todos los items antes de mejorar redaccion. Respuesta compacta, JSON completo.
`;
