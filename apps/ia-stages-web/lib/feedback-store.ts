import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type UserFeedbackRecord = {
  id: string;
  ts: string;
  runId?: string | null;
  stage?: string | null;
  analysisId?: string | null;
  analysisCode?: string | null;
  odooProjectId?: string | null;
  url?: string | null;
  userText: string;
  meta?: Record<string, unknown>;
};

const FEEDBACK_DIR = path.join(process.cwd(), "data", "user-feedback");
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, "feedback.jsonl");

export async function appendUserFeedback(input: Omit<UserFeedbackRecord, "id" | "ts">) {
  const record: UserFeedbackRecord = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...input,
    userText: input.userText.trim()
  };

  await mkdir(FEEDBACK_DIR, { recursive: true });
  await appendFile(FEEDBACK_FILE, `${JSON.stringify(record)}\n`, "utf8");
  return { id: record.id, ts: record.ts, file: FEEDBACK_FILE };
}

