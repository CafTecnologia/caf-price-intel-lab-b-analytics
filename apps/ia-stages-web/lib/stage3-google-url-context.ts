import { randomUUID } from "node:crypto";
import { callGeminiWithUrlContext } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import { extractStage3SourceRecords, type Stage3SourceRecord } from "@/lib/stage3-source-audit";
import { extractGeminiUsageMetadata, estimateAiCost } from "@/lib/usage-cost";
import { resolveGoogleGroundingRedirect } from "@/lib/google-grounding-redirect";

export async function runGoogleUrlContextValidation(input: {
  stage3Result: unknown;
  model?: string;
  maxSources?: number;
  runId?: string;
}) {
  const { sources, totalSourcesFound } = extractStage3SourceRecords(input.stage3Result, input.maxSources ?? 8);
  const rawUsableSources = sources.filter((source) => source.reportedUrl).slice(0, Math.max(1, Math.min(input.maxSources ?? 8, 80)));
  const { sources: usableSources, resolutions } = await resolveSourcesForUrlContext(rawUsableSources);
  const prompt = buildGoogleUrlValidationPrompt(usableSources);
  const ai = await callGeminiWithUrlContext({ prompt, stage: "stage3", model: input.model });
  const parsed = parseUrlValidationText(ai.text, usableSources);
  const usage = extractGeminiUsageMetadata(ai.usageMetadata);
  const cost = estimateAiCost({ provider: "gemini", model: ai.model, usage });
  const urlContextSummary = summarizeUrlContextMetadata(ai.urlContextMetadata);

  return {
    runId: input.runId || randomUUID(),
    provider: "gemini" as const,
    model: ai.model,
    result: {
      ...parsed,
      metadata: {
        ...(isRecord(parsed.metadata) ? parsed.metadata : {}),
        app_experiment: "stage3_google_url_context_validation",
        total_sources_found: totalSourcesFound,
        sources_sent_to_url_context: usableSources.length,
        url_context_used: urlContextSummary.used,
        url_context_successes: urlContextSummary.successes,
        url_context_errors: urlContextSummary.errors,
        google_grounding_redirects_resolved: resolutions.filter((item) => item.status === "resolved").length
      }
    },
    raw: ai.text,
    urlContextMetadata: ai.urlContextMetadata,
    usage,
    cost,
    details: {
      experimentalGoogleUrlContext: true,
      promptLength: prompt.length,
      totalSourcesFound,
      sourcesSent: usableSources.length,
      urlContext: urlContextSummary,
      googleGroundingRedirectResolutions: resolutions
    }
  };
}

async function resolveSourcesForUrlContext(sources: Stage3SourceRecord[]) {
  const resolutions = await Promise.all(sources.map((source) => resolveGoogleGroundingRedirect(source.reportedUrl)));
  return {
    resolutions,
    sources: sources.map((source, index) => {
      const resolution = resolutions[index];
      if (!resolution?.resolvedUrl) return source;
      return {
        ...source,
        reportedUrl: resolution.resolvedUrl,
        reportedNotes: [
          source.reportedNotes,
          `URL original Google/Vertex: ${resolution.originalUrl}`
        ].filter(Boolean).join(" | ")
      };
    })
  };
}

function buildGoogleUrlValidationPrompt(sources: Stage3SourceRecord[]) {
  return `Actua como herramienta de lectura de URLs para fuentes de cotizacion.

Debes usar URL Context para abrir y revisar las URLs entregadas. No reemplaces URL Context por memoria ni por inferencia.

Objetivo: responder preguntas cerradas sobre cada URL. No decidas si la fuente sirve; eso lo hara el supervisor IA con tus senales.

Reglas:
- No busques nuevas fuentes. Solo valida las URLs entregadas.
- No inventes precios, titulos ni conclusiones.
- Responde solo si/no/no_evaluable a las preguntas cerradas.
- Si URL Context no puede leer una pagina, usa "no" o "no_evaluable" segun corresponda.
- No declares "cumple ficha", "aceptar", "descartar", "sirve" ni "no sirve".
- Conserva sourceId e itemKey exactamente.

Devuelve SOLO JSON valido con esta forma:
{
  "metadata": {
    "modo": "google_url_context_binary_signals",
    "fuentes_validadas": 0,
    "observaciones_generales": []
  },
  "fuentes": [
    {
      "sourceId": "1#1",
      "itemKey": "1",
      "url": "https://...",
      "url_leida": "si | no | no_evaluable",
      "pagina_abre": "si | no | no_evaluable",
      "producto_leido": "si | no | no_evaluable",
      "precio_visible": "si | no | no_evaluable",
      "precio_reportado_coincide": "si | no | no_evaluable",
      "precio_detectado": null,
      "moneda": null,
      "producto_en_pagina": null,
      "evidencia": "texto corto observado en la pagina",
      "error": null
    }
  ],
  "resumen": {
    "url_leidas": 0,
    "paginas_abiertas": 0,
    "productos_leidos": 0,
    "precios_visibles": 0,
    "precios_reportados_coinciden": 0,
    "comentario": null
  }
}

Fuentes a validar:
${sources.map((source) => `SOURCE ${source.sourceId}
ItemKey: ${source.itemKey}
Item: ${source.itemName}
Ficha: ${source.itemDescription}
Precio techo: ${source.itemCeilingPrice ?? ""}
Proveedor reportado: ${source.reportedSourceName}
Producto reportado: ${source.reportedProductTitle}
Precio reportado: ${source.reportedPriceText || source.reportedPrice || ""} ${source.reportedCurrency || ""}
Notas reportadas: ${source.reportedNotes}
URL: ${source.reportedUrl}`).join("\n\n")}`;
}

function parseUrlValidationText(raw: string, sources: Stage3SourceRecord[]) {
  try {
    return parseJsonFromModelText<Record<string, unknown>>(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      metadata: {
        modo: "google_url_context_validation_raw_text",
        fuentes_validadas: sources.length,
        observaciones_generales: ["Google URL Context devolvio texto no parseable como JSON.", message]
      },
	      fuentes: sources.map((source) => ({
	        sourceId: source.sourceId,
	        itemKey: source.itemKey,
	        url: source.reportedUrl,
	        url_leida: "no_evaluable",
	        pagina_abre: "no_evaluable",
	        producto_leido: "no_evaluable",
	        precio_visible: "no_evaluable",
	        precio_reportado_coincide: "no_evaluable",
	        evidencia: raw.slice(0, 4000),
	        error: "json_no_parseable"
	      })),
	      resumen: {
	        url_leidas: 0,
	        paginas_abiertas: 0,
	        productos_leidos: 0,
	        precios_visibles: 0,
	        precios_reportados_coinciden: 0,
	        comentario: "Se conserva texto crudo para revision."
	      }
    };
  }
}

function summarizeUrlContextMetadata(metadata: unknown) {
  const urlMetadata = isRecord(metadata) && Array.isArray(metadata.urlMetadata)
    ? metadata.urlMetadata.filter(isRecord)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
