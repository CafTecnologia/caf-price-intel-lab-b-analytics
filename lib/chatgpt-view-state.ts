import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AnalysisChange } from "./chatgpt-analysis";

export type ViewFilter = "all" | "loss" | "pending" | "over_ceiling";
export type ViewSort = "item" | "utility_asc" | "utility_desc";
export type FinanceViewState = {
  calculationId: string;
  scenarioId: string | null;
  filter: ViewFilter;
  sort: ViewSort;
  selectedItemId: string | null;
  draftChanges: AnalysisChange[];
  dataUpdatedAt: string;
  version: number;
  updatedAt: string;
  expiresAt: string;
};

type StateFile = { version: 1; sessions: Record<string, FinanceViewState> };
const TTL_MS = 8 * 60 * 60 * 1000;

export class FinanceViewConflictError extends Error {
  constructor(message = "La vista cambió. Actualiza antes de continuar.") {
    super(message);
    this.name = "FinanceViewConflictError";
  }
}

function directory(): string {
  const cwd = process.cwd();
  const root = /[\\/]apps[\\/]financial-offer-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
  return resolve(root, "data", "financial-offer");
}
function filename(): string { return resolve(directory(), "chatgpt-view-state.json"); }
function actorKey(profileId: string): string { return createHash("sha256").update(profileId).digest("hex"); }
function empty(): StateFile { return { version: 1, sessions: {} }; }

async function readStateFile(): Promise<StateFile> {
  let raw: string;
  try { raw = await readFile(filename(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
  const parsed = JSON.parse(raw) as StateFile;
  if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") {
    throw new Error("El estado de la vista no está disponible.");
  }
  return parsed;
}

async function acquireLock(): Promise<() => Promise<void>> {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const lockPath = resolve(directory(), "chatgpt-view-state.lock");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const token = randomUUID();
      await handle.writeFile(token);
      return async () => {
        await handle.close();
        if ((await readFile(lockPath, "utf8").catch(() => "")) === token) await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 120_000) await unlink(lockPath).catch(() => undefined);
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  throw new Error("La vista está ocupada. Intenta de nuevo.");
}

function live(state: FinanceViewState | undefined): FinanceViewState | null {
  if (!state || Date.parse(state.expiresAt) <= Date.now()) return null;
  return state;
}

export async function readFinanceView(profileId: string): Promise<FinanceViewState | null> {
  return live((await readStateFile()).sessions[actorKey(profileId)]);
}

export async function changeFinanceView(
  profileId: string,
  expectedViewVersion: number | null,
  update: (current: FinanceViewState | null) => Omit<FinanceViewState, "version" | "updatedAt" | "expiresAt">,
): Promise<FinanceViewState> {
  const release = await acquireLock();
  try {
    const file = await readStateFile();
    const key = actorKey(profileId);
    const current = live(file.sessions[key]);
    if (expectedViewVersion !== null && current?.version !== expectedViewVersion) {
      throw new FinanceViewConflictError();
    }
    const nextValue = update(current);
    const now = new Date();
    const next: FinanceViewState = {
      ...nextValue,
      version: (current?.version ?? 0) + 1,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    };
    file.sessions[key] = next;
    for (const [id, value] of Object.entries(file.sessions)) {
      if (!live(value)) delete file.sessions[id];
    }
    const target = filename();
    const temp = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(file), { mode: 0o600, flag: "wx" });
      await chmod(temp, 0o600);
      await rename(temp, target);
      await chmod(target, 0o600);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
    return next;
  } finally {
    await release();
  }
}

export async function clearFinanceView(profileId: string): Promise<void> {
  const release = await acquireLock();
  try {
    const file = await readStateFile();
    delete file.sessions[actorKey(profileId)];
    const temp = filename() + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(file), { mode: 0o600, flag: "wx" });
      await rename(temp, filename());
      await chmod(filename(), 0o600);
    } finally { await unlink(temp).catch(() => undefined); }
  } finally { await release(); }
}
