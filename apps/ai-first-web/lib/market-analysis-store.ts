import "server-only";

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { AI_PROVIDERS, FILE_TYPES } from "@ai-first-contracts/enums";

import { backupCorruptedJsonFile, readSanitizedJsonText } from "./local-json-file";
import { MARKET_ANALYSIS_RUN_STATUSES, type MarketAnalysisRunStatus } from "./market-analysis-quality-gate";
import { MarketAnalysisResultSchema } from "./market-analysis-schema";

const PROJECT_CODE_PATTERN = /^P\d{5}$/;

const StoredMarketAnalysisRunSchema = z
  .object({
    runId: z.string().trim().min(1),
    projectCode: z.string().trim().regex(PROJECT_CODE_PATTERN).optional(),
    odooProjectId: z.number().int().positive().nullable().optional(),
    odooProjectName: z.string().trim().nullable().optional(),
    fileName: z.string().trim().min(1),
    fileType: z.enum(FILE_TYPES),
    status: z.enum(MARKET_ANALYSIS_RUN_STATUSES),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    provider: z.enum(AI_PROVIDERS),
    model: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    rowCount: z.number().int().min(0),
    uploadedFilePath: z.string().trim().min(1),
    sourceSummary: z.string(),
    result: MarketAnalysisResultSchema,
    groundingSources: z.array(z.object({ title: z.string().nullable(), uri: z.string().nullable() })).default([]),
    usage: z
      .object({
        latencyMs: z.number().int().min(0),
        inputTokens: z.number().int().nullable(),
        outputTokens: z.number().int().nullable(),
        finishReason: z.string().nullable(),
        grounded: z.boolean(),
      })
      .nullable(),
    errorMessage: z.string().nullable(),
  })
  .strict();

type StoredMarketAnalysisRun = z.infer<typeof StoredMarketAnalysisRunSchema>;
export type MarketAnalysisRun = Omit<StoredMarketAnalysisRun, "projectCode"> & {
  projectCode: string;
};
export type { MarketAnalysisRunStatus };

type MarketAnalysisStoreData = {
  runs: MarketAnalysisRun[];
  nextProjectSequence: number;
};

function formatProjectCode(sequence: number): string {
  return `P${String(sequence).padStart(5, "0")}`;
}

function parseProjectSequence(projectCode: string | undefined): number | null {
  if (!projectCode || !PROJECT_CODE_PATTERN.test(projectCode)) {
    return null;
  }

  const parsed = Number(projectCode.slice(1));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function storePath(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "market-analysis-runs.json");
}

function normalizeStore(store: { runs: StoredMarketAnalysisRun[]; nextProjectSequence?: number }): MarketAnalysisStoreData {
  const runsByCreatedAt = store.runs
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId));

  const assignedCodes = new Map<string, string>();
  const usedSequences = new Set<number>();
  let highestSequence = 0;

  for (const run of runsByCreatedAt) {
    const sequence = parseProjectSequence(run.projectCode);
    if (sequence === null || usedSequences.has(sequence)) {
      continue;
    }

    usedSequences.add(sequence);
    assignedCodes.set(run.runId, formatProjectCode(sequence));
    highestSequence = Math.max(highestSequence, sequence);
  }

  let nextSequence = Math.max(store.nextProjectSequence ?? 1, highestSequence + 1);

  for (const run of runsByCreatedAt) {
    if (assignedCodes.has(run.runId)) {
      continue;
    }

    while (usedSequences.has(nextSequence)) {
      nextSequence += 1;
    }

    usedSequences.add(nextSequence);
    assignedCodes.set(run.runId, formatProjectCode(nextSequence));
    highestSequence = Math.max(highestSequence, nextSequence);
    nextSequence += 1;
  }

  const runs = store.runs.map((run) => ({
    ...run,
    projectCode: assignedCodes.get(run.runId) ?? formatProjectCode(1),
  }));

  return {
    runs,
    nextProjectSequence: Math.max(nextSequence, highestSequence + 1, 1),
  };
}

function readStore(): MarketAnalysisStoreData {
  const targetPath = storePath();

  if (!existsSync(targetPath)) {
    return { runs: [], nextProjectSequence: 1 };
  }

  try {
    const rawText = readSanitizedJsonText(targetPath);
    if (!rawText) {
      return { runs: [], nextProjectSequence: 1 };
    }

    const raw = JSON.parse(rawText) as {
      runs?: unknown[];
      nextProjectSequence?: unknown;
    };
    const parsed = {
      runs: Array.isArray(raw.runs)
        ? raw.runs
            .map((run) => StoredMarketAnalysisRunSchema.safeParse(run))
            .filter((result): result is { success: true; data: StoredMarketAnalysisRun } => result.success)
            .map((result) => result.data)
        : [],
      nextProjectSequence:
        typeof raw.nextProjectSequence === "number" && Number.isInteger(raw.nextProjectSequence) && raw.nextProjectSequence > 0
          ? raw.nextProjectSequence
          : undefined,
    };
    const normalized = normalizeStore(parsed);

    const shouldRewrite =
      (parsed.nextProjectSequence ?? 1) !== normalized.nextProjectSequence ||
      parsed.runs.length !== (Array.isArray(raw.runs) ? raw.runs.length : 0) ||
      parsed.runs.some((run) => run.projectCode !== normalized.runs.find((item) => item.runId === run.runId)?.projectCode);

    if (shouldRewrite) {
      writeStore(normalized);
    }

    return normalized;
  } catch {
    backupCorruptedJsonFile(targetPath);
    return { runs: [], nextProjectSequence: 1 };
  }
}

function writeStore(store: MarketAnalysisStoreData) {
  const targetPath = storePath();
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(store, null, 2), "utf8");
}

export class MarketAnalysisStore {
  save(run: Omit<MarketAnalysisRun, "projectCode"> & { projectCode?: string }): MarketAnalysisRun {
    const store = readStore();
    const existingRun = store.runs.find((existing) => existing.runId === run.runId) ?? null;
    const projectCode = run.projectCode ?? existingRun?.projectCode ?? formatProjectCode(store.nextProjectSequence);
    const filteredRuns = store.runs.filter((existing) => existing.runId !== run.runId);
    const nextProjectSequence =
      existingRun || run.projectCode ? store.nextProjectSequence : store.nextProjectSequence + 1;
    const nextStore = {
      runs: [{ ...run, projectCode }, ...filteredRuns].slice(0, 100),
      nextProjectSequence,
    };
    writeStore(nextStore);
    return { ...run, projectCode };
  }

  get(runId: string): MarketAnalysisRun | null {
    return readStore().runs.find((run) => run.runId === runId) ?? null;
  }

  list(limit = 8): MarketAnalysisRun[] {
    return readStore().runs
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }
}
