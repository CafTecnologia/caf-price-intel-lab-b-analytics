import { readFile } from "node:fs/promises";
import path from "node:path";
import { getExternalProviderRuntimeConfig } from "@/lib/provider-services";
import { compactItemForPricing, getStageItems, isJsonRecord, itemKeyFromRecord, type JsonRecord } from "@/lib/stage-field-access";
import { extractOpenAiUsageMetadata, estimateAiCost, type AiCostSummary, type AiUsageSummary } from "@/lib/usage-cost";

const AGENT_REL = path.join("agents", "stage3-openai-buyer.agent.md");
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const HEADER = ["ITEM", "ESTADO", "PROVEEDOR", "PRODUCTO", "PRECIO", "MONEDA", "ENLACE", "SOPORTE", "OBSERVACION"];

type StageResult = {
  metadata?: Record<string, unknown>;
  items?: Record<string, unknown>[];
  control_calidad?: Record<string, unknown>;
};

type TsvRow = Record<(typeof HEADER)[number], string>;

export async function runOpenAiStage3Lab(input: {
  stage2Json: unknown;
  model?: string;
  reasoningEffort?: string;
  searchContextSize?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  runId?: string;
  promptOverride?: string;
}) {
  const cfg = await getExternalProviderRuntimeConfig("openai");
  if (!cfg?.apiKey) {
    throw new Error("Falta OPENAI_API_KEY en configuraci?n.");
  }

  const model = normalizeOpenAiModel(input.model || cfg.model || "gpt-5.5");
  const reasoningEffort = normalizeReasoningEffort(model, input.reasoningEffort || cfg.reasoningEffort || "medium");
  const stage2Block = normalizeStage2Block(input.stage2Json);
  const prompt = input.promptOverride?.trim() || await buildOpenAiStage3Prompt(stage2Block);
  const ai = await callOpenAiTsv({
    apiKey: cfg.apiKey,
    model,
    reasoningEffort,
    prompt,
    searchContextSize: input.searchContextSize || (model.includes("mini") || model.includes("nano") ? "low" : "medium"),
    maxOutputTokens: input.maxOutputTokens || (model.includes("mini") || model.includes("nano") ? 9000 : 14000)
  });
  const rows = parseOpenAiRows(ai.text);
  const result = stage3FromTsvRows(rows, stage2Block, { model, reasoningEffort });
  const usage = extractOpenAiUsageMetadata(ai.raw?.usage) ?? inferUsageFromRaw(ai.raw);
  const searchQueries = countOpenAiSearchCalls(ai.raw);
  const cost = estimateAiCost({ provider: "openai", model, usage, search: { searchQueries, groundedPrompt: searchQueries > 0 } });

  return {
    runId: input.runId || crypto.randomUUID(),
    provider: "openai" as const,
    model,
    result,
    raw: ai.text,
    groundingMetadata: extractOpenAiGrounding(ai.raw),
    usage,
    cost,
    details: {
      experimentalOpenAiStage3: true,
      reasoningEffort,
      promptText: prompt,
      promptLength: prompt.length,
      searchContextSize: input.searchContextSize || null,
      rowCount: rows.length,
      searchQueries,
      parsedRows: rows.slice(0, 200)
    }
  };
}

async function buildOpenAiStage3Prompt(stage2Block: StageResult) {
  let agentMd: string;
  try {
    agentMd = await readFile(path.join(process.cwd(), AGENT_REL), "utf8");
  } catch {
    agentMd = "Actua como comprador profesional. Devuelve TSV con fuentes reales, sin inventar links ni precios.";
  }

  const compactItems = (stage2Block.items ?? []).map((item, index) => compactItemForPricing(item, index));

  return `${agentMd}\n\nItems a cotizar:\n${compactItems
    .map((item) => `ITEM ${item.itemKey}\nNombre: ${item.name || "SIN NOMBRE"}\nDescripcion: ${item.description || "SIN DESCRIPCION"}\nUnidad: ${item.unit}\nCantidad: ${item.quantity}\nPrecio techo: ${item.ceiling}\nTipo/nota tecnica: ${[item.type, item.technicalUnit, item.technicalNote].filter(Boolean).join(" | ") || "SIN NOTA"}`)
    .join("\n\n")}`;
}

async function callOpenAiTsv(input: {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  prompt: string;
  searchContextSize: "low" | "medium" | "high";
  maxOutputTokens: number;
}) {
  const body: Record<string, unknown> = {
    model: input.model,
    input: input.prompt,
    tools: [
      {
        type: "web_search",
        search_context_size: input.searchContextSize,
        user_location: { type: "approximate", country: "CO", region: "Bogota", city: "Bogota" }
      }
    ],
    max_output_tokens: input.maxOutputTokens
  };
  if (/^gpt-5/i.test(input.model)) {
    body.reasoning = { effort: input.reasoningEffort };
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (response.ok) {
      const raw = JSON.parse(text) as JsonRecord;
      const outputText = extractOpenAiText(raw);
      if (!outputText) throw new Error(`OpenAI no devolvio texto util: ${text.slice(0, 1200)}`);
      return { text: outputText, raw };
    }
    lastError = new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 1600)}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) throw lastError;
    await sleep(attempt * 9000);
  }
  throw lastError || new Error("OpenAI fallo sin detalle.");
}

function normalizeStage2Block(stage2Json: unknown): StageResult {
  if (!isJsonRecord(stage2Json)) return { metadata: {}, items: [] };
  const items = getStageItems(stage2Json);
  return { metadata: isJsonRecord(stage2Json.metadata) ? stage2Json.metadata : {}, items };
}

export function parseOpenAiRows(text: string): TsvRow[] {
  const markdownRows = parseFinancialMarkdownRows(text);
  if (markdownRows.length) return markdownRows;
  const financialDelimitedRows = parseFinancialDelimitedRows(text);
  return financialDelimitedRows.length ? financialDelimitedRows : parseTsv(text);
}

function parseFinancialMarkdownRows(text: string): TsvRow[] {
  const clean = text.trim();
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes("|"));
  const headerIndex = lines.findIndex((line) => {
    const headers = splitMarkdownLine(line).map(normalizeMarkdownHeader);
    return headers.includes("item") && headers.includes("proveedor 1") && headers.includes("url proveedor 1");
  });
  if (headerIndex < 0) return [];
  const headers = splitMarkdownLine(lines[headerIndex]).map(normalizeMarkdownHeader);
  const rows: TsvRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (isMarkdownSeparator(line)) continue;
    const cells = splitMarkdownLine(line);
    if (cells.length < Math.min(6, headers.length)) continue;
    const values = new Map<string, string>();
    headers.forEach((header, index) => values.set(header, cleanMarkdownCell(cells[index] ?? "")));
    const item = normalizeItemId(values.get("item") ?? "");
    if (!item) continue;
    const proveedor = values.get("proveedor 1") ?? "";
    const precio = values.get("precio proveedor 1") ?? "";
    const moneda = values.get("moneda proveedor 1") ?? "";
    const enlace = cleanUrlCell(values.get("url proveedor 1") ?? "");
    const notasProveedor = values.get("notas proveedor 1") ?? "";
    const notasItem = values.get("notas del item") ?? "";
    const hasCommercialSource = Boolean((proveedor || precio || moneda || notasProveedor) && (precio || enlace));
    rows.push({
      ITEM: item,
      ESTADO: hasCommercialSource ? "FUENTE CON PRECIO VERIFICABLE" : "SIN FUENTE USABLE",
      PROVEEDOR: proveedor,
      PRODUCTO: values.get("nombre") ?? "",
      PRECIO: precio,
      MONEDA: moneda,
      ENLACE: enlace,
      SOPORTE: notasItem,
      OBSERVACION: notasProveedor
    });
  }
  return rows;
}

function parseFinancialDelimitedRows(text: string): TsvRow[] {
  const clean = text.replace(/```(?:tsv|text|markdown|md)?/gi, "").replace(/```/g, "").trim();
  const rawLines = clean.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const headerIndex = rawLines.findIndex((line) => {
    const headers = splitDelimitedFinancialLine(line).map(normalizeMarkdownHeader);
    return headers.includes("item") && headers.includes("proveedor 1") && headers.includes("url proveedor 1");
  });
  if (headerIndex < 0) return [];

  const headers = splitDelimitedFinancialLine(rawLines[headerIndex]).map(normalizeMarkdownHeader);
  const rows: TsvRow[] = [];
  for (const line of rawLines.slice(headerIndex + 1)) {
    if (/^[-|\s:]+$/.test(line)) continue;
    const cells = splitDelimitedFinancialLine(line);
    if (cells.length < Math.min(6, headers.length)) continue;
    const values = new Map<string, string>();
    headers.forEach((header, index) => values.set(header, cleanMarkdownCell(cells[index] ?? "")));
    const item = normalizeItemId(values.get("item") ?? "");
    if (!item) continue;
    const proveedor = values.get("proveedor 1") ?? "";
    const precio = values.get("precio proveedor 1") ?? "";
    const moneda = values.get("moneda proveedor 1") ?? "";
    const enlace = cleanUrlCell(values.get("url proveedor 1") ?? "");
    const notasProveedor = values.get("notas proveedor 1") ?? "";
    const notasItem = values.get("notas del item") ?? "";
    const hasCommercialSource = Boolean((proveedor || precio || moneda || notasProveedor) && (precio || enlace));
    rows.push({
      ITEM: item,
      ESTADO: hasCommercialSource ? "FUENTE CON PRECIO VERIFICABLE" : "SIN FUENTE USABLE",
      PROVEEDOR: proveedor,
      PRODUCTO: values.get("nombre") ?? "",
      PRECIO: precio,
      MONEDA: moneda,
      ENLACE: enlace,
      SOPORTE: notasItem,
      OBSERVACION: notasProveedor
    });
  }
  return rows;
}

function parseTsv(text: string): TsvRow[] {
  const clean = text.replace(/```(?:tsv|text)?/gi, "").replace(/```/g, "").trim();
  const rawLines = clean.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const headerIndex = rawLines.findIndex((line) => normalizeHeaderLine(line).startsWith(HEADER.slice(0, 4).join("\t")) || normalizePipeHeader(line).startsWith(HEADER.slice(0, 4).join("\t")));
  const lines = headerIndex >= 0 ? rawLines.slice(headerIndex + 1) : rawLines;
  const rows: TsvRow[] = [];
  for (const line of lines) {
    if (/^[-|\s:]+$/.test(line)) continue;
    const cols = splitRow(line);
    if (cols.length < 2) continue;
    const row = Object.fromEntries(HEADER.map((key, index) => [key, (cols[index] ?? "").trim()])) as TsvRow;
    if (!row.ITEM || /^item$/i.test(row.ITEM)) continue;
    rows.push(row);
  }
  return rows;
}

export function stage3FromTsvRows(rows: TsvRow[], stage2Block: StageResult, meta: { model: string; reasoningEffort: string }): StageResult {
  const byItem = new Map<string, TsvRow[]>();
  for (const row of rows) {
    const key = normalizeItemId(row.ITEM);
    if (!key) continue;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key)?.push(row);
  }

  const items = (stage2Block.items ?? []).map((item, index) => {
    const key = itemKeyFromRecord(item, index);
    const rowList = byItem.get(key) || [];
    const candidateRows = rowList.filter((row) => !/sin\s+fuente/i.test(row.ESTADO || "") && (row.ENLACE || row.PROVEEDOR || row.PRODUCTO));
    const verifiedRows = candidateRows.filter(isVerifiedOpenAiSourceRow);
    const hasCandidates = candidateRows.length > 0;
    return {
      ...item,
      "Estado de cotizacion": {
        resultado_busqueda: verifiedRows.length
          ? `cotizado_${Math.min(verifiedRows.length, 3)}_fuente_verificable`
          : hasCandidates
            ? `candidatas_${Math.min(candidateRows.length, 3)}_pendiente_auditoria`
            : "sin_fuentes_confiables",
        estado_pricing: verifiedRows.length ? "pendiente_revision" : "no_usable",
        calidad_datos: verifiedRows.length ? "pendiente_supervision" : hasCandidates ? "sin_fuente_verificable" : "sin_datos",
        decision_siguiente_paso: verifiedRows.length ? "revisar_fuentes" : hasCandidates ? "auditar_o_reintentar" : "buscar_manualmente"
      },
      "Cotizaciones encontradas": candidateRows.map((row, sourceIndex) => ({
        numero: sourceIndex + 1,
        fuente: { nombre: row.PROVEEDOR || null, url: cleanUrlCell(row.ENLACE) || null, tipo_fuente: null, origen_geografico: null, es_internacional: false },
        producto: { titulo: row.PRODUCTO || null, marca: null, referencia: null, unidad_cotizada: null },
        precio: { valor: parsePrice(row.PRECIO), moneda: row.MONEDA || null, texto_original: row.PRECIO || null, incluye_iva: null },
        defensa: {
          estado_fuente: row.ESTADO || "pendiente_revision",
          coincidencia_tecnica: null,
          coincidencia_unidad: null,
          evidencia_precio: row.SOPORTE || null,
          trazabilidad_fuente: cleanUrlCell(row.ENLACE) || row.ENLACE || null,
          justificacion: row.OBSERVACION || null,
          alertas: buildOpenAiSourceAlerts(row),
          usable_para_pricing: isVerifiedOpenAiSourceRow(row)
        },
        evidencia_corta: row.SOPORTE || null,
        observacion_tsv: row.OBSERVACION || null
      })),
      "Auditoria de busqueda": {
        estrategias_intentadas: ["openai_tsv_experimental"],
        fuentes_descartadas: rowList.filter((row) => /sin\s+fuente/i.test(row.ESTADO || "")).map((row) => ({ fuente_o_url: null, motivo: row.OBSERVACION || row.SOPORTE || "SIN FUENTE USABLE" })),
        motivo_menos_de_3: verifiedRows.length < 3 ? (rowList.find((row) => /sin\s+fuente/i.test(row.ESTADO || ""))?.OBSERVACION || null) : null,
        requiere_revision_humana: true
      }
    };
  });

  return {
    metadata: {
      ...(stage2Block.metadata ?? {}),
      modo: "openai_tsv_experimental",
      proveedor: "openai",
      modelo: meta.model,
      reasoning_effort: meta.reasoningEffort,
      total_items_cotizados: items.length,
      formato_intermedio: "markdown_or_tsv"
    },
    items,
    control_calidad: {
      calidad_datos: "pendiente_supervision",
      nota: "Resultado experimental OpenAI TSV. Revisar dominios, links y supervisor antes de enviar a finanzas."
    }
  };
}


function isVerifiedOpenAiSourceRow(row: TsvRow) {
  return /fuente\s+con\s+precio\s+verificable/i.test(row.ESTADO || "") && Boolean(cleanUrlCell(row.ENLACE)) && Boolean(parsePrice(row.PRECIO));
}

function buildOpenAiSourceAlerts(row: TsvRow) {
  const alerts: string[] = [];
  const status = row.ESTADO || "";
  if (/candidata\s+parcial/i.test(status)) alerts.push("candidata_parcial");
  if (/sin\s+precio\s+visible/i.test(status)) alerts.push("sin_precio_visible");
  if (/no\s+cumple\s+ficha/i.test(status)) alerts.push("no_cumple_ficha");
  if (/link\s+no\s+verificable/i.test(status)) alerts.push("link_no_verificable");
  if (!parsePrice(row.PRECIO)) alerts.push("precio_no_parseable_o_ausente");
  if (!cleanUrlCell(row.ENLACE)) alerts.push("url_ausente_o_no_parseable");
  return alerts;
}

function extractOpenAiText(raw: JsonRecord) {
  if (typeof raw.output_text === "string") return raw.output_text.trim();
  const chunks: string[] = [];
  const output = Array.isArray(raw.output) ? raw.output : [];
  for (const item of output) {
    if (!isJsonRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isJsonRecord(content) && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractOpenAiGrounding(raw: JsonRecord) {
  const output = Array.isArray(raw.output) ? raw.output : [];
  return {
    webSearchCalls: output.filter((item) => isJsonRecord(item) && item.type === "web_search_call"),
    annotations: output.flatMap((item) => isJsonRecord(item) && Array.isArray(item.content) ? item.content : [])
  };
}

function inferUsageFromRaw(raw: JsonRecord): AiUsageSummary | undefined {
  return extractOpenAiUsageMetadata(raw.usage);
}

function countOpenAiSearchCalls(raw: JsonRecord) {
  const output = Array.isArray(raw.output) ? raw.output : [];
  return output.filter((item) => isJsonRecord(item) && item.type === "web_search_call").length;
}

function normalizeOpenAiModel(value: string) {
  const model = value.trim() || "gpt-5.5";
  const allowed = new Set(["gpt-5.5-pro", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-pro"]);
  return allowed.has(model) ? model : "gpt-5.5";
}

function normalizeReasoningEffort(model: string, value: string) {
  const effort = ["low", "medium", "high", "xhigh"].includes(value) ? value : "medium";
  if (/pro$/i.test(model) && effort === "low") return "medium";
  return effort;
}

function normalizeHeaderLine(line: string) { return line.split("\t").map((col) => col.trim().toUpperCase()).join("\t"); }
function normalizePipeHeader(line: string) { return line.split("|").map((col) => col.trim().toUpperCase()).filter(Boolean).join("\t"); }
function splitRow(line: string) {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes("|")) return line.split("|").map((part) => part.trim()).filter((part, index, arr) => !(index === 0 && !part) && !(index === arr.length - 1 && !part));
  return line.split(/\s{2,}/);
}
function splitDelimitedFinancialLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  if (line.includes("|")) return splitMarkdownLine(line);
  return line.split(/\s{2,}/).map((cell) => cell.trim());
}
function normalizeItemId(value: string) { return String(value || "").trim().replace(/^item\s*/i, "").trim(); }
function cleanUrlCell(value: string) {
  const text = String(value || "").trim();
  const markdown = text.match(/\((https?:\/\/[^\s)]+)\)/i);
  if (markdown) return trimSuspiciousUrl(markdown[1]);
  const direct = text.match(/https?:\/\/[^\s)]+/i);
  return direct ? trimSuspiciousUrl(direct[0]) : text;
}
function trimSuspiciousUrl(url: string) { return url.length > 500 ? url.slice(0, 500) : url; }
function parsePrice(value: string) {
  const match = String(value || "").replace(/\s+/g, "").match(/-?\d[\d.,]*/);
  const text = match?.[0] ?? "";
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastDot >= 0) {
    normalized = /^\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  } else if (lastComma >= 0) {
    normalized = /^\d{1,3}(?:,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function splitMarkdownLine(line: string) {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function normalizeMarkdownHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanMarkdownCell(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, " ").replace(/\\\|/g, "|").trim();
}
