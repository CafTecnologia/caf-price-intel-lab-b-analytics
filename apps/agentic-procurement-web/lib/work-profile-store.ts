import fs from "node:fs/promises";
import path from "node:path";
import { BUILTIN_WORK_PROFILES, type WorkProfile, type WorkProfileRun } from "./work-profile-contract";
import { dataDirectory } from "./store";

const locks = new Map<string, Promise<void>>();

function profileDir() {
  return path.join(dataDirectory(), "work-profiles");
}

function runDir() {
  return path.join(dataDirectory(), "work-profile-runs");
}

function catalogDir() {
  return path.join(dataDirectory(), "document-catalog");
}

function sourceDir() {
  return path.join(dataDirectory(), "document-sources");
}

async function ensure() {
  await Promise.all([
    fs.mkdir(profileDir(), { recursive: true }),
    fs.mkdir(runDir(), { recursive: true }),
    fs.mkdir(catalogDir(), { recursive: true }),
    fs.mkdir(sourceDir(), { recursive: true })
  ]);
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function atomicWrite(target: string, value: unknown) {
  const previous = locks.get(target) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    try {
      await fs.rename(temp, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      await fs.rm(target, { force: true });
      await fs.rename(temp, target);
    }
  });
  locks.set(target, current);
  try {
    await current;
  } finally {
    if (locks.get(target) === current) locks.delete(target);
  }
}

export async function listWorkProfiles(): Promise<WorkProfile[]> {
  await ensure();
  const files = (await fs.readdir(profileDir())).filter((file) => file.endsWith(".json"));
  const custom = await Promise.all(files.map(async (file) =>
    JSON.parse(await fs.readFile(path.join(profileDir(), file), "utf8")) as WorkProfile
  ));
  const byId = new Map(BUILTIN_WORK_PROFILES.map((profile) => [profile.id, profile]));
  custom.forEach((profile) => byId.set(profile.id, profile));
  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export async function getWorkProfile(profileId: string) {
  return (await listWorkProfiles()).find((profile) => profile.id === profileId) || null;
}

export async function saveWorkProfile(input: WorkProfile, publish = false) {
  await ensure();
  const current = await getWorkProfile(input.id);
  const now = new Date().toISOString();
  const profile: WorkProfile = {
    ...input,
    contract: "caf-work-profile/v1",
    version: current ? current.version + 1 : Math.max(1, input.version || 1),
    status: publish ? "published" : "draft",
    createdAt: current?.createdAt || input.createdAt || now,
    updatedAt: now
  };
  await atomicWrite(path.join(profileDir(), `${safeName(profile.id)}.json`), profile);
  return profile;
}

export async function listWorkProfileRuns(filters: { projectId?: string; processNumber?: string } = {}): Promise<WorkProfileRun[]> {
  await ensure();
  const files = (await fs.readdir(runDir())).filter((file) => file.endsWith(".json"));
  const runs = await Promise.all(files.map(async (file) =>
    JSON.parse(await fs.readFile(path.join(runDir(), file), "utf8")) as WorkProfileRun
  ));
  const projectId = String(filters.projectId || "").trim();
  const processNumber = String(filters.processNumber || "").trim().toLowerCase();
  return runs
    .filter((run) => !projectId || String(run.project.projectId || "") === projectId)
    .filter((run) => !processNumber || String(run.project.processNumber || "").trim().toLowerCase() === processNumber)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getWorkProfileRun(runId: string) {
  await ensure();
  try {
    return JSON.parse(await fs.readFile(path.join(runDir(), `${safeName(runId)}.json`), "utf8")) as WorkProfileRun;
  } catch {
    return null;
  }
}

export async function saveWorkProfileRun(run: WorkProfileRun) {
  await ensure();
  run.updatedAt = new Date().toISOString();
  await atomicWrite(path.join(runDir(), `${safeName(run.id)}.json`), run);
  return run;
}

export async function getCachedDocumentCatalog(sourceHash: string) {
  await ensure();
  try {
    return JSON.parse(await fs.readFile(path.join(catalogDir(), `${safeName(sourceHash)}.json`), "utf8")) as WorkProfileRun["documents"][number];
  } catch {
    return null;
  }
}

export async function saveDocumentCatalog(sourceHash: string, document: WorkProfileRun["documents"][number]) {
  await ensure();
  await atomicWrite(path.join(catalogDir(), `${safeName(sourceHash)}.json`), document);
}

export async function saveDocumentSource(sourceHash: string, extension: string, buffer: Buffer) {
  await ensure();
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const target = path.join(sourceDir(), `${safeName(sourceHash)}${safeExtension}`);
  try {
    await fs.access(target);
  } catch {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, buffer);
    try { await fs.rename(temporary, target); }
    catch { await fs.rm(temporary, { force: true }); }
  }
  return target;
}

/**
 * Identidad previa a la descarga.
 *
 * El catalogo se indexa por sha256 del contenido, que solo se conoce con los
 * bytes en la mano. Drive entrega un md5 en el listado, antes de descargar.
 * Este mapa une ambos para poder preguntar "ya conoces este archivo" sin mover
 * un solo byte.
 */
function identityDir() {
  return path.join(dataDirectory(), "document-identity");
}

function identityKey(md5: string) {
  return safeName(md5.trim().toLowerCase());
}

export type DocumentIdentity = {
  md5: string;
  sourceHash: string;
  name?: string;
  size?: number;
  updatedAt: string;
};

export async function getDocumentIdentity(md5: string): Promise<DocumentIdentity | null> {
  if (!md5) return null;
  await fs.mkdir(identityDir(), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(path.join(identityDir(), `${identityKey(md5)}.json`), "utf8")) as DocumentIdentity;
  } catch {
    return null;
  }
}

export async function saveDocumentIdentity(entry: Omit<DocumentIdentity, "updatedAt">) {
  if (!entry.md5 || !entry.sourceHash) return;
  await fs.mkdir(identityDir(), { recursive: true });
  await atomicWrite(path.join(identityDir(), `${identityKey(entry.md5)}.json`), {
    ...entry,
    md5: entry.md5.trim().toLowerCase(),
    updatedAt: new Date().toISOString()
  });
}
