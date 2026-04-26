import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import BetterSqlite3Database from "better-sqlite3";

import { OdooImportPreviewSchema } from "../../../../integrations/odoo/src/dtos";
import { DocumentResultSchema } from "../../../ai-first-contracts/src/schemas/document";
import { SourceSegmentSchema } from "../../../ai-first-contracts/src/schemas/source";
import type { OdooImportPreview } from "../../../../integrations/odoo/src/dtos";
import type { DocumentResult } from "../../../ai-first-contracts/src/schemas/document";
import type { BasicDocumentRunTrace } from "../orchestration/basic-document-orchestrator";
import type { UploadedFileInput } from "../persistence/write-model";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

interface LocalStatement {
  run(params?: Record<string, unknown>): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface LocalDatabase {
  pragma(value: string): void;
  exec(sql: string): void;
  prepare(sql: string): LocalStatement;
}

export interface LocalRunRecord {
  documentId: string;
  fileName: string;
  fileType: DocumentResult["file_type"];
  processingStatus: DocumentResult["processing_status"];
  createdAt: string;
  updatedAt: string;
  uploadedFile: UploadedFileInput;
  sourceSegments: SourceSegment[];
  document: DocumentResult;
  trace: BasicDocumentRunTrace;
  odooPreview: OdooImportPreview;
}

interface PersistedRunRow {
  document_id: string;
  file_name: string;
  file_type: string;
  processing_status: string;
  created_at: string;
  updated_at: string;
  uploaded_file_json: string;
  source_segments_json: string;
  document_json: string;
  trace_json: string;
  odoo_preview_json: string;
}

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function defaultDatabasePath(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "ai-first-local.db");
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

export class LocalRunStore {
  private readonly db: LocalDatabase;

  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new BetterSqlite3Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.ensureSchema();
  }

  private ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_document_runs (
        document_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        processing_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        uploaded_file_json TEXT NOT NULL,
        source_segments_json TEXT NOT NULL,
        document_json TEXT NOT NULL,
        trace_json TEXT NOT NULL,
        odoo_preview_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_document_runs_updated_at
      ON local_document_runs(updated_at DESC);
    `);
  }

  save(record: LocalRunRecord): void {
    const timestamp = toIsoNow();
    const current = this.get(record.documentId);
    const createdAt = current?.createdAt ?? record.createdAt ?? timestamp;

    this.db
      .prepare(
        `
          INSERT INTO local_document_runs (
            document_id,
            file_name,
            file_type,
            processing_status,
            created_at,
            updated_at,
            uploaded_file_json,
            source_segments_json,
            document_json,
            trace_json,
            odoo_preview_json
          ) VALUES (
            @document_id,
            @file_name,
            @file_type,
            @processing_status,
            @created_at,
            @updated_at,
            @uploaded_file_json,
            @source_segments_json,
            @document_json,
            @trace_json,
            @odoo_preview_json
          )
          ON CONFLICT(document_id) DO UPDATE SET
            file_name = excluded.file_name,
            file_type = excluded.file_type,
            processing_status = excluded.processing_status,
            updated_at = excluded.updated_at,
            uploaded_file_json = excluded.uploaded_file_json,
            source_segments_json = excluded.source_segments_json,
            document_json = excluded.document_json,
            trace_json = excluded.trace_json,
            odoo_preview_json = excluded.odoo_preview_json
        `,
      )
      .run({
        document_id: record.documentId,
        file_name: record.fileName,
        file_type: record.fileType,
        processing_status: record.processingStatus,
        created_at: createdAt,
        updated_at: timestamp,
        uploaded_file_json: JSON.stringify(record.uploadedFile),
        source_segments_json: JSON.stringify(record.sourceSegments),
        document_json: JSON.stringify(record.document),
        trace_json: JSON.stringify(record.trace),
        odoo_preview_json: JSON.stringify(record.odooPreview),
      });
  }

  private hydrateRow(row: PersistedRunRow): LocalRunRecord {
    const document = DocumentResultSchema.parse(parseJson(row.document_json));
    const sourceSegments = SourceSegmentSchema.array().parse(parseJson(row.source_segments_json));
    const odooPreview = OdooImportPreviewSchema.parse(parseJson(row.odoo_preview_json));

    return {
      documentId: row.document_id,
      fileName: row.file_name,
      fileType: document.file_type,
      processingStatus: document.processing_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      uploadedFile: parseJson(row.uploaded_file_json),
      sourceSegments,
      document,
      trace: parseJson(row.trace_json),
      odooPreview,
    };
  }

  get(documentId: string): LocalRunRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT
            document_id,
            file_name,
            file_type,
            processing_status,
            created_at,
            updated_at,
            uploaded_file_json,
            source_segments_json,
            document_json,
            trace_json,
            odoo_preview_json
          FROM local_document_runs
          WHERE document_id = ?
        `,
      )
      .get(documentId) as PersistedRunRow | undefined;

    if (!row) {
      return null;
    }

    try {
      return this.hydrateRow(row);
    } catch (error) {
      console.warn(`Skipping unreadable local run ${row.document_id}`, error);
      return null;
    }
  }

  list(limit = 20): LocalRunRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            document_id,
            file_name,
            file_type,
            processing_status,
            created_at,
            updated_at,
            uploaded_file_json,
            source_segments_json,
            document_json,
            trace_json,
            odoo_preview_json
          FROM local_document_runs
          ORDER BY updated_at DESC
          LIMIT ?
        `,
      )
      .all(limit) as PersistedRunRow[];

    return rows.flatMap((row) => {
      try {
        return [this.hydrateRow(row)];
      } catch (error) {
        console.warn(`Skipping unreadable local run ${row.document_id}`, error);
        return [];
      }
    });
  }
}
