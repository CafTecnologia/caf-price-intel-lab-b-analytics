import { compactItemForPricing, getStageItems } from "@/lib/stage-field-access";

type CompactPricingItem = ReturnType<typeof compactItemForPricing>;

export function buildStage3GoogleLabPrompt(stage2Json: unknown) {
  const compactItems = getStageItems(stage2Json).map((item, index) => compactItemForPricing(item, index));
  const metadata = stage2Json && typeof stage2Json === "object" && !Array.isArray(stage2Json)
    ? (stage2Json as { metadata?: Record<string, unknown> }).metadata
    : undefined;

  if (metadata?.lab_prompt_style === "markdown_table_one_source") {
    return buildMarkdownOneSourcePrompt(compactItems);
  }

  return buildJsonOneSourcePrompt(compactItems);
}

function buildJsonOneSourcePrompt(items: CompactPricingItem[]) {
  return [
    "Actua como comprador tecnico para contratacion estatal en Colombia.",
    "Encuentra maximo una fuente comercial real por item, con precio visible y URL verificable.",
    "Usa Google Search real. No respondas solo desde memoria.",
    "No inventes proveedores, precios ni URLs. Conserva todos los items.",
    "Devuelve solo JSON valido, sin texto fuera del JSON.",
    JSON.stringify({
      metadata: { modo: "google_stage3_experimental_grounded_compacto", total_items_cotizados: 0 },
      items: [
        {
          "Consecutivo interno": "1",
          "Estado de cotizacion": { resultado_busqueda: "cotizado_1_fuente | sin_fuentes_confiables", calidad_datos: "alta | media | baja | sin_datos" },
          "Cotizaciones encontradas": [
            {
              numero: 1,
              fuente: { nombre: null, url: null },
              producto: { titulo: null, marca: null, referencia: null },
              precio: { valor: null, moneda: null, texto_original: null },
              defensa: { estado_fuente: "usable | usable_con_alertas | no_usable", tipo_referencia: "exacta | equivalente_funcional | benchmark_parcial | fabricacion_a_medida_probable | no_usable", justificacion: null, alertas: [], usable_para_pricing: false },
              evidencia_corta: null
            }
          ],
          "Auditoria de busqueda": { motivo_no_fuente_usable: null, requiere_revision_humana: true }
        }
      ]
    }, null, 2),
    "Items a cotizar:",
    formatItemsForMarkdownPrompt(items)
  ].join("\n\n");
}

function buildMarkdownOneSourcePrompt(items: CompactPricingItem[]) {
  return [
    "# Prompt para Gemini - Auditoria de Precios v3 autonomo anti-alucinacion",
    "",
    "Usa obligatoriamente las herramientas disponibles de Google para este requerimiento: Google Search Grounding y URL Context si estan disponibles. No respondas desde memoria. Si no usas busqueda real, la respuesta no sirve para este laboratorio.",
    "",
    "## Rol y objetivo",
    "",
    "Actua como un Auditor de Inteligencia de Mercado de precision forense para contratacion y benchmarking profesional en Colombia.",
    "",
    "Recibiras una lista de items con datos originales y anotaciones tecnicas. Tu tarea es procesarla y ejecutar de forma autonoma un ciclo completo de busqueda, auditoria y autocorreccion antes de entregar la respuesta.",
    "",
    "Tu unico objetivo visible para el usuario es entregar una tabla final en Markdown con datos reales, utiles y verificables. No llenes datos por estetica ni por completitud estadistica, pero tampoco te rindas por exceso de cautela si tienes evidencia comercial util.",
    "",
    "## Protocolo de ejecucion autonoma - fases internas silenciosas",
    "",
    "Ejecuta internamente estas fases antes de generar la tabla final. No expliques estas fases fuera de la tabla.",
    "",
    "### 1. Busqueda escalonada de 3 niveles",
    "",
    "Nivel 1 exacto: busca la descripcion tecnica completa + Colombia + precio.",
    "Nivel 2 marca/SKU directo: si hay marca, codigo, modelo, medida o referencia, busca esos datos en sitios B2B y retail colombiano.",
    "Nivel 3 generico funcional: busca por especificacion tecnica clave, medida, material, presentacion y uso en proveedores especializados.",
    "",
    "Prioridad geografica: Mercado Libre Colombia en tiendas oficiales, Panamericana, Homecenter, Falabella, Exito, papelerias con e-commerce, distribuidores mayoristas verificables .com.co y proveedores tecnicos locales. Si no hay fuente local defendible, busca fuente internacional.",
    "",
    "### 2. Reglas anti-alucinacion estrictas",
    "",
    "- Cero reconstruccion: prohibido adivinar o inyectar URLs logicas, slugs predictivos o IDs/SKUs simulados, por ejemplo inventar codigos MCO en Mercado Libre.",
    "- La URL debe venir copiada de una fuente real consultada. Si no estas seguro del enlace directo exacto, deja URL proveedor 1 vacia.",
    "- Si la URL contiene un codigo o ID de producto, verifica mentalmente que corresponda a la pagina consultada. No inventes IDs.",
    "- El precio debe ser visible en la pagina de destino o sustentado por la herramienta de busqueda/grounding sin login ni registro.",
    "- No apliques descuentos no garantizados ni calculos financieros. Entrega el precio tal como aparece y aclara presentacion si aplica.",
    "- Prioridad de realidad vs presupuesto: el precio techo unitario NO es filtro de rechazo. Si el precio real supera el techo, reportalo igual y explicalo en notas.",
    "- No inventes proveedores, productos, precios, cantidades, unidades ni precios techo.",
    "- No cambies los datos originales del item. Conserva todos los items en la salida.",
    "",
    "### 3. Auditoria interna y prueba de enlace muerto",
    "",
    "Antes de escribir una URL, revisa si el slug es coherente con el producto y si el dominio/pagina parece ser una ficha comercial directa.",
    "Si el slug tiene secuencias numericas sospechosas, redundantes o no sustentadas por la herramienta, descarta la URL.",
    "Si un precio, SKU o ID difiere aunque sea por un digito de la evidencia real, consideralo error de integridad y borralo.",
    "No uses pagina principal, categoria, marca, coleccion, buscador interno ni URL generica como URL proveedor 1 si no permite verificar producto y precio directamente.",
    "",
    "### 4. Protocolo Link Vacio y trazabilidad",
    "",
    "Si tras agotar los 3 niveles no hallas e-commerce directo, funcional y defendible para un item, deja vacios proveedor, precio, moneda y URL proveedor 1.",
    "Si Google Search/Grounding muestra proveedor, producto y precio pero no puedes confirmar URL directa, puedes reportar proveedor/precio como candidato observado por busqueda, dejar URL proveedor 1 vacia y explicar en Notas proveedor 1: candidato observado en busqueda/grounding; requiere verificacion humana del enlace.",
    "En Notas del item explica brevemente que se encontro fuente directa, candidato de grounding, benchmark parcial o que no se hallo precio directo neto verificable, y menciona los terminos principales de busqueda usados.",
    "No pongas Google Search como fuente comercial. Solo si el laboratorio te exige trazabilidad de busqueda, puedes poner una URL de Google Search en URL proveedor 1, pero debes dejar proveedor, precio y moneda vacios y en Notas proveedor 1 escribir exactamente: No se hallo precio directo neto verificable en e-commerce. Se adjunta enlace de trazabilidad de busqueda.",
    "",
    "## Interpretacion del item",
    "",
    "Usa los datos originales y las anotaciones tecnicas de cada item para decidir que buscar y que aceptar.",
    "",
    "- Si el item exige marca, referencia, modelo, compatibilidad, capacidad, norma, medida exacta o presentacion especifica, la fuente debe respetar esos requisitos.",
    "- Si el item es abierto, homologable o de gama definida, puedes usar un producto equivalente o similar, pero debes explicar la equivalencia y las diferencias importantes.",
    "- Si el producto parece de fabricacion a medida, busca una referencia comercial comparable que ayude a estimar precio, pero marcala como benchmark parcial o fabricacion a medida probable en notas.",
    "- Si solo encuentras una ficha tecnica sin precio, no la pongas como proveedor con precio. Puedes mencionarla en Notas del item como pista tecnica.",
    "- Si encuentras un benchmark parcial util para estimar mercado, puedes usarlo solo si el precio es real y explicas claramente que diferencia tiene frente al item solicitado.",
    "",
    "## Criterio de fuente defendible",
    "",
    "La fuente seleccionada debe tener proveedor o tienda identificable, producto solicitado o alternativa equivalente explicada, precio visible o claramente sustentado, moneda COP o USD y URL directa que permita verificar producto y precio.",
    "",
    "## Salida requerida estricta",
    "",
    "Entrega exclusivamente una tabla Markdown raw. Sin saludos, sin introducciones, sin resumenes de auditoria, sin despedidas y sin bloques de codigo delimitados por backticks.",
    "",
    "Usa exactamente estas columnas y en este orden:",
    "",
    "| Item | Nombre | Descripcion | Und de medida | Cant | Precio techo unitario | Notas del item | Proveedor 1 | Precio proveedor 1 | Moneda proveedor 1 | URL proveedor 1 | Notas proveedor 1 | TRM proveedor 1 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "",
    "## Como llenar las notas",
    "",
    "Notas del item: resume busqueda aplicada, requisitos criticos, nivel que funciono o fallo, y si el precio real supera el techo.",
    "Notas proveedor 1: explica por que la fuente sirve, si es exacta/equivalente/benchmark/fuente con cautela, diferencias importantes y si el precio fue visible en link o observado mediante Grounding/URL Context/busqueda.",
    "",
    "## Items a evaluar",
    "",
    "A continuacion vienen los items a evaluar. Usa sus datos originales y su lectura tecnica como fuente principal para decidir la busqueda.",
    "",
    formatItemsForMarkdownPrompt(items)
  ].join("\n");
}

export function buildStage3GoogleLabInstructionPrompt() {
  return buildMarkdownOneSourcePrompt([]).replace(/\n## Items a evaluar\n[\s\S]*$/u, "").trim();
}

export function buildStage3GoogleLabFinalPrompt(instructionPrompt: string, stage2Json: unknown) {
  const items = getStageItems(stage2Json).map((item, index) => compactItemForPricing(item, index));
  return [
    instructionPrompt.trim(),
    "",
    "## Items a evaluar",
    "",
    "A continuacion vienen los items de la etapa a evaluar. Usa sus datos originales y su lectura tecnica como fuente principal para decidir la busqueda.",
    "",
    formatItemsForMarkdownPrompt(items)
  ].join("\n");
}

export function formatItemsForMarkdownPrompt(items: CompactPricingItem[]) {
  return items.map((item) => [
    `ITEM ${item.itemKey}`,
    `Nombre: ${item.name || ""}`,
    `Descripcion: ${item.description || ""}`,
    `Und de medida: ${item.unit || ""}`,
    `Cant: ${item.quantity || ""}`,
    `Precio techo unitario: ${item.ceiling || ""}`,
    "",
    "Lectura tecnica:",
    `Tipo de ficha: ${item.type || ""}`,
    `Resumen comprable: ${item.technicalNote || ""}`,
    `Atributos obligatorios: ${formatPromptValue(item.criticalAttributes)}`,
    `Guia para busqueda: ${formatPromptValue(item.searchGuide)}`
  ].join("\n")).join("\n\n");
}

function formatPromptValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => `\n- ${String(item)}`).join("");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === null || value === undefined ? "" : String(value);
}
