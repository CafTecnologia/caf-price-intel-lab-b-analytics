import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { StageOutput } from "@/lib/ai-pipeline";
import { buildStage3CoverageReport } from "@/lib/stage3Review";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "ai-runs.sqlite");
/** Identificador de esta app en SQLite; filas antiguas pueden seguir mostrando `financial-bridge`. */
const APP_VARIANT = "extraccion-datos-estrategicos";

type StageName = "stage1" | "stage2" | "stage3" | "stage3b" | "stage3c" | "stage2_experimental" | "stage3_google_lab" | "stage3_openai_lab";

export type Stage3ActiveResultSummary = {
  runId: string;
  result: Record<string, unknown> | null;
  raw: string | null;
  provider: string | null;
  model: string | null;
  itemCount: number;
  expectedCount: number;
  actualCount: number;
  complete: boolean;
  status: "complete" | "partial" | "failed" | "unknown";
  updatedAt: string | null;
};

export type StageSuccessSaveOutcome = {
  activeUpdated: boolean;
  preservedPrevious: boolean;
  reason?: string;
  attemptedItemCount: number;
  activeItemCount: number;
  attemptedCoverage?: Stage3StoredQuality;
  activeCoverage?: Stage3StoredQuality;
  activeStage?: Stage3ActiveResultSummary | null;
};

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

export function saveStageSuccess(stage: StageName, output: StageOutput, durationMs?: number): StageSuccessSaveOutcome {
  const db = getDb();
  upsertRun({ runId: output.runId });
  const attemptedItemCount = getItemsCount(output.result);
  insertStageAttempt(db, {
    runId: output.runId,
    stage,
    status: "ok",
    provider: (output as { provider?: string }).provider ?? null,
    model: output.model,
    durationMs: durationMs ?? null,
    itemCount: attemptedItemCount,
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
    errorCode: null,
    errorMessage: null
  });

  if (stage === "stage3") {
    const previous = db
      .prepare("SELECT * FROM run_stages WHERE run_id = ? AND stage = 'stage3' AND status = 'ok'")
      .get(output.runId) as Record<string, unknown> | undefined;
    const attemptedCoverage = getStage3StoredQuality(output.result);
    const previousCoverage = previous ? getStage3StoredQuality(parseJson(previous.result_json, null)) : null;

    if (previous && previousCoverage && shouldPreservePreviousStage3(previousCoverage, attemptedCoverage)) {
      refreshRunSummary(output.runId);
      const activeStage = normalizeActiveStage3Summary(previous, previousCoverage);
      return {
        activeUpdated: false,
        preservedPrevious: true,
        reason:
          previousCoverage.complete && !attemptedCoverage.complete
            ? "previous_complete_attempt_partial"
            : "previous_has_more_items",
        attemptedItemCount,
        activeItemCount: previousCoverage.actualCount,
        attemptedCoverage,
        activeCoverage: previousCoverage,
        activeStage
      };
    }
  }

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
    itemCount: attemptedItemCount,
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

  const activeCoverage = stage === "stage3" ? getStage3StoredQuality(output.result) : undefined;
  return {
    activeUpdated: true,
    preservedPrevious: false,
    attemptedItemCount,
    activeItemCount: attemptedItemCount,
    attemptedCoverage: activeCoverage,
    activeCoverage,
    activeStage: stage === "stage3"
      ? {
          runId: output.runId,
          result: output.result,
          raw: output.raw,
          provider: (output as { provider?: string }).provider ?? null,
          model: output.model,
          itemCount: attemptedItemCount,
          expectedCount: activeCoverage?.expectedCount ?? 0,
          actualCount: activeCoverage?.actualCount ?? attemptedItemCount,
          complete: Boolean(activeCoverage?.complete),
          status: activeCoverage?.status ?? "unknown",
          updatedAt: null
        }
      : null
  };
}

export function saveStageFailure(input: StageFailureInput) {
  const db = getDb();
  upsertRun({ runId: input.runId });
  const previous = db
    .prepare("SELECT status FROM run_stages WHERE run_id = ? AND stage = ?")
    .get(input.runId, input.stage) as { status?: string } | undefined;

  if (previous?.status === "ok") {
    refreshRunSummary(input.runId);
    return;
  }

  const callTrace = getCallTraceFromDetails(input.details);

  insertStageAttempt(db, {
    runId: input.runId,
    stage: input.stage,
    status: "failed",
    provider: null,
    model: null,
    durationMs: input.durationMs ?? null,
    itemCount: null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    thinkingTokens: null,
    totalTokens: null,
    inputUsd: null,
    cachedInputUsd: null,
    outputUsd: null,
    searchUsd: null,
    totalUsd: null,
    aiStatus: callTrace?.status ?? null,
    providerHttpCode: callTrace?.httpStatus ?? null,
    providerFinishReason: callTrace?.finishReason ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? input.errorTitle ?? null
  });

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

export function listRuns(limit = 50, options?: { includeLab?: boolean }) {
  const db = getDb();
  const includeLab = options?.includeLab === true;
  const whereClause = includeLab
    ? ""
    : `
      WHERE
        (COALESCE(r.analysis_id, '') <> '' OR COALESCE(r.file_name, '') <> '')
        AND r.run_id NOT LIKE 'lab-%'
        AND r.run_id NOT LIKE 'human-lab-%'
        AND r.run_id NOT LIKE 'stage3b-%smoke%'
      `;
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
      ${whereClause}
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

  const runRow = run as Record<string, unknown>;
  const stages = db
    .prepare("SELECT * FROM run_stages WHERE run_id = ? ORDER BY stage")
    .all(runId)
    .map((row) => normalizeStageRow(row as Record<string, unknown>));
  const usageAttempts = listUsageAttemptsForRunContext(db, runId, runRow.analysis_id, runRow.odoo_project_id);

  return {
    ...normalizeRunRow({ ...runRow, stages_json: "[]" }),
    stages,
    usageAttempts
  };
}

export function findBestStage3ResultForRunContext(input: {
  runId: string;
  stage2Result?: unknown;
}): Stage3ActiveResultSummary | null {
  const db = getDb();
  const run = db
    .prepare(
      `
      SELECT r.run_id, r.analysis_id, a.odoo_project_id
      FROM runs r
      LEFT JOIN analyses a ON a.id = r.analysis_id
      WHERE r.run_id = ?
      `
    )
    .get(input.runId) as Record<string, unknown> | undefined;
  if (!run) {
    return null;
  }

  let rows: Record<string, unknown>[];
  if (typeof run.odoo_project_id === "string" && run.odoo_project_id.trim()) {
    rows = db
      .prepare(
        `
        SELECT s.*, r.analysis_id AS analysis_id, a.odoo_project_id AS odoo_project_id
        FROM run_stages s
        JOIN runs r ON r.run_id = s.run_id
        LEFT JOIN analyses a ON a.id = r.analysis_id
        WHERE s.stage = 'stage3' AND s.status = 'ok' AND a.odoo_project_id = ?
        `
      )
      .all(run.odoo_project_id.trim()) as Record<string, unknown>[];
  } else if (typeof run.analysis_id === "string" && run.analysis_id.trim()) {
    rows = db
      .prepare(
        `
        SELECT s.*, r.analysis_id AS analysis_id, a.odoo_project_id AS odoo_project_id
        FROM run_stages s
        JOIN runs r ON r.run_id = s.run_id
        LEFT JOIN analyses a ON a.id = r.analysis_id
        WHERE s.stage = 'stage3' AND s.status = 'ok' AND r.analysis_id = ?
        `
      )
      .all(run.analysis_id.trim()) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare("SELECT * FROM run_stages WHERE run_id = ? AND stage = 'stage3' AND status = 'ok'")
      .all(input.runId) as Record<string, unknown>[];
  }

  const scored = rows
    .map((row) => {
      const result = parseJson(row.result_json, null);
      const quality = input.stage2Result
        ? getStage3QualityAgainstInput(input.stage2Result, result)
        : getStage3StoredQuality(result);
      return { row, quality };
    })
    .filter((item) => item.quality.actualCount > 0)
    .sort((a, b) => compareStage3Quality(b.quality, a.quality));

  if (!scored.length) {
    return null;
  }

  return normalizeActiveStage3Summary(scored[0].row, scored[0].quality);
}

export function refreshRunSummary(runId: string, forcedStatus?: "failed") {
  const db = getDb();
  const stages = db.prepare("SELECT * FROM run_stages WHERE run_id = ?").all(runId) as Array<
    Record<string, unknown>
  >;
  const attempts = db.prepare("SELECT * FROM run_stage_attempts WHERE run_id = ?").all(runId) as Array<
    Record<string, unknown>
  >;
  const billableRows = attempts.length ? attempts : stages;
  const totalTokens = sumNumber(billableRows, "total_tokens");
  const totalUsd = sumNumber(billableRows, "total_usd");
  const totalDurationMs = sumNumber(billableRows, "duration_ms");
  const status = forcedStatus ?? (stages.some((stage) => stage.status === "failed") ? "failed" : "running");
  const isLabRun = /^lab-|^human-lab-|^stage3b-.*smoke/i.test(runId);
  const hasOkStage = stages.some((stage) => stage.status === "ok");
  const completedStatus =
    status === "failed" ? "failed" : (isLabRun && hasOkStage) || stages.length >= 2 ? "completed" : "running";

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

    CREATE TABLE IF NOT EXISTS run_stage_attempts (
      attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );
  `);

  ensureColumn(db, "run_stages", "ai_status", "TEXT");
  ensureColumn(db, "run_stages", "provider_http_code", "INTEGER");
  ensureColumn(db, "run_stages", "provider_finish_reason", "TEXT");
  ensureColumn(db, "run_stages", "call_trace_json", "TEXT");
  backfillStageAttempts(db);

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

type StageAttemptInsert = {
  runId: string;
  stage: StageName;
  status: "ok" | "failed";
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  itemCount: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
  inputUsd: number | null;
  cachedInputUsd: number | null;
  outputUsd: number | null;
  searchUsd: number | null;
  totalUsd: number | null;
  aiStatus: string | null;
  providerHttpCode: number | null;
  providerFinishReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function insertStageAttempt(db: Database.Database, input: StageAttemptInsert) {
  db.prepare(
    `
    INSERT INTO run_stage_attempts (
      run_id, stage, status, provider, model, duration_ms, item_count,
      input_tokens, cached_input_tokens, output_tokens, thinking_tokens, total_tokens,
      input_usd, cached_input_usd, output_usd, search_usd, total_usd,
      ai_status, provider_http_code, provider_finish_reason, error_code, error_message, created_at
    )
    VALUES (
      @runId, @stage, @status, @provider, @model, @durationMs, @itemCount,
      @inputTokens, @cachedInputTokens, @outputTokens, @thinkingTokens, @totalTokens,
      @inputUsd, @cachedInputUsd, @outputUsd, @searchUsd, @totalUsd,
      @aiStatus, @providerHttpCode, @providerFinishReason, @errorCode, @errorMessage, datetime('now')
    )
    `
  ).run(input);
}

function listUsageAttemptsForRunContext(db: Database.Database, runId: string, analysisId: unknown, odooProjectId: unknown) {
  const rows =
    typeof odooProjectId === "string" && odooProjectId.trim()
      ? db
          .prepare(
            `
            SELECT a.*, r.analysis_id AS analysis_id, an.code AS analysis_code
            FROM run_stage_attempts a
            JOIN runs r ON r.run_id = a.run_id
            LEFT JOIN analyses an ON an.id = r.analysis_id
            WHERE an.odoo_project_id = ?
            ORDER BY datetime(a.created_at), a.attempt_id
            `
          )
          .all(odooProjectId.trim())
      : typeof analysisId === "string" && analysisId.trim()
        ? db
          .prepare(
            `
            SELECT a.*, r.analysis_id AS analysis_id, an.code AS analysis_code
            FROM run_stage_attempts a
            JOIN runs r ON r.run_id = a.run_id
            LEFT JOIN analyses an ON an.id = r.analysis_id
            WHERE r.analysis_id = ?
            ORDER BY datetime(a.created_at), a.attempt_id
            `
          )
          .all(analysisId.trim())
      : db
          .prepare(
            `
            SELECT a.*, r.analysis_id AS analysis_id, an.code AS analysis_code
            FROM run_stage_attempts a
            JOIN runs r ON r.run_id = a.run_id
            LEFT JOIN analyses an ON an.id = r.analysis_id
            WHERE a.run_id = ?
            ORDER BY datetime(a.created_at), a.attempt_id
            `
          )
          .all(runId);

  return rows.map((row) => normalizeAttemptRow(row as Record<string, unknown>));
}

function normalizeAttemptRow(row: Record<string, unknown>) {
  return {
    attemptId: row.attempt_id,
    runId: row.run_id,
    analysisId: row.analysis_id != null ? String(row.analysis_id) : null,
    analysisCode: row.analysis_code != null ? String(row.analysis_code) : null,
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
    createdAt: row.created_at
  };
}

function backfillStageAttempts(db: Database.Database) {
  db.prepare(
    `
    INSERT INTO run_stage_attempts (
      run_id, stage, status, provider, model, duration_ms, item_count,
      input_tokens, cached_input_tokens, output_tokens, thinking_tokens, total_tokens,
      input_usd, cached_input_usd, output_usd, search_usd, total_usd,
      ai_status, provider_http_code, provider_finish_reason, error_code, error_message, created_at
    )
    SELECT
      s.run_id, s.stage, s.status, s.provider, s.model, s.duration_ms, s.item_count,
      s.input_tokens, s.cached_input_tokens, s.output_tokens, s.thinking_tokens, s.total_tokens,
      s.input_usd, s.cached_input_usd, s.output_usd, s.search_usd, s.total_usd,
      s.ai_status, s.provider_http_code, s.provider_finish_reason, s.error_code, s.error_message, s.updated_at
    FROM run_stages s
    WHERE NOT EXISTS (
      SELECT 1 FROM run_stage_attempts a WHERE a.run_id = s.run_id
    )
    `
  ).run();

  db.prepare(
    `
    UPDATE runs
    SET
      total_tokens = COALESCE((SELECT SUM(total_tokens) FROM run_stage_attempts a WHERE a.run_id = runs.run_id), 0),
      total_usd = COALESCE((SELECT SUM(total_usd) FROM run_stage_attempts a WHERE a.run_id = runs.run_id), 0),
      total_duration_ms = COALESCE((SELECT SUM(duration_ms) FROM run_stage_attempts a WHERE a.run_id = runs.run_id), 0)
    WHERE EXISTS (SELECT 1 FROM run_stage_attempts a WHERE a.run_id = runs.run_id)
    `
  ).run();
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

type Stage3StoredQuality = {
  expectedCount: number;
  actualCount: number;
  missingCount: number;
  complete: boolean;
  status: "complete" | "partial" | "failed" | "unknown";
};

function shouldPreservePreviousStage3(previous: Stage3StoredQuality, attempted: Stage3StoredQuality) {
  return compareStage3Quality(previous, attempted) > 0;
}

function compareStage3Quality(a: Stage3StoredQuality, b: Stage3StoredQuality) {
  const completeDelta = Number(a.complete) - Number(b.complete);
  if (completeDelta !== 0) {
    return completeDelta;
  }
  const actualDelta = a.actualCount - b.actualCount;
  if (actualDelta !== 0) {
    return actualDelta;
  }
  const missingDelta = b.missingCount - a.missingCount;
  if (missingDelta !== 0) {
    return missingDelta;
  }
  return a.expectedCount - b.expectedCount;
}

function getStage3QualityAgainstInput(stage2Result: unknown, stage3Result: unknown): Stage3StoredQuality {
  const report = buildStage3CoverageReport(stage2Result, stage3Result);
  return {
    expectedCount: report.expectedCount,
    actualCount: report.actualCount,
    missingCount: report.missingKeys.length,
    complete: report.complete,
    status: report.status === "complete" ? "complete" : report.status === "partial" ? "partial" : "unknown"
  };
}

function getStage3StoredQuality(stage3Result: unknown): Stage3StoredQuality {
  const result = stage3Result && typeof stage3Result === "object" && !Array.isArray(stage3Result)
    ? (stage3Result as Record<string, unknown>)
    : {};
  const metadata = result.metadata && typeof result.metadata === "object" && !Array.isArray(result.metadata)
    ? (result.metadata as Record<string, unknown>)
    : {};
  const control = result.control_calidad && typeof result.control_calidad === "object" && !Array.isArray(result.control_calidad)
    ? (result.control_calidad as Record<string, unknown>)
    : {};
  const coverage = control.cobertura_stage3 && typeof control.cobertura_stage3 === "object" && !Array.isArray(control.cobertura_stage3)
    ? (control.cobertura_stage3 as Record<string, unknown>)
    : {};
  const actualCount = firstFiniteCount(
    metadata.app_stage3_actual_items,
    coverage.recibidos,
    getItemsCount(result)
  );
  const expectedCount = firstFiniteCount(
    metadata.app_stage3_expected_items,
    coverage.esperados,
    metadata.total_items_cotizados,
    actualCount
  );
  const missingCount = firstFiniteCount(coverage.faltantes, Math.max(0, expectedCount - actualCount));
  const statusText = String(metadata.app_stage3_coverage_status ?? coverage.estado ?? "");
  const complete = Boolean(coverage.completo) || (expectedCount > 0 && actualCount >= expectedCount && missingCount === 0);
  const status = complete ? "complete" : actualCount > 0 ? "partial" : statusText === "failed" ? "failed" : "unknown";
  return { expectedCount, actualCount, missingCount, complete, status };
}

function normalizeActiveStage3Summary(
  row: Record<string, unknown>,
  quality: Stage3StoredQuality
): Stage3ActiveResultSummary {
  return {
    runId: String(row.run_id),
    result: parseJson(row.result_json, null) as Record<string, unknown> | null,
    raw: typeof row.raw_text === "string" ? row.raw_text : null,
    provider: typeof row.provider === "string" ? row.provider : null,
    model: typeof row.model === "string" ? row.model : null,
    itemCount: typeof row.item_count === "number" ? row.item_count : quality.actualCount,
    expectedCount: quality.expectedCount,
    actualCount: quality.actualCount,
    complete: quality.complete,
    status: quality.status,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null
  };
}

function firstFiniteCount(...values: unknown[]) {
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.trunc(n));
    }
  }
  return 0;
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
