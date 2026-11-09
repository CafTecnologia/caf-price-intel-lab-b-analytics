/**
 * Herramientas deterministas de revisión Etapa 3 (sin IA).
 * Compara el JSON de entrada (resultado Etapa 2) con el resultado Etapa 3.
 */

export type Stage3ItemKey = {
  key: string;
  label: string;
};

export type Stage3ValidationReport = {
  expectedCount: number;
  actualCount: number;
  expectedKeys: string[];
  outputKeys: string[];
  missingKeys: string[];
  extraInOutput: string[];
  duplicateOutputKeys: string[];
  basicIssues: string[];
};

const CONSECUTIVO_LABELS = [
  "Consecutivo interno",
  "consecutivo interno",
  "Consecutivo Interno"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getItemsArray(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }
  const items = value.items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter((row): row is Record<string, unknown> => isRecord(row));
}

function normalizeKeyPart(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return String(value);
}

/**
 * Clave estable para cruzar ítems: Consecutivo interno, o compuesto Lote + No. item.
 */
export function getStage3ItemKey(item: Record<string, unknown>): Stage3ItemKey {
  for (const label of CONSECUTIVO_LABELS) {
    if (label in item && item[label] !== undefined && item[label] !== null && item[label] !== "") {
      const k = normalizeKeyPart(item[label]);
      if (k) {
        return { key: `c:${k}`, label: `Consecutivo ${k}` };
      }
    }
  }

  const lote = item["Lote"] ?? item["lote"] ?? item["No. lote"];
  const noItem = item["No. item"] ?? item["No item"] ?? item["no_item"];
  const a = normalizeKeyPart(lote);
  const b = normalizeKeyPart(noItem);
  if (a || b) {
    return { key: `l:${a}|i:${b}`, label: [a && `Lote ${a}`, b && `Item ${b}`].filter(Boolean).join(" · ") || "ítem" };
  }

  return { key: `h:${hashObjectShallow(item)}`, label: "ítem (sin consecutivo)" };
}

function hashObjectShallow(item: Record<string, unknown>): string {
  const pick = Object.keys(item)
    .slice(0, 8)
    .sort()
    .map((k) => `${k}:${normalizeKeyPart(item[k]).slice(0, 40)}`);
  return pick.join("|").slice(0, 120);
}

function collectKeys(items: Record<string, unknown>[]): { keys: string[]; keyToLabel: Map<string, string> } {
  const keyToLabel = new Map<string, string>();
  const keys: string[] = [];

  for (const item of items) {
    const { key, label } = getStage3ItemKey(item);
    if (!keyToLabel.has(key)) {
      keyToLabel.set(key, label);
      keys.push(key);
    }
  }

  return { keys, keyToLabel };
}

function findDuplicates(keys: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) {
      dup.add(k);
    }
    seen.add(k);
  }
  return [...dup];
}

export function findMissingItemKeys(
  expectedItems: Record<string, unknown>[],
  outputItems: Record<string, unknown>[]
): { missingKeys: string[]; missingLabels: string[]; expectedKeySet: Set<string>; outputKeySet: Set<string> } {
  const exp = collectKeys(expectedItems);
  const out = collectKeys(outputItems);
  const expectedSet = new Set(exp.keys);
  const outputSet = new Set(out.keys);
  const missingKeys = exp.keys.filter((k) => !outputSet.has(k));
  const missingLabels = missingKeys.map((k) => exp.keyToLabel.get(k) ?? k);
  return { missingKeys, missingLabels, expectedKeySet: expectedSet, outputKeySet: outputSet };
}

export function validateStage3AgainstInput(
  stage2Result: unknown,
  stage3Result: unknown
): Stage3ValidationReport {
  const expectedItems = getItemsArray(stage2Result);
  const outputItems = getItemsArray(stage3Result);

  const expectedMeta = collectKeys(expectedItems);
  const outputMeta = collectKeys(outputItems);

  const missing = findMissingItemKeys(expectedItems, outputItems);
  const extraInOutput = outputMeta.keys.filter((k) => !missing.expectedKeySet.has(k));

  const outputRowKeys = outputItems.map((it) => getStage3ItemKey(it).key);
  const dupOut = findDuplicates(outputRowKeys);

  const basicIssues: string[] = [];

  if (expectedItems.length === 0) {
    basicIssues.push("La entrada de Etapa 3 no tiene lista `items` o está vacía.");
  }
  if (outputItems.length === 0 && expectedItems.length > 0) {
    basicIssues.push("El resultado Etapa 3 no tiene ítems pero la entrada sí.");
  }

  if (dupOut.length) {
    basicIssues.push(`Hay claves duplicadas en la salida (${dupOut.length}): revisar consecutivos o lotes repetidos.`);
  }

  const countMismatch = expectedItems.length !== outputItems.length;
  if (countMismatch && expectedItems.length > 0 && outputItems.length > 0) {
    basicIssues.push(
      `Recuento distinto: entrada ${expectedItems.length} filas en items, salida ${outputItems.length} (la coincidencia por clave puede ser menor que el número de filas si hay duplicados).`
    );
  }

  return {
    expectedCount: expectedItems.length,
    actualCount: outputItems.length,
    expectedKeys: expectedMeta.keys,
    outputKeys: outputMeta.keys,
    missingKeys: missing.missingKeys,
    extraInOutput,
    duplicateOutputKeys: dupOut,
    basicIssues
  };
}

export function missingItemsDetail(
  stage2Result: unknown,
  stage3Result: unknown
): {
  missingLabels: string[];
  missingKeys: string[];
  summary: string;
} {
  const expectedItems = getItemsArray(stage2Result);
  const outputItems = getItemsArray(stage3Result);
  const { missingKeys, missingLabels } = findMissingItemKeys(expectedItems, outputItems);

  return {
    missingKeys,
    missingLabels,
    summary:
      missingLabels.length === 0
        ? "No se detectan ítems de entrada ausentes en la salida (según claves de consecutivo / lote+item)."
        : `Faltan ${missingLabels.length} ítem(es) en la salida respecto a la entrada.`
  };
}


export type Stage3CoverageReport = Stage3ValidationReport & {
  complete: boolean;
  coverageRatio: number;
  status: "complete" | "partial" | "empty_input";
  missingLabels: string[];
};

export function buildStage3CoverageReport(stage2Result: unknown, stage3Result: unknown): Stage3CoverageReport {
  const report = validateStage3AgainstInput(stage2Result, stage3Result);
  const detail = missingItemsDetail(stage2Result, stage3Result);
  const complete = report.expectedCount > 0 && report.missingKeys.length === 0 && report.actualCount >= report.expectedCount;
  return {
    ...report,
    complete,
    coverageRatio: report.expectedCount > 0 ? report.actualCount / report.expectedCount : 0,
    status: report.expectedCount === 0 ? "empty_input" : complete ? "complete" : "partial",
    missingLabels: detail.missingLabels
  };
}

export function getMissingStage2Items(stage2Result: unknown, stage3Result: unknown): Record<string, unknown>[] {
  const expectedItems = getItemsArray(stage2Result);
  const outputItems = getItemsArray(stage3Result);
  const missing = findMissingItemKeys(expectedItems, outputItems);
  const missingSet = new Set(missing.missingKeys);
  return expectedItems.filter((item) => missingSet.has(getStage3ItemKey(item).key));
}

export function makeStage2SubsetForMissing(stage2Result: unknown, missingItems: Record<string, unknown>[]) {
  const base = isRecord(stage2Result) ? stage2Result : {};
  const metadata = isRecord(base.metadata) ? base.metadata : {};
  const control = isRecord(base.control_calidad) ? base.control_calidad : undefined;
  return {
    ...base,
    metadata: {
      ...metadata,
      subset_reason: "stage3_missing_items_completion",
      subset_items: missingItems.length
    },
    ...(control ? { control_calidad: control } : {}),
    items: missingItems
  };
}

export function annotateStage3Coverage(
  stage2Result: unknown,
  stage3Result: Record<string, unknown>
): Record<string, unknown> {
  const report = buildStage3CoverageReport(stage2Result, stage3Result);
  const metadata = isRecord(stage3Result.metadata) ? stage3Result.metadata : {};
  const control = isRecord(stage3Result.control_calidad) ? stage3Result.control_calidad : {};
  const notes = Array.isArray(control.notas_app) ? control.notas_app.map((item) => String(item)) : [];
  if (report.status === "partial") {
    notes.push(`Cobertura parcial de Etapa 3: ${report.actualCount}/${report.expectedCount} items. Puedes completar faltantes con miniagente.`);
  }

  return {
    ...stage3Result,
    metadata: {
      ...metadata,
      app_stage3_coverage_status: report.status,
      app_stage3_expected_items: report.expectedCount,
      app_stage3_actual_items: report.actualCount
    },
    control_calidad: {
      ...control,
      estado_app:
        report.status === "complete" ? "recibido_completo" : report.status === "partial" ? "recibido_parcial" : "sin_entrada",
      notas_app: [...new Set(notes)],
      cobertura_stage3: {
        estado: report.status,
        completo: report.complete,
        esperados: report.expectedCount,
        recibidos: report.actualCount,
        faltantes: report.missingKeys.length,
        faltantes_muestra: report.missingLabels.slice(0, 30),
        duplicados: report.duplicateOutputKeys.length,
        extras: report.extraInOutput.length
      }
    }
  };
}

export function mergeStage3Results(
  stage2Result: unknown,
  currentStage3Result: unknown,
  completionStage3Result: unknown
): Record<string, unknown> {
  const current = isRecord(currentStage3Result) ? currentStage3Result : { items: [] };
  const completion = isRecord(completionStage3Result) ? completionStage3Result : { items: [] };
  const currentItems = getItemsArray(current);
  const completionItems = getItemsArray(completion);
  const seen = new Set(currentItems.map((item) => getStage3ItemKey(item).key));
  const mergedItems = [...currentItems];

  for (const item of completionItems) {
    const key = getStage3ItemKey(item).key;
    if (!seen.has(key)) {
      mergedItems.push(item);
      seen.add(key);
    }
  }

  const metadata = {
    ...(isRecord(current.metadata) ? current.metadata : {}),
    ultima_accion_app: "miniagente_faltantes",
    items_agregados_por_miniagente: mergedItems.length - currentItems.length
  };
  const control = {
    ...(isRecord(current.control_calidad) ? current.control_calidad : {}),
    miniagente_faltantes: {
      items_previos: currentItems.length,
      items_recibidos_miniagente: completionItems.length,
      items_agregados: mergedItems.length - currentItems.length
    }
  };

  return annotateStage3Coverage(stage2Result, {
    ...current,
    metadata,
    control_calidad: control,
    items: mergedItems
  });
}
