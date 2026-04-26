import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MARKET_ANALYSIS_COLUMNS, normalizeMarketAnalysisRow } from "../lib/market-analysis-schema";
import { MarketAnalysisStore } from "../lib/market-analysis-store";
import { readStoredProviderSettings } from "../lib/provider-settings";

function createWorkspace(name: string): string {
  const workspace = resolve(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(resolve(workspace, "data", "ai-first-local"), { recursive: true });
  return workspace;
}

function buildRow() {
  const emptyRow = Object.fromEntries(MARKET_ANALYSIS_COLUMNS.map((column) => [column, ""]));

  return normalizeMarketAnalysisRow({
    ...emptyRow,
    [MARKET_ANALYSIS_COLUMNS[0]]: "1",
    [MARKET_ANALYSIS_COLUMNS[1]]: "Item demo",
    [MARKET_ANALYSIS_COLUMNS[2]]: "Ficha demo",
    [MARKET_ANALYSIS_COLUMNS[3]]: "1",
    [MARKET_ANALYSIS_COLUMNS[4]]: "Ficha abierta.",
    [MARKET_ANALYSIS_COLUMNS[5]]: "N/D",
    [MARKET_ANALYSIS_COLUMNS[6]]: "N/D",
    [MARKET_ANALYSIS_COLUMNS[7]]: "N/D",
    [MARKET_ANALYSIS_COLUMNS[8]]: "100",
    [MARKET_ANALYSIS_COLUMNS[9]]: "120",
    [MARKET_ANALYSIS_COLUMNS[10]]: "110",
    [MARKET_ANALYSIS_COLUMNS[11]]: "110",
    [MARKET_ANALYSIS_COLUMNS[12]]: "130",
    [MARKET_ANALYSIS_COLUMNS[13]]: "Viable",
    [MARKET_ANALYSIS_COLUMNS[14]]: "Sin alertas.",
  });
}

function buildValidRun(runId: string, createdAt: string) {
  return {
    runId,
    fileName: "demo.xlsx",
    fileType: "xlsx" as const,
    status: "completed" as const,
    createdAt,
    updatedAt: createdAt,
    provider: "gemini" as const,
    model: "gemini-3-flash-preview",
    promptVersion: "2026-04-23.1",
    rowCount: 1,
    uploadedFilePath: `C:/tmp/${runId}.xlsx`,
    sourceSummary: "Segmentos extraidos localmente: 1",
    result: {
      rows: [buildRow()],
      warnings: [],
      provider_notes: [],
    },
    groundingSources: [],
    usage: null,
    errorMessage: null,
  };
}

const cleanupPaths: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);

  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

describe("web persistence regressions", () => {
  it("backs up a corrupted market-analysis store before replacing it with a healthy one", () => {
    const workspace = createWorkspace("web-store-corrupt");
    cleanupPaths.push(workspace);
    process.chdir(workspace);

    const storeFile = resolve(workspace, "data", "ai-first-local", "market-analysis-runs.json");
    writeFileSync(storeFile, "{ this is not valid json", "utf8");

    const store = new MarketAnalysisStore();
    const saved = store.save(buildValidRun("run-corrupt-recovery", "2026-04-23T23:31:00.000Z"));

    expect(saved.projectCode).toBe("P00001");

    const backups = readdirSync(resolve(workspace, "data", "ai-first-local")).filter((entry) =>
      entry.startsWith("market-analysis-runs.json.corrupt-"),
    );
    expect(backups).toHaveLength(1);

    const persisted = JSON.parse(readFileSync(storeFile, "utf8")) as {
      runs: Array<{ runId: string; projectCode: string }>;
      nextProjectSequence: number;
    };

    expect(persisted.runs).toHaveLength(1);
    expect(persisted.runs[0]?.runId).toBe("run-corrupt-recovery");
    expect(persisted.runs[0]?.projectCode).toBe("P00001");
    expect(persisted.nextProjectSequence).toBe(2);
  });

  it("keeps valid runs, drops invalid entries and preserves sequential project codes", () => {
    const workspace = createWorkspace("web-store-normalize");
    cleanupPaths.push(workspace);
    process.chdir(workspace);

    const storeFile = resolve(workspace, "data", "ai-first-local", "market-analysis-runs.json");
    const validRun = buildValidRun("run-existing", "2026-04-23T23:32:00.000Z");

    writeFileSync(
      storeFile,
      `\uFEFF${JSON.stringify(
        {
          runs: [
            { ...validRun, projectCode: undefined },
            { runId: "broken-entry", fileName: "" },
          ],
          nextProjectSequence: 2,
        },
        null,
        2,
      )}`,
      "utf8",
    );

    const store = new MarketAnalysisStore();
    const listed = store.list(10);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.runId).toBe("run-existing");
    expect(listed[0]?.projectCode).toBe("P00002");

    const saved = store.save(buildValidRun("run-new", "2026-04-23T23:33:00.000Z"));
    expect(saved.projectCode).toBe("P00003");

    const persisted = JSON.parse(readFileSync(storeFile, "utf8")) as {
      runs: Array<{ runId: string; projectCode: string }>;
      nextProjectSequence: number;
    };

    expect(persisted.runs.map((run) => run.runId)).toEqual(["run-new", "run-existing"]);
    expect(persisted.runs.map((run) => run.projectCode)).toEqual(["P00003", "P00002"]);
    expect(persisted.nextProjectSequence).toBe(4);
  });

  it("backs up corrupted provider settings and restores safe defaults", () => {
    const workspace = createWorkspace("provider-settings-corrupt");
    cleanupPaths.push(workspace);
    process.chdir(workspace);

    const settingsFile = resolve(workspace, "data", "ai-first-local", "provider-settings.json");
    writeFileSync(settingsFile, '{"activeProvider": "gemini",', "utf8");

    const settings = readStoredProviderSettings();
    expect(settings.activeProvider).toBe("openai");
    expect(settings.connections.openai.model).toBeTruthy();

    const backups = readdirSync(resolve(workspace, "data", "ai-first-local")).filter((entry) =>
      entry.startsWith("provider-settings.json.corrupt-"),
    );
    expect(backups).toHaveLength(1);

    const persisted = JSON.parse(readFileSync(settingsFile, "utf8")) as {
      activeProvider: string;
      connections: Record<string, { apiKey: string | null }>;
    };
    expect(persisted.activeProvider).toBe("openai");
    expect(persisted.connections.gemini.apiKey).toBeNull();
  });
});
