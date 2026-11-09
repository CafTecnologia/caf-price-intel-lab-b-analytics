import { randomUUID } from "node:crypto";
import { callGemini } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import { compactItemForPricing, getStageItems, isJsonRecord, type JsonRecord } from "@/lib/stage-field-access";
import { extractDeepSeekUsageMetadata, estimateAiCost, type AiCostSummary } from "@/lib/usage-cost";
import { runGoogleStage3Lab } from "@/lib/stage3-google-lab";
import { collectStage3SourceEvidence } from "@/lib/stage3-source-audit";
import { runGoogleUrlContextValidation } from "@/lib/stage3-google-url-context";
import { buildStage3GoogleLabFinalPrompt, formatItemsForMarkdownPrompt } from "@/prompts/stage3-google-lab";

type CompactItem = ReturnType<typeof compactItemForPricing>;

type LabRow = {
  itemKey: string;
  name: string;
  description: string;
  unit: string;
  quantity: string;
  ceiling: string;
  provider: string;
  price: string;
  currency: string;
  url: string;
  itemNotes: string;
  providerNotes: string;
  attempt: number;
  signals: string[];
  rawItem: JsonRecord;
  searchEvidenceUrl?: string;
};

type AuditorPending = {
  itemKey: string;
  motivo?: string;
  instruccion_busqueda?: string;
};

type AuditorReview = {
  resumen?: {
    estado_general?: string;
    comentario?: string;
    items_con_fuente?: number;
    items_pendientes?: number;
  };
  aceptados?: Array<{ itemKey: string; motivo?: string }>;
  pendientes?: AuditorPending[];
  diagnostico_final?: Array<{ itemKey: string; estado?: string; nota?: string }>;
  continuar?: boolean;
};

type AttemptToolEvidence = {
  linkEvidence?: unknown;
  urlContext?: unknown;
  error?: string;
};

type AttemptRecord = {
  attempt: number;
  requestedItems: string[];
  googleModel: string;
  parseMode?: string;
  rows: LabRow[];
  rawPreview: string;
  usage?: unknown;
  cost?: AiCostSummary;
  error?: string;
  toolEvidence?: AttemptToolEvidence;
};

type RunInput = {
  stage2Json: unknown;
  instructionPrompt: string;
  googleModel?: string;
  auditorModel?: string;
  maxAttempts?: number;
  runId?: string;
};

export async function runStage3ConversationalLab(input: RunInput) {
  const runId = input.runId || `conv-lab-${randomUUID()}`;
  const googleModel = input.googleModel || "gemini:gemini-3.5-flash";
  const auditorModel = input.auditorModel || "deepseek:deepseek-v4-pro";
  const maxAttempts = Math.min(3, Math.max(1, input.maxAttempts || 3));
  const allItems = getStageItems(input.stage2Json).map((item, index) => compactItemForPricing(item, index));
  const byKey = new Map(allItems.map((item) => [item.itemKey, item]));
  const accumulated = new Map<string, LabRow>();
  const attempts: AttemptRecord[] = [];
  const auditorReviews: Array<{ attempt: number; review: AuditorReview; raw: string; usage?: unknown; cost?: AiCostSummary; fallback?: boolean }> = [];

  let pendingItems = allItems;
  let previousContext = "Primer intento: lista completa.";

  for (let attempt = 1; attempt <= maxAttempts && pendingItems.length > 0; attempt += 1) {
    const prompt = attempt === 1
      ? buildStage3GoogleLabFinalPrompt(input.instructionPrompt, makeStage2Subset(input.stage2Json, pendingItems, attempt))
      : buildRetryPrompt(input.instructionPrompt, pendingItems, previousContext, attempt);

    let rows: LabRow[] = [];
    let rawPreview = "";
    let parseMode: string | undefined;
    let googleCost: AiCostSummary | undefined;
    let googleUsage: unknown;

    try {
      const google = await runGoogleStage3Lab({
        stage2Json: makeStage2Subset(input.stage2Json, pendingItems, attempt),
        model: googleModel,
        runId: `${runId}-attempt-${attempt}`,
        promptOverride: prompt
      });
      rows = rowsFromStage3Result(google.result, pendingItems, attempt);
      rawPreview = typeof google.raw === "string" ? google.raw.slice(0, 8000) : "";
      parseMode = isJsonRecord(google.details) ? String(google.details.parseMode ?? "") : undefined;
      googleCost = google.cost;
      googleUsage = google.usage;
      mergeRows(accumulated, rows);
      const toolEvidence = await collectAttemptToolEvidence(input.stage2Json, orderRows(allItems, accumulated), googleModel, `${runId}-attempt-${attempt}`);
      attempts.push({
        attempt,
        requestedItems: pendingItems.map((item) => item.itemKey),
        googleModel: google.model,
        parseMode,
        rows,
        rawPreview,
        usage: googleUsage,
        cost: googleCost,
        toolEvidence
      });
    } catch (error) {
      attempts.push({
        attempt,
        requestedItems: pendingItems.map((item) => item.itemKey),
        googleModel,
        rows: [],
        rawPreview: "",
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const reviewResult = await callAuditor({
      runId,
      attempt,
      auditorModel,
      maxAttempts,
      requestedItems: pendingItems,
      accumulatedRows: Array.from(accumulated.values()),
      attemptRows: rows,
      previousContext,
      googleError: attempts.at(-1)?.error,
      toolEvidence: attempts.at(-1)?.toolEvidence
    });
    auditorReviews.push(reviewResult);

    const pendingKeys = normalizePendingKeys(reviewResult.review, allItems, accumulated);
    previousContext = summarizeAuditorReview(reviewResult.review, attempt);
    pendingItems = pendingKeys.map((key) => byKey.get(key)).filter(Boolean) as CompactItem[];

    if (!reviewResult.review.continuar || attempt >= maxAttempts) break;
  }

  const accumulatedRows = orderRows(allItems, accumulated);
  const finalAudit = auditorReviews.at(-1)?.review ?? fallbackAuditorReview(accumulatedRows, allItems, "Sin auditor final.");

  return {
    ok: true,
    runId,
    provider: "gemini-conversational-lab",
    googleModel,
    auditorModel,
    maxAttempts,
    attempts,
    auditorReviews,
    accumulatedRows,
    stage3Result: buildStage3LikeResult(input.stage2Json, accumulatedRows),
    finalAudit,
    summary: summarizeRun(accumulatedRows, allItems, finalAudit),
    cost: summarizeCosts(attempts.map((attempt) => attempt.cost), auditorReviews.map((review) => review.cost))
  };
}

function makeStage2Subset(stage2Json: unknown, items: CompactItem[], attempt: number) {
  const base = isJsonRecord(stage2Json) ? stage2Json : {};
  const metadata = isJsonRecord(base.metadata) ? base.metadata : {};
  return {
    ...base,
    metadata: {
      ...metadata,
      lab_prompt_style: "markdown_table_one_source",
      conversational_lab_attempt: attempt,
      conversational_lab_items: items.map((item) => item.itemKey)
    },
    items: items.map((item) => item.original)
  };
}

function buildRetryPrompt(instructionPrompt: string, items: CompactItem[], previousContext: string, attempt: number) {
  return [
    instructionPrompt.trim(),
    "",
    `## Contexto corto del intento ${attempt}`,
    "",
    previousContext,
    "",
    "El intento anterior dejo estos items pendientes, vacios o dudosos. Procesa SOLO esta lista pendiente.",
    "Mant?n exactamente el mismo formato de tabla Markdown de la instruccion principal.",
    "",
    "## Contra-requerimiento de rescate",
    "",
    "Antes de rendirte, ejecuta un ciclo de busqueda de 3 niveles por cada item pendiente:",
    "",
    "Nivel 1 exacto: descripcion tecnica completa + Colombia + precio.",
    "Nivel 2 marca/modelo/referencia: marca, modelo, codigo, medida o referencia principal si existe.",
    "Nivel 3 generico funcional: especificaciones comerciales, medidas, material, presentacion y proveedor especializado colombiano.",
    "",
    "No uses el precio techo como filtro para descartar una fuente real. Si el precio real supera el techo, reportalo y explicalo.",
    "No reconstruyas URLs ni IDs. Si no tienes URL directa real, deja URL proveedor 1 vacia.",
    "No pegues Google Search como URL proveedor 1. Si solo tienes evidencia de busqueda, deja proveedor/precio/URL vacios y explica en Notas del item que se intento.",
    "",
    "## Items pendientes a evaluar",
    "",
    formatItemsForMarkdownPrompt(items)
  ].join("\n");
}

function rowsFromStage3Result(result: Record<string, unknown>, requestedItems: CompactItem[], attempt: number): LabRow[] {
  const items = Array.isArray(result.items) ? result.items.filter(isJsonRecord) : [];
  const byKey = new Map(items.map((item, index) => [String(item["Consecutivo interno"] ?? item["No. item"] ?? requestedItems[index]?.itemKey ?? index + 1), item]));
  return requestedItems.map((original, index) => {
    const item = byKey.get(original.itemKey) ?? items[index] ?? {};
    const quote = firstQuote(item);
    const fuente = quote && isJsonRecord(quote.fuente) ? quote.fuente : {};
    const precio = quote && isJsonRecord(quote.precio) ? quote.precio : {};
    const defensa = quote && isJsonRecord(quote.defensa) ? quote.defensa : {};
    const provider = text(fuente.nombre) || text(quote?.proveedor);
    const rawUrl = text(fuente.url) || text(quote?.url);
    const searchEvidenceUrl = isGoogleSearchUrl(rawUrl) ? rawUrl : "";
    const url = searchEvidenceUrl ? "" : rawUrl;
    const price = text(precio.texto_original) || text(precio.valor) || text(quote?.precio);
    const currency = text(precio.moneda) || text(quote?.moneda);
    const itemNotes = text(item["Notas del item"]) || text(item["Resumen de cotizacion"]);
    const providerNotes = text(defensa.justificacion) || text(quote?.evidencia_corta) || text(quote?.notas);
    return {
      itemKey: original.itemKey,
      name: original.name,
      description: original.description,
      unit: original.unit,
      quantity: original.quantity,
      ceiling: original.ceiling,
      provider,
      price,
      currency,
      url,
      itemNotes,
      providerNotes,
      attempt,
      signals: buildSignals({ provider, price, currency, url, providerNotes, itemNotes }),
      rawItem: item,
      searchEvidenceUrl
    };
  });
}

function firstQuote(item: JsonRecord): JsonRecord | null {
  const quotes = item["Cotizaciones encontradas"];
  return Array.isArray(quotes) && isJsonRecord(quotes[0]) ? quotes[0] : null;
}

function buildSignals(row: Pick<LabRow, "provider" | "price" | "currency" | "url" | "providerNotes" | "itemNotes">) {
  const signals: string[] = [];
  if (!row.provider) signals.push("sin_proveedor");
  if (!row.price) signals.push("sin_precio");
  if (!row.currency) signals.push("sin_moneda");
  if (!row.url) signals.push("sin_url");
  if (row.url && !/^https?:\/\//i.test(row.url)) signals.push("url_no_http");
  if (isSearchCategoryOrBrandUrl(row.url)) signals.push("url_busqueda_marca_o_categoria");
  if (isGoogleSearchUrl(row.url)) signals.push("url_google_search_no_fuente_comercial");
  if (hasSuspiciousMarketplaceId(row.url)) signals.push("url_id_marketplace_requiere_verificacion");
  if (/homecenter\.com\.co\/?$|mercadolibre\.com\.co\/?$|tierragro\.com\/?$/i.test(row.url)) signals.push("url_homepage");
  if (!row.providerNotes && !row.itemNotes) signals.push("sin_notas_defensa");
  return signals;
}


function isGoogleSearchUrl(url: string) {
  return /(^https?:\/\/)?(www\.)?google\.[^/]+\/search/i.test(url);
}

function isSearchCategoryOrBrandUrl(url: string) {
  return /listado\.mercadolibre|\/search\?|\?q=|\/category\/|\/categories\/|\/collections\/|\/marcas\/|vendors\?q=|\/tag\/|\/catalogo\/?$/i.test(url);
}

function hasSuspiciousMarketplaceId(url: string) {
  return /\/(MCO|MEC|MLA|MLM|MPE)-?\d{8,}/i.test(url);
}

function mergeRows(accumulated: Map<string, LabRow>, incoming: LabRow[]) {
  for (const row of incoming) {
    const current = accumulated.get(row.itemKey);
    if (!current || rowScore(row) > rowScore(current)) {
      accumulated.set(row.itemKey, row);
    }
  }
}

function rowScore(row: LabRow) {
  const directUrlScore = row.url && !isSearchCategoryOrBrandUrl(row.url) && !isGoogleSearchUrl(row.url) ? 2 : 0;
  return (row.provider ? 2 : 0) + (row.price ? 2 : 0) + (row.currency ? 0.5 : 0) + directUrlScore + (row.providerNotes ? 0.5 : 0);
}

async function callAuditor(input: {
  runId: string;
  attempt: number;
  auditorModel: string;
  maxAttempts: number;
  requestedItems: CompactItem[];
  accumulatedRows: LabRow[];
  attemptRows: LabRow[];
  previousContext: string;
  googleError?: string;
  toolEvidence?: AttemptToolEvidence;
}) {
  const prompt = buildAuditorPrompt(input);
  try {
    const ai = await callGemini({ prompt, model: input.auditorModel, stage: "stage3" });
    const parsed = parseJsonFromModelText<AuditorReview>(ai.text);
    const usage = extractDeepSeekUsageMetadata(ai.usageMetadata);
    const cost = estimateAiCost({ provider: "deepseek", model: ai.model, usage });
    return { attempt: input.attempt, review: sanitizeAuditorReview(parsed), raw: ai.text, usage, cost };
  } catch (error) {
    const fallback = fallbackAuditorReview(input.accumulatedRows, input.requestedItems, error instanceof Error ? error.message : String(error));
    return { attempt: input.attempt, review: fallback, raw: "", fallback: true };
  }
}

function buildAuditorPrompt(input: Parameters<typeof callAuditor>[0]) {
  const rows = input.accumulatedRows.map((row) => ({
    itemKey: row.itemKey,
    nombre: row.name,
    proveedor: row.provider,
    precio: row.price,
    moneda: row.currency,
    url: row.url,
    evidencia_busqueda_url: row.searchEvidenceUrl || "",
    notas_item: row.itemNotes,
    notas_proveedor: row.providerNotes,
    intento_origen: row.attempt,
    senales_app: row.signals
  }));
  const currentAttempt = input.attemptRows.map((row) => ({ itemKey: row.itemKey, proveedor: row.provider, precio: row.price, url: row.url, senales_app: row.signals }));
  const toolEvidence = summarizeToolEvidenceForAuditor(input.toolEvidence);
  return [
    "Eres el auditor IA del laboratorio de cotizacion Stage 3.",
    "La app solo te da senales simples; no las trates como verdad absoluta. Tu decides que items tienen una fuente defendible y cuales deben reintentarse.",
    "Evalua con criterio de compras: proveedor identificable, precio real, URL util, coherencia entre proveedor-dominio-producto, precio razonable frente al mercado y relacion tecnica con lo pedido. La URL es la evidencia mas fuerte, pero no es la unica senal: tambien pesan nombre de proveedor, slug coherente, titulo detectado, precio visible, cobertura de tokens del producto, notas de equivalencia y si URL Context pudo leer la pagina.",
    "Una URL de busqueda, marca, coleccion, categoria o Google Search no debe pasar como fuente_defendible si no permite verificar directamente producto y precio; como maximo puede ser benchmark_util, evidencia_de_busqueda o pendiente. Si la fuente es un benchmark parcial util, puedes aceptarla con cautela si el precio sirve como referencia y la nota lo explica.",
    "Aprendizajes del laboratorio: Gemini tiende a completar tablas por estetica, reconstruir slugs bonitos, inventar IDs de marketplaces, sobreconfiar en su propia auditoria, negarse a buscar en algunos reintentos y descartar fuentes reales por superar el precio techo. Debes vigilar esos patrones y pedir reintento solo de lo pendiente.",
    "El precio techo no es filtro de rechazo. Si el precio real supera el techo, puede ser fuente defendible o benchmark util, con nota de alerta.",
    "Si Gemini afirma que ejecuto auditoria interna, no lo aceptes como prueba suficiente. La autoauditoria ayuda, pero no reemplaza evidencia externa, URL directa, URL Context o senales de la app.",
    "Si el scraper directo falla por timeout, 403, captcha o HTTP pero dominio/proveedor/slug son coherentes o URL Context ve producto/precio, no lo descartes de una vez: usa benchmark_util, precio_dudoso o url_no_verificada segun el caso.",
    "Si el dominio no resuelve, la URL es categoria/busqueda/homepage, el link directo da 404/http_error, el precio no aparece y URL Context tampoco verifica, tratalo como pendiente aunque Gemini lo defienda.",
    "Puedes conservar un resultado como benchmark_util o candidato_util cuando proveedor, producto, precio y notas son plausibles, pero si la URL falla y no hay otra evidencia externa fuerte, mantenlo tambien en pendientes mientras queden intentos para buscar una fuente mejor. No confundas candidato util con fuente confirmada.",
    "Si una misma tienda cambia slugs o IDs entre intentos para el mismo item, sospecha reconstruccion de URL. Clasifica como posible_url_inventada o url_dudosa y pide rescate de link/fuente alternativa.",
    "Solo deja pendientes vacio cuando la fuente sea verificable, candidata fuerte por URL Context, o cuando se agotaron los intentos y ya solo queda conservar benchmarks utiles con advertencia.",
    "Si ves URL con ID largo de MercadoLibre/Panamericana/tienda y la app marca url_id_marketplace_requiere_verificacion, no afirmes que fue validada salvo que la evidencia lo sostenga; pidela como pendiente o url_dudosa.",
    "Si aparece evidencia_busqueda_url o una URL de Google Search, clasificala como evidencia_de_busqueda, no como fuente_defendible.",
    "No hagas calculos financieros. No inventes navegacion ni verificacion que no tengas en la evidencia recibida.",
    `Este proceso permite maximo ${input.maxAttempts} intentos de Gemini. Vas en el intento ${input.attempt}.`,
    input.googleError ? `El intento de Gemini fallo tecnicamente: ${input.googleError}` : "",
    "",
    "Devuelve solo JSON valido con esta forma exacta:",
    JSON.stringify({
      resumen: { estado_general: "completo | parcial | fallido", comentario: "", items_con_fuente: 0, items_pendientes: 0 },
      aceptados: [{ itemKey: "1", motivo: "" }],
      pendientes: [{ itemKey: "2", motivo: "", instruccion_busqueda: "" }],
      diagnostico_final: [{ itemKey: "1", estado: "fuente_defendible | benchmark_util | candidato_util | evidencia_de_busqueda | pendiente | sin_fuente | precio_dudoso | url_dudosa | posible_url_inventada", nota: "" }],
      continuar: true
    }, null, 2),
    "",
    "Contexto anterior:",
    input.previousContext,
    "",
    "Items solicitados en este intento:",
    JSON.stringify(input.requestedItems.map((item) => ({ itemKey: item.itemKey, nombre: item.name, descripcion: item.description, unidad: item.unit, cantidad: item.quantity, precio_techo: item.ceiling, guia_busqueda: item.searchGuide, atributos: item.criticalAttributes })), null, 2),
    "",
    "Respuesta acumulada actual:",
    JSON.stringify(rows, null, 2),
    "",
    "Evidencia tecnica reunida por la app antes de tu auditoria:",
    JSON.stringify(toolEvidence, null, 2),
    "",
    "Solo para referencia, filas devueltas en el intento actual:",
    JSON.stringify(currentAttempt, null, 2)
  ].filter(Boolean).join("\n");
}


async function collectAttemptToolEvidence(stage2Json: unknown, rows: LabRow[], googleModel: string, runId: string): Promise<AttemptToolEvidence> {
  const stage3Result = buildStage3LikeResult(stage2Json, rows);
  const sourcesCount = rows.filter((row) => row.url).length;
  if (!sourcesCount) return { linkEvidence: { summary: { inspectedSources: 0 } }, urlContext: { result: { resumen: { no_verificables: 0 } } } };

  try {
    const [linkEvidence, urlContext] = await Promise.all([
      collectStage3SourceEvidence(stage3Result, { maxSources: Math.min(20, Math.max(1, sourcesCount)) }),
      runGoogleUrlContextValidation({
        stage3Result,
        model: googleModel,
        maxSources: Math.min(12, Math.max(1, sourcesCount)),
        runId: `${runId}-url-context`
      })
    ]);
    return { linkEvidence, urlContext };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

function summarizeToolEvidenceForAuditor(toolEvidence?: AttemptToolEvidence) {
  if (!toolEvidence) return { disponible: false };
  if (toolEvidence.error) return { disponible: false, error: toolEvidence.error };

  const linkEvidence = isJsonRecord(toolEvidence.linkEvidence) ? toolEvidence.linkEvidence : {};
  const linkRows = Array.isArray(linkEvidence.evidence) ? linkEvidence.evidence.filter(isJsonRecord) : [];
  const urlContextRoot = isJsonRecord(toolEvidence.urlContext) ? toolEvidence.urlContext : {};
  const urlContextResult = isJsonRecord(urlContextRoot.result) ? urlContextRoot.result : {};
  const urlContextRows = Array.isArray(urlContextResult.fuentes) ? urlContextResult.fuentes.filter(isJsonRecord) : [];
  const urlBySource = new Map(urlContextRows.map((row) => [text(row.sourceId), row]));

  return {
    disponible: true,
    resumen_link_directo: isJsonRecord(linkEvidence.summary) ? linkEvidence.summary : null,
    resumen_url_context: isJsonRecord(urlContextResult.resumen) ? urlContextResult.resumen : null,
    fuentes: linkRows.slice(0, 20).map((row) => {
      const sourceId = text(row.sourceId);
      const diagnostics = isJsonRecord(row.diagnostics) ? row.diagnostics : {};
      const urlContext = sourceId ? urlBySource.get(sourceId) : undefined;
      return {
        sourceId,
        itemKey: text(row.itemKey),
        proveedor_reportado: text(row.reportedSourceName),
        url_reportada: text(row.reportedUrl),
        producto_reportado: text(row.reportedProductTitle),
        precio_reportado: row.reportedPrice ?? null,
        estado_link_directo: text(row.status),
        http_status: row.httpStatus ?? null,
        titulo_detectado: text(row.title),
        precios_detectados: Array.isArray(row.detectedPrices) ? row.detectedPrices.slice(0, 5) : [],
        banderas_app: Array.isArray(diagnostics.flags) ? diagnostics.flags : [],
        nivel_app: text(diagnostics.level),
        precio_reportado_visible: diagnostics.reportedPriceFoundInPage ?? null,
        cobertura_texto_producto: diagnostics.productTokenCoverage ?? null,
        url_context: urlContext ? {
          estado_url: text(urlContext.estado_url),
          estado_fuente: text(urlContext.estado_fuente),
          precio_visible: urlContext.precio_visible ?? null,
          precio_detectado: urlContext.precio_detectado ?? null,
          cumple_ficha: text(urlContext.cumple_ficha),
          evidencia: text(urlContext.evidencia).slice(0, 500),
          riesgos: Array.isArray(urlContext.riesgos) ? urlContext.riesgos : [],
          accion_sugerida: text(urlContext.accion_sugerida)
        } : null
      };
    })
  };
}

function sanitizeAuditorReview(review: AuditorReview): AuditorReview {
  return {
    resumen: isJsonRecord(review.resumen) ? review.resumen : {},
    aceptados: Array.isArray(review.aceptados) ? review.aceptados.filter(isJsonRecord).map((row) => ({ itemKey: text(row.itemKey), motivo: text(row.motivo) })) : [],
    pendientes: Array.isArray(review.pendientes) ? review.pendientes.filter(isJsonRecord).map((row) => ({ itemKey: text(row.itemKey), motivo: text(row.motivo), instruccion_busqueda: text(row.instruccion_busqueda) })) : [],
    diagnostico_final: Array.isArray(review.diagnostico_final) ? review.diagnostico_final.filter(isJsonRecord).map((row) => ({ itemKey: text(row.itemKey), estado: text(row.estado), nota: text(row.nota) })) : [],
    continuar: Boolean(review.continuar)
  };
}

function fallbackAuditorReview(rows: LabRow[], requestedItems: CompactItem[], reason: string): AuditorReview {
  const byKey = new Map(rows.map((row) => [row.itemKey, row]));
  const pendientes = requestedItems.filter((item) => rowScore(byKey.get(item.itemKey) ?? emptyRow(item)) < 4).map((item) => ({
    itemKey: item.itemKey,
    motivo: "La auditoria IA no respondio; la app solo usa senales minimas para no perder el ciclo.",
    instruccion_busqueda: "Buscar una fuente comercial directa con precio y URL verificable."
  }));
  return {
    resumen: { estado_general: pendientes.length ? "parcial" : "completo", comentario: `Fallback auditor: ${reason}`, items_con_fuente: requestedItems.length - pendientes.length, items_pendientes: pendientes.length },
    aceptados: requestedItems.filter((item) => !pendientes.some((pending) => pending.itemKey === item.itemKey)).map((item) => ({ itemKey: item.itemKey, motivo: "Senales minimas completas." })),
    pendientes,
    diagnostico_final: requestedItems.map((item) => ({ itemKey: item.itemKey, estado: pendientes.some((pending) => pending.itemKey === item.itemKey) ? "pendiente" : "fuente_defendible", nota: "Fallback de continuidad." })),
    continuar: pendientes.length > 0
  };
}

function emptyRow(item: CompactItem): LabRow {
  return { itemKey: item.itemKey, name: item.name, description: item.description, unit: item.unit, quantity: item.quantity, ceiling: item.ceiling, provider: "", price: "", currency: "", url: "", itemNotes: "", providerNotes: "", attempt: 0, signals: ["sin_proveedor", "sin_precio", "sin_url"], rawItem: item.original, searchEvidenceUrl: "" };
}

function normalizePendingKeys(review: AuditorReview, allItems: CompactItem[], accumulated: Map<string, LabRow>) {
  const valid = new Set(allItems.map((item) => item.itemKey));
  const explicit = (review.pendientes ?? []).map((item) => item.itemKey).filter((key) => valid.has(key));
  if (explicit.length) return [...new Set(explicit)];
  if (review.continuar === false) return [];
  return allItems.filter((item) => rowScore(accumulated.get(item.itemKey) ?? emptyRow(item)) < 4).map((item) => item.itemKey);
}

function summarizeAuditorReview(review: AuditorReview, attempt: number) {
  const resumen = review.resumen ?? {};
  const pending = (review.pendientes ?? []).slice(0, 20).map((item) => `ITEM ${item.itemKey}: ${item.motivo || "pendiente"}${item.instruccion_busqueda ? ` / ${item.instruccion_busqueda}` : ""}`).join("\n");
  return [
    `Auditor intento ${attempt}: ${resumen.estado_general || "sin_estado"}. ${resumen.comentario || ""}`.trim(),
    pending ? `Pendientes y guia:\n${pending}` : "Sin pendientes reportados por auditor."
  ].join("\n");
}

function orderRows(items: CompactItem[], accumulated: Map<string, LabRow>) {
  return items.map((item) => accumulated.get(item.itemKey) ?? emptyRow(item));
}

function buildStage3LikeResult(stage2Json: unknown, rows: LabRow[]) {
  return {
    metadata: {
      modo: "stage3_conversational_lab",
      total_items_cotizados: rows.length,
      app_experiment: "google_conversational_with_deepseek_auditor"
    },
    items: rows.map((row) => ({
      "Consecutivo interno": row.itemKey,
      "No. item": row.rawItem["No. item"] ?? row.itemKey,
      "Nombre o descripcion": row.name,
      "Detalles o ficha tecnica": row.description,
      "Und de medida": row.unit,
      "Cant": row.quantity,
      "Precio techo encontrado": row.ceiling,
      "Estado de cotizacion": {
        resultado_busqueda: row.provider || row.price || row.url ? "cotizado_1_fuente" : "sin_fuentes_confiables",
        estado_pricing: "pendiente_revision",
        calidad_datos: "pendiente_auditor",
        decision_siguiente_paso: "revisar_auditor"
      },
      "Cotizaciones encontradas": row.provider || row.price || row.url ? [{
        numero: 1,
        fuente: { nombre: row.provider || null, url: row.url || null },
        precio: { valor: null, moneda: row.currency || null, texto_original: row.price || null },
        defensa: { estado_fuente: "pendiente_auditor", tipo_referencia: "no_evaluable", justificacion: row.providerNotes || null, alertas: row.signals, usable_para_pricing: false },
        evidencia_corta: row.providerNotes || row.itemNotes || null
      }] : [],
      "URL evidencia busqueda": row.searchEvidenceUrl || null,
      "Notas del item": row.itemNotes || null,
      "Datos originales": row.rawItem
    })),
    control_calidad: { estado_app: "laboratorio_conversacional", nota_app: "Resultado acumulado por intentos; no reemplaza flujo estandar." },
    source_stage2_items: getStageItems(stage2Json).length
  };
}

function summarizeRun(rows: LabRow[], items: CompactItem[], finalAudit: AuditorReview) {
  const withSource = rows.filter((row) => row.provider || row.price || row.url).length;
  const withUrl = rows.filter((row) => row.url).length;
  const withSearchEvidence = rows.filter((row) => row.searchEvidenceUrl).length;
  const pendingByAuditor = finalAudit.pendientes?.length ?? Math.max(0, items.length - withSource);
  const auditorState = finalAudit.resumen?.estado_general ?? "sin_estado";
  const computedState = pendingByAuditor === 0 && withSource === items.length && auditorState === "completo" ? "completo" : auditorState;
  return {
    totalItems: items.length,
    rowsWithAnySource: withSource,
    rowsWithUrl: withUrl,
    rowsWithSearchEvidence: withSearchEvidence,
    pendingByAuditor,
    state: computedState,
    auditorState,
    comment: finalAudit.resumen?.comentario ?? ""
  };
}

function summarizeCosts(googleCosts: Array<AiCostSummary | undefined>, auditorCosts: Array<AiCostSummary | undefined>) {
  const google = googleCosts.filter(Boolean) as AiCostSummary[];
  const auditor = auditorCosts.filter(Boolean) as AiCostSummary[];
  return {
    totalUsd: roundUsd([...google, ...auditor].reduce((sum, cost) => sum + cost.totalUsd, 0)),
    googleUsd: roundUsd(google.reduce((sum, cost) => sum + cost.totalUsd, 0)),
    auditorUsd: roundUsd(auditor.reduce((sum, cost) => sum + cost.totalUsd, 0)),
    google,
    auditor
  };
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
