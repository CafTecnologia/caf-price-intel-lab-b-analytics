import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const value = process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[++index] : "true";
  args.set(key, value);
}

const runId = args.get("run-id");
const caseId = args.get("case-id") ?? runId;
const baseUrl = args.get("base-url") ?? "http://127.0.0.1:18020";
const containerRoot = args.get("container-root") ?? "/workspace";
const hostRoot = args.get("host-root") ?? resolve("..", "..");

if (!runId || !caseId) {
  console.error("Uso: npm run fixture:from-run -- --run-id <runId> [--case-id <case_id>]");
  process.exit(2);
}

const response = await fetch(`${baseUrl}/api/market-analysis/${runId}`);
if (!response.ok) {
  throw new Error(`No fue posible leer run ${runId}: HTTP ${response.status}`);
}

const payload = await response.json();
const run = payload.run;
const sourcePath = run.uploadedFilePath;

function resolveReadableSourcePath(pathFromRun) {
  const candidates = [pathFromRun];
  if (pathFromRun?.startsWith(`${containerRoot}/`)) {
    candidates.push(resolve(hostRoot, pathFromRun.slice(containerRoot.length + 1)));
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "No existe el archivo fuente del run en las rutas conocidas.",
      `run.uploadedFilePath: ${pathFromRun}`,
      `container-root: ${containerRoot}`,
      `host-root: ${hostRoot}`,
      `candidatas: ${candidates.join(" | ")}`,
    ].join("\n"),
  );
}

const readableSourcePath = resolveReadableSourcePath(sourcePath);

const fixtureDir = resolve("tests", "fixtures", "document_analysis");
const expectedDir = resolve("tests", "expected", "document_analysis");
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(expectedDir, { recursive: true });

const fixtureName = `${caseId}_${basename(readableSourcePath)}`.replace(/[^\w.\-]+/g, "_");
const fixturePath = resolve(fixtureDir, fixtureName);
copyFileSync(readableSourcePath, fixturePath);

const rows = run.result?.rows ?? [];
const expected = {
  case_id: caseId,
  document_name: fixtureName,
  source_run_id: runId,
  description: "Expected generado automaticamente desde un run. Ajusta minimos y expected_items despues de revisar el caso.",
  expected: {
    json_valid: true,
    item_count: { min: Math.max(1, rows.length) },
    required_fields: [
      "item",
      "description",
      "technical_description",
      "quantity",
      "fit_analysis",
      "source_1",
      "source_2",
      "source_3",
      "reference_unit",
      "notes",
    ],
    minimum_field_coverage: {
      quantity: 0.5,
      reference_unit: 0.5,
      technical_description: 0.5,
    },
    expected_items: rows.slice(0, 5).map((row) => ({
      item: row["Ítem"] ?? "",
      description: row["Nombre o descripción"] ?? "",
      quantity: row.Cant ?? "",
      reference_unit: row["PRECIO REFERENCIA (TECHO) UNIT"] ?? "",
    })),
    warnings: { allow: true, max: Math.max(10, run.result?.warnings?.length ?? 0) },
  },
};

const expectedPath = resolve(expectedDir, `${caseId}.expected.json`);
writeFileSync(expectedPath, JSON.stringify(expected, null, 2), "utf8");

const actualPath = resolve(expectedDir, `${caseId}.actual.seed.json`);
writeFileSync(actualPath, JSON.stringify(run, null, 2), "utf8");

console.log(JSON.stringify({ fixturePath, expectedPath, actualPath, sourcePath, readableSourcePath }, null, 2));
