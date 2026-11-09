import { collectStage3SourceEvidence } from "@/lib/stage3-source-audit";

type JsonRecord = Record<string, unknown>;
type SignalValue = "si" | "no" | "no_evaluable";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function signal(value: boolean | null | undefined): SignalValue {
  if (value === true) return "si";
  if (value === false) return "no";
  return "no_evaluable";
}

function signalFromText(value: unknown): SignalValue {
  if (typeof value === "boolean") return signal(value);
  const text = asText(value).toLowerCase();
  if (["si", "true", "ok", "verificada", "confirmado", "coincide"].includes(text)) return "si";
  if (["no", "false", "error", "fallo", "no_coincide"].includes(text)) return "no";
  return "no_evaluable";
}

function sourceEvidenceKey(value: unknown): string {
  if (!isRecord(value)) return "";
  const sourceId = asText(value.sourceId);
  if (sourceId) return sourceId;
  const itemKey = asText(value.itemKey);
  const index = asText(value.sourceIndex);
  return itemKey && index ? `${itemKey}#${index}` : itemKey;
}

function extractUrlContextResult(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  if (isRecord(value.result)) return value.result;
  return value;
}

function extractUrlContextSources(value: unknown): JsonRecord[] {
  const result = extractUrlContextResult(value);
  return Array.isArray(result.fuentes) ? result.fuentes.filter(isRecord) : [];
}

function summarizeUrlContextForSupervisor(value: unknown) {
  const result = extractUrlContextResult(value);
  const fuentes = extractUrlContextSources(value);
  if (!fuentes.length) return null;
  return {
    metadata: isRecord(result.metadata) ? result.metadata : null,
    resumen: isRecord(result.resumen) ? result.resumen : null,
    fuentes: fuentes.length
  };
}

function sourceUrlContextKey(source: JsonRecord): string {
  return asText(source.sourceId) || asText(source.fuente) || asText(source.itemKey);
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getItems(value: unknown): JsonRecord[] {
  if (!isRecord(value)) return [];
  const direct = value.items;
  if (Array.isArray(direct)) return direct.filter(isRecord);
  const result = isRecord(value.result) ? value.result : null;
  return Array.isArray(result?.items) ? result.items.filter(isRecord) : [];
}

function itemKeyFromRecord(item: JsonRecord, fallbackIndex: number): string {
  const consecutive = asText(item["Consecutivo interno"]) || asText(item.consecutivo) || asText(item.consecutivo_interno) || asText(item.item) || asText(item.Item);
  if (consecutive) return consecutive;
  const lote = asText(item.Lote) || asText(item.lote);
  const itemNo = asText(item["No. item"]) || asText(item.no_item) || asText(item.numero_item);
  if (lote || itemNo) return [lote ? `lote:${lote}` : "", itemNo ? `item:${itemNo}` : ""].filter(Boolean).join("|");
  return `fila:${fallbackIndex + 1}`;
}

function buildStage2Context(stage2Json?: unknown) {
  const items = getItems(stage2Json).slice(0, 120);
  return items.map((item, index) => ({
    itemKey: itemKeyFromRecord(item, index),
    nombre: asText(item["Nombre o descripcion"]) || asText(item["Nombre o descripción"]) || asText(item["Nombre o descripciÃ³n"]) || asText(item.name) || asText(item.nombre),
    ficha: asText(item["Detalles o ficha tecnica"]) || asText(item["Detalles o ficha técnica"]) || asText(item["Detalles o ficha tÃ©cnica"]) || asText(item.description) || asText(item.descripcion),
    lectura_tecnica: asText(item["Lectura tecnica"]) || asText(item["Lectura técnica"]) || asText(item["Lectura tÃ©cnica"]) || asText(item.lectura_tecnica) || asText(item["Notas tecnicas"]) || asText(item["Notas técnicas"]) || asText(item["Notas tÃ©cnicas"]),
    pauta_busqueda: asText(item["Pauta de busqueda"]) || asText(item["Pauta de búsqueda"]) || asText(item["Pauta de bÃºsqueda"]) || asText(item.pauta_busqueda) || asText(item["Como buscar"]) || asText(item["Cómo buscar"]) || asText(item["CÃ³mo buscar"])
  }));
}

function toSignalEvidence(item: JsonRecord): JsonRecord {
  if (isRecord(item.toolSignals)) return item;

  const diagnostics = isRecord(item.diagnostics) ? item.diagnostics : {};
  const status = asText(item.status);
  const url = asText(item.finalUrl) || asText(item.reportedUrl);
  const parsed = safeUrl(url);
  const reportedPrice = asText(item.reportedPriceText) || asText(item.reportedPrice);
  const hasReportedPrice = Boolean(reportedPrice || typeof item.reportedPrice === "number");
  const detectedPrices = Array.isArray(item.detectedPrices) ? item.detectedPrices.map(String).filter(Boolean).slice(0, 8) : [];
  const urlContext = isRecord(item.urlContext) ? item.urlContext : {};
  const rescueSearch = isRecord(item.rescueSearch) ? item.rescueSearch : {};
  const urlContextUrlStatus = (asText(urlContext.url_leida) || asText(urlContext.estado_url)).toLowerCase();
  const priceVisibleText = asText(urlContext.precio_visible).toLowerCase();
  const urlContextPriceVisible = typeof urlContext.precio_visible === "boolean"
    ? urlContext.precio_visible
    : priceVisibleText === "si"
      ? true
      : priceVisibleText === "no"
        ? false
        : null;

  const linkOpened = status === "ok" ? true : status ? false : null;
  const domainResolved = status === "domain_ok" || status === "ok" || (Boolean(parsed?.hostname) && status !== "domain_error" && status !== "invalid_url");
  const urlValid = !url ? null : Boolean(parsed && (parsed.protocol === "http:" || parsed.protocol === "https:"));

  return {
    sourceId: asText(item.sourceId),
    itemKey: asText(item.itemKey),
    itemName: asText(item.itemName),
    itemDescription: asText(item.itemDescription),
    itemCeilingPrice: item.itemCeilingPrice ?? null,
    sourceIndex: item.sourceIndex ?? null,
    reported: {
      provider: asText(item.reportedSourceName),
      url: asText(item.reportedUrl),
      finalUrl: asText(item.finalUrl),
      productTitle: asText(item.reportedProductTitle),
      priceRaw: reportedPrice,
      priceValue: item.reportedPrice ?? null,
      currency: asText(item.reportedCurrency),
      notes: asText(item.reportedNotes)
    },
    toolSignals: {
      proveedor_reportado: signal(Boolean(asText(item.reportedSourceName))),
      precio_reportado: signal(hasReportedPrice),
      url_reportada: signal(Boolean(asText(item.reportedUrl))),
      url_formato_valido: signal(urlValid),
      dominio_resuelve: signal(url ? domainResolved : null),
      link_abre: signal(status ? linkOpened : null),
      contenido_usable: signal(status === "ok" ? true : status === "not_html" ? false : null),
      pagina_tiene_precio: signal(status === "ok" ? detectedPrices.length > 0 : null),
      precio_reportado_aparece_en_pagina: signal(typeof diagnostics.reportedPriceFoundInPage === "boolean" ? diagnostics.reportedPriceFoundInPage : null),
      url_es_busqueda: signal(typeof diagnostics.isSearchUrl === "boolean" ? diagnostics.isSearchUrl : null),
      url_es_homepage: signal(typeof diagnostics.isHomepage === "boolean" ? diagnostics.isHomepage : null),
      pagina_parece_bloqueada: signal(Array.isArray(diagnostics.flags) ? diagnostics.flags.includes("pagina_bloqueo_captcha") : null),
      url_contiene_tokens_tecnicos: signal(typeof diagnostics.urlHasTechnicalTokens === "boolean" ? diagnostics.urlHasTechnicalTokens : null),
      url_comparte_tokens_con_item: signal(typeof diagnostics.urlTokensOverlapItem === "boolean" ? diagnostics.urlTokensOverlapItem : null),
      url_comparte_tokens_con_producto_reportado: signal(typeof diagnostics.urlTokensOverlapReportedProduct === "boolean" ? diagnostics.urlTokensOverlapReportedProduct : null),
      url_comparte_tokens_con_notas_google: signal(typeof diagnostics.urlTokensOverlapNotes === "boolean" ? diagnostics.urlTokensOverlapNotes : null),
      url_parece_ficha_producto: signal(typeof diagnostics.urlLooksLikeProductPage === "boolean" ? diagnostics.urlLooksLikeProductPage : null),
      url_parece_generada_desde_descripcion: signal(typeof diagnostics.urlLooksGeneratedFromDescription === "boolean" ? diagnostics.urlLooksGeneratedFromDescription : null),
      url_fallida_con_pistas_rescate: signal(typeof diagnostics.failedUrlWithRescueSignals === "boolean" ? diagnostics.failedUrlWithRescueSignals : null),
      sin_url_con_senal_grounding: signal(typeof diagnostics.missingUrlWithGroundingSignal === "boolean" ? diagnostics.missingUrlWithGroundingSignal : null),
      google_url_context_leyo_url: signal(urlContextUrlStatus ? urlContextUrlStatus === "verificada" || urlContextUrlStatus === "si" : null),
      google_url_context_pagina_abre: signalFromText(urlContext.pagina_abre),
      google_url_context_producto_leido: signalFromText(urlContext.producto_leido),
      google_url_context_precio_visible: signal(urlContextPriceVisible),
      google_url_context_devolvio_precio: signal(asText(urlContext.precio_detectado) ? true : urlContextUrlStatus ? false : null),
      google_url_context_precio_reportado_coincide: signalFromText(urlContext.precio_reportado_coincide),
      busqueda_rescate_ejecutada: signal(typeof rescueSearch.attempted === "boolean" ? rescueSearch.attempted : null),
      rescate_encontro_url: signal(asText(rescueSearch.candidateUrl) ? true : typeof rescueSearch.attempted === "boolean" ? false : null),
      rescate_url_mismo_proveedor: signal(typeof rescueSearch.sameProviderOrDomain === "boolean" ? rescueSearch.sameProviderOrDomain : null),
      rescate_link_abre: signal(typeof rescueSearch.urlOpened === "boolean" ? rescueSearch.urlOpened : null),
      rescate_precio_reportado_aparece: signal(typeof rescueSearch.priceFoundInPage === "boolean" ? rescueSearch.priceFoundInPage : null),
      rescate_tokens_producto: signal(typeof rescueSearch.technicalTokenHit === "boolean" ? rescueSearch.technicalTokenHit : null)
    },
    observed: {
      httpStatus: item.httpStatus ?? null,
      pageTitle: asText(item.title),
      textPreview: asText(item.textPreview).slice(0, 900),
      detectedPrices,
      error: asText(item.error),
      rescueHints: {
        strongUrlTokens: Array.isArray(diagnostics.strongUrlTokens) ? diagnostics.strongUrlTokens.map(String).slice(0, 16) : [],
        sharedUrlItemTokens: Array.isArray(diagnostics.sharedUrlItemTokens) ? diagnostics.sharedUrlItemTokens.map(String).slice(0, 12) : [],
        sharedUrlReportedProductTokens: Array.isArray(diagnostics.sharedUrlReportedProductTokens) ? diagnostics.sharedUrlReportedProductTokens.map(String).slice(0, 12) : [],
        sharedUrlNoteTokens: Array.isArray(diagnostics.sharedUrlNoteTokens) ? diagnostics.sharedUrlNoteTokens.map(String).slice(0, 12) : [],
        failedUrlWithRescueSignals: typeof diagnostics.failedUrlWithRescueSignals === "boolean" ? diagnostics.failedUrlWithRescueSignals : null,
        missingUrlWithGroundingSignal: typeof diagnostics.missingUrlWithGroundingSignal === "boolean" ? diagnostics.missingUrlWithGroundingSignal : null
      },
      urlContext: Object.keys(urlContext).length ? {
        url_leida: urlContext.url_leida ?? null,
        pagina_abre: urlContext.pagina_abre ?? null,
        producto_leido: urlContext.producto_leido ?? null,
        estado_url: urlContext.estado_url ?? null,
        precio_visible: urlContext.precio_visible ?? null,
        precio_reportado_coincide: urlContext.precio_reportado_coincide ?? null,
        precio_detectado: urlContext.precio_detectado ?? null,
        producto_detectado: urlContext.producto_en_pagina ?? urlContext.producto_detectado ?? null,
        evidencia: urlContext.evidencia ?? urlContext.evidencia_url ?? null
      } : null,
      rescueSearch: Object.keys(rescueSearch).length ? {
        candidateKind: rescueSearch.candidateKind ?? null,
        query: rescueSearch.query ?? null,
        candidateUrl: rescueSearch.candidateUrl ?? null,
        candidateFinalUrl: rescueSearch.candidateFinalUrl ?? null,
        candidateTitle: rescueSearch.candidateTitle ?? null,
        sameProviderOrDomain: rescueSearch.sameProviderOrDomain ?? null,
        urlOpened: rescueSearch.urlOpened ?? null,
        priceFoundInPage: rescueSearch.priceFoundInPage ?? null,
        productTokensFound: Array.isArray(rescueSearch.productTokensFound) ? rescueSearch.productTokensFound.map(String).slice(0, 12) : [],
        detectedPrices: Array.isArray(rescueSearch.detectedPrices) ? rescueSearch.detectedPrices.map(String).slice(0, 8) : [],
        error: rescueSearch.error ?? null
      } : null
    }
  };
}

export function toStage3SourceSignalEvidence(evidence: unknown): JsonRecord[] {
  return Array.isArray(evidence) ? evidence.filter(isRecord).map(toSignalEvidence) : [];
}

export function summarizeStage3SourceSignalEvidence(evidence: JsonRecord[]) {
  const countSignal = (key: string, value: SignalValue = "si") =>
    evidence.filter((item) => isRecord(item.toolSignals) && item.toolSignals[key] === value).length;

  return {
    fuentes_reportadas: evidence.length,
    con_proveedor: countSignal("proveedor_reportado"),
    con_precio: countSignal("precio_reportado"),
    con_url: countSignal("url_reportada"),
    dominios_resuelven: countSignal("dominio_resuelve"),
    links_abren: countSignal("link_abre"),
    paginas_con_precio: countSignal("pagina_tiene_precio"),
    precios_reportados_confirmados_en_pagina: countSignal("precio_reportado_aparece_en_pagina"),
    url_context_precios_reportados_coinciden: countSignal("google_url_context_precio_reportado_coincide"),
    url_context_productos_leidos: countSignal("google_url_context_producto_leido"),
    urls_fallidas_con_pistas_rescate: countSignal("url_fallida_con_pistas_rescate"),
    urls_con_tokens_compartidos_item: countSignal("url_comparte_tokens_con_item"),
    urls_con_tokens_producto_reportado: countSignal("url_comparte_tokens_con_producto_reportado"),
    urls_parecen_ficha_producto: countSignal("url_parece_ficha_producto"),
    fuentes_sin_url_con_grounding: countSignal("sin_url_con_senal_grounding"),
    url_context_leyo_url: countSignal("google_url_context_leyo_url"),
    rescate_busquedas: countSignal("busqueda_rescate_ejecutada"),
    rescate_urls_encontradas: countSignal("rescate_encontro_url"),
    rescate_links_abren: countSignal("rescate_link_abre"),
    rescate_precios_confirmados: countSignal("rescate_precio_reportado_aparece"),
    rescate_tokens_producto: countSignal("rescate_tokens_producto")
  };
}

export async function buildStage3SourceSupervisorEvidencePayload(body: {
  stage2Json?: unknown;
  stage3Result?: unknown;
  rawText?: string;
  maxSources?: number;
  evidence?: unknown;
  urlContextResult?: unknown;
}) {
  const directPayload = Array.isArray(body.evidence)
    ? { evidence: body.evidence, summary: null }
    : await collectStage3SourceEvidence(body.stage3Result, { maxSources: body.maxSources });

  const urlContextBySource = new Map<string, JsonRecord>();
  for (const source of extractUrlContextSources(body.urlContextResult)) {
    const sourceId = sourceUrlContextKey(source);
    if (sourceId) urlContextBySource.set(sourceId, source);
  }

  const merged = (Array.isArray(directPayload.evidence) ? directPayload.evidence : []).filter(isRecord).map((item) => {
    const key = sourceEvidenceKey(item);
    const urlContext = key ? urlContextBySource.get(key) : undefined;
    return urlContext ? { ...item, urlContext } : item;
  });
  const evidence = toStage3SourceSignalEvidence(merged);

  return {
    stage2Context: buildStage2Context(body.stage2Json),
    evidence,
    summary: {
      binarySignals: summarizeStage3SourceSignalEvidence(evidence),
      source: directPayload.summary,
      urlContext: summarizeUrlContextForSupervisor(body.urlContextResult)
    },
    rawText: typeof body.rawText === "string" ? body.rawText.slice(0, 12000) : undefined
  };
}

export function buildStage3SourceSupervisorPrompt(payload: { evidence: unknown; summary: unknown; rawText?: string; stage2Context?: unknown }) {
  return `Eres el supervisor IA de Etapa 3-B. Tu trabajo es auditar si las fuentes y precios entregados por el cotizador parecen reales y sustentados.

La app NO decide por ti. La app solo mide senales cerradas como si/no/no_evaluable. Tu debes interpretar esas senales junto con el resultado crudo del cotizador.

Objetivo unico:
Determinar, por cada fuente, si el cotizador invento datos o si hay soporte razonable para usar esa referencia de precio. Tu pregunta central es: "esta fuente sirve para que un humano la use como referencia de mercado, con el nivel de confianza correcto?"

No hagas:
- No reemplaces una fuente por otra tienda distinta solo para completar. Si investigas, concentrate en el mismo proveedor/dominio o en una tienda asociada claramente por nombre.
- No inventes proveedores, precios, URLs ni productos.
- No invalides una fuente porque el precio supere el precio techo. El precio techo solo sirve como contexto financiero; no es criterio de verdad ni de descarte.
- No calcules utilidad, margen, oferta, IVA, totales ni ajustes financieros.
- No castigues automaticamente una fuente por timeout, 403, captcha o bloqueo si otras senales la sostienen.
- No uses "precio cercano al techo", "precio supera techo" o "precio bajo techo" como razon de descarte. Solo importa si el precio reportado parece real y sustentado.
- No conviertas un bloqueo tecnico de lectura en "fuente mala". Si el dominio es real, la URL parece ficha de producto, el proveedor/precio estan reportados y el producto corresponde, normalmente es una fuente con cautela, no una baja automatica.
- No confirmes una fuente solo porque el precio te parezca plausible o porque recuerdes que el proveedor existe. Si no hay precio confirmado, usa confianza media como maximo.

Usa las senales como contrato cerrado:
- "si" significa que la app pudo comprobar esa pregunta.
- "no" significa que la app no pudo comprobarla o encontro lo contrario.
- "no_evaluable" significa que la herramienta no pudo medirlo; no lo conviertas en fallo automatico ni en confirmacion.
- La app mide hechos binarios. Tu no debes inventar senales nuevas: si una senal no esta en los datos, tratala como no_evaluable.

Preguntas que debes responder por fuente:
1. Hay proveedor, producto y precio reportados?
2. Hay soporte externo de URL o pagina? link_abre, google_url_context_leyo_url, rescate_link_abre, url_parece_ficha_producto, url_comparte_tokens_con_item o url_comparte_tokens_con_producto_reportado.
3. Hay soporte externo del precio? precio_reportado_aparece_en_pagina, google_url_context_precio_reportado_coincide o rescate_precio_reportado_aparece. Si no lo hay pero la fuente es una ficha comercial coherente, baja a cautela/media en vez de descartar.
4. El producto corresponde razonablemente al item y a su ficha?
5. Hay signos de riesgo: URL generada, 404/409/timeout sin ninguna pista de producto, pagina generica, proveedor generico, SKU/ID sospechoso, producto distinto, precio sin soporte o precio diferente al detectado?

Reglas de decision:
- precio_confirmado: solo cuando proveedor/producto/precio estan reportados, la URL o URL Context lee la pagina, el producto corresponde y el precio reportado queda confirmado por pagina, URL Context o rescate.
- precio_confirmado_url_corregida: solo cuando la URL original falla, pero busqueda_rescate encuentra una URL del mismo proveedor/dominio que abre, contiene tokens del producto y confirma el precio reportado.
- precio_confirmado_con_cautela: cuando hay proveedor + producto + precio reportado y la fuente parece real, pero falta confirmacion plena del precio. Ejemplos validos: URL Context lee producto pero el scraper no ve precio; la URL abre y producto corresponde pero el precio carga por JavaScript; la URL exacta de producto falla por 403/captcha pero dominio, slug/tokens y proveedor son coherentes; se detecta un precio diferente pero cercano y el producto corresponde. Este estado SIEMPRE implica confianza media como maximo.
- fuente_real_url_no_canonica: proveedor/producto/precio parecen reales, pero la URL es categoria, busqueda interna, coleccion, listado o pagina no final. Usalo como rescatable/media-baja, no como aceptacion directa.
- precio_sin_confirmar: proveedor/producto pueden ser reales, pero el precio no quedo sustentado y la URL tampoco da suficiente soporte de producto.
- fuente_sin_url_rescatable: hay proveedor/producto/precio en el raw, pero no hay URL util ni rescate suficiente para sostenerlo.
- url_no_verificable: hay URL, pero ninguna herramienta pudo leerla ni sostenerla; si ademas el precio no tiene soporte, no la aceptes.
- producto_no_corresponde: la evidencia muestra marca/modelo/capacidad/presentacion/producto incompatible.
- sin_fuente: no hay proveedor, precio ni URL util.

Reglas negativas importantes:
- No uses precio_confirmado_con_cautela si la URL no abre, URL Context no lee, rescate no abre, y la URL tampoco parece ficha de producto ni comparte tokens claros con el item/producto reportado. Eso es fuente_sin_url_rescatable o precio_sin_confirmar.
- No uses precio_confirmado si el estado narrativo dice "se acepta con cautela", "no confirma precio", "pagina generica", "URL no abre" o "requiere rescate".
- No uses confianza alta con accion aceptar_con_cautela.
- No uses confianza alta si el estado es precio_confirmado_con_cautela, fuente_real_url_no_canonica, precio_sin_confirmar, fuente_sin_url_rescatable, url_no_verificable, producto_no_corresponde o sin_fuente.
- No uses confianza baja cuando no hay proveedor, precio ni URL candidata. Eso no es mala fuente: es sin_datos.
- No invalides una fuente porque el precio supere el techo. El techo solo es contexto financiero, no prueba de verdad.
- No confirmes una fuente por plausibilidad, memoria o nombre de proveedor. El precio actual requiere soporte externo.
- No marques como baja una ficha comercial coherente solo porque Google URL Context fallo completo o el fetch del VPS recibio 403. En ese caso usa media/cautela si no hay contradiccion.
- No rescates una URL 404/410 solo porque el slug parezca coherente. Un 404/410 requiere URL Context, rescate con producto/precio o nueva busqueda; si no, dejala rescatable/baja. Trata 403/captcha/timeout diferente: esos si pueden ser bloqueo tecnico.

Reglas de confianza:
- alta: solo precio_confirmado o precio_confirmado_url_corregida con precio_soportado=si, url_soportada=si y producto_corresponde=si/parcial.
- media: precio_confirmado_con_cautela, o fuente real con URL de producto/proveedor/precio coherentes pero precio no confirmado por bloqueo, JavaScript, timeout o falla transitoria de herramienta.
- baja: producto_no_corresponde, URL generada/sospechosa, pagina generica/listado sin producto, precio ausente, proveedor generico, precio contradictorio fuerte, o caso demasiado gris.
- sin_datos: sin_fuente o ausencia de proveedor/precio/URL candidata.
Estados permitidos:
- precio_confirmado: fuente, producto y precio tienen soporte suficiente.
- precio_confirmado_url_corregida: la URL reportada era mala/no canonica, pero el mismo proveedor/dominio sostiene producto y precio mediante URL corregida o evidencia equivalente.
- precio_confirmado_con_cautela: hay soporte razonable de proveedor/producto/precio por raw + senales, pero alguna senal quedo no_evaluable, bloqueada, en busqueda interna, coleccion o sin precio visible por scraping.
- fuente_real_url_no_canonica: proveedor/producto/precio parecen reales, pero la URL reportada parece generada, vieja o no canonica y requiere corregirse antes de usarla como soporte final.
- precio_sin_confirmar: la fuente puede existir, pero el precio no quedo sustentado.
- fuente_sin_url_rescatable: proveedor/producto/precio parecen utiles, pero falta URL o la URL no sirve.
- url_no_verificable: hay URL, pero ninguna herramienta pudo leerla ni sostenerla.
- producto_no_corresponde: la evidencia muestra que el producto no corresponde razonablemente.
- sin_fuente: no hay proveedor/precio/URL suficiente.

Devuelve SOLO JSON valido con esta forma:
{
  "resumen": {
    "estado_general": "con_precios_confirmados | mixto | requiere_rescate | sin_soporte",
    "fuentes_evaluadas": 0,
    "precios_confirmados": 0,
    "precios_con_cautela": 0,
    "fuentes_rescatables": 0,
    "sin_soporte": 0,
    "comentario": "texto corto"
  },
  "fuentes": [
    {
	      "sourceId": "string",
	      "itemKey": "string",
	      "estado": "precio_confirmado | precio_confirmado_url_corregida | precio_confirmado_con_cautela | fuente_real_url_no_canonica | precio_sin_confirmar | fuente_sin_url_rescatable | url_no_verificable | producto_no_corresponde | sin_fuente",
	      "precio_soportado": "si | no | parcial | no_evaluable",
	      "url_soportada": "si | no | parcial | no_evaluable",
	      "producto_corresponde": "si | no | parcial | no_evaluable",
      "techo_alerta": "supera_techo | cerca_techo | sin_alerta | no_evaluable",
      "evidencia_usada": ["herramienta_dominios", "herramienta_links", "busqueda_rescate", "google_url_context", "resultado_crudo"],
      "comentario": "explicacion corta, orientada a soporte real del precio",
	      "accion_sugerida": "aceptar | aceptar_con_cautela | aceptar_url_corregida | rescatar_url | buscar_precio | nueva_busqueda | descartar",
      "confianza": "alta | media | baja | sin_datos"
    }
  ],
  "items_prioritarios": [
    {
      "itemKey": "string",
      "motivo": "texto corto",
      "accion_sugerida": "rescatar_url | buscar_precio | nueva_busqueda | descartar | sin_accion"
    }
  ]
}

Datos disponibles para auditar:
${JSON.stringify(payload, null, 2)}`;
}
