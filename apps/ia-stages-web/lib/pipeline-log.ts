import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AiStage } from "@/lib/ai-failures";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "ai-pipeline.jsonl");
const MAX_STRING_LENGTH = 12000;

type PipelineLogEvent = {
  runId: string;
  stage: AiStage;
  event: string;
  provider?: string;
  model?: string;
  fileName?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
  error?: unknown;
};

export async function writePipelineLog(event: PipelineLogEvent) {
  const payload = {
    ts: new Date().toISOString(),
    ...event,
    data: sanitizeForLog(event.data),
    error: serializeError(event.error)
  };

  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
}

function serializeError(error: unknown) {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return sanitizeForLog({
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }

  return sanitizeForLog(error);
}

function sanitizeForLog(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (/api.?key|token|secret|password/i.test(key)) {
          return [key, "[redacted]"];
        }

        return [key, sanitizeForLog(entry)];
      })
    );
  }

  return value;
}

function truncate(value: string) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}... [truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}
