import { readFile } from "node:fs/promises";
import path from "node:path";

export type PipelineLogRow = {
  ts?: string;
  runId?: string;
  stage?: string;
  event?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  fileName?: string;
  data?: unknown;
  error?: unknown;
};

const LOG_FILE = path.join(process.cwd(), "logs", "ai-pipeline.jsonl");

export async function readPipelineLogRows(options: {
  runId: string;
  stage?: string;
  limit?: number;
}): Promise<PipelineLogRow[]> {
  const limit = clampInt(options.limit ?? 200, 1, 800);
  const runId = options.runId.trim();
  const stage = options.stage?.trim();

  if (!runId) {
    return [];
  }

  // Simple implementation: read file and filter last matches.
  // The file is capped by operational log rotation; we keep this minimal and safe.
  const raw = await readFile(LOG_FILE, "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }

  const rows: PipelineLogRow[] = [];
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parsed = safeJson(line);
    if (!parsed) continue;
    if (parsed.runId !== runId) continue;
    if (stage && parsed.stage !== stage) continue;
    rows.push(parsed);
    if (rows.length >= limit) break;
  }

  return rows.reverse();
}

function safeJson(line: string): PipelineLogRow | null {
  try {
    const parsed = JSON.parse(line) as PipelineLogRow;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function clampInt(value: number, min: number, max: number) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

