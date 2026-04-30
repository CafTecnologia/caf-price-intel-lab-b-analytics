import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type MarketAnalysisStageStatus = "started" | "completed" | "failed";

export type MarketAnalysisStageTrace = {
  run_id: string;
  document_name: string;
  stage_name: string;
  prompt: string | null;
  raw_response: unknown | null;
  parsed_json: unknown | null;
  status: MarketAnalysisStageStatus;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  model: string | null;
};

type TraceStore = {
  stages: MarketAnalysisStageTrace[];
};

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function tracePath(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "market-analysis-stage-traces.json");
}

function fixturesRoot(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "fixtures", "market-analysis");
}

function readTraceStore(): TraceStore {
  const targetPath = tracePath();
  if (!existsSync(targetPath)) {
    return { stages: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(targetPath, "utf8")) as Partial<TraceStore>;
    return { stages: Array.isArray(parsed.stages) ? parsed.stages : [] };
  } catch {
    return { stages: [] };
  }
}

function writeTraceStore(store: TraceStore) {
  const targetPath = tracePath();
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify({ stages: store.stages.slice(-2000) }, null, 2), "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function startMarketAnalysisStage(input: {
  runId: string;
  documentName: string;
  stageName: string;
  prompt?: string | null;
  retryCount?: number;
  model?: string | null;
}) {
  const startedAt = nowIso();

  saveMarketAnalysisStage({
    run_id: input.runId,
    document_name: input.documentName,
    stage_name: input.stageName,
    prompt: input.prompt ?? null,
    raw_response: null,
    parsed_json: null,
    status: "started",
    error_message: null,
    started_at: startedAt,
    finished_at: null,
    duration_ms: null,
    retry_count: input.retryCount ?? 0,
    model: input.model ?? null,
  });

  return startedAt;
}

export function finishMarketAnalysisStage(input: {
  runId: string;
  documentName: string;
  stageName: string;
  startedAt: string;
  prompt?: string | null;
  rawResponse?: unknown | null;
  parsedJson?: unknown | null;
  status: "completed" | "failed";
  errorMessage?: string | null;
  retryCount?: number;
  model?: string | null;
}) {
  const finishedAt = nowIso();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(input.startedAt));

  saveMarketAnalysisStage({
    run_id: input.runId,
    document_name: input.documentName,
    stage_name: input.stageName,
    prompt: input.prompt ?? null,
    raw_response: input.rawResponse ?? null,
    parsed_json: input.parsedJson ?? null,
    status: input.status,
    error_message: input.errorMessage ?? null,
    started_at: input.startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    retry_count: input.retryCount ?? 0,
    model: input.model ?? null,
  });
}

export function saveMarketAnalysisStage(stage: MarketAnalysisStageTrace) {
  const store = readTraceStore();
  store.stages.push(stage);
  writeTraceStore(store);
}

export function getMarketAnalysisStages(runId: string): MarketAnalysisStageTrace[] {
  return readTraceStore().stages.filter((stage) => stage.run_id === runId);
}

export function buildMarketAnalysisDebugReport(input: {
  runId: string;
  run: unknown | null;
}): string {
  const stages = getMarketAnalysisStages(input.runId);
  const lines = [
    `# Debug analisis Financiero - B`,
    ``,
    `run_id: ${input.runId}`,
    `generated_at: ${nowIso()}`,
    ``,
    `## Run`,
    "```json",
    JSON.stringify(input.run, null, 2),
    "```",
    ``,
    `## Etapas`,
  ];

  for (const stage of stages) {
    lines.push(
      ``,
      `### ${stage.stage_name}`,
      `status: ${stage.status}`,
      `model: ${stage.model ?? "N/D"}`,
      `retry_count: ${stage.retry_count}`,
      `started_at: ${stage.started_at}`,
      `finished_at: ${stage.finished_at ?? "N/D"}`,
      `duration_ms: ${stage.duration_ms ?? "N/D"}`,
      `error_message: ${stage.error_message ?? "N/D"}`,
      ``,
      `prompt: ${stage.prompt ? `${stage.prompt.length} chars` : "N/D"}`,
      `raw_response: ${stage.raw_response ? "capturada" : "N/D"}`,
      `parsed_json: ${stage.parsed_json ? "capturado" : "N/D"}`,
    );
  }

  if (stages.length === 0) {
    lines.push("", "No hay trazas guardadas para este run.");
  }

  return lines.join("\n");
}

export function registerMarketAnalysisFixture(input: {
  runId: string;
  documentName: string;
  uploadedFilePath: string;
  metadata: unknown;
}): string {
  const targetDir = resolve(fixturesRoot(), input.runId);
  mkdirSync(targetDir, { recursive: true });
  const targetFile = resolve(targetDir, input.documentName);
  copyFileSync(input.uploadedFilePath, targetFile);
  writeFileSync(resolve(targetDir, "metadata.json"), JSON.stringify(input.metadata, null, 2), "utf8");
  writeFileSync(
    resolve(targetDir, "debug.md"),
    buildMarketAnalysisDebugReport({ runId: input.runId, run: input.metadata }),
    "utf8",
  );
  return targetDir;
}
