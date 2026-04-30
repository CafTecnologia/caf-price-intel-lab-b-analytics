import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const value = process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[++index] : "true";
  args.set(key, value);
}

const expectedPath = args.get("expected");
const actualPath = args.get("actual");
const runId = args.get("run-id");
const baseUrl = args.get("base-url") ?? "http://127.0.0.1:18020";
const outPath = args.get("out");

if (!expectedPath || (!actualPath && !runId)) {
  console.error("Uso: npm run evaluate:document -- --expected <expected.json> (--actual <result.json> | --run-id <runId>) [--out report.json]");
  process.exit(2);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function readActual() {
  if (actualPath) {
    return readJson(actualPath);
  }

  const response = await fetch(`${baseUrl}/api/market-analysis/${runId}`);
  if (!response.ok) {
    throw new Error(`No fue posible leer run ${runId}: HTTP ${response.status}`);
  }
  return response.json();
}

function unwrapRows(actual) {
  if (Array.isArray(actual?.rows)) return actual.rows;
  if (Array.isArray(actual?.result?.rows)) return actual.result.rows;
  if (Array.isArray(actual?.run?.result?.rows)) return actual.run.result.rows;
  return [];
}

function unwrapWarnings(actual) {
  if (Array.isArray(actual?.warnings)) return actual.warnings;
  if (Array.isArray(actual?.result?.warnings)) return actual.result.warnings;
  if (Array.isArray(actual?.run?.result?.warnings)) return actual.run.result.warnings;
  return [];
}

function unwrapStages(actual) {
  if (Array.isArray(actual?.stages)) return actual.stages;
  if (Array.isArray(actual?.debug?.stages)) return actual.debug.stages;
  if (Array.isArray(actual?.run?.stages)) return actual.run.stages;
  return [];
}

function unwrapStatus(actual) {
  return actual?.status ?? actual?.run?.status ?? null;
}

function pick(row, key) {
  const aliases = {
    item: ["item", "Ítem"],
    description: ["description", "Nombre o descripción"],
    technical_description: ["technical_description", "Descripción o ficha técnica"],
    quantity: ["quantity", "Cant"],
    fit_analysis: ["fit_analysis", "Análisis de Ficha"],
    source_1: ["source_1", "Fuente 1 (Precio)"],
    source_2: ["source_2", "Fuente 2 (Precio)"],
    source_3: ["source_3", "Fuente 3 (Precio)"],
    reference_unit: ["reference_unit", "PRECIO REFERENCIA (TECHO) UNIT"],
    notes: ["notes", "Resumen de Fuentes y Observaciones"],
  };
  for (const alias of aliases[key] ?? [key]) {
    if (row?.[alias] !== undefined && row?.[alias] !== null) return String(row[alias]).trim();
  }
  return "";
}

function isMoneyLike(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || /^n\/?d$/i.test(normalized)) return false;
  if (/^(und|unidad|un|kg|ml|lt|m|cm|caja|paquete)$/i.test(normalized)) return false;
  return /(?:cop|usd|\$|[0-9][0-9.,]*\s*(?:cop|usd)?)/i.test(normalized) && /\d/.test(normalized);
}

function ratio(count, total) {
  return total === 0 ? 0 : count / total;
}

function scoreBoolean(name, passed, details = {}) {
  return { name, passed, score: passed ? 1 : 0, ...details };
}

function evaluate(expected, actual) {
  if (actual?._read_error) {
    return {
      case_id: expected.case_id ?? basename(expectedPath ?? "expected"),
      status: "failed",
      score: 0,
      row_count: 0,
      warning_count: 0,
      expected_metadata: expected.metadata ?? {},
      checks: [
        {
          name: "json_valid",
          passed: false,
          score: 0,
          error: actual._read_error,
        },
      ],
    };
  }

  const rows = unwrapRows(actual);
  const warnings = unwrapWarnings(actual);
  const stages = unwrapStages(actual);
  const actualStatus = unwrapStatus(actual);
  const expectedConfig = expected.expected ?? expected;
  const requiredFields = expectedConfig.required_fields ?? [];
  const checks = [];

  checks.push(scoreBoolean("json_valid", true));

  const itemCount = expectedConfig.item_count ?? {};
  const minItems = itemCount.min ?? itemCount.exact ?? 0;
  const maxItems = itemCount.max ?? itemCount.exact ?? Number.POSITIVE_INFINITY;
  checks.push(
    scoreBoolean("cantidad_items", rows.length >= minItems && rows.length <= maxItems, {
      actual: rows.length,
      min: minItems,
      max: Number.isFinite(maxItems) ? maxItems : null,
    }),
  );

  const missingRequired = [];
  let requiredPresent = 0;
  for (const [rowIndex, row] of rows.entries()) {
    for (const field of requiredFields) {
      if (pick(row, field)) {
        requiredPresent += 1;
      } else {
        missingRequired.push({ row: rowIndex + 1, field });
      }
    }
  }
  const requiredTotal = rows.length * requiredFields.length;
  const requiredCoverage = ratio(requiredPresent, requiredTotal);
  checks.push({
    name: "campos_obligatorios",
    passed: requiredTotal === 0 || requiredCoverage >= 0.8,
    score: requiredCoverage,
    missing: missingRequired.slice(0, 25),
  });

  for (const [field, minimum] of Object.entries(expectedConfig.minimum_field_coverage ?? {})) {
    const filled = rows.filter((row) => {
      const value = pick(row, field);
      return field === "reference_unit" ? isMoneyLike(value) : Boolean(value);
    }).length;
    const coverage = ratio(filled, rows.length);
    checks.push({
      name: field === "reference_unit" ? "precios_techo" : field === "technical_description" ? "ficha_tecnica" : field,
      passed: coverage >= Number(minimum),
      score: coverage,
      filled,
      total: rows.length,
      minimum,
    });
  }

  const expectedItems = expectedConfig.expected_items ?? [];
  const itemFailures = [];
  for (const expectedItem of expectedItems) {
    const row = rows.find((candidate) => pick(candidate, "item") === String(expectedItem.item));
    if (!row) {
      itemFailures.push({ item: expectedItem.item, reason: "missing" });
      continue;
    }
    for (const field of ["description", "quantity", "reference_unit", "technical_description"]) {
      const expectedValue = expectedItem[field];
      if (!expectedValue) continue;
      if (field === "reference_unit" && !isMoneyLike(expectedValue)) {
        itemFailures.push({
          item: expectedItem.item,
          field,
          reason: "malformed_expected_reference_unit",
          expected: expectedValue,
        });
        continue;
      }
      const actualValue = pick(row, field);
      if (!actualValue.toLowerCase().includes(String(expectedValue).toLowerCase())) {
        itemFailures.push({ item: expectedItem.item, field, expected: expectedValue, actual: actualValue });
      }
    }
  }
  checks.push(scoreBoolean("expected_items", itemFailures.length === 0, { failures: itemFailures }));

  const itemIds = rows.map((row) => pick(row, "item")).filter(Boolean);
  const duplicateItems = itemIds.filter((item, index) => itemIds.indexOf(item) !== index);
  checks.push(
    scoreBoolean("items_duplicados", duplicateItems.length === 0, {
      duplicates: Array.from(new Set(duplicateItems)).slice(0, 20),
    }),
  );

  const warningPolicy = expectedConfig.warnings ?? {};
  const maxWarnings = warningPolicy.max ?? Number.POSITIVE_INFINITY;
  checks.push(
    scoreBoolean("warnings", warningPolicy.allow === true || warnings.length === 0, {
      actual: warnings.length,
      max: Number.isFinite(maxWarnings) ? maxWarnings : null,
      passed: (warningPolicy.allow === true || warnings.length === 0) && warnings.length <= maxWarnings,
    }),
  );

  const failedStages = stages
    .filter((stage) => stage?.status === "failed")
    .map((stage) => ({
      stage_name: stage.stage_name,
      error_message: stage.error_message,
      retry_count: stage.retry_count,
    }));
  const allowStageFailures = expectedConfig.pipeline?.allow_stage_failures === true;
  const requirePipelineStages = expectedConfig.pipeline?.required === true;
  const requiredStages = expectedConfig.pipeline?.required_stages ?? [];
  const presentStageNames = new Set(stages.map((stage) => String(stage?.stage_name ?? "")));
  const missingRequiredStages = requiredStages.filter((stageName) => !presentStageNames.has(stageName));
  checks.push(
    scoreBoolean(
      "pipeline_stages",
      (!requirePipelineStages || stages.length > 0) &&
        missingRequiredStages.length === 0 &&
        (allowStageFailures || failedStages.length === 0) &&
        !(actualStatus === "completed" && failedStages.length > 0),
      {
      total: stages.length,
      failed: failedStages.slice(0, 20),
      missing_required: missingRequiredStages,
      actual_status: actualStatus,
      },
    ),
  );

  const score = checks.reduce((sum, check) => sum + (Number(check.score) || 0), 0) / Math.max(checks.length, 1);
  return {
    case_id: expected.case_id ?? basename(expectedPath ?? "expected"),
    expected_metadata: expected.metadata ?? {},
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    score: Number(score.toFixed(3)),
    row_count: rows.length,
    warning_count: warnings.length,
    checks,
  };
}

let actual;
try {
  actual = await readActual();
} catch (error) {
  actual = { _read_error: error instanceof Error ? error.message : "No se pudo leer resultado real." };
}

let report;
try {
  const expected = readJson(expectedPath);
  report = evaluate(expected, actual);
} catch (error) {
  report = {
    case_id: expectedPath,
    status: "failed",
    score: 0,
    error: error instanceof Error ? error.message : "Error evaluando resultado.",
  };
}

const output = JSON.stringify(report, null, 2);
console.log(output);
if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), output, "utf8");
}

if (report.status !== "passed") {
  process.exit(1);
}
