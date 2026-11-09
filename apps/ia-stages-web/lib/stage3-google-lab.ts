import { randomUUID } from "node:crypto";
import { callGeminiWithSearchAndUrlContext, callGeminiWithSearchAndUrlContextFreeform } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import { compactItemForPricing, getStageItems, isJsonRecord } from "@/lib/stage-field-access";
import { extractGeminiUsageMetadata, estimateAiCost, summarizeSearchUsage } from "@/lib/usage-cost";
import { buildStage3GoogleLabPrompt } from "@/prompts/stage3-google-lab";
import { resolveGoogleGroundingRedirect } from "@/lib/google-grounding-redirect";

export async function runGoogleStage3Lab(input: { stage2Json: unknown; model?: string; runId?: string; promptOverride?: string }) {
  const prompt = input.promptOverride?.trim() || buildStage3GoogleLabPrompt(input.stage2Json);
  const promptStyle = getLabPromptStyle(input.stage2Json);
  const ai = promptStyle === "markdown_table_one_source"
    ? await callGeminiWithSearchAndUrlContextFreeform({ prompt, stage: "stage3", model: input.model })
    : await callGeminiWithSearchAndUrlContext({ prompt, stage: "stage3", model: input.model });
  const parsed = parseGoogleLabText(ai.text, input.stage2Json);
  const usage = extractGeminiUsageMetadata(ai.usageMetadata);
  const search = summarizeSearchUsage(ai.groundingMetadata);
  const cost = estimateAiCost({ provider: "gemini", model: ai.model, usage, search });
  const normalized = await normalizeGoogleLabResult(parsed.result, input.stage2Json, parsed.notes);
  const urlContext = summarizeUrlContextMetadata((ai as { urlContextMetadata?: unknown }).urlContextMetadata);
  const finalResult = search.groundedPrompt
    ? attachGoogleToolMetadata(normalized.result, urlContext, normalized.redirectResolutions)
    : markGoogleResultWithoutGrounding(normalized.result, ai.text);

  return {
    runId: input.runId || randomUUID(),
    provider: "gemini" as const,
    model: ai.model,
    result: finalResult,
    raw: ai.text,
    groundingMetadata: ai.groundingMetadata,
    urlContextMetadata: (ai as { urlContextMetadata?: unknown }).urlContextMetadata,
    usage,
    cost,
    details: { experimentalGoogleStage3: true, promptStyle, promptText: prompt, promptLength: prompt.length, search, urlContext, googleGroundingRedirectResolutions: normalized.redirectResolutions, parseMode: parsed.parseMode }
  };
}

function getLabPromptStyle(stage2Json: unknown) {
  if (!isJsonRecord(stage2Json) || !isJsonRecord(stage2Json.metadata)) return "json_compact";
  return stage2Json.metadata.lab_prompt_style === "markdown_table_one_source" ? "markdown_table_one_source" : "json_compact";
}


function attachGoogleToolMetadata(
  result: Record<string, unknown>,
  urlContext: ReturnType<typeof summarizeUrlContextMetadata>,
  redirectResolutions: Array<Awaited<ReturnType<typeof resolveGoogleGroundingRedirect>>> = []
) {
  return {
    ...result,
    metadata: {
      ...((isJsonRecord(result.metadata) ? result.metadata : {})),
      app_url_context_status: urlContext.used ? "url_context_reportado" : "sin_url_context_reportado",
      app_url_context_successes: urlContext.successes,
      app_url_context_errors: urlContext.errors,
      app_google_grounding_redirects_resolved: redirectResolutions.filter((item) => item.status === "resolved").length
    },
    control_calidad: {
      ...((isJsonRecord(result.control_calidad) ? result.control_calidad : {})),
      url_context_app: urlContext,
      google_grounding_redirect_resolutions: redirectResolutions
    }
  };
}

function summarizeUrlContextMetadata(metadata: unknown) {
  const urlMetadata = isJsonRecord(metadata) && Array.isArray(metadata.urlMetadata)
    ? metadata.urlMetadata.filter(isJsonRecord)
    : [];
  let successes = 0;
  let errors = 0;
  for (const item of urlMetadata) {
    const status = String(item.urlRetrievalStatus ?? item.status ?? "").toLowerCase();
    if (status.includes("success") || status === "url_retrieval_status_success") successes += 1;
    else if (status) errors += 1;
  }
  return {
    used: urlMetadata.length > 0,
    urls: urlMetadata.map((item) => ({
      url: typeof item.retrievedUrl === "string" ? item.retrievedUrl : typeof item.url === "string" ? item.url : null,
      status: item.urlRetrievalStatus ?? item.status ?? null
    })),
    successes,
    errors
  };
}


function parseGoogleLabText(raw: string, stage2Json: unknown): { result: Record<string, unknown>; parseMode: string; notes: string[] } {
  const notes: string[] = [];
  try {
    return { result: parseJsonFromModelText<Record<string, unknown>>(raw), parseMode: "json", notes };
  } catch (error) {
    if (error instanceof Error) notes.push(error.message);
  }

  const fenced = parseLastValidJsonFence(raw);
  if (fenced) {
    return {
      result: fenced,
      parseMode: "json_fence_salvaged",
      notes: ["Google mezclo razonamiento con JSON; la app rescato el ultimo bloque JSON valido.", ...notes]
    };
  }

  const markdownTable = parseMarkdownOneSourceTable(raw);
  if (markdownTable) {
    return {
      result: markdownTable,
      parseMode: "markdown_table_one_source",
      notes: ["Google devolvio tabla Markdown; la app la normalizo para auditoria y validacion.", ...notes]
    };
  }

  notes.unshift("Google devolvio texto no parseable como JSON; se conserva el crudo y se arma una tabla minima para auditoria.");
  const originalItems = getStageItems(stage2Json).map((item, index) => compactItemForPricing(item, index));
  return {
    parseMode: "raw_text",
    notes,
    result: {
      metadata: {
        modo: "google_stage3_experimental_raw_text",
        total_items_cotizados: originalItems.length,
        observaciones_generales: notes
      },
      items: originalItems.map((original) => ({
        "Consecutivo interno": original.itemKey,
        "No. item": original.original["No. item"] ?? null,
        "Nombre o descripcion": original.name || null,
        "Detalles o ficha tecnica": original.description || null,
        "Und de medida": original.unit || null,
        "Cant": original.quantity || null,
        "Precio techo encontrado": original.ceiling || null,
        "Estado de cotizacion": {
          resultado_busqueda: "respuesta_cruda_recibida",
          estado_pricing: "pendiente_revision",
          calidad_datos: "no_evaluable",
          decision_siguiente_paso: "revisar_fuentes"
        },
        "Cotizaciones encontradas": [],
        "Respuesta cruda Google": raw.slice(0, 12000),
        "Datos originales": original.original
      })),
      control_calidad: {
        estado_app: "texto_crudo_recibido",
        notas_app: notes,
        raw_preview: raw.slice(0, 4000)
      }
    }
  };
}


function parseLastValidJsonFence(raw: string): Record<string, unknown> | null {
  const matches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const body = matches[index]?.[1]?.trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (isJsonRecord(parsed)) return parsed;
    } catch {
      // Keep looking for an earlier valid fenced JSON block.
    }
  }
  return null;
}


function parseMarkdownOneSourceTable(raw: string): Record<string, unknown> | null {
  const rows = extractMarkdownRows(raw);
  if (rows.length < 2) return null;
  const headerIndex = rows.findIndex((row) => {
    const normalized = splitMarkdownRow(row).map(normalizeMarkdownHeader);
    return normalized.includes("item") && normalized.includes("proveedor 1") && normalized.includes("url proveedor 1");
  });
  if (headerIndex < 0) return null;
  const headers = splitMarkdownRow(rows[headerIndex]).map(normalizeMarkdownHeader);
  const parsedItems: Record<string, unknown>[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (isMarkdownSeparator(row)) continue;
    const cells = splitMarkdownRow(row);
    if (cells.length < headers.length - 2) continue;
    const values = new Map<string, string>();
    headers.forEach((header, index) => values.set(header, cleanMarkdownCell(cells[index] ?? "")));
    const itemKey = normalizeItemKey(values.get("item") ?? "");
    if (!itemKey) continue;
    const proveedor = values.get("proveedor 1") ?? "";
    const precio = values.get("precio proveedor 1") ?? "";
    const moneda = values.get("moneda proveedor 1") ?? "";
    const url = extractUrl(values.get("url proveedor 1") ?? "");
    const notasProveedor = values.get("notas proveedor 1") ?? "";
    const notasItem = values.get("notas del item") ?? "";
    const hasSource = Boolean(proveedor || precio || moneda || url || notasProveedor);
    parsedItems.push({
      "Consecutivo interno": itemKey,
      "Estado de cotizacion": {
        resultado_busqueda: hasSource ? "cotizado_1_fuente" : "sin_fuentes_confiables",
        estado_pricing: hasSource ? "pendiente_revision" : "no_usable",
        calidad_datos: hasSource ? "no_evaluable" : "sin_datos",
        decision_siguiente_paso: hasSource ? "revisar_fuentes" : "buscar_manualmente"
      },
      "Cotizaciones encontradas": hasSource ? [{
        numero: 1,
        fuente: { nombre: proveedor || null, url: url || null, origen_geografico: inferSourceGeography(url) },
        producto: { titulo: values.get("nombre") || null, marca: null, referencia: null },
        precio: { valor: null, moneda: moneda || null, texto_original: precio || null },
        defensa: {
          estado_fuente: "usable_con_alertas",
          tipo_referencia: inferReferenceType(`${notasItem} ${notasProveedor}`),
          justificacion: notasProveedor || notasItem || null,
          alertas: [],
          usable_para_pricing: true
        },
        evidencia_corta: notasProveedor || notasItem || null,
        trm: values.get("trm proveedor 1") || null
      }] : [],
      "Auditoria de busqueda": {
        busquedas_intentadas: [],
        fuentes_descartadas: [],
        motivo_no_fuente_usable: hasSource ? null : notasItem || "Sin fuente defendible reportada en tabla Markdown.",
        requiere_revision_humana: true
      },
      "Resumen de cotizacion": hasSource ? `${proveedor} ${precio} ${moneda}`.trim() : null,
      "Notas del item": notasItem || null
    });
  }
  if (!parsedItems.length) return null;
  return {
    metadata: { modo: "google_stage3_experimental_markdown_table_one_source", total_items_cotizados: parsedItems.length, observaciones_generales: [] },
    items: parsedItems,
    control_calidad: { estado_app: "markdown_table_normalized", nota_app: "La respuesta Markdown fue normalizada para conservar fuentes y validar links." }
  };
}

function extractMarkdownRows(raw: string) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\|.*\|$/.test(line));
}
function splitMarkdownRow(row: string) {
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function isMarkdownSeparator(row: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row);
}
function normalizeMarkdownHeader(header: string) {
  return header.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function normalizeItemKey(value: string) {
  return value.replace(/^item\s+/i, "").trim();
}
function cleanMarkdownCell(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, " ").replace(/\\\|/g, "|").trim();
}
function extractUrl(value: string) {
  const markdownLink = value.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownLink?.[1]) return markdownLink[1].trim();
  const plain = value.match(/https?:\/\/\S+/i);
  return plain?.[0]?.replace(/[),.;]+$/, "") ?? "";
}
function inferReferenceType(notes: string) {
  const text = notes.toLowerCase();
  if (text.includes("exact")) return "exacta";
  if (text.includes("equivalent") || text.includes("homolog")) return "equivalente_funcional";
  if (text.includes("benchmark") || text.includes("similar") || text.includes("cautela")) return "benchmark_parcial";
  if (text.includes("medida") || text.includes("fabricacion")) return "fabricacion_a_medida_probable";
  return "no_evaluable";
}
function inferSourceGeography(url: string) {
  if (!url) return null;
  return /\.com\.co|\.co\//i.test(url) ? "CO" : null;
}


function markGoogleResultWithoutGrounding(result: Record<string, unknown>, raw: string) {
  const items = Array.isArray(result.items) ? result.items.filter(isJsonRecord) : [];
  const normalizedItems = items.map((item) => {
    const quotes = Array.isArray(item["Cotizaciones encontradas"])
      ? item["Cotizaciones encontradas"].filter(isJsonRecord).map((quote) => {
          const defensa = isJsonRecord(quote.defensa) ? quote.defensa : {};
          const alertas = Array.isArray(defensa.alertas) ? defensa.alertas : [];
          return {
            ...quote,
            defensa: {
              ...defensa,
              estado_fuente: defensa.estado_fuente ?? "pendiente_auditor",
              alertas: [...new Set([...alertas, "sin_grounding_reportado_por_modelo"])],
              usable_para_pricing: false
            }
          };
        })
      : [];
    return {
      ...item,
      "Estado de cotizacion": {
        ...((isJsonRecord(item["Estado de cotizacion"]) ? item["Estado de cotizacion"] : {})),
        resultado_busqueda: quotes.length ? "candidatos_sin_grounding_reportado" : "sin_fuentes_confiables",
        estado_pricing: "pendiente_auditor",
        calidad_datos: "requiere_evidencia",
        decision_siguiente_paso: "validar_con_herramientas_y_auditor"
      },
      "Cotizaciones encontradas": quotes,
      "Advertencia app": "El modelo no reporto groundingMetadata. La app conserva las fuentes como candidatas para validarlas con link directo, URL Context y auditor IA; no se aceptan automaticamente.",
      "Respuesta cruda Google": typeof item["Respuesta cruda Google"] === "string"
        ? item["Respuesta cruda Google"]
        : raw.slice(0, 12000)
    };
  });

  return {
    ...result,
    metadata: {
      ...((isJsonRecord(result.metadata) ? result.metadata : {})),
      app_search_status: "sin_grounding_reportado_con_candidatos",
      app_experiment_warning: "Google no reporto groundingMetadata. Las fuentes se conservan como candidatas y deben validarse antes de usarse."
    },
    items: normalizedItems,
    control_calidad: {
      ...((isJsonRecord(result.control_calidad) ? result.control_calidad : {})),
      estado_app: "candidatos_sin_grounding_reportado",
      nota_app: "Se evita un falso bloqueo: las fuentes no se descartan solo por falta de groundingMetadata, pero quedan pendientes de auditoria.",
      raw_preview: raw.slice(0, 4000)
    }
  };
}

async function normalizeGoogleLabResult(result: Record<string, unknown>, stage2Json: unknown, notes: string[] = []) {
  const originalItems = getStageItems(stage2Json).map((item, index) => compactItemForPricing(item, index));
  const items = Array.isArray(result.items) ? result.items.filter(isJsonRecord) : [];
  const byKey = new Map(items.map((item, index) => [String(item["Consecutivo interno"] ?? item["No. item"] ?? index + 1), item]));

  const normalizedItems = originalItems.map((original, index) => {
    const found = byKey.get(original.itemKey) ?? items[index] ?? {};
    return {
      "Consecutivo interno": original.itemKey,
      "No. item": original.original["No. item"] ?? null,
      "Nombre o descripcion": original.name || null,
      "Detalles o ficha tecnica": original.description || null,
      "Und de medida": original.unit || null,
      "Cant": original.quantity || null,
      "Precio techo encontrado": original.ceiling || null,
      ...found,
      "Datos originales": original.original
    };
  });
  const { items: itemsWithResolvedUrls, resolutions: redirectResolutions } = await resolveGoogleGroundingUrlsInItems(normalizedItems);

  return {
    result: {
    ...result,
    metadata: {
      ...((isJsonRecord(result.metadata) ? result.metadata : {})),
      experimental: true,
      app_experiment: "stage3_google_grounded_lab",
      total_items_cotizados: normalizedItems.length
    },
    items: itemsWithResolvedUrls,
    control_calidad: {
      ...((isJsonRecord(result.control_calidad) ? result.control_calidad : {})),
      nota_app: "Resultado experimental Google. Usar supervisor antes de enviar a financiero.",
      notas_parseo: notes
    }
  },
    redirectResolutions
  };
}

async function resolveGoogleGroundingUrlsInItems(items: Record<string, unknown>[]) {
  const resolutions: Array<Awaited<ReturnType<typeof resolveGoogleGroundingRedirect>>> = [];
  const normalized = await Promise.all(items.map(async (item) => {
    const quotes = Array.isArray(item["Cotizaciones encontradas"])
      ? item["Cotizaciones encontradas"].filter(isJsonRecord)
      : [];
    if (!quotes.length) return item;
    const normalizedQuotes = await Promise.all(quotes.map(async (quote) => {
      const fuente = isJsonRecord(quote.fuente) ? quote.fuente : {};
      const url = typeof fuente.url === "string" ? fuente.url : typeof quote.url === "string" ? quote.url : "";
      const resolution = await resolveGoogleGroundingRedirect(url);
      resolutions.push(resolution);
      if (!resolution.resolvedUrl) return quote;
      return {
        ...quote,
        fuente: {
          ...fuente,
          url: resolution.resolvedUrl,
          url_original_google_grounding: resolution.originalUrl
        }
      };
    }));
    return { ...item, "Cotizaciones encontradas": normalizedQuotes };
  }));
  return { items: normalized, resolutions };
}
