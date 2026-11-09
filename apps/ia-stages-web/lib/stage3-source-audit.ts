import { lookup } from "node:dns/promises";

type JsonRecord = Record<string, unknown>;

export type Stage3SourceRecord = {
  sourceId: string;
  itemKey: string;
  itemName: string;
  itemDescription: string;
  itemCeilingPrice: unknown;
  sourceIndex: number;
  reportedSourceName: string;
  reportedUrl: string;
  reportedProductTitle: string;
  reportedPrice: unknown;
  reportedPriceText: string;
  reportedCurrency: string;
  reportedNotes: string;
};

export type Stage3SourceDiagnostics = {
  flags: string[];
  score: number;
  level: "ok" | "watch" | "review" | "critical";
  domain?: string;
  domainResolved?: boolean;
  hostnameLooksSuspicious?: boolean;
  isSearchUrl?: boolean;
  isHomepage?: boolean;
  isGenericProviderName?: boolean;
  domainSourceNameMismatch?: boolean;
  reportedPriceNumber?: number | null;
  ceilingPriceNumber?: number | null;
  priceCeilingRatio?: number | null;
  reportedPriceNearCeiling?: boolean;
  reportedPriceFoundInPage?: boolean | null;
  detectedPricesCount?: number;
  productTokenCoverage?: number | null;
  urlHasTechnicalTokens?: boolean;
  urlTokensOverlapItem?: boolean;
  urlTokensOverlapReportedProduct?: boolean;
  urlTokensOverlapNotes?: boolean;
  urlLooksLikeProductPage?: boolean;
  urlLooksGeneratedFromDescription?: boolean;
  failedUrlWithRescueSignals?: boolean;
  missingUrlWithGroundingSignal?: boolean;
  strongUrlTokens?: string[];
  sharedUrlItemTokens?: string[];
  sharedUrlReportedProductTokens?: string[];
  sharedUrlNoteTokens?: string[];
};

export type Stage3SourceEvidence = Stage3SourceRecord & {
  status: "ok" | "missing_url" | "invalid_url" | "domain_error" | "timeout" | "fetch_error" | "http_error" | "not_html";
  httpStatus?: number;
  finalUrl?: string;
  title?: string;
  textPreview?: string;
  detectedPrices?: string[];
  rescueSearch?: Stage3SourceRescueSearchEvidence;
  diagnostics?: Stage3SourceDiagnostics;
  error?: string;
};

export type Stage3SourceRescueSearchEvidence = {
  attempted: boolean;
  reason: "failed_url_with_rescue_signals" | "missing_url_with_grounding_signal" | "not_needed" | "insufficient_clues";
  candidateKind?: "internal_search" | "external_search_result";
  query?: string;
  candidateUrl?: string;
  candidateFinalUrl?: string;
  candidateTitle?: string;
  sameProviderOrDomain?: boolean | null;
  urlOpened?: boolean | null;
  httpStatus?: number;
  priceFoundInPage?: boolean | null;
  productTokensFound?: string[];
  technicalTokenHit?: boolean | null;
  detectedPrices?: string[];
  error?: string;
  searchedAt: string;
};

export type Stage3SourceAuditSummary = {
  totalSourcesFound: number;
  inspectedSources: number;
  ok: number;
  missingUrl: number;
  invalidUrl: number;
  domainError: number;
  failed: number;
  diagnosticLevels: Record<Stage3SourceDiagnostics["level"], number>;
  diagnosticFlags: Record<string, number>;
  rescueSearch?: {
    attempted: number;
    candidateFound: number;
    sameProviderOrDomain: number;
    opened: number;
    priceFoundInPage: number;
    technicalTokenHit: number;
  };
};

const DEFAULT_MAX_SOURCES = 12;
const FETCH_TIMEOUT_MS = 8_000;
const RESCUE_SEARCH_TIMEOUT_MS = 9_000;
const MAX_HTML_CHARS = 240_000;
const MAX_TEXT_PREVIEW_CHARS = 1_800;
const MAX_RESCUE_CANDIDATES = 5;
const STOPWORDS = new Set([
  "para", "con", "como", "tipo", "medida", "unidad", "referencia", "sistema", "suministro", "instalacion",
  "incluye", "segun", "debe", "tener", "material", "producto", "productos", "elemento", "servicio", "equipo", "marca",
  "para", "con", "sin", "desde", "hasta", "activo", "activa", "precio", "colombia", "comprar", "tienda", "store",
  "product", "products", "producto", "categoria", "category", "oficial", "profesional", "generico", "compatible"
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getFirstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function getFirstExistingValue(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return null;
}

function getNestedRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function getItemKey(item: JsonRecord, fallbackIndex: number): string {
  const consecutive = getFirstText(item, ["Consecutivo interno", "consecutivo", "consecutivo_interno", "item", "Item"]);
  if (consecutive) return consecutive;
  const lote = getFirstText(item, ["Lote", "lote"]);
  const itemNo = getFirstText(item, ["No. item", "no_item", "numero_item"]);
  if (lote || itemNo) return [lote ? `lote:${lote}` : "", itemNo ? `item:${itemNo}` : ""].filter(Boolean).join("|");
  return `fila:${fallbackIndex + 1}`;
}

function getItems(stage3Result: unknown): JsonRecord[] {
  if (!isRecord(stage3Result)) return [];
  const items = stage3Result.items;
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

function sourceUrl(source: JsonRecord): string {
  const direct = getFirstText(source, ["url", "URL", "link", "enlace"]);
  if (direct) return direct;
  const fuente = getNestedRecord(source, "fuente");
  return fuente ? getFirstText(fuente, ["url", "URL", "link", "enlace"]) : "";
}

function sourceName(source: JsonRecord): string {
  const direct = getFirstText(source, ["proveedor", "Proveedor", "nombre", "name"]);
  if (direct) return direct;
  const fuente = getNestedRecord(source, "fuente");
  return fuente ? getFirstText(fuente, ["nombre", "name", "proveedor", "Proveedor"]) : "";
}

function sourceProductTitle(source: JsonRecord): string {
  const producto = getNestedRecord(source, "producto");
  const productTitle = producto ? getFirstText(producto, ["titulo", "title", "nombre", "name"]) : "";
  return productTitle || getFirstText(source, ["producto", "titulo", "title", "nombre_producto"]);
}

function sourcePrice(source: JsonRecord): unknown {
  const precio = getNestedRecord(source, "precio");
  if (precio && Object.prototype.hasOwnProperty.call(precio, "valor")) return precio.valor;
  for (const key of ["precio", "price", "unit_price", "precio_unitario", "valor"]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return null;
}

function sourcePriceText(source: JsonRecord): string {
  const precio = getNestedRecord(source, "precio");
  const fromPrice = precio ? getFirstText(precio, ["texto_original", "original", "text", "valor_texto"]) : "";
  if (fromPrice) return fromPrice;
  const direct = getFirstText(source, ["precio_texto", "price_text", "texto_precio", "precio_original"]);
  if (direct) return direct;
  const value = sourcePrice(source);
  return typeof value === "string" ? value : "";
}

function sourceCurrency(source: JsonRecord): string {
  const precio = getNestedRecord(source, "precio");
  const fromPrice = precio ? getFirstText(precio, ["moneda", "currency"]) : "";
  return fromPrice || getFirstText(source, ["moneda", "currency"]);
}

function sourceNotes(source: JsonRecord): string {
  return getFirstText(source, ["notas", "notes", "observacion", "comentario", "text_original", "evidencia_corta"]);
}

export function extractStage3SourceRecords(stage3Result: unknown, maxSources = DEFAULT_MAX_SOURCES): {
  sources: Stage3SourceRecord[];
  totalSourcesFound: number;
} {
  const limit = Math.max(1, Math.min(200, Math.trunc(maxSources || DEFAULT_MAX_SOURCES)));
  const sources: Stage3SourceRecord[] = [];
  let totalSourcesFound = 0;

  getItems(stage3Result).forEach((item, itemIndex) => {
    const quotes = item["Cotizaciones encontradas"] ?? item["cotizaciones"] ?? item["quotes"];
    const sourceList = Array.isArray(quotes) ? quotes.filter(isRecord) : [];
    totalSourcesFound += sourceList.length;

    for (let index = 0; index < sourceList.length && sources.length < limit; index += 1) {
      const source = sourceList[index];
      const itemKey = getItemKey(item, itemIndex);
      sources.push({
        sourceId: `${itemKey}#${index + 1}`,
        itemKey,
        itemName: getFirstText(item, ["Nombre o descripci?n", "Nombre o descripcion", "Nombre o descripci?n", "name", "nombre"]),
        itemDescription: getFirstText(item, ["Detalles o ficha t?cnica", "Detalles o ficha tecnica", "Detalles o ficha t?cnica", "description", "descripcion"]),
        itemCeilingPrice: getFirstExistingValue(item, ["Precio techo encontrado", "precio_techo", "ceiling_unit_price"]),
        sourceIndex: index + 1,
        reportedSourceName: sourceName(source),
        reportedUrl: sourceUrl(source),
        reportedProductTitle: sourceProductTitle(source),
        reportedPrice: sourcePrice(source),
        reportedPriceText: sourcePriceText(source),
        reportedCurrency: sourceCurrency(source),
        reportedNotes: sourceNotes(source)
      });
    }
  });

  return { sources, totalSourcesFound };
}


export async function collectStage3SourceDomainEvidence(stage3Result: unknown, options: { maxSources?: number } = {}) {
  const { sources, totalSourcesFound } = extractStage3SourceRecords(stage3Result, options.maxSources);
  const evidence = await Promise.all(sources.map(checkDomainForSource));
  const summary = summarizeDomainEvidence(evidence, totalSourcesFound);
  return { evidence, summary };
}

type Stage3SourceDomainEvidence = Stage3SourceRecord & {
  status: "domain_ok" | "missing_url" | "invalid_url" | "domain_error";
  finalUrl?: string;
  domain?: string;
  domainResolved?: boolean;
  error?: string;
  diagnostics: Pick<Stage3SourceDiagnostics, "flags" | "score" | "level" | "domain" | "domainResolved" | "hostnameLooksSuspicious" | "isSearchUrl" | "isHomepage" | "isGenericProviderName" | "domainSourceNameMismatch">;
};

async function checkDomainForSource(source: Stage3SourceRecord): Promise<Stage3SourceDomainEvidence> {
  if (!source.reportedUrl) {
    return withDomainDiagnostics({ ...source, status: "missing_url", error: "La fuente no trae URL." });
  }

  let url: URL;
  try {
    url = new URL(source.reportedUrl);
  } catch {
    return withDomainDiagnostics({ ...source, status: "invalid_url", error: "La URL no es valida." });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return withDomainDiagnostics({ ...source, status: "invalid_url", finalUrl: url.toString(), error: "La URL no usa http/https." });
  }

  try {
    await lookup(url.hostname);
    return withDomainDiagnostics({ ...source, status: "domain_ok", finalUrl: url.toString(), domain: url.hostname.toLowerCase(), domainResolved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withDomainDiagnostics({ ...source, status: "domain_error", finalUrl: url.toString(), domain: url.hostname.toLowerCase(), domainResolved: false, error: `El dominio no resuelve: ${message}` });
  }
}

function withDomainDiagnostics<T extends Omit<Stage3SourceDomainEvidence, "diagnostics">>(evidence: T): T & { diagnostics: Stage3SourceDomainEvidence["diagnostics"] } {
  const urlText = evidence.finalUrl || evidence.reportedUrl;
  const parsedUrl = safeUrl(urlText);
  const hostname = parsedUrl?.hostname.toLowerCase() || evidence.domain || "";
  const isSearchUrl = Boolean(parsedUrl && /(?:^|\.)(google|bing|yahoo)\.[a-z.]+$/i.test(hostname) && /\/search/i.test(parsedUrl.pathname));
  const urlLooksLikeProductPage = Boolean(parsedUrl && looksLikeProductPageUrl(parsedUrl));
  const isHomepage = Boolean(parsedUrl && (parsedUrl.pathname === "/" || parsedUrl.pathname === "") && !parsedUrl.search);
  const hostnameLooksSuspicious = Boolean(hostname && (/__|\.\.|\s|,/.test(hostname) || !hostname.includes(".")));
  const isGenericProviderName = isGenericSourceName(evidence.reportedSourceName);
  const domainSourceNameMismatch = Boolean(hostname && evidence.reportedSourceName && !isGenericProviderName && !sourceNameMatchesDomain(evidence.reportedSourceName, hostname));
  const flags: string[] = [];
  if (evidence.status !== "domain_ok") flags.push(`status_${evidence.status}`);
  if (hostnameLooksSuspicious) flags.push("hostname_sospechoso");
  if (isSearchUrl) flags.push("url_busqueda");
  if (isHomepage) flags.push("homepage_no_producto");
  if (/placeholder|xxxx|mco-xxxx|example\.com/i.test(evidence.reportedUrl)) flags.push("placeholder_url");
  if (isGenericProviderName) flags.push("proveedor_generico");
  if (domainSourceNameMismatch) flags.push("proveedor_no_coincide_dominio");
  const criticalSet = new Set(["status_domain_error", "status_invalid_url", "placeholder_url", "url_busqueda"]);
  const score = flags.reduce((sum, flag) => sum + (criticalSet.has(flag) ? 3 : flag.startsWith("status_") ? 2 : 1), 0);
  const level: Stage3SourceDiagnostics["level"] = score >= 5 ? "critical" : score >= 3 ? "review" : score >= 1 ? "watch" : "ok";
  return {
    ...evidence,
    diagnostics: {
      flags,
      score,
      level,
      domain: hostname || undefined,
      domainResolved: evidence.status === "domain_ok",
      hostnameLooksSuspicious,
      isSearchUrl,
      isHomepage,
      isGenericProviderName,
      domainSourceNameMismatch
    }
  };
}

function summarizeDomainEvidence(evidence: Stage3SourceDomainEvidence[], totalSourcesFound: number) {
  const diagnosticLevels: Record<Stage3SourceDiagnostics["level"], number> = { ok: 0, watch: 0, review: 0, critical: 0 };
  const diagnosticFlags: Record<string, number> = {};
  let domainOk = 0;
  let missingUrl = 0;
  let invalidUrl = 0;
  let domainError = 0;
  for (const item of evidence) {
    if (item.status === "domain_ok") domainOk += 1;
    else if (item.status === "missing_url") missingUrl += 1;
    else if (item.status === "invalid_url") invalidUrl += 1;
    else domainError += 1;
    const level = item.diagnostics.level;
    diagnosticLevels[level] += 1;
    for (const flag of item.diagnostics.flags) diagnosticFlags[flag] = (diagnosticFlags[flag] ?? 0) + 1;
  }
  return { totalSourcesFound, inspectedSources: evidence.length, domainOk, missingUrl, invalidUrl, domainError, diagnosticLevels, diagnosticFlags };
}

export async function collectStage3SourceEvidence(stage3Result: unknown, options: { maxSources?: number } = {}) {
  const { sources, totalSourcesFound } = extractStage3SourceRecords(stage3Result, options.maxSources);
  const fetched = await Promise.all(sources.map(fetchEvidenceForSource));
  const evidence = await Promise.all(fetched.map(attachRescueSearchEvidence));
  const summary = summarizeEvidence(evidence, totalSourcesFound);
  return { evidence, summary };
}

async function fetchEvidenceForSource(source: Stage3SourceRecord): Promise<Stage3SourceEvidence> {
  if (!source.reportedUrl) return withDiagnostics({ ...source, status: "missing_url", error: "La fuente no trae URL." });

  let url: URL;
  try {
    url = new URL(source.reportedUrl);
  } catch {
    return withDiagnostics({ ...source, status: "invalid_url", error: "La URL no es valida." });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return withDiagnostics({ ...source, status: "invalid_url", error: "La URL no usa http/https." });
  }

  try {
    await lookup(url.hostname);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withDiagnostics({ ...source, status: "domain_error", finalUrl: url.toString(), error: `El dominio no resuelve: ${message}` });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.6",
        "user-agent": "CAF-IA-SourceAudit/1.0"
      }
    });

    const contentType = response.headers.get("content-type") ?? "";
    const httpStatus = response.status;
    const finalUrl = response.url;

    if (!response.ok) {
      return withDiagnostics({ ...source, status: "http_error", httpStatus, finalUrl, error: response.statusText || `HTTP ${httpStatus}` });
    }

    if (!/text\/html|text\/plain|application\/xhtml\+xml|application\/xml/i.test(contentType)) {
      return withDiagnostics({ ...source, status: "not_html", httpStatus, finalUrl, error: `Contenido no textual: ${contentType || "desconocido"}` });
    }

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const title = extractTitle(html);
    const textPreview = htmlToTextPreview(html);
    const detectedPrices = detectPriceStrings(textPreview);

    return withDiagnostics({
      ...source,
      status: "ok",
      httpStatus,
      finalUrl,
      title,
      textPreview,
      detectedPrices
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /abort|timeout/i.test(message) || (error instanceof Error && error.name === "AbortError");
    return withDiagnostics({ ...source, status: isTimeout ? "timeout" : "fetch_error", error: message });
  } finally {
    clearTimeout(timeout);
  }
}

async function attachRescueSearchEvidence(evidence: Stage3SourceEvidence): Promise<Stage3SourceEvidence> {
  const rescueSearch = await runRescueSearchForSource(evidence);
  return rescueSearch.attempted ? { ...evidence, rescueSearch } : evidence;
}

async function runRescueSearchForSource(evidence: Stage3SourceEvidence): Promise<Stage3SourceRescueSearchEvidence> {
  const searchedAt = new Date().toISOString();
  const diagnostics = evidence.diagnostics;
  const shouldSearchFailedUrl = Boolean(diagnostics?.failedUrlWithRescueSignals);
  const shouldSearchMissingUrl = Boolean(diagnostics?.missingUrlWithGroundingSignal);
  if (!shouldSearchFailedUrl && !shouldSearchMissingUrl) {
    return { attempted: false, reason: "not_needed", searchedAt };
  }

  const reason = shouldSearchFailedUrl ? "failed_url_with_rescue_signals" : "missing_url_with_grounding_signal";
  const targetDomain = rescueTargetDomain(evidence);
  const queryTokens = rescueQueryTokens(evidence);
  if (!queryTokens.length && !evidence.reportedSourceName) {
    return { attempted: false, reason: "insufficient_clues", searchedAt };
  }

  const queries = buildRescueQueries({ evidence, targetDomain, queryTokens });
  let selectedQuery = queries[0] ?? "";
  try {
    const { query, candidates } = await searchRescueCandidates(queries, evidence, targetDomain);
    selectedQuery = query;
    if (!candidates.length) {
      return { attempted: true, reason, query, error: "La busqueda de rescate no devolvio candidatos utiles.", searchedAt };
    }

    let best: Stage3SourceRescueSearchEvidence | null = null;
    for (const candidateUrl of candidates.slice(0, MAX_RESCUE_CANDIDATES)) {
      const checked = await fetchRescueCandidate(candidateUrl, evidence, targetDomain, query, reason, searchedAt);
      if (!best || rescueCandidateScore(checked) > rescueCandidateScore(best)) best = checked;
      if (checked.urlOpened && checked.priceFoundInPage && checked.technicalTokenHit) break;
    }
    return best ?? { attempted: true, reason, query, error: "No se pudo leer ningun candidato de rescate.", searchedAt };
  } catch (error) {
    return { attempted: true, reason, query: selectedQuery, error: error instanceof Error ? error.message : String(error), searchedAt };
  }
}

function rescueTargetDomain(evidence: Stage3SourceEvidence): string {
  const parsed = safeUrl(evidence.reportedUrl);
  if (parsed?.hostname) return parsed.hostname.toLowerCase();
  return providerDomainHint(evidence.reportedSourceName);
}

function providerDomainHint(provider: string): string {
  const text = normalizeText(provider);
  if (/mercado\s*libre|mercadolibre/.test(text)) return "mercadolibre.com.co";
  if (/homecenter|sodimac/.test(text)) return "homecenter.com.co";
  if (/panamericana/.test(text)) return "panamericana.com.co";
  if (/falabella/.test(text)) return "falabella.com.co";
  if (/\bexito\b/.test(text)) return "exito.com";
  if (/\bsony\b/.test(text)) return "sony.com.co";
  if (/altavista/.test(text)) return "altavista.com.co";
  if (/global\s*music/.test(text)) return "globalmusic.com.co";
  if (/vision\s*broadcast/.test(text)) return "tiendavisionbroadcast.co";
  if (/voxtienda|vox\s*tienda|vox\s*musical/.test(text)) return "voxtiendamusical.com";
  return "";
}

function rescueQueryTokens(evidence: Stage3SourceEvidence): string[] {
  const diagnostics = evidence.diagnostics;
  const fromDiagnostics = [
    ...(Array.isArray(diagnostics?.strongUrlTokens) ? diagnostics.strongUrlTokens : []),
    ...(Array.isArray(diagnostics?.sharedUrlItemTokens) ? diagnostics.sharedUrlItemTokens : []),
    ...(Array.isArray(diagnostics?.sharedUrlNoteTokens) ? diagnostics.sharedUrlNoteTokens : [])
  ].map(String);
  const fallback = Array.from(tokenSet(`${evidence.reportedProductTitle} ${evidence.itemName} ${evidence.itemDescription} ${evidence.reportedNotes}`))
    .filter(isStrongUrlToken);
  return [...new Set([...fromDiagnostics, ...fallback])]
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .slice(0, 8);
}

function buildRescueQueries(input: { evidence: Stage3SourceEvidence; targetDomain: string; queryTokens: string[] }): string[] {
  const domainLabel = input.targetDomain ? input.targetDomain.replace(/^www\./, "") : "";
  const provider = input.evidence.reportedSourceName.trim();
  const tokens = input.queryTokens.slice(0, 5);
  const compact = [domainLabel, ...tokens].filter(Boolean).join(" ");
  const providerCompact = [provider, ...tokens].filter(Boolean).join(" ");
  const shortTokens = tokens.slice(0, 4).join(" ");
  const queries = [
    compact,
    providerCompact,
    [domainLabel || provider, shortTokens].filter(Boolean).join(" "),
    shortTokens
  ]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(queries)];
}

async function searchRescueCandidates(
  queries: string[],
  evidence: Stage3SourceEvidence,
  targetDomain: string
): Promise<{ query: string; candidates: string[] }> {
  const internal = buildInternalSearchCandidateUrls(queries[0] ?? "", evidence, targetDomain);
  if (internal.length) return { query: queries[0] ?? "", candidates: internal };

  let lastQuery = queries[0] ?? "";
  for (const query of queries) {
    lastQuery = query;
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchTextWithTimeout(url, RESCUE_SEARCH_TIMEOUT_MS, "text/html,*/*");
    const candidates = extractDuckDuckGoUrls(html)
      .filter((candidate) => isUsefulCandidateUrl(candidate, evidence, targetDomain));
    const unique = [...new Set(candidates)];
    if (unique.length) return { query, candidates: unique.slice(0, MAX_RESCUE_CANDIDATES) };
  }
  return { query: lastQuery, candidates: [] };
}

function buildInternalSearchCandidateUrls(query: string, evidence: Stage3SourceEvidence, targetDomain: string): string[] {
  const domains = [
    targetDomain,
    providerDomainHint(evidence.reportedSourceName)
  ].filter(Boolean);
  const uniqueDomains = [...new Set(domains.map((domain) => domain.replace(/^www\./, "")))];
  let q = query
    .replace(/^site:\S+\s+/i, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const domain of uniqueDomains) {
    const label = baseDomainLabel(domain);
    q = q
      .replace(new RegExp(escapeRegExp(domain), "gi"), " ")
      .replace(new RegExp(`\\b${escapeRegExp(label)}\\b`, "gi"), " ");
  }
  q = q.replace(/\s+/g, " ").trim();
  if (!uniqueDomains.length || !q) return [];
  const encodedPlus = encodeURIComponent(q).replace(/%20/g, "+");
  const encoded = encodeURIComponent(q);
  return uniqueDomains.flatMap((domain) => [
    `https://${domain}/?s=${encodedPlus}&post_type=product`,
    `https://${domain}/?s=${encodedPlus}`,
    `https://${domain}/search?q=${encoded}`,
    `https://${domain}/search?type=product&q=${encoded}`
  ]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDuckDuckGoUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/uddg=([^&"']+)/gi)) {
    const decoded = decodeURIComponentSafe(match[1]);
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) urls.push(decoded);
  }
  for (const match of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    urls.push(decodeHtml(match[1]));
  }
  return urls;
}

function isUsefulCandidateUrl(candidate: string, evidence: Stage3SourceEvidence, targetDomain: string): boolean {
  const parsed = safeUrl(candidate);
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (/(^|\.)duckduckgo\.com$|(^|\.)google\.|(^|\.)bing\.|facebook|instagram|linkedin|youtube|pinterest|tiktok|x\.com|twitter/i.test(hostname)) return false;
  if (targetDomain && sameBaseDomain(hostname, targetDomain)) return true;
  if (sourceNameMatchesDomain(evidence.reportedSourceName, hostname)) return true;
  return false;
}

async function fetchRescueCandidate(
  candidateUrl: string,
  evidence: Stage3SourceEvidence,
  targetDomain: string,
  query: string,
  reason: Stage3SourceRescueSearchEvidence["reason"],
  searchedAt: string
): Promise<Stage3SourceRescueSearchEvidence> {
  const sameProviderOrDomain = isSameProviderOrDomain(candidateUrl, evidence, targetDomain);
  try {
    const response = await fetchWithTimeout(candidateUrl, RESCUE_SEARCH_TIMEOUT_MS, "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.6");
    const httpStatus = response.status;
    const contentType = response.headers.get("content-type") ?? "";
    const candidateFinalUrl = response.url;
    if (!response.ok) {
      return { attempted: true, reason, candidateKind: candidateUrl.includes("/search") || candidateUrl.includes("?s=") ? "internal_search" : "external_search_result", query, candidateUrl, candidateFinalUrl, sameProviderOrDomain, urlOpened: false, httpStatus, error: response.statusText || `HTTP ${httpStatus}`, searchedAt };
    }
    if (!/text\/html|text\/plain|application\/xhtml\+xml|application\/xml/i.test(contentType)) {
      return { attempted: true, reason, candidateKind: candidateUrl.includes("/search") || candidateUrl.includes("?s=") ? "internal_search" : "external_search_result", query, candidateUrl, candidateFinalUrl, sameProviderOrDomain, urlOpened: false, httpStatus, error: `Contenido no textual: ${contentType || "desconocido"}`, searchedAt };
    }

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const pageText = htmlToPlainText(html).slice(0, MAX_HTML_CHARS);
    const textPreview = pageText.slice(0, MAX_TEXT_PREVIEW_CHARS);
    const candidateTitle = extractTitle(html);
    const detectedPrices = detectPriceStrings(pageText);
    const reportedPrice = evidence.diagnostics?.reportedPriceNumber ?? parseFlexibleNumber(evidence.reportedPriceText || evidence.reportedPrice);
    const priceFoundInPage = reportedPrice ? priceAppearsInText(reportedPrice, pageText) : null;
    const productTokensFound = findProductTokensInText(evidence, `${candidateTitle} ${pageText}`);
    const technicalTokenHit = productTokensFound.length > 0;
    return {
      attempted: true,
      reason,
      candidateKind: candidateUrl.includes("/search") || candidateUrl.includes("?s=") ? "internal_search" : "external_search_result",
      query,
      candidateUrl,
      candidateFinalUrl,
      candidateTitle,
      sameProviderOrDomain,
      urlOpened: true,
      httpStatus,
      priceFoundInPage,
      productTokensFound,
      technicalTokenHit,
      detectedPrices,
      searchedAt
    };
  } catch (error) {
    return { attempted: true, reason, candidateKind: candidateUrl.includes("/search") || candidateUrl.includes("?s=") ? "internal_search" : "external_search_result", query, candidateUrl, sameProviderOrDomain, urlOpened: false, error: error instanceof Error ? error.message : String(error), searchedAt };
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, accept: string): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs, accept);
  return response.text();
}

async function fetchWithTimeout(url: string, timeoutMs: number, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept,
        "accept-language": "es-CO,es;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 (compatible; CAF-IA-SourceAudit/1.0; +https://caftecnologia.com)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isSameProviderOrDomain(candidateUrl: string, evidence: Stage3SourceEvidence, targetDomain: string): boolean {
  const parsed = safeUrl(candidateUrl);
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase();
  return Boolean(
    (targetDomain && sameBaseDomain(hostname, targetDomain)) ||
    sourceNameMatchesDomain(evidence.reportedSourceName, hostname)
  );
}

function sameBaseDomain(left: string, right: string): boolean {
  return baseDomainLabel(left) === baseDomainLabel(right);
}

function baseDomainLabel(hostname: string): string {
  const clean = hostname.toLowerCase().replace(/^www\./, "");
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] || clean;
  const secondLevelTlds = new Set(["com", "net", "org", "gov", "edu"]);
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (tld.length === 2 && secondLevelTlds.has(sld) && parts.length >= 3) return parts[parts.length - 3];
  return sld;
}

function findProductTokensInText(evidence: Stage3SourceEvidence, text: string): string[] {
  const normalized = ` ${normalizeText(text)} `;
  const tokens = rescueQueryTokens(evidence).filter((token) => token.length >= 3 || /[a-z]\d|\d[a-z]/.test(token));
  return [...new Set(tokens.filter((token) => normalized.includes(` ${normalizeText(token)} `)))].slice(0, 12);
}

function rescueCandidateScore(value: Stage3SourceRescueSearchEvidence): number {
  return [
    value.sameProviderOrDomain ? 4 : 0,
    value.urlOpened ? 4 : 0,
    value.priceFoundInPage ? 5 : 0,
    value.technicalTokenHit ? 3 : 0,
    Math.min(value.productTokensFound?.length ?? 0, 4)
  ].reduce((sum, part) => sum + part, 0);
}

function withDiagnostics<T extends Stage3SourceEvidence>(evidence: T): T {
  return { ...evidence, diagnostics: buildSourceDiagnostics(evidence) };
}

function buildSourceDiagnostics(evidence: Stage3SourceEvidence): Stage3SourceDiagnostics {
  const flags: string[] = [];
  const urlText = evidence.finalUrl || evidence.reportedUrl;
  const parsedUrl = safeUrl(urlText);
  const hostname = parsedUrl?.hostname.toLowerCase() || "";
  const isSearchUrl = Boolean(parsedUrl && /(?:^|\.)(google|bing|yahoo)\.[a-z.]+$/i.test(hostname) && /\/search/i.test(parsedUrl.pathname));
  const urlLooksLikeProductPage = Boolean(parsedUrl && looksLikeProductPageUrl(parsedUrl));
  const isHomepage = Boolean(parsedUrl && (parsedUrl.pathname === "/" || parsedUrl.pathname === "") && !parsedUrl.search);
  const hostnameLooksSuspicious = Boolean(hostname && (/__|\.\.|\s|,/.test(hostname) || !hostname.includes(".")));
  const isGenericProviderName = isGenericSourceName(evidence.reportedSourceName);
  const domainSourceNameMismatch = Boolean(hostname && evidence.reportedSourceName && !isGenericProviderName && !sourceNameMatchesDomain(evidence.reportedSourceName, hostname));
  const reportedPriceNumber = parseFlexibleNumber(evidence.reportedPriceText || evidence.reportedPrice);
  const ceilingPriceNumber = parseFlexibleNumber(evidence.itemCeilingPrice);
  const priceCeilingRatio = reportedPriceNumber && ceilingPriceNumber ? reportedPriceNumber / ceilingPriceNumber : null;
  const reportedPriceNearCeiling = Boolean(priceCeilingRatio && priceCeilingRatio >= 0.97 && priceCeilingRatio <= 1.03);
  const text = [evidence.title, evidence.textPreview].filter(Boolean).join(" ");
  const reportedPriceFoundInPage = reportedPriceNumber ? priceAppearsInText(reportedPriceNumber, text) : null;
  const productTokenCoverage = text ? estimateProductTokenCoverage(`${evidence.itemName} ${evidence.itemDescription} ${evidence.reportedProductTitle}`, text) : null;
  const detectedPricesCount = evidence.detectedPrices?.length ?? 0;
  const urlTokenSignals = buildUrlTokenSignals(evidence);

  if (evidence.status !== "ok") flags.push(`status_${evidence.status}`);
  if (hostnameLooksSuspicious) flags.push("hostname_sospechoso");
  if (isSearchUrl) flags.push("url_busqueda");
  if (isHomepage) flags.push("homepage_no_producto");
  if (/placeholder|xxxx|mco-xxxx|example\.com/i.test(evidence.reportedUrl)) flags.push("placeholder_url");
  if (isGenericProviderName) flags.push("proveedor_generico");
  if (domainSourceNameMismatch) flags.push("proveedor_no_coincide_dominio");
  if (reportedPriceNearCeiling) flags.push("precio_casi_igual_techo");
  if (reportedPriceFoundInPage === false) flags.push("precio_reportado_no_visible");
  if (evidence.status === "ok" && detectedPricesCount === 0) flags.push("sin_precio_detectado_en_pagina");
  if (productTokenCoverage !== null && productTokenCoverage < 0.18) flags.push("baja_coincidencia_texto_producto");
  if (/captcha|access denied|forbidden|cloudflare|robot|verifica que eres humano/i.test(text)) flags.push("pagina_bloqueo_captcha");
  if (urlTokenSignals.urlHasTechnicalTokens) flags.push("url_con_tokens_tecnicos");
  if (urlTokenSignals.urlTokensOverlapItem) flags.push("url_comparte_tokens_item");
  if (urlTokenSignals.urlTokensOverlapReportedProduct) flags.push("url_comparte_tokens_producto_reportado");
  if (urlTokenSignals.urlTokensOverlapNotes) flags.push("url_comparte_tokens_notas");
  if (urlLooksLikeProductPage) flags.push("url_parece_ficha_producto");
  if (urlTokenSignals.urlLooksGeneratedFromDescription) flags.push("url_parece_generada_desde_descripcion");
  if (urlTokenSignals.failedUrlWithRescueSignals) flags.push("url_fallida_con_pistas_rescate");
  if (urlTokenSignals.missingUrlWithGroundingSignal) flags.push("sin_url_con_senal_grounding");

  const criticalSet = new Set(["status_domain_error", "status_invalid_url", "placeholder_url", "url_busqueda"]);
  const score = flags.reduce((sum, flag) => sum + (criticalSet.has(flag) ? 3 : flag.startsWith("status_") ? 2 : 1), 0);
  const level: Stage3SourceDiagnostics["level"] = score >= 5 ? "critical" : score >= 3 ? "review" : score >= 1 ? "watch" : "ok";

  return {
    flags,
    score,
    level,
    domain: hostname || undefined,
    domainResolved: evidence.status !== "domain_error" && Boolean(hostname),
    hostnameLooksSuspicious,
    isSearchUrl,
    isHomepage,
    urlLooksLikeProductPage,
    isGenericProviderName,
    domainSourceNameMismatch,
    reportedPriceNumber,
    ceilingPriceNumber,
    priceCeilingRatio,
    reportedPriceNearCeiling,
    reportedPriceFoundInPage,
    detectedPricesCount,
    productTokenCoverage,
    ...urlTokenSignals
  };
}

function buildUrlTokenSignals(evidence: Stage3SourceEvidence) {
  const urlText = evidence.finalUrl || evidence.reportedUrl;
  const urlTokens = extractUrlPathTokens(urlText);
  const strongUrlTokens = urlTokens.filter(isStrongUrlToken).slice(0, 16);
  const itemTokens = tokenSet(`${evidence.itemName} ${evidence.itemDescription}`);
  const reportedProductTokens = tokenSet(evidence.reportedProductTitle);
  const noteTokens = tokenSet(evidence.reportedNotes);
  const sharedUrlItemTokens = strongUrlTokens.filter((token) => itemTokens.has(token)).slice(0, 12);
  const sharedUrlReportedProductTokens = strongUrlTokens.filter((token) => reportedProductTokens.has(token)).slice(0, 12);
  const sharedUrlNoteTokens = strongUrlTokens.filter((token) => noteTokens.has(token)).slice(0, 12);
  const hasPriceOrProvider = Boolean(evidence.reportedSourceName || evidence.reportedPriceText || typeof evidence.reportedPrice === "number");
  const urlFailed = evidence.status !== "ok" && evidence.status !== "missing_url";
  const urlLooksGeneratedFromDescription = urlTokens.length >= 9 && sharedUrlItemTokens.length >= 3;
  const failedUrlWithRescueSignals = Boolean(
    urlFailed &&
    hasPriceOrProvider &&
    strongUrlTokens.length > 0 &&
    (sharedUrlItemTokens.length > 0 || sharedUrlReportedProductTokens.length > 0 || sharedUrlNoteTokens.length > 0)
  );
  const missingUrlWithGroundingSignal = Boolean(
    evidence.status === "missing_url" &&
    hasPriceOrProvider &&
    /grounding|busqueda|búsqueda|candidato observado|requiere verificacion|requiere verificación/i.test(evidence.reportedNotes)
  );

  return {
    urlHasTechnicalTokens: strongUrlTokens.length > 0,
    urlTokensOverlapItem: sharedUrlItemTokens.length > 0,
    urlTokensOverlapReportedProduct: sharedUrlReportedProductTokens.length > 0,
    urlTokensOverlapNotes: sharedUrlNoteTokens.length > 0,
    urlLooksGeneratedFromDescription,
    failedUrlWithRescueSignals,
    missingUrlWithGroundingSignal,
    strongUrlTokens,
    sharedUrlItemTokens,
    sharedUrlReportedProductTokens,
    sharedUrlNoteTokens
  };
}

function looksLikeProductPageUrl(value: URL): boolean {
  const path = normalizeText(decodeURIComponentSafe(value.pathname));
  if (!path || path === "/") return false;
  if (/(^|\s)(search|buscar|busqueda|listado|category|categoria|cat|collections?|collection|k)(\s|$)/.test(path)) return false;
  return /(^|\s)(product|products|producto|shop|tienda)(\s|$)/.test(path)
    || /\b(p|sku|mco|ref|referencia)[-_]?\d{3,}\b/.test(path)
    || /\d{3,}.*[a-z]{3,}|[a-z]{3,}.*\d{3,}/.test(path);
}

function extractUrlPathTokens(value: string): string[] {
  const parsed = safeUrl(value);
  if (!parsed) return [];
  return [...new Set(normalizeText(decodeURIComponentSafe(`${parsed.pathname} ${parsed.search}`)).split(/\s+/).filter(Boolean))].slice(0, 40);
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 2 && !STOPWORDS.has(token)));
}

function isStrongUrlToken(token: string): boolean {
  if (!token || STOPWORDS.has(token)) return false;
  if (/[a-z]/.test(token) && /\d/.test(token)) return token.length >= 2;
  if (/^\d+$/.test(token)) return token.length >= 3 && token.length <= 8;
  return token.length >= 4;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

function htmlToTextPreview(html: string): string {
  return htmlToPlainText(html).slice(0, MAX_TEXT_PREVIEW_CHARS);
}

function htmlToPlainText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function detectPriceStrings(text: string): string[] {
  const matches = text.match(/(?:\$|COP|USD)\s*[0-9][0-9.,\s]{2,}(?:\s*(?:COP|USD))?/gi) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\s+/g, " ").trim()))].slice(0, 8);
}

function summarizeEvidence(evidence: Stage3SourceEvidence[], totalSourcesFound: number): Stage3SourceAuditSummary {
  let ok = 0;
  let missingUrl = 0;
  let invalidUrl = 0;
  let domainError = 0;
  let failed = 0;
  const diagnosticLevels: Stage3SourceAuditSummary["diagnosticLevels"] = { ok: 0, watch: 0, review: 0, critical: 0 };
  const diagnosticFlags: Record<string, number> = {};
  const rescueSearch = { attempted: 0, candidateFound: 0, sameProviderOrDomain: 0, opened: 0, priceFoundInPage: 0, technicalTokenHit: 0 };

  for (const item of evidence) {
    if (item.status === "ok") ok += 1;
    else if (item.status === "missing_url") missingUrl += 1;
    else if (item.status === "invalid_url") invalidUrl += 1;
    else if (item.status === "domain_error") domainError += 1;
    else failed += 1;

    const level = item.diagnostics?.level ?? "ok";
    diagnosticLevels[level] += 1;
    for (const flag of item.diagnostics?.flags ?? []) {
      diagnosticFlags[flag] = (diagnosticFlags[flag] ?? 0) + 1;
    }

    if (item.rescueSearch?.attempted) {
      rescueSearch.attempted += 1;
      if (item.rescueSearch.candidateUrl) rescueSearch.candidateFound += 1;
      if (item.rescueSearch.sameProviderOrDomain) rescueSearch.sameProviderOrDomain += 1;
      if (item.rescueSearch.urlOpened) rescueSearch.opened += 1;
      if (item.rescueSearch.priceFoundInPage) rescueSearch.priceFoundInPage += 1;
      if (item.rescueSearch.technicalTokenHit) rescueSearch.technicalTokenHit += 1;
    }
  }

  return {
    totalSourcesFound,
    inspectedSources: evidence.length,
    ok,
    missingUrl,
    invalidUrl,
    domainError,
    failed,
    diagnosticLevels,
    diagnosticFlags,
    rescueSearch
  };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isGenericSourceName(value: string): boolean {
  const text = normalizeText(value);
  return !text || /^(proveedor|tienda|distribuidor|suministros|ferreteria|marketplace|proveedor industrial|proveedor colombia|comercializadora)$/i.test(text) || /generico|generic|colombia industrial|industrial colombia/.test(text);
}

function sourceNameMatchesDomain(name: string, hostname: string): boolean {
  const source = normalizeText(name).split(/\s+/).filter((token) => token.length >= 4);
  const domain = normalizeText(hostname.replace(/^www\./, "").split(".")[0]);
  return source.some((token) => domain.includes(token) || token.includes(domain));
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseFlexibleNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asText(value).replace(/[^0-9.,-]/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;
  if (lastComma > lastDot) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma) {
    const decimals = text.length - lastDot - 1;
    normalized = decimals === 3 && text.indexOf(",") === -1 ? text.replace(/\./g, "") : text.replace(/,/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceAppearsInText(price: number, text: string): boolean {
  if (!text) return false;
  const rounded = Math.round(price);
  const variants = new Set([String(rounded), rounded.toLocaleString("es-CO"), rounded.toLocaleString("en-US")]);
  const compactText = text.replace(/\s+/g, " ");
  return [...variants].some((variant) => compactText.includes(variant));
}

function estimateProductTokenCoverage(productText: string, pageText: string): number | null {
  const page = normalizeText(pageText);
  const tokens = [...new Set(normalizeText(productText).split(/\s+/).filter((token) => token.length >= 5 && !STOPWORDS.has(token)))].slice(0, 16);
  if (!tokens.length) return null;
  const hits = tokens.filter((token) => page.includes(token)).length;
  return hits / tokens.length;
}
