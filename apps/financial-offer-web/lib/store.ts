import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  mergeCalculationLinkFields,
  normalizeImportPayload,
  toCalculation,
  type FinancialOfferImportInput,
  type FinancialOfferProject,
} from "./contract";

type StoreData = {
  projects: FinancialOfferProject[];
};

type FinancialOfferProjectPatch = Omit<Partial<FinancialOfferProject>, "settings"> & {
  settings?: Partial<FinancialOfferProject["settings"]>;
};

function ensureCalculationShape(project: FinancialOfferProject): FinancialOfferProject {
  return {
    ...project,
    odooProjectId: project.odooProjectId ?? null,
    iaRunId: project.iaRunId ?? null,
    sourceAnalysisId: project.sourceAnalysisId ?? null,
  };
}

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]financial-offer-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function storePath(): string {
  return resolve(projectRoot(), "data", "financial-offer", "projects.json");
}

async function readStore(): Promise<StoreData> {
  const path = storePath();
  if (!existsSync(path)) {
    return { projects: [] };
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as StoreData;
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    return {
      projects: projects.map((p) => ensureCalculationShape(p as FinancialOfferProject)),
    };
  } catch {
    return { projects: [] };
  }
}

async function writeStore(data: StoreData) {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, path);
}

export async function listProjects(): Promise<FinancialOfferProject[]> {
  const store = await readStore();
  return store.projects.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getProject(projectId: string): Promise<FinancialOfferProject | null> {
  const store = await readStore();
  return store.projects.find((project) => project.id === projectId) ?? null;
}

export async function saveProject(projectId: string, patch: FinancialOfferProjectPatch): Promise<FinancialOfferProject | null> {
  const store = await readStore();
  const current = store.projects.find((project) => project.id === projectId);
  if (!current) {
    return null;
  }
  const updated: FinancialOfferProject = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    settings: {
      ...current.settings,
      ...(patch.settings ?? {}),
    },
    items: patch.items ?? current.items,
  };
  await writeStore({ projects: [updated, ...store.projects.filter((project) => project.id !== projectId)] });
  return updated;
}

export async function importProject(input: FinancialOfferImportInput): Promise<FinancialOfferProject> {
  const parsed = normalizeImportPayload(input);
  const store = await readStore();
  const now = new Date().toISOString();
  const sourceSystem = parsed.calculation.source_system?.trim() || null;
  const existingByExternalId = parsed.calculation.external_id
    ? store.projects.find((project) => project.externalId === parsed.calculation.external_id && project.sourceSystem === sourceSystem)
    : null;
  const id = existingByExternalId?.id ?? randomUUID();
  const base = toCalculation(parsed, id, existingByExternalId?.createdAt ?? now);
  const project = {
    ...base,
    ...mergeCalculationLinkFields(parsed.calculation, existingByExternalId),
    updatedAt: now,
  };
  const nextProjects = [project, ...store.projects.filter((current) => current.id !== id)].slice(0, 200);
  await writeStore({ projects: nextProjects });
  return project;
}

export async function createEmptyProject(input: {
  name: string;
  externalId?: string | null;
  entity?: string | null;
  odooProjectId?: string | null;
  iaRunId?: string | null;
  sourceAnalysisId?: string | null;
}): Promise<FinancialOfferProject> {
  return importProject({
    calculation: {
      external_id: input.externalId ?? null,
      source_system: "manual",
      odoo_project_id: input.odooProjectId ?? null,
      ia_run_id: input.iaRunId ?? null,
      source_analysis_id: input.sourceAnalysisId ?? null,
      name: input.name,
      entity: input.entity ?? null,
      currency: "COP",
    },
    items: [
      {
        item: "1",
        description: "Item pendiente",
        quantity: 1,
        unit: "UND",
        selected_cost_mode: "manual",
        manual_unit_cost: null,
        reference_unit: null,
        notes: "Cálculo creado para carga manual posterior.",
      },
    ],
    settings: {
      vat_rate: 19,
      default_margin: 0,
      default_cost_mode: "manual",
      usd_import_pct: 30,
    },
  });
}

export const listCalculations = listProjects;
export const getCalculation = getProject;
export const importCalculation = importProject;
export const createEmptyCalculation = createEmptyProject;
export const saveCalculation = saveProject;
