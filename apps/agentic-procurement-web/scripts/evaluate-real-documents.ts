import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../lib/document-parser";
import { executeRun } from "../lib/orchestrator";
import { effectiveConfidence, effectiveDecision } from "../lib/commercial-policy";
import { saveRun } from "../lib/store";
import type { AgentRun } from "../lib/types";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-real");

async function main() {
  const candidates = [
    "H:\\Mi unidad\\Caf Tecnología - Archivos\\Caf 2026\\2026 PROCESOS DE CONTRACIÓN\\01 EN PROCESO\\146 SENA REGIONAL NARIÑO Grupo de - MC-NRÑ-CIPLL-00057-2026\\LISTADO DE PRECIOS SENA NARIÑO.xlsx",
    path.resolve(process.cwd(), "..", "stage3c_stage1_pdf.json")
  ].filter((file) => fs.existsSync(file));

  if (!candidates.length) throw new Error("No se encontraron los documentos reales configurados.");

  const results = [];
  for (const [index, file] of candidates.entries()) {
    const parsed = parseDocument(path.basename(file), fs.readFileSync(file));
    const run = makeRun(`real_${index + 1}_${Date.now()}`, path.basename(file), parsed, 30);
    await saveRun(run);
    const completed = await executeRun(run.id);
    const unsafeHigh = completed.items.filter((item) =>
      effectiveConfidence(item) === "high" &&
      effectiveDecision(item) === "accept" &&
      (
        item.supervision?.sourceSupport !== "yes" ||
        item.supervision?.priceObserved !== "yes" ||
        item.supervision?.productMatch !== "yes" ||
        item.supervision?.componentCompleteness !== "complete"
      )
    ).length;
    results.push({
      file: path.basename(file),
      sourceRows: parsed.inventory.detectedRows,
      normalized: completed.metrics.normalized,
      interpreted: completed.metrics.interpreted,
      marketRecords: completed.items.filter((item) => item.market).length,
      supervised: completed.items.filter((item) => item.supervision).length,
      accepted: completed.metrics.accepted,
      humanReview: completed.items.filter((item) => effectiveDecision(item) === "human_review").length,
      noResult: completed.items.filter((item) => effectiveDecision(item) === "no_result").length,
      retry: completed.items.filter((item) => effectiveDecision(item) === "retry").length,
      unsafeHigh,
      providerCalls: completed.metrics.providerCalls,
      durationMs: completed.metrics.durationMs,
      sourceWarnings: parsed.inventory.warnings
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: "Prueba estructural con documentos reales y proveedor mock controlado. No mide exactitud de busqueda web.",
    contract: "caf-real-document-evaluation/v1",
    results
  };
  const outputDir = path.join(process.cwd(), ".test-reports");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "real-documents.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function makeRun(id: string, name: string, parsed: ReturnType<typeof parseDocument>, batchSize: number): AgentRun {
  return {
    contract: "caf-agent-run/v1",
    id,
    name,
    branch: 1,
    status: "draft",
    providerId: "mock",
    model: "mock-deterministic",
    batchSize,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeStage: "source",
    inventory: parsed.inventory,
    items: parsed.items.map((original) => ({ id: original.id, original, status: "imported", reviews: [] })),
    steps: [],
    events: [],
    metrics: { totalItems: parsed.items.length, normalized: 0, interpreted: 0, priced: 0, accepted: 0, pending: parsed.items.length, warnings: 0, durationMs: 0, providerCalls: 0 }
  };
}
