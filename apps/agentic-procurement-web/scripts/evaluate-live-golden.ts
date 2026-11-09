import fs from "node:fs";
import path from "node:path";
import { executeRun } from "../lib/orchestrator";
import { effectiveConfidence, effectiveDecision } from "../lib/commercial-policy";
import { saveRun } from "../lib/store";
import type { AgentItem, AgentRun, OriginalItem, ResolutionMode } from "../lib/types";

process.env.CAF_AGENT_DATA_DIR = path.join(process.cwd(), ".test-live");

type GoldenCase = {
  id: string;
  name: string;
  unit: string;
  description: string;
  expectedMode: ResolutionMode;
  expectedAutomation: "automatic" | "assisted" | "human";
  expectedOutcome: string;
};

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures", "golden-resolution-cases.json"), "utf8")) as { cases: GoldenCase[] };
  const selectedIds = new Set(
    (process.env.LIVE_GOLDEN_IDS || "direct-exact,pack-known-requirement,product-service,custom-sample")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const cases = fixture.cases.filter((entry) => selectedIds.has(entry.id));
  const items: AgentItem[] = cases.map((entry, index) => {
    const original: OriginalItem = {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      unit: entry.unit,
      quantity: 1,
      ceilingPrice: "$ 500.000",
      source: { file: "golden-live.json", row: index + 1 },
      raw: {}
    };
    return { id: entry.id, original, status: "imported", reviews: [] };
  });
  const run: AgentRun = {
    contract: "caf-agent-run/v1",
    id: `live_golden_${Date.now()}`,
    name: "Golden live Codex PC",
    branch: 1,
    status: "draft",
    providerId: "codex_pc",
    model: "codex-cli",
    batchSize: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeStage: "source",
    inventory: { fileName: "golden-live.json", extension: ".json", size: cases.length, sheets: [], parser: "golden", detectedRows: cases.length, warnings: [] },
    items,
    steps: [],
    events: [],
    metrics: { totalItems: cases.length, normalized: 0, interpreted: 0, priced: 0, accepted: 0, pending: cases.length, warnings: 0, durationMs: 0, providerCalls: 0 }
  };
  await saveRun(run);
  const completed = await executeRun(run.id);
  const rows = cases.map((expected) => {
    const item = completed.items.find((entry) => entry.id === expected.id)!;
    const actualMode = item.technical?.resolutionPlan.mode || null;
    const actualAutomation = item.technical?.resolutionPlan.automationLevel || null;
    const decision = effectiveDecision(item);
    const confidence = effectiveConfidence(item);
    const unsafeAcceptance = ["product-service", "custom-sample"].includes(item.id) &&
      ["accept", "accept_with_note"].includes(decision);
    return {
      id: item.id,
      expectedMode: expected.expectedMode,
      actualMode,
      modeMatch: actualMode === expected.expectedMode,
      expectedAutomation: expected.expectedAutomation,
      actualAutomation,
      automationMatch: actualAutomation === expected.expectedAutomation,
      decision,
      confidence,
      supplier: item.market?.supplier || "",
      price: item.market?.price ?? null,
      evidenceArtifacts: item.market?.lines.reduce((sum, line) => sum + line.evidence.length, 0) || 0,
      unsafeAcceptance
    };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    contract: "caf-live-golden-evaluation/v1",
    provider: "codex_pc",
    runId: completed.id,
    status: completed.status,
    metrics: completed.metrics,
    modeAccuracy: rows.filter((row) => row.modeMatch).length / rows.length,
    automationAccuracy: rows.filter((row) => row.automationMatch).length / rows.length,
    unsafeAcceptances: rows.filter((row) => row.unsafeAcceptance).length,
    rows
  };
  const outputDir = path.join(process.cwd(), ".test-reports");
  fs.mkdirSync(outputDir, { recursive: true });
  const selectionLabel = [...selectedIds].join("_").replace(/[^a-z0-9_-]/gi, "_");
  fs.writeFileSync(path.join(outputDir, `live-golden-codex-pc-${selectionLabel}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
