import fs from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./store";
import type { WorkProfileInputFile } from "./work-profile-documents";
import type { WorkProfileProjectContext } from "./work-profile-contract";

export type WorkProfileTestCase = {
  id: string;
  label: string;
  description: string;
  processNumber: string;
  expectedDecision: "viable" | "not_viable" | "indeterminate";
  expectedReason: string;
  contextFile: string;
  documents: Array<{ file: string; name: string; mimeType: string }>;
};

type TestCaseManifest = { contract: "caf-work-profile-test-cases/v1"; cases: WorkProfileTestCase[] };

function rootDirectory() {
  return path.join(dataDirectory(), "work-profile-test-cases");
}

export async function listWorkProfileTestCases() {
  const manifest = await readManifest();
  return Promise.all(manifest.cases.map(async (entry) => ({
    ...entry,
    ready: await filesExist(entry),
    fileCount: entry.documents.length
  })));
}

export async function loadWorkProfileTestCase(caseId: string): Promise<{
  definition: WorkProfileTestCase;
  project: WorkProfileProjectContext;
  files: WorkProfileInputFile[];
}> {
  const manifest = await readManifest();
  const definition = manifest.cases.find((entry) => entry.id === caseId);
  if (!definition) throw new Error("Caso de prueba no encontrado.");
  const project = JSON.parse(await fs.readFile(safePath(definition.contextFile), "utf8")) as WorkProfileProjectContext;
  const files = await Promise.all(definition.documents.map(async (document) => ({
    name: document.name,
    mimeType: document.mimeType,
    buffer: await fs.readFile(safePath(document.file))
  })));
  return { definition, project, files };
}

async function readManifest(): Promise<TestCaseManifest> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(rootDirectory(), "manifest.json"), "utf8")) as TestCaseManifest;
    if (value.contract !== "caf-work-profile-test-cases/v1" || !Array.isArray(value.cases)) throw new Error("Contrato invalido.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { contract: "caf-work-profile-test-cases/v1", cases: [] };
    throw error;
  }
}

async function filesExist(entry: WorkProfileTestCase) {
  try {
    await Promise.all([fs.access(safePath(entry.contextFile)), ...entry.documents.map((document) => fs.access(safePath(document.file)))]);
    return true;
  } catch { return false; }
}

function safePath(relativePath: string) {
  const root = path.resolve(rootDirectory());
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Ruta de caso de prueba no permitida.");
  return target;
}
