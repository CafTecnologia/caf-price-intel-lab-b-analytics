import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { StageOutput } from "@/lib/ai-pipeline";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "ai-runs.sqlite");
/** Identificador de esta app en SQLite; filas antiguas pueden seguir mostrando `financial-bridge`. */
const APP_VARIANT = "extraccion-datos-estrategicos";

type StageName = "stage1" | "stage2" | "stage3";

export type RunRecordInput = {
  runId: string;
  analysisId?: string | null;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileHash?: string;
};

export type AnalysisRecord = {
  id: string;
  code: string;
  title: string | null;
  odooProjectId: string | null;
  calculationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StageFailureInput = {
  runId: string;
  stage: StageName;
  durationMs?: number;
  errorCode?: string;
  errorTitle?: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
  raw?: string;
  result?: unknown;
};

export function computeBufferHash(buffer: Buffer | Uint8Array) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function upsertRun(input: RunRecordInput) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO runs (
      run_id, created_at, updated_at, app_variant, analysis_id, file_name, file_size, file_type, file_hash, status
    )
    VALUES (
      @runId, datetime('now'), datetime('now'), @appVariant, @analysisId, @fileName, @fileSize, @fileType, @fileHash, 'running'
    )
    ON CONFLICT(run_id) DO UPDATE SET
      updated_at = datetime('now'),
      analysis_id = COALESCE(excluded.analysis_id, runs.analysis_id),
      file_name = COALESCE(excluded.file_name, runs.file_name),
      file_size = COALESCE(excluded.file_size, runs.file_size),
      file_type = COALESCE(excluded.file_type, runs.file_type),
      file_hash = COALESCE(excluded.file_hash, runs.file_hash)
    `
  ).run({
    runId: input.runId,
    appVariant: APP_VARIANT,
    analysisId: input.analysisId ?? null,
    fileName: input.fileName ?? null,
    fileSize: input.fileSize ?? null,
    fileType: input.fileType ?? null,
    fileHash: input.fileHash ?? null
  });
}

export function saveStageSuccess(stage: StageName, output: StageOutput, durationMs?: number) {
  const db = getDb();
  upsertRun({ runId: output.runId });
  db.prepare(
    `
    INSERT INTO run_stages (
      run_id, stage, status, provider, model, duration_ms, item_count,
      input_tokens, cached_input_tokens, output_tokens, thinking_tokens, total_tokens,
      input_usd, cached_input_usd, output_usd, search_usd, total_usd,
      ai_status, provider_http_code, provider_finish_reason,
      error_code, error_message, result_json, raw_text, grounding_json, call_trace_json, updated_at
    )
    VALUES (
      @runId, @stage, 'ok', @provider, @model, @durationMs, @itemCount,
      @inputTokens, @cachedInputTokens, @outputTokens, @thinkingTokens, @totalTokens,
      @inputUsd, @cachedInputUsd, @outputUsd, @searchUsd, @totalUsd,
      @aiStatus, @providerHttpCode, @providerFinishReason,
      NULL, NULL, @resultJson, @rawText, @groundingJson, @callTraceJson, datetime('now')
    )
    ON CONFLICT(run_id, stage) DO UPDATE SET
      status = excluded.status,
      provider = excluded.provider,
      model = excluded.model,
      duration_ms = excluded.duration_ms,
      item_count = excluded.item_count,
      input_tokens = excluded.input_tokens,
      cached_input_tokens = excluded.cached_input_tokens,
      output_tokens = excluded.output_tokens,
      thinking_tokens = excluded.thinking_tokens,
      total_tokens = excluded.total_tokens,
      input_usd = excluded.input_usd,
      cached_input_usd = excluded.cached_input_usd,
      output_usd = excluded.output_usd,
      search_usd = excluded.search_usd,
      total_usd = excluded.total_usd,
      ai_status = excluded.ai_status,
      provider_http_code = excluded.provider_http_code,
      provider_finish_reason = excluded.provider_finish_reason,
      error_code = NULL,
      error_message = NULL,
      result_json = excluded.result_json,
      raw_text = excluded.raw_text,
      grounding_json = excluded.grounding_json,
      call_trace_json = excluded.call_trace_json,
      updated_at = datetime('now')
    `
  ).run({
    runId: output.runId,
    stage,
    provider: (output as { provider?: string }).provider ?? null,
    model: output.model,
    durationMs: durationMs ?? null,
    itemCount: getItemsCount(output.result),
    inputTokens: output.usage?.inputTokens ?? null,
    cachedInputTokens: output.usage?.cachedInputTokens ?? null,
    outputTokens: output.usage?.outputTokens ?? null,
    thinkingTokens: output.usage?.thinkingTokens ?? null,
    totalTokens: output.usage?.totalTokens ?? null,
    inputUsd: output.cost?.inputUsd ?? null,
    cachedInputUsd: output.cost?.cachedInputUsd ?? null,
    outputUsd: output.cost?.outputUsd ?? null,
    searchUsd: output.cost?.searchUsd ?? null,
    totalUsd: output.cost?.totalUsd ?? null,
    aiStatus: (output as { callTrace?: { status?: string } }).callTrace?.status ?? null,
    providerHttpCode: (output as { callTrace?: { httpStatus?: number } }).callTrace?.httpStatus ?? null,
    providerFinishReason: (output as { callTrace?: { finishReason?: string } }).callTrace?.finishReason ?? null,
    resultJson: JSON.stringify(output.result),
    rawText: output.raw,
    groundingJson: output.groundingMetadata ? JSON.stringify(output.groundingMetadata) : null,
    callTraceJson: (output as { callTrace?: unknown }).callTrace
      ? JSON.stringify((output as { callTrace?: unknown }).callTrace)
      : null
  });

  refreshRunSummary(output.runId);
}

export function saveStageFailure(input: StageFailureInput) {
  const db = getDb();
  upsertRun({ runId: input.runId });
  const callTrace = getCallTraceFromDetails(input.details);

  db.prepare(
    `
    INSERT INTO run_stages (
      run_id, stage, status, duration_ms, ai_status, provider_http_code, provider_finish_reason,
      error_code, error_message, result_json, raw_text, call_trace_json, updated_at
    )
    VALUES (
      @runId, @stage, 'failed', @durationMs, @aiStatus, @providerHttpCode, @providerFinishReason,
      @errorCode, @errorMessage, @resultJson, @rawText, @callTraceJson, datetime('now')
    )
    ON CONFLICT(run_id, stage) DO UPDATE SET
      status = excluded.status,
      duration_ms = excluded.duration_ms,
      ai_status = excluded.ai_status,
      provider_http_code = excluded.provider_http_code,
      provider_finish_reason = excluded.provider_finish_reason,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      result_json = excluded.result_json,
      raw_text = excluded.raw_text,
      call_trace_json = excluded.call_trace_json,
      updated_at = datetime('now')
    `
  ).run({
    runId: input.runId,
    stage: input.stage,
    durationMs: input.durationMs ?? null,
    aiStatus: callTrace?.status ?? null,
    providerHttpCode: callTrace?.httpStatus ?? null,
    providerFinishReason: callTrace?.finishReason ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? input.errorTitle ?? null,
    resultJson: input.result ? JSON.stringify(input.result) : null,
    rawText: input.raw ?? null,
    callTraceJson: callTrace ? JSON.stringify(callTrace) : null
  });

  refreshRunSummary(input.runId, "failed");
}

export function listRuns(limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        r.*,
        a.code AS analysis_code,
        a.odoo_project_id AS odoo_project_id,
        a.calculation_id AS calculation_id,
        (
          SELECT json_group_array(json_object(
            'stage', s.stage,
            'status', s.status,
            'provider', s.provider,
            'model', s.model,
            'durationMs', s.duration_ms,
            'itemCount', s.item_count,
            'totalTokens', s.total_tokens,
            'totalUsd', s.total_usd,
            'aiStatus', s.ai_status,
            'providerHttpCode', s.provider_http_code,
            'providerFinishReason', s.provider_finish_reason,
            'errorCode', s.error_code,
            'errorMessage', s.error_message
          ))
          FROM run_stages s
          WHERE s.run_id = r.run_id
          ORDER BY s.stage
        ) AS stages_json
      FROM runs r
      LEFT JOIN analyses a ON a.id = r.analysis_id
      ORDER BY datetime(r.updated_at) DESC
      LIMIT ?
      `
    )
    .all(limit)
    .map((row) => normalizeRunRow(row as Record<string, unknown>));
}

export function getRun(runId: string) {
  const db = getDb();
  const run = db
    .prepare(
      `
      SELECT r.*, a.code AS analysis_code, a.odoo_project_id AS odoo_project_id, a.calculation_id AS calculation_id
      FROM runs r
      LEFT JOIN analyses a ON a.id = r.analysis_id
      WHERE r.run_id = ?
      `
    )
    .get(runId);
  if (!run) {
    return null;
  }

  const stages = db
    .prepare("SELECT * FROM run_stages WHERE run_id = ? ORDER BY stage")
    .all(runId)
    .map((row) => normalizeStageRow(row as Record<string, unknown>));

  return {
    ...normalizeRunRow({ ...(run as Record<string, unknown>), stages_json: "[]" }),
    stages
  };
}

export function refreshRunSummary(runId: string, forcedStatus?: "failed") {
  const db = getDb();
  const stages = db.prepare("SELECT * FROM run_stages WHERE run_id = ?").all(runId) as Array<
    Record<string, unknown>
  >;
  const totalTokens = sumNumber(stages, "total_tokens");
  const totalUsd = sumNumber(stages, "total_usd");
  const totalDurationMs = sumNumber(stages, "duration_ms");
  const status = forcedStatus ?? (stages.some((stage) => stage.status === "failed") ? "failed" : "running");
  const completedStatus =
    status === "failed" ? "failed" : stages.length >= 2 ? "completed" : "running";

  db.prepare(
    `
    UPDATE runs
    SET
      status = @status,
      total_tokens = @totalTokens,
      total_usd = @totalUsd,
      total_duration_ms = @totalDurationMs,
      updated_at = datetime('now')
    WHERE run_id = @runId
    `
  ).run({
    runId,
    status: completedStatus,
    totalTokens,
    totalUsd,
    totalDurationMs
  });
}

function getDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      app_variant TEXT,
      file_name TEXT,
      file_size INTEGER,
      file_type TEXT,
      file_hash TEXT,
      status TEXT NOT NULL,
      total_tokens INTEGER,
      total_usd REAL,
      total_duration_ms INTEGER,
      quality_rating TEXT,
      quality_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS run_stages (
      run_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      duration_ms INTEGER,
      item_count INTEGER,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      thinking_tokens INTEGER,
      total_tokens INTEGER,
      input_usd REAL,
      cached_input_usd REAL,
      output_usd REAL,
      search_usd REAL,
      total_usd REAL,
      ai_status TEXT,
      provider_http_code INTEGER,
      provider_finish_reason TEXT,
      error_code TEXT,
      error_message TEXT,
      result_json TEXT,
      raw_text TEXT,
      grounding_json TEXT,
      call_trace_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, stage),
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );
  `);

  ensureColumn(db, "run_stages", "ai_status", "TEXT");
  ensureColumn(db, "run_stages", "provider_http_code", "INTEGER");
  ensureColumn(db, "run_stages", "provider_finish_reason", "TEXT");
  ensureColumn(db, "run_stages", "call_trace_json", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT,
      odoo_project_id TEXT,
      calculation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "runs", "analysis_id", "TEXT");

  return db;
}

export function createAnalysis(input: { odooProjectId?: string | null; title?: string | null }): AnalysisRecord {
  const db = getDb();
  const id = randomUUID();
  const code = allocateAnalysisCode(db, input.odooProjectId ?? null);
  const title = input.title?.trim() || null;
  const odoo = input.odooProjectId?.trim() || null;

  db.prepare(
    `
    INSERT INTO analyses (id, code, title, odoo_project_id, calculation_id, created_at, updated_at)
    VALUES (@id, @code, @title, @odooProjectId, NULL, datetime('now'), datetime('now'))
    `
  ).run({ id, code, title, odooProjectId: odoo });

  return {
    id,
    code,
    title,
    odooProjectId: odoo,
    calculationId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function getAnalysisById(id: string): AnalysisRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM analyses WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return normalizeAnalysisRow(row);
}

export function listAnalyses(limit = 50, odooProjectId?: string | null) {
  const db = getDb();
  if (odooProjectId && odooProjectId.trim()) {
    return db
      .prepare(
        `
        SELECT * FROM analyses
        WHERE odoo_project_id = ?
        ORDER BY datetime(updated_at) DESC
        LIMIT ?
        `
      )
      .all(odooProjectId.trim(), limit)
      .map((row) => normalizeAnalysisRow(row as Record<string, unknown>));
  }
  return db
    .prepare(
      `
      SELECT * FROM analyses
      ORDER BY datetime(updated_at) DESC
      LIMIT ?
      `
    )
    .all(limit)
    .map((row) => normalizeAnalysisRow(row as Record<string, unknown>));
}

export function setAnalysisCalculationId(analysisId: string, calculationId: string) {
  const db = getDb();
  db.prepare(
    `
    UPDATE analyses
    SET calculation_id = @calculationId, updated_at = datetime('now')
    WHERE id = @analysisId
    `
  ).run({ analysisId, calculationId });
}

export function getRunAnalysisMeta(runId: string): { analysisId: string | null; analysisCode: string | null } {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT r.analysis_id AS analysis_id, a.code AS analysis_code
      FROM runs r
      LEFT JOIN analyses a ON a.id = r.analysis_id
      WHERE r.run_id = ?
      `
    )
    .get(runId) as { analysis_id: string | null; analysis_code: string | null } | undefined;
  return {
    analysisId: row?.analysis_id ?? null,
    analysisCode: row?.analysis_code ?? null
  };
}

function allocateAnalysisCode(db: Database.Database, odooProjectId: string | null): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (odooProjectId) {
    const key = odooProjectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "PROY";
    const row = db.prepare(`SELECT COUNT(*) AS c FROM analyses WHERE odoo_project_id = ?`).get(odooProjectId) as { c: number };
    const n = Number(row.c) + 1;
    return `PRJ-${key}-${String(n).padStart(5, "0")}`;
  }
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM analyses WHERE odoo_project_id IS NULL AND date(created_at) = date('now')`)
    .get() as { c: number };
  const n = Number(row.c) + 1;
  return `SIN-${day}-${String(n).padStart(5, "0")}`;
}

function normalizeAnalysisRow(row: Record<string, unknown>): AnalysisRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    title: row.title != null ? String(row.title) : null,
    odooProjectId: row.odoo_project_id != null ? String(row.odoo_project_id) : null,
    calculationId: row.calculation_id != null ? String(row.calculation_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function normalizeRunRow(row: Record<string, unknown>) {
  return {
    runId: row.run_id,
    analysisId: row.analysis_id != null ? String(row.analysis_id) : null,
    analysisCode: row.analysis_code != null ? String(row.analysis_code) : null,
    odooProjectId: row.odoo_project_id != null ? String(row.odoo_project_id) : null,
    calculationId: row.calculation_id != null ? String(row.calculation_id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appVariant: row.app_variant,
    fileName: row.file_name,
    fileSize: row.file_size,
    fileType: row.file_type,
    fileHash: row.file_hash,
    status: row.status,
    totalTokens: row.total_tokens,
    totalUsd: row.total_usd,
    totalDurationMs: row.total_duration_ms,
    qualityRating: row.quality_rating,
    qualityNotes: row.quality_notes,
    stages: parseJson(row.stages_json, [])
  };
}

function normalizeStageRow(row: Record<string, unknown>) {
  return {
    stage: row.stage,
    status: row.status,
    provider: row.provider,
    model: row.model,
    durationMs: row.duration_ms,
    itemCount: row.item_count,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    thinkingTokens: row.thinking_tokens,
    totalTokens: row.total_tokens,
    inputUsd: row.input_usd,
    cachedInputUsd: row.cached_input_usd,
    outputUsd: row.output_usd,
    searchUsd: row.search_usd,
    totalUsd: row.total_usd,
    aiStatus: row.ai_status,
    providerHttpCode: row.provider_http_code,
    providerFinishReason: row.provider_finish_reason,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    result: parseJson(row.result_json, null),
    raw: row.raw_text,
    groundingMetadata: parseJson(row.grounding_json, null),
    callTrace: parseJson(row.call_trace_json, null)
  };
}

function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string" || !value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sumNumber(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function getItemsCount(value: unknown) {
  if (value && typeof value === "object" && "items" in value) {
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) ? items.length : 0;
  }

  return 0;
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) {
    return;
  }

  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
}

function getCallTraceFromDetails(details: Record<string, unknown> | undefined) {
  const trace = details?.aiCallTrace;
  if (trace && typeof trace === "object" && !Array.isArray(trace)) {
    return trace as {
      status?: string;
      httpStatus?: number;
      finishReason?: string;
    };
  }

  return null;
}
