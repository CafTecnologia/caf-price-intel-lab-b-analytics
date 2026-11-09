import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRun } from "./types";

const writeLocks = new Map<string, Promise<void>>();

export function dataDirectory() {
  return process.env.CAF_AGENT_DATA_DIR ? path.resolve(process.env.CAF_AGENT_DATA_DIR) : path.join(process.cwd(), ".data");
}

function directories() {
  const dataDir = dataDirectory();
  return { runsDir: path.join(dataDir, "runs"), uploadsDir: path.join(dataDir, "uploads"), learningDir: path.join(dataDir, "learning") };
}

async function ensure() {
  const { runsDir, uploadsDir } = directories();
  await Promise.all([
    fs.mkdir(runsDir, { recursive: true }),
    fs.mkdir(uploadsDir, { recursive: true })
  ]);
}

function runPath(runId: string) {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(directories().runsDir, `${safe}.json`);
}

export async function listRuns(): Promise<AgentRun[]> {
  await ensure();
  const { runsDir } = directories();
  const files = (await fs.readdir(runsDir)).filter((file) => file.endsWith(".json"));
  const runs = await Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(runsDir, file), "utf8")) as AgentRun));
  return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getRun(runId: string): Promise<AgentRun | null> {
  await ensure();
  try { return JSON.parse(await fs.readFile(runPath(runId), "utf8")) as AgentRun; } catch { return null; }
}

export async function saveRun(run: AgentRun) {
  await ensure();
  const target = runPath(run.id);
  const previous = writeLocks.get(target) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    run.updatedAt = new Date().toISOString();
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(run, null, 2), "utf8");
    try {
      await replaceFile(temp, target);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  });
  writeLocks.set(target, current);
  try {
    await current;
  } finally {
    if (writeLocks.get(target) === current) writeLocks.delete(target);
  }
  return run;
}

async function replaceFile(temp: string, target: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EPERM", "EACCES", "EEXIST"].includes(code || "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  await fs.rm(target, { force: true });
  try {
    await fs.rename(temp, target);
  } catch {
    throw lastError;
  }
}

export async function saveUpload(name: string, buffer: Buffer) {
  await ensure();
  const { uploadsDir } = directories();
  const safe = `${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const target = path.join(uploadsDir, safe);
  await fs.writeFile(target, buffer);
  return target;
}

export async function resetData() {
  const { runsDir, uploadsDir, learningDir } = directories();
  await Promise.all([
    fs.rm(runsDir, { recursive: true, force: true }),
    fs.rm(uploadsDir, { recursive: true, force: true }),
    fs.rm(learningDir, { recursive: true, force: true })
  ]);
  await ensure();
}
