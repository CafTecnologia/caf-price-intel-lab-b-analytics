import type { AppAiConfig } from "./app-config";

export type SearchAssistantItem = {
  item?: string | null;
  description?: string | null;
  technicalDescription?: string | null;
  unit?: string | null;
  notes?: string | null;
  referenceUnit?: number | null;
  priceSources?: Array<{
    label?: string | null;
    url?: string | null;
    notes?: string | null;
    currency?: string | null;
  }> | null;
};

export type SearchAssistantResult = {
  query: string;
  url: string;
  source: "deepseek" | "local";
};

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function compact(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\$?\s*\d{1,3}([.,]\d{3})+([.,]\d+)?/g, " ")
    .replace(/\b(cant|cantidad|precio|total|cop|usd|iva|item|nota|alerta)\b/gi, " ")
    .trim();
}

function uniqueWords(text: string, maxWords: number): string {
  const seen = new Set<string>();
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}"'.\/-]+$/gu, ""))
    .filter((word) => word.length > 1)
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return words.slice(0, maxWords).join(" ");
}

export function buildLocalSearchQuery(item: SearchAssistantItem): string {
  const name = uniqueWords(compact(item.description), 10);
  const technical = uniqueWords(compact(item.technicalDescription), 12);
  const query = uniqueWords(`${name} ${technical}`, 22);
  return `${query || "producto"} proveedor precio`.replace(/\s+/g, " ").trim();
}

function normalizeQuery(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^consulta\s*:\s*/i, "")
    .replace(/[“”]/g, "\"")
    .replace(/\bumbral de rendimiento\b/gi, "rendimiento")
    .replace(/\bprocesamiento avanzada\b/gi, "")
    .replace(/\bgestion con\b/gi, "")
    .replace(/\bgesti[oó]n avanzada\b/gi, "")
    .replace(/\bproveedor precio Colombia\b/gi, "Colombia proveedor precio")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function ensureGoogleIntent(query: string): string {
  const hasProvider = /\b(proveedor|distribuidor|venta|precio)\b/i.test(query);
  return `${query}${hasProvider ? "" : " proveedor precio"}`.replace(/\s+/g, " ").trim();
}

export async function buildSearchQueryWithDeepSeek(item: SearchAssistantItem, config: AppAiConfig): Promise<SearchAssistantResult> {
  const fallback = buildLocalSearchQuery(item);
  if (!config.deepseekApiKey.trim()) {
    return { query: fallback, url: googleUrl(fallback), source: "local" };
  }

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        thinking: { type: "disabled" },
        max_tokens: 90,
        messages: [
          {
            role: "system",
            content:
              [
                "Analiza el item y escribe UNA consulta para Google.",
                "Lee toda la informacion disponible del item: nombre, ficha tecnica, unidad, notas, URLs y nombres/notas de cotizaciones existentes.",
                "No copies el texto: normalizalo para buscar el producto real.",
                "Prioriza terminos que apunten a un producto especifico: marca, gama, linea comercial, referencia, modelo, medidas, capacidad, material, norma, compatibilidad y presentacion.",
                "Si la ficha parece cerrada por marca, gama, catalogo, referencia o modelo, esos terminos mandan sobre el nombre generico.",
                "Usa las fuentes o links existentes solo como pista para aclarar marca, referencia, gama o categoria; no son verdad absoluta.",
                "Contrasta cada fuente con nombre y ficha: si una fuente contradice el pliego, parece generica, marketplace dudoso o apunta a otro producto, ignora esa marca/referencia.",
                "Si una fuente coincide materialmente con la ficha, puedes usar su marca o referencia para enfocar la busqueda.",
                "Usa en lo posible solo terminos que aparezcan en el pliego o en la ficha.",
                "No agregues palabras externas salvo que normalicen algo evidente o ayuden de verdad a buscar el mismo producto.",
                "No omitas especificaciones valiosas si aparecen: funciones, conexion, voltaje, tecnologia, capacidad, tamano, doble faz, USB, WiFi, LAN, garantia.",
                "Puedes usar hasta 26 palabras si el item trae muchas especificaciones relevantes.",
                "Usa la ficha tecnica para completar la descripcion si aporta RAM, SSD, medidas, norma, referencia o marca.",
                "Quita cantidades, precios y frases de pliego poco buscables: umbral, gestion, procesamiento avanzada.",
                "No agregues pais ni ciudad; el usuario decide si busca local o exterior.",
                "Agrega proveedor precio solo si la consulta no tiene intencion comercial clara.",
                "No cotices, no inventes, no expliques. Devuelve solo la consulta final.",
                "Ejemplo entrada: COMPUTADOR TODO EN UNO, UMBRAL DE RENDIMIENTO PCMARK 10: 6200; ficha: 16GB RAM SSD.",
                "Ejemplo salida: computador todo en uno PCMark 10 6200 16GB RAM SSD proveedor precio.",
                "Ejemplo entrada: Tubo estructural cuadrado de 50x50mm x 6m cal 2 mm.",
                "Ejemplo salida: tubo estructural cuadrado 50x50mm 6m calibre 2 proveedor precio.",
              ].join(" "),
          },
          {
            role: "user",
            content: [
              `Descripcion: ${item.description ?? ""}`,
              `Ficha tecnica: ${item.technicalDescription ?? ""}`,
              `Unidad: ${item.unit ?? ""}`,
              `Notas: ${item.notes ?? ""}`,
              `Precio techo unitario: ${item.referenceUnit ?? ""}`,
              `Fuentes existentes: ${JSON.stringify(
                (item.priceSources ?? []).map((source) => ({
                  proveedor: source.label,
                  url: source.url,
                  notas: source.notes,
                  moneda: source.currency,
                })),
              )}`,
              "Consulta Google:",
            ].join("\n"),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("DeepSeek search query failed");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const modelQuery = normalizeQuery(data.choices?.[0]?.message?.content ?? "");
    if (!modelQuery) return { query: fallback, url: googleUrl(fallback), source: "local" };
    const query = ensureGoogleIntent(modelQuery);
    return { query, url: googleUrl(query), source: "deepseek" };
  } catch {
    return { query: fallback, url: googleUrl(fallback), source: "local" };
  }
}
