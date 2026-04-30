import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_COLUMNS, normalizeMarketAnalysisRow } from "../lib/market-analysis-schema";
import { MarketAnalysisService } from "../lib/market-analysis-service";
import { MarketAnalysisStore } from "../lib/market-analysis-store";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const cleanupPaths: string[] = [];
const originalCwd = process.cwd();

function workspace(name: string) {
  const dir = resolve(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(resolve(dir, "data", "ai-first-local"), { recursive: true });
  cleanupPaths.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

describe("market analysis export", () => {
  it("exports the same market rows that are stored in backend JSON", () => {
    const root = workspace("market-export");
    process.chdir(root);

    const row = normalizeMarketAnalysisRow({
      [MARKET_ANALYSIS_COLUMNS[0]]: "1",
      [MARKET_ANALYSIS_COLUMNS[1]]: "Taladro",
      [MARKET_ANALYSIS_COLUMNS[2]]: "Taladro percutor profesional",
      [MARKET_ANALYSIS_COLUMNS[3]]: "2 UND",
      [MARKET_ANALYSIS_COLUMNS[4]]: "Ficha abierta",
      [MARKET_ANALYSIS_COLUMNS[5]]: "Proveedor A | COP 100000",
      [MARKET_ANALYSIS_COLUMNS[6]]: "Proveedor B | COP 110000",
      [MARKET_ANALYSIS_COLUMNS[7]]: "Proveedor C | COP 120000",
      [MARKET_ANALYSIS_COLUMNS[12]]: "COP 130000",
      [MARKET_ANALYSIS_COLUMNS[14]]: "Sin alertas",
    });

    const store = new MarketAnalysisStore();
    store.save({
      runId: "run-export",
      fileName: "fixture.xlsx",
      fileType: "xlsx",
      status: "completed",
      createdAt: "2026-04-30T10:00:00.000Z",
      updatedAt: "2026-04-30T10:00:00.000Z",
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      promptVersion: "test",
      rowCount: 1,
      uploadedFilePath: "/tmp/fixture.xlsx",
      sourceSummary: "fixture",
      result: { rows: [row], warnings: ["warning demo"], provider_notes: [] },
      groundingSources: [],
      usage: null,
      errorMessage: null,
    });

    const service = new MarketAnalysisService(store);
    const jsonExport = JSON.parse(service.exportRun("run-export", "json").body.toString("utf8")) as {
      rows: Array<Record<string, string>>;
    };
    const xlsxExport = service.exportRun("run-export", "xlsx");
    const workbook = XLSX.read(xlsxExport.body, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Matriz);

    expect(jsonExport.rows).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[MARKET_ANALYSIS_COLUMNS[0]]).toBe(jsonExport.rows[0]?.[MARKET_ANALYSIS_COLUMNS[0]]);
    expect(rows[0]?.[MARKET_ANALYSIS_COLUMNS[1]]).toBe(jsonExport.rows[0]?.[MARKET_ANALYSIS_COLUMNS[1]]);
    expect(rows[0]?.[MARKET_ANALYSIS_COLUMNS[3]]).toBe(jsonExport.rows[0]?.[MARKET_ANALYSIS_COLUMNS[3]]);
    expect(rows[0]?.[MARKET_ANALYSIS_COLUMNS[12]]).toBe(jsonExport.rows[0]?.[MARKET_ANALYSIS_COLUMNS[12]]);
  });
});
