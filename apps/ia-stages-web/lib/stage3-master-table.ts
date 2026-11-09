import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getFieldText, getStageItems, isJsonRecord, type JsonRecord } from "@/lib/stage-field-access";

export type MasterEvaluation =
  | "Exacta"
  | "Equivalente"
  | "Benchmark"
  | "Sin stock"
  | "Tecnica sin precio"
  | "No verificada"
  | "No cumple"
  | "Sin fuente";

export type Stage3MasterAttempt = {
  id?: string;
  label?: string;
  provider?: string;
  model?: string;
  result?: unknown;
  rows?: unknown[];
};

export type MasterProviderCell = {
  proveedor: string;
  precio: string;
  moneda: string;
  link: string;
  evaluacion: MasterEvaluation;
  notas: string;
  intento: string;
  score: number;
};

export type Stage3MasterRow = {
  itemKey: string;
  originales: Record<string, unknown>;
  proveedor1: MasterProviderCell | null;
  proveedor2: MasterProviderCell | null;
  proveedor3: MasterProviderCell | null;
  estado: MasterEvaluation;
  completitud: "completo" | "util_con_alerta" | "pendiente" | "sin_fuente";
};

export type Stage3MasterTable = {
  generatedAt: string;
  runId?: string;
  rows: Stage3MasterRow[];
  summary: {
    totalItems: number;
    completos: number;
    utilesConAlerta: number;
    pendientes: number;
    sinFuente: number;
    providerSlotsFilled: number;
    evaluations: Record<string, number>;
  };
};

type Candidate = MasterProviderCell & { itemKey: string };

const ORIGINAL_COLUMNS = [
  "Consecutivo interno",
  "Lote",
  "No. item",
  "Nombre o descripcion",
  "Nombre o descripci?n",
  "Detalles o ficha tecnica",
  "Detalles o ficha t?cnica",
  "Und de medida",
  "Cant",
  "Precio techo encontrado"
];

export function buildStage3MasterTable(input: {
  stage2Json: unknown;
  attempts?: Stage3MasterAttempt[];
  runId?: string;
}): Stage3MasterTable {
  const stage2Items = getStageItems(input.stage2Json);
  const candidatesByItem = new Map<string, Candidate[]>();

  for (const attempt of input.attempts ?? []) {
    for (const candidate of extractCandidatesFromAttempt(attempt)) {
      const list = candidatesByItem.get(candidate.itemKey) ?? [];
      list.push(candidate);
      candidatesByItem.set(candidate.itemKey, list);
    }
  }

  const rows = stage2Items.map((item, index) => {
    const itemKey = getMasterItemKey(item, index);
    const candidates = dedupeCandidates(candidatesByItem.get(itemKey) ?? [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const estado = candidates[0]?.evaluacion ?? "Sin fuente";
    return {
      itemKey,
      originales: originalFields(item),
      proveedor1: candidates[0] ?? null,
      proveedor2: candidates[1] ?? null,
      proveedor3: candidates[2] ?? null,
      estado,
      completitud: completenessFor(estado)
    } satisfies Stage3MasterRow;
  });

  return {
    generatedAt: new Date().toISOString(),
    runId: input.runId,
    rows,
    summary: summarizeRows(rows)
  };
}

export async function saveStage3MasterTable(table: Stage3MasterTable, runId: string) {
  const safeRunId = runId.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 120) || "stage3-master";
  const dir = path.join(process.cwd(), "data", "labs", "stage3-master");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeRunId}.json`);
  await writeFile(file, JSON.stringify(table, null, 2));
  return file;
}

function extractCandidatesFromAttempt(attempt: Stage3MasterAttempt): Candidate[] {
  const out: Candidate[] = [];
  const label = attempt.label || attempt.id || "intento";
  if (Array.isArray(attempt.rows)) {
    for (const row of attempt.rows.filter(isJsonRecord)) out.push(...candidateFromSummaryRow(row, label));
  }
  if (attempt.result) out.push(...candidatesFromStage3Result(attempt.result, label));
  return out;
}

function candidatesFromStage3Result(result: unknown, label: string): Candidate[] {
  if (!isJsonRecord(result) || !Array.isArray(result.items)) return [];
  const out: Candidate[] = [];
  result.items.filter(isJsonRecord).forEach((item, index) => {
    const itemKey = getMasterItemKey(item, index);
    const quotes = Array.isArray(item["Cotizaciones encontradas"]) ? item["Cotizaciones encontradas"].filter(isJsonRecord) : [];
    for (const quote of quotes) out.push(candidateFromQuote(itemKey, quote, label));
  });
  return out;
}

function candidateFromSummaryRow(row: JsonRecord, label: string): Candidate[] {
  const itemKey = String(row.item ?? row.itemKey ?? row["No. item"] ?? row["Consecutivo interno"] ?? "").trim();
  if (!itemKey) return [];
  const out: Candidate[] = [];
  const proveedor = text(row.proveedor);
  const link = text(row.url);
  const precio = text(row.precio);
  if (proveedor || link || precio) {
    const evaluation = classifyCandidate({
      price: precio,
      tipoReferencia: text(row.tipoReferencia),
      defensa: text(row.defensa),
      veredicto: text(row.veredictoLab),
      validation: isJsonRecord(row.validacion) ? row.validacion : null,
      notes: [text(row.evidencia), text(row.defensa)].join(" ")
    });
    out.push({
      itemKey,
      proveedor,
      precio,
      moneda: text(row.moneda),
      link,
      evaluacion: evaluation,
      notas: buildNotes({ evaluation, row, label }),
      intento: label,
      score: scoreFor(evaluation, Boolean(precio), Boolean(link))
    });
  }

  const audit = isJsonRecord(row.auditoria) ? row.auditoria : null;
  const discarded = audit && Array.isArray(audit.fuentes_descartadas) ? audit.fuentes_descartadas.filter(isJsonRecord) : [];
  for (const source of discarded) {
    const reason = text(source.motivo_descarte);
    if (!/sin precio visible|no se encontr[oó] precio|coincidencia t[eé]cnica exacta/i.test(reason)) continue;
    out.push({
      itemKey,
      proveedor: text(source.nombre),
      precio: "",
      moneda: "",
      link: text(source.url),
      evaluacion: "Tecnica sin precio",
      notas: `Tipo: fuente tecnica sin precio. Riesgo: no hay precio visible. Accion: buscar precio por referencia. Fuente: ${label}. ${reason}`.trim(),
      intento: label,
      score: scoreFor("Tecnica sin precio", false, Boolean(text(source.url)))
    });
  }
  return out;
}

function candidateFromQuote(itemKey: string, quote: JsonRecord, label: string): Candidate {
  const fuente = isJsonRecord(quote.fuente) ? quote.fuente : {};
  const precioObj = isJsonRecord(quote.precio) ? quote.precio : {};
  const defensa = isJsonRecord(quote.defensa) ? quote.defensa : {};
  const precio = text(precioObj.texto_original) || text(precioObj.valor) || text(quote.precio);
  const link = text(fuente.url) || text(quote.url);
  const evaluation = classifyCandidate({
    price: precio,
    tipoReferencia: text(defensa.tipo_referencia),
    defensa: text(defensa.estado_fuente),
    veredicto: "",
    validation: null,
    notes: [text(defensa.justificacion), text(quote.evidencia_corta)].join(" ")
  });
  return {
    itemKey,
    proveedor: text(fuente.nombre) || text(quote.proveedor),
    precio,
    moneda: text(precioObj.moneda) || text(quote.moneda),
    link,
    evaluacion: evaluation,
    notas: `Tipo: ${evaluation}. Fuente: ${label}. ${text(defensa.justificacion) || text(quote.evidencia_corta)}`.trim(),
    intento: label,
    score: scoreFor(evaluation, Boolean(precio), Boolean(link))
  };
}

function classifyCandidate(input: {
  price: string;
  tipoReferencia: string;
  defensa: string;
  veredicto: string;
  validation: JsonRecord | null;
  notes: string;
}): MasterEvaluation {
  const state = [input.tipoReferencia, input.defensa, input.veredicto, input.notes].join(" ").toLowerCase();
  const validationState = input.validation
    ? [input.validation.estadoFuente, input.validation.estado_fuente, input.validation.cumpleFicha, input.validation.cumple_ficha, input.validation.riesgos].map(text).join(" ").toLowerCase()
    : "";
  if (/no_corresponde|no_cumple|no cumple|rechazada/.test(state) || /no_cumple|cumple_ficha.*no/.test(validationState)) return "No cumple";
  if (/sin stock|agotado|no disponible/.test(state) || /sin stock|agotado|no disponible/.test(validationState)) return "Sin stock";
  if (/benchmark_util|candidata_parcial|parcial/.test(state) || /candidata_parcial|parcial/.test(validationState)) return "Benchmark";
  if (/referencia_tecnica_sin_precio|rescatable_por_referencia|sin_precio_visible/.test(state) || /sin_precio_visible/.test(validationState)) return "Tecnica sin precio";
  if (/precio_dudoso|rescatable_por_url|link_no_verificable|no_verificable|requiere_supervision|revisar_o_reintentar/.test(state) || /link_no_verificable|no_verificable/.test(validationState)) return "No verificada";
  if (!input.price && /exacta|coincidencia tecnica|fuente tecnica/.test(state)) return "Tecnica sin precio";
  if (/benchmark|fabricacion_a_medida|parcial/.test(state)) return "Benchmark";
  if (/equivalente/.test(state)) return "Equivalente";
  if (/fuente_defendible|exacta|usable\b|verificable/.test(state) || /verificable.*si/.test(validationState)) return input.price ? "Exacta" : "Tecnica sin precio";
  return input.price ? "No verificada" : "Tecnica sin precio";
}

function buildNotes(input: { evaluation: MasterEvaluation; row: JsonRecord; label: string }) {
  const validation = isJsonRecord(input.row.validacion) ? input.row.validacion : null;
  const parts = [
    `Tipo: ${input.evaluation}`,
    validation ? `Validacion: ${text(validation.estadoFuente) || text(validation.estado_fuente) || "sin detalle"}` : "",
    validation ? `Cumple: ${text(validation.cumpleFicha) || text(validation.cumple_ficha) || "no evaluado"}` : "",
    validation && text(validation.riesgos) ? `Riesgo: ${text(validation.riesgos)}` : "",
    text(input.row.evidencia) ? `Evidencia: ${text(input.row.evidencia)}` : "",
    `Fuente: ${input.label}`
  ];
  return parts.filter(Boolean).join(". ");
}

function dedupeCandidates(candidates: Candidate[]) {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    const key = [candidate.proveedor.toLowerCase(), candidate.link.toLowerCase(), candidate.precio.toLowerCase(), candidate.evaluacion].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function originalFields(item: JsonRecord) {
  const out: Record<string, unknown> = {};
  for (const key of ORIGINAL_COLUMNS) {
    if (item[key] !== undefined && out[canonicalOriginalKey(key)] === undefined) out[canonicalOriginalKey(key)] = item[key];
  }
  return out;
}

function canonicalOriginalKey(key: string) {
  if (key.includes("descripci")) return "Nombre o descripcion";
  if (key.includes("ficha")) return "Detalles o ficha tecnica";
  return key;
}

function getMasterItemKey(item: JsonRecord, index: number) {
  return (
    getFieldText(item, ["Consecutivo interno", "consecutivo", "consecutivo interno"]) ||
    getFieldText(item, ["No. item", "No item", "item", "numero item"]) ||
    String(index + 1)
  ).trim();
}

function completenessFor(evaluation: MasterEvaluation): Stage3MasterRow["completitud"] {
  if (evaluation === "Exacta" || evaluation === "Equivalente") return "completo";
  if (evaluation === "Benchmark" || evaluation === "Sin stock") return "util_con_alerta";
  if (evaluation === "Tecnica sin precio" || evaluation === "No verificada") return "pendiente";
  return "sin_fuente";
}

function summarizeRows(rows: Stage3MasterRow[]): Stage3MasterTable["summary"] {
  const evaluations: Record<string, number> = {};
  let providerSlotsFilled = 0;
  for (const row of rows) {
    evaluations[row.estado] = (evaluations[row.estado] ?? 0) + 1;
    providerSlotsFilled += [row.proveedor1, row.proveedor2, row.proveedor3].filter(Boolean).length;
  }
  return {
    totalItems: rows.length,
    completos: rows.filter((row) => row.completitud === "completo").length,
    utilesConAlerta: rows.filter((row) => row.completitud === "util_con_alerta").length,
    pendientes: rows.filter((row) => row.completitud === "pendiente").length,
    sinFuente: rows.filter((row) => row.completitud === "sin_fuente").length,
    providerSlotsFilled,
    evaluations
  };
}

function scoreFor(evaluation: MasterEvaluation, hasPrice: boolean, hasLink: boolean) {
  const base: Record<MasterEvaluation, number> = {
    Exacta: 100,
    Equivalente: 82,
    Benchmark: 64,
    "Sin stock": 58,
    "Tecnica sin precio": 46,
    "No verificada": 30,
    "No cumple": 0,
    "Sin fuente": 0
  };
  return base[evaluation] + (hasPrice ? 5 : 0) + (hasLink ? 3 : 0);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("; ");
  return "";
}
