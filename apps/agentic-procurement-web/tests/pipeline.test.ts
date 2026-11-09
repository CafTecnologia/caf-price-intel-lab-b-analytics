import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as XLSX from "@e965/xlsx";
import { parseDocument } from "../lib/document-parser";
import { executeRun, nextResumeStage, readStringList } from "../lib/orchestrator";
import { getRun, resetData, saveRun } from "../lib/store";
import type { AgentItem, AgentRun } from "../lib/types";
import { parseCop } from "../lib/utils";
import { effectiveDecision } from "../lib/commercial-policy";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-data");

const fixturePath = path.join(process.cwd(), "fixtures", "licitacion-papeleria-12.json");

test("COP conserva miles y decimales colombianos", () => {
  assert.equal(parseCop("$ 5.880"), 5880);
  assert.equal(parseCop("$ 6.500,00"), 6500);
  assert.equal(parseCop("173,200"), 173200);
  assert.equal(parseCop("2.5"), 2.5);
});

test("inventaria JSON anidado y mantiene trazabilidad", () => {
  const parsed = parseDocument("control.json", fs.readFileSync(fixturePath));
  assert.equal(parsed.items.length, 12);
  assert.equal(parsed.items[0].id, "1");
  assert.equal(parsed.items[0].source.file, "control.json");
  assert.equal(parsed.items[0].ceilingPrice, "$ 5.880");
});

test("separa Nombre y Descripcion cuando ambas columnas existen", () => {
  const file = path.join(process.cwd(), "fixtures", "licitacion-un-item-real.json");
  const parsed = parseDocument("licitacion-un-item-real.json", fs.readFileSync(file));
  assert.equal(parsed.items[0].name, "LIBRO DE ACTAS 200 FOLIOS");
  assert.equal(parsed.items[0].description, "Libro de actas empastado de 200 folios para registro institucional.");
});

test("encuentra una tabla XLSX aunque el encabezado no este en la primera fila", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["PROCESO DE PRUEBA"],
    ["Generado para control"],
    ["Item", "Nombre", "Descripcion", "Und", "Cant", "Precio techo unitario"],
    [1, "Cable solar", "Rojo 6 mm", "ML", 20, "$ 8.250"]
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Listado");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const parsed = parseDocument("listado.xlsx", buffer);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, "Cable solar");
  assert.equal(parsed.items[0].source.row, 4);
});

test("ignora hojas de instrucciones aunque contengan palabras como descripcion y ficha tecnica", () => {
  const itemsSheet = XLSX.utils.aoa_to_sheet([
    ["Datos del item"],
    ["Item", "Nombre", "Descripcion", "Und de medida", "Cant", "Precio techo unitario"],
    [1, "Taladro profesional", "Taladro 1/2 pulg", "UND", 2, "$ 750.000"],
    [2, "PC AIO i5", "Pantalla 23 pulgadas RAM 16 GB", "UND", 3, "$ 4.000.000"]
  ]);
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ["Grupo", "Columna", "Que escribir"],
    ["Opcional", "Descripcion", "Ficha tecnica o detalle ampliado"],
    ["Opcional", "URL proveedor 1/2/3", "Link de trazabilidad"],
    ["Opcional", "Notas proveedor 1/2/3", "Comparabilidad, alerta o comentario util"]
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, itemsSheet, "Carga de items");
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instrucciones");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const parsed = parseDocument("con-instrucciones.xlsx", buffer);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items.map((item) => item.name), ["Taladro profesional", "PC AIO i5"]);
  assert.ok(parsed.inventory.warnings.some((warning) => warning.includes("Instrucciones")));
});

test("omite filas que solo contienen errores de formula de Excel", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Item", "Nombre o descripcion", "Descripcion", "Cant", "Precio techo unitario"],
    [1, "Tablet institucional", "Pantalla de 11 pulgadas", 2, "$ 980.000"],
    ["#ERROR!", "#ERROR!", "#ERROR!", "#ERROR!", "#ERROR!"],
    ["#REF!", "#REF!", "#REF!", "#REF!", "#REF!"]
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Oferta");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const parsed = parseDocument("formulas-con-error.xlsx", buffer);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, "Tablet institucional");
  assert.ok(parsed.inventory.warnings.some((warning) => warning.includes("2 fila(s)")));
});

test("documento real SENA conserva sus 199 items, trazabilidad y precio estimado", () => {
  const real = "H:\\Mi unidad\\Caf Tecnología - Archivos\\Caf 2026\\2026 PROCESOS DE CONTRACIÓN\\01 EN PROCESO\\146 SENA REGIONAL NARIÑO Grupo de - MC-NRÑ-CIPLL-00057-2026\\LISTADO DE PRECIOS SENA NARIÑO.xlsx";
  if (!fs.existsSync(real)) return;
  const parsed = parseDocument(path.basename(real), fs.readFileSync(real));
  assert.equal(parsed.items.length, 199);
  assert.equal(parsed.inventory.sheets[0].name, "Hoja2");
  assert.equal(parsed.items[0].source.row, 2);
  assert.equal(parsed.items[0].ceilingPrice, "$ 80,212");
  assert.equal(parseCop(parsed.items[0].ceilingPrice), 80212);
  assert.equal(parsed.items.at(-1)?.id, "199");
});

test("flujo sintetico conserva capas, trazas y semantica de confianza", async () => {
  await resetData();
  const parsed = parseDocument("control.json", fs.readFileSync(fixturePath));
  const run = makeRun("run_pipeline", parsed.items.map((original) => ({ id: original.id, original, status: "imported", reviews: [] })), 30);
  await saveRun(run);
  const completed = await executeRun(run.id);

  assert.equal(completed.status, "needs_review");
  assert.equal(completed.metrics.normalized, 12);
  assert.equal(completed.metrics.interpreted, 12);
  assert.equal(completed.metrics.accepted, 8);
  assert.equal(completed.metrics.pending, 4);
  assert.equal(completed.metrics.providerCalls, 4);
  assert.ok(completed.steps.every((step) => step.expected && step.observed));
  assert.ok(completed.steps.filter((step) => step.stage !== "source").every((step) => step.prompt && step.rawResponse));
  const noData = completed.items.filter((item) => item.market?.confidence === "no_data");
  assert.equal(noData.length, 3);
  assert.ok(noData.every((item) => item.market?.decision === "no_result"));
  assert.ok(completed.events.some((entry) => entry.title.includes("Desviacion")));
});

test("reanuda desde Mercado y no repite capas ya validas", async () => {
  const run = await getRun("run_pipeline");
  assert.ok(run);
  const originalCalls = run.metrics.providerCalls;
  const target = run.items[0];
  target.market = undefined;
  target.supervisedAt = undefined;
  target.status = "interpreted";
  run.activeStage = "market";
  run.status = "failed";
  await saveRun(run);

  const resumed = await executeRun(run.id);
  assert.equal(resumed.metrics.providerCalls, originalCalls + 2);
  assert.ok(resumed.items.every((item) => item.normalized && item.technical));
  assert.ok(resumed.items[0].market);
  assert.ok(resumed.items[0].supervisedAt);
  assert.ok(resumed.events.some((entry) => entry.title.includes("conservada")) === false);
});

test("una corrida fallida cambia de proveedor y reanuda sin perder el archivo", async () => {
  await resetData();
  const parsed = parseDocument("control.json", fs.readFileSync(fixturePath));
  const run = makeRun("run_provider_recovery", parsed.items.slice(0, 2).map((original) => ({ id: original.id, original, status: "imported", reviews: [] })), 30);
  run.providerId = "codex_vps";
  run.model = "codex-cli";
  await saveRun(run);

  const failed = await executeRun(run.id, async () => {
    throw new Error("fetch failed");
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.metrics.normalized, 0);
  assert.equal(failed.inventory.detectedRows, 2);

  const recovered = await executeRun(run.id, undefined, "mock");
  assert.equal(recovered.providerId, "mock");
  assert.equal(recovered.inventory.detectedRows, 2);
  assert.equal(recovered.metrics.normalized, 2);
  assert.ok(recovered.items.every((item) => item.normalized && item.technical && item.market && item.supervision));
  assert.ok(recovered.events.some((entry) => entry.title === "Proveedor cambiado"));
});

test("Continuar pendientes abre rama de Mercado sin tocar aceptados", async () => {
  await resetData();
  const parsed = parseDocument("control.json", fs.readFileSync(fixturePath));
  const run = makeRun("run_retry", parsed.items.map((original) => ({ id: original.id, original, status: "imported", reviews: [] })), 30);
  await saveRun(run);
  const first = await executeRun(run.id);
  const acceptedBefore = first.items.filter((item) => ["accept", "accept_with_note"].includes(effectiveDecision(item))).map((item) => ({ id: item.id, supplier: item.market?.supplier }));
  const second = await executeRun(run.id);
  assert.equal(second.branch, 2);
  assert.equal(second.metrics.accepted, 11);
  assert.equal(second.metrics.pending, 1);
  assert.equal(second.metrics.providerCalls, 6);
  assert.deepEqual(second.items.filter((item) => acceptedBefore.some((entry) => entry.id === item.id)).map((item) => ({ id: item.id, supplier: item.market?.supplier })), acceptedBefore);
  assert.ok(second.events.some((entry) => entry.title === "Reintento dirigido"));
});

test("fixture historica extensa sigue siendo inventariable", () => {
  const historical = path.resolve(process.cwd(), "..", "stage3c_stage1_pdf.json");
  if (!fs.existsSync(historical)) return;
  const parsed = parseDocument("stage3c_stage1_pdf.json", fs.readFileSync(historical));
  assert.equal(parsed.items.length, 363);
  assert.ok(parsed.items.every((item) => item.source.file === "stage3c_stage1_pdf.json"));
});

test("Extraccion repara solo los items omitidos y registra la cobertura", async () => {
  await resetData();
  const parsed = parseDocument("control.json", fs.readFileSync(fixturePath));
  const run = makeRun("run_repair", parsed.items.slice(0, 2).map((original) => ({ id: original.id, original, status: "imported", reviews: [] })), 30);
  await saveRun(run);
  let omitted = false;
  const completed = await executeRun(run.id, async (_provider, request) => {
    const response = structuredClone(request.mockResponse) as { items?: Array<{ id?: string }> };
    if (request.stage === "extraction" && !omitted && response.items) {
      response.items = response.items.slice(0, 1);
      omitted = true;
    }
    return { ok: true, contract: "caf-agent-task/v1", jobId: request.jobId, status: "completed", stage: request.stage, rawResponse: JSON.stringify(response) };
  });
  const extractionSteps = completed.steps.filter((step) => step.stage === "extraction");
  assert.equal(extractionSteps.length, 2);
  assert.equal(extractionSteps[0].status, "warning");
  assert.equal(extractionSteps[1].status, "passed");
  assert.match(extractionSteps[1].prompt || "", /PASADA DE REPARACION CONTROLADA/);
  assert.deepEqual(extractionSteps[1].itemIds, [parsed.items[1].id]);
  assert.equal(completed.metrics.normalized, 2);
  assert.equal(completed.metrics.providerCalls, 5);
  assert.ok(completed.events.some((entry) => entry.title === "Reparacion focalizada"));
});

test("la reanudacion vuelve al primer checkpoint incompleto", () => {
  const parsed = parseDocument("control.json", fs.readFileSync(fixturePath));
  const items: AgentItem[] = parsed.items.slice(0, 2).map((original) => ({ id: original.id, original, status: "imported", reviews: [] }));
  assert.equal(nextResumeStage(items), "extraction");
  items[0].normalized = { name: "A", description: "", unit: "UN", quantity: 1, ceilingPriceCop: 1, transformations: [] };
  items[1].normalized = { name: "B", description: "", unit: "UN", quantity: 1, ceilingPriceCop: 1, transformations: [] };
  assert.equal(nextResumeStage(items), "technical");
});

test("los proveedores pueden enriquecer listas tecnicas sin degradarlas a object Object", () => {
  const values = readStringList([
    { datoOriginal: "200 FOLIOS", transformacion: "sin conversion", interpretacion: "Debe corresponder a 200 folios." },
    "Producto empastado"
  ]);
  assert.deepEqual(values, ["200 FOLIOS: Debe corresponder a 200 folios.", "Producto empastado"]);
  assert.ok(values.every((value) => !value.includes("[object Object]")));
});

function makeRun(id: string, items: AgentItem[], batchSize: number): AgentRun {
  const at = new Date().toISOString();
  return {
    contract: "caf-agent-run/v1",
    id,
    name: "Caso sintetico",
    branch: 1,
    status: "draft",
    providerId: "mock",
    model: "synthetic-v1",
    batchSize,
    createdAt: at,
    updatedAt: at,
    activeStage: "source",
    inventory: { fileName: "control.json", extension: ".json", size: 1, sheets: [{ name: "JSON", rows: items.length, columns: 7 }], parser: "test", detectedRows: items.length, warnings: [] },
    items,
    steps: [{ id: "source", stage: "source", title: "Inventario", expected: "Conservar original", observed: `${items.length} items`, status: "passed", itemIds: items.map((item) => item.id) }],
    events: [],
    metrics: { totalItems: items.length, normalized: 0, interpreted: 0, priced: 0, accepted: 0, pending: items.length, warnings: 0, durationMs: 0, providerCalls: 0 }
  };
}
