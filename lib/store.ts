import { withStoreRead } from "./store-read-queue";
import { priceBaseRestoreImpact } from "./price-base";
import "server-only";
import { createVersionedFileReader } from "./versioned-file-reader";

import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";

import {
  AUTO_CALCULATION_NAME,
  EMPTY_NOTES_DOCUMENT,
  mergeCalculationLinkFields,
  normalizeImportPayload,
  preserveAdditionalCostsOnReimport,
  toCalculation,
  type FinancialGeneralCost,
  type FinancialOfferImportInput,
  type FinancialOfferItem,
  type FinancialOfferProject,
} from "./contract";
import { inheritedRetentionPatch, type RetentionDefaults } from "./financial-defaults";
import {
  applyPriceBasePatch, capturePriceBase, capturePriceBaseOffers, restorePriceBase,
  type PriceBaseItem, type PriceBaseOfferSnapshot, type PriceBasePatch,
} from "./price-base";
import {
  CalculationOperationsSchema,
  CalculationOperationConflictError,
  applyCalculationOperationBatch,
  canonicalCalculationOperationDigest,
  deterministicOperationItemId,
  type CalculationOperationChange,
  type CalculationOperationsInput,
} from "./calculation-operations";

import {
  AnalysisChangesSchema,
  AnalysisConflictError,
  previewAnalysis,
  type AnalysisActionReceipt,
  type AnalysisActor,
  type AnalysisChange,
  type AnalysisDiffEntry,
  type FinancialAnalysisScenario,
} from "./chatgpt-analysis";

export type PriceBaseVersion = {
  id: string;
  projectId: string;
  parentId: string | null;
  createdAt: string;
  source: "initial" | "ai" | "manual" | "restore";
  restoredFromVersionId?: string;
  jobId: string | null;
  changedItemIds: string[];
  snapshot: PriceBaseItem[];
  offerSnapshots?: PriceBaseOfferSnapshot[];
  generalCosts?: FinancialGeneralCost[];
  manualReferenceTotal: number | null;
  budgetLimits?: FinancialOfferProject["settings"]["budgetLimits"];
  usdToCopRate?: number | null;
  usdImportPct?: number;
  analysisReferenceIncluded?: boolean;
  digest: string;
  stateDigest?: string;
};

type PriceBaseReceipt = { digest: string; versionId: string };

export type VersionActionReceipt = {
  operationId: string;
  projectId: string;
  scope: "price_base" | "scenario";
  action: "save" | "restore";
  targetId: string | null;
  status: "saved" | "applied" | "no_changes";
  updatedAt: string;
};

type StoredVersionActionReceipt = { digest: string; receipt: VersionActionReceipt };

export type CalculationOperationsReceipt = {
  status: "applied" | "no_changes";
  source: "ai";
  operationId: string;
  jobId: string;
  externalRunId: string;
  calculationId: string;
  baseVersionId: string;
  createdItemIds: string[];
  createdItemKeys: Array<{ itemId: string; key: string }>;
  updatedItemIds: string[];
  changes: CalculationOperationChange[];
  updatedAt: string;
};

type StoredCalculationOperationsReceipt = { digest: string; receipt: CalculationOperationsReceipt };

export type ManualCalculationChangeReceipt = {
  id: string;
  projectId: string;
  updatedAt: string;
  changes: CalculationOperationChange[];
  summary: string;
  source: "human";
};

export type CalculationDeletionReceipt = {
  operationId: string;
  calculationId: string;
  externalId: string | null;
  odooProjectId: string | null;
  iaRunId: string | null;
  sourceAnalysisId: string | null;
  deletedUpdatedAt: string;
  deletedAt: string;
};

type StoredAnalysisActionReceipt = { digest: string; receipt: AnalysisActionReceipt };

type StoreData = {
  importReceipts?: Record<string, { hash: string; projectId: string }>;
  deletionReceipts?: Record<string, CalculationDeletionReceipt>;
  priceBaseVersions?: PriceBaseVersion[];
  priceBaseReceipts?: Record<string, PriceBaseReceipt>;
  versionActionReceipts?: Record<string, StoredVersionActionReceipt>;
  calculationOperationReceipts?: Record<string, StoredCalculationOperationsReceipt>;
  analysisScenarios?: FinancialAnalysisScenario[];
  analysisActionReceipts?: Record<string, StoredAnalysisActionReceipt>;
  manualChangeReceipts?: ManualCalculationChangeReceipt[];
  projects: FinancialOfferProject[];
  scenarios: FinancialOfferScenario[];
  financialDefaults: FinancialAppDefaults;
};

export type FinancialAppDefaults = RetentionDefaults;

const DEFAULT_FINANCIAL_SETTINGS: FinancialAppDefaults = {
  applyReteFuente: true,
  reteFuenteRate: 2.5,
  reteFuenteBase: "pre_vat",
  applyReteIva: true,
  reteIvaRate: 15,
  reteIvaBase: "vat",
  applyReteIca: true,
  reteIcaRate: 0,
  reteIcaBase: "pre_vat",
};

export type FinancialOfferScenario = {
  id: string;
  projectId: string;
  name: string;
  note: string;
  createdAt: string;
  archivedAt: string | null;
  createdBy: { id: string | null; name: string } | null;
  kind?: "offer";
  snapshot: OfferScenarioSnapshot | Pick<FinancialOfferProject, "name" | "settings" | "items" | "generalCosts" | "notesDocument">;
};

type OfferScenarioItem = Pick<FinancialOfferItem, "id" | "item" | "offerMode" | "discountPct" | "profitPct" | "manualOfferUnit">;
type OfferScenarioSnapshot = {
  items: OfferScenarioItem[];
  settings: Pick<FinancialOfferProject["settings"], "defaultMargin" |
    "applyReteFuente" | "reteFuenteRate" | "reteFuenteBase" | "applyReteIva" | "reteIvaRate" |
    "reteIvaBase" | "applyReteIca" | "reteIcaRate" | "reteIcaBase" | "stampTaxRate">;
};

function captureOfferScenario(project: FinancialOfferProject): OfferScenarioSnapshot {
  const { defaultMargin, applyReteFuente, reteFuenteRate, reteFuenteBase,
    applyReteIva, reteIvaRate, reteIvaBase, applyReteIca, reteIcaRate, reteIcaBase, stampTaxRate } = project.settings;
  return structuredClone({
    items: project.items.map(({ id, item, offerMode, discountPct, profitPct, manualOfferUnit }) => ({
      id, item, offerMode, discountPct, profitPct, manualOfferUnit,
    })),
    settings: { defaultMargin, applyReteFuente, reteFuenteRate, reteFuenteBase,
      applyReteIva, reteIvaRate, reteIvaBase, applyReteIca, reteIcaRate, reteIcaBase, stampTaxRate },
  });
}

type FinancialOfferProjectPatch = Omit<Partial<FinancialOfferProject>, "settings"> & {
  settings?: Partial<FinancialOfferProject["settings"]>;
};

function ensureCalculationShape(project: FinancialOfferProject): FinancialOfferProject {
  return {
    ...project,
    readOnly: project.readOnly ?? false,
    frozenAt: project.frozenAt ?? null,
    items: (project.items ?? []).map((item) => ({
      ...item, deliverableType: item.deliverableType ?? null,
      additionalCosts: item.additionalCosts ?? [],
    })),
    generalCosts: project.generalCosts ?? [],
    odooProjectId: project.odooProjectId ?? null,
    iaRunId: project.iaRunId ?? null,
    sourceAnalysisId: project.sourceAnalysisId ?? null,
    odooCallbackUrl: project.odooCallbackUrl ?? null,
    odooReturnUrl: project.odooReturnUrl ?? null,
    odooDb: project.odooDb ?? null,
    odooProjectName: project.odooProjectName ?? null,
    odooProcessNumber: project.odooProcessNumber ?? null,
    odooEntityName: project.odooEntityName ?? null,
    odooUserId: project.odooUserId ?? null,
    odooUserName: project.odooUserName ?? null,
    notesDocument: project.notesDocument ?? EMPTY_NOTES_DOCUMENT,
    settings: {
      ...project.settings,
      manualReferenceTotal: project.settings.manualReferenceTotal ?? null,
      applyReteFuente: project.settings.applyReteFuente ?? false,
      reteFuenteRate: project.settings.reteFuenteRate ?? 2.5,
      reteFuenteBase: project.settings.reteFuenteBase ?? "pre_vat",
      applyReteIva: project.settings.applyReteIva ?? false,
      reteIvaRate: project.settings.reteIvaRate ?? 15,
      reteIvaBase: project.settings.reteIvaBase ?? "vat",
      applyReteIca: project.settings.applyReteIca ?? false,
      reteIcaRate: project.settings.reteIcaRate ?? 0,
      reteIcaBase: project.settings.reteIcaBase ?? "pre_vat",
      stampTaxRate: project.settings.stampTaxRate ?? null,
    },
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
  return withStoreRead(storePath(), readStoreFile);
}
async function readStoreFile(): Promise<StoreData> {
  const path = storePath();
  if (!existsSync(path)) {
    return { projects: [], scenarios: [], financialDefaults: DEFAULT_FINANCIAL_SETTINGS };
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as StoreData;
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    return {
      importReceipts: parsed.importReceipts ?? {},
      deletionReceipts: parsed.deletionReceipts ?? {},
      priceBaseVersions: Array.isArray(parsed.priceBaseVersions) ? parsed.priceBaseVersions : [],
      priceBaseReceipts: parsed.priceBaseReceipts ?? {},
      versionActionReceipts: parsed.versionActionReceipts ?? {},
      calculationOperationReceipts: parsed.calculationOperationReceipts ?? {},
      analysisScenarios: Array.isArray(parsed.analysisScenarios) ? parsed.analysisScenarios : [],
      analysisActionReceipts: parsed.analysisActionReceipts ?? {},
      manualChangeReceipts: Array.isArray(parsed.manualChangeReceipts) ? parsed.manualChangeReceipts : [],
      projects: projects.map((p) => ensureCalculationShape(p as FinancialOfferProject)),
      scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
      financialDefaults: { ...DEFAULT_FINANCIAL_SETTINGS, ...(parsed.financialDefaults ?? {}) },
    };
  } catch {
    throw new Error("No se pudo leer el almacenamiento financiero. Se cancela la escritura para proteger los calculos.");
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export class HistoricalReadonlyError extends Error {
  constructor() {
    super("Este cálculo pertenece al histórico comercial y es de solo lectura.");
    this.name = "HistoricalReadonlyError";
  }
}

// Next route bundles share one process snapshot instead of retaining one per route.
const sharedReaders = globalThis as typeof globalThis & {
  __cafFinancialStoreReaderV1?: ReturnType<typeof createVersionedFileReader<StoreData>>;
};
const storeReader = sharedReaders.__cafFinancialStoreReaderV1 ??=
  createVersionedFileReader<StoreData>(() => readStore());

async function writeStore(
  data: StoreData,
  readonlyTransition?: { projectId: string; readOnly: boolean },
) {
  const current = await readStore();
  for (const locked of current.projects.filter((project) => project.readOnly)) {
    if (readonlyTransition?.projectId === locked.id) continue;
    const next = data.projects.find((project) => project.id === locked.id);
    if (!next || stableJson(next) !== stableJson(locked)) {
      throw new HistoricalReadonlyError();
    }
    const currentScenarios = current.scenarios.filter((item) => item.projectId === locked.id);
    const nextScenarios = data.scenarios.filter((item) => item.projectId === locked.id);
    const currentVersions = (current.priceBaseVersions ?? []).filter((item) => item.projectId === locked.id);
    const nextVersions = (data.priceBaseVersions ?? []).filter((item) => item.projectId === locked.id);
    const currentAnalyses = (current.analysisScenarios ?? []).filter((item) => item.calculationId === locked.id);
    const nextAnalyses = (data.analysisScenarios ?? []).filter((item) => item.calculationId === locked.id);
    if (stableJson(currentScenarios) !== stableJson(nextScenarios)
        || stableJson(currentVersions) !== stableJson(nextVersions)
        || stableJson(currentAnalyses) !== stableJson(nextAnalyses)) {
      throw new HistoricalReadonlyError();
    }
  }
  if (readonlyTransition) {
    const before = current.projects.find((project) => project.id === readonlyTransition.projectId);
    const after = data.projects.find((project) => project.id === readonlyTransition.projectId);
    if (!before || !after
        || before.readOnly === readonlyTransition.readOnly
        || after.readOnly !== readonlyTransition.readOnly) {
      throw new Error("La transición de solo lectura no es válida.");
    }
  }
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, path);
  storeReader.invalidate(path);
}

export class CalculationConflictError extends Error {
  constructor(message = "El cálculo cambió en otra sesión. Recarga la página antes de guardar para no perder esos cambios.") {
    super(message);
    this.name = "CalculationConflictError";
  }
}

function versionActionDigest(input: {
  projectId: string;
  scope: VersionActionReceipt["scope"];
  action: VersionActionReceipt["action"];
  targetId: string | null;
  expectedUpdatedAt: string;
  payload?: unknown;
}): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function replayVersionAction(
  store: StoreData,
  operationId: string | undefined,
  digest: string | null,
): VersionActionReceipt | null {
  if (!operationId || !digest) return null;
  const stored = store.versionActionReceipts?.[operationId];
  if (!stored) return null;
  if (stored.digest !== digest) {
    throw new CalculationConflictError("El operationId ya fue usado con una acción de versión distinta.");
  }
  return structuredClone(stored.receipt);
}

export async function getVersionActionReceipt(
  operationId: string, projectId?: string, scope?: VersionActionReceipt["scope"],
): Promise<VersionActionReceipt | null> {
  const stored = (await readStore()).versionActionReceipts?.[operationId]?.receipt;
  if (!stored || (projectId && stored.projectId !== projectId) || (scope && stored.scope !== scope)) return null;
  return structuredClone(stored);
}

function withVersionActionReceipt(
  store: StoreData, operationId: string | undefined, digest: string | null,
  receipt: VersionActionReceipt,
): StoreData {
  if (!operationId || !digest) return store;
  return {
    ...store,
    versionActionReceipts: {
      ...store.versionActionReceipts,
      [operationId]: { digest, receipt },
    },
  };
}

let saveProjectQueue: Promise<void> = Promise.resolve();

async function acquireStoreLock(): Promise<() => Promise<void>> {
  const lockPath = `${storePath()}.write-lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(`${lockPath}/owner`, `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 600_000) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error("Otra escritura financiera mantiene ocupado el almacenamiento.");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
}

async function serializeProjectSave<T>(operation: () => Promise<T>): Promise<T> {
  const previous = saveProjectQueue;
  let release!: () => void;
  saveProjectQueue = new Promise<void>((resolveQueue) => {
    release = () => resolveQueue();
  });
  await previous;
  let releaseStoreLock: (() => Promise<void>) | null = null;
  try {
    releaseStoreLock = await acquireStoreLock();
    return await operation();
  } finally {
    if (releaseStoreLock) await releaseStoreLock();
    release();
  }
}

function nextCalculationName(projects: FinancialOfferProject[], now: string): string {
  const day = now.slice(0, 10).replace(/-/g, "");
  const prefix = `CAL-${day}`;
  const count = projects.filter((project) => project.name.startsWith(prefix)).length + 1;
  return `${prefix}-${String(count).padStart(4, "0")}`;
}

function appendCalculationNameSuffix(name: string, suffix?: string | null): string {
  const cleanSuffix = suffix?.trim();
  if (!cleanSuffix || name.endsWith(cleanSuffix)) {
    return name;
  }
  return `${name}${cleanSuffix}`;
}

function patchLinkedCalculationFields(
  current: FinancialOfferProject,
  input: {
    nameSuffix?: string | null;
    odooProjectId?: string | null;
    iaRunId?: string | null;
    sourceAnalysisId?: string | null;
    odooCallbackUrl?: string | null;
    odooReturnUrl?: string | null;
    odooDb?: string | null;
    odooProjectName?: string | null;
    odooProcessNumber?: string | null;
    odooEntityName?: string | null;
    odooUserId?: string | null;
    odooUserName?: string | null;
  },
): FinancialOfferProjectPatch {
  const patch: FinancialOfferProjectPatch = {};
  const nameWithSuffix = appendCalculationNameSuffix(current.name, input.nameSuffix);
  if (nameWithSuffix !== current.name) {
    patch.name = nameWithSuffix;
  }
  if (input.odooProjectId !== undefined && (input.odooProjectId ?? null) !== current.odooProjectId) {
    patch.odooProjectId = input.odooProjectId ?? null;
  }
  if (input.iaRunId !== undefined && (input.iaRunId ?? null) !== current.iaRunId) {
    patch.iaRunId = input.iaRunId ?? null;
  }
  if (input.sourceAnalysisId !== undefined && (input.sourceAnalysisId ?? null) !== current.sourceAnalysisId) {
    patch.sourceAnalysisId = input.sourceAnalysisId ?? null;
  }
  if (input.odooCallbackUrl !== undefined && (input.odooCallbackUrl ?? null) !== current.odooCallbackUrl) {
    patch.odooCallbackUrl = input.odooCallbackUrl ?? null;
  }
  if (input.odooReturnUrl !== undefined && (input.odooReturnUrl ?? null) !== current.odooReturnUrl) {
    patch.odooReturnUrl = input.odooReturnUrl ?? null;
  }
  if (input.odooDb !== undefined && (input.odooDb ?? null) !== current.odooDb) {
    patch.odooDb = input.odooDb ?? null;
  }
  for (const key of ["odooProjectName", "odooProcessNumber", "odooEntityName", "odooUserId", "odooUserName"] as const) {
    if (input[key] !== undefined && (input[key] ?? null) !== current[key]) {
      patch[key] = input[key] ?? null;
    }
  }
  return patch;
}

export async function listProjects(): Promise<FinancialOfferProject[]> {
  return storeReader.select(storePath(), store =>
    store.projects.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

export async function getProject(projectId: string): Promise<FinancialOfferProject | null> {
  return storeReader.select(storePath(), store =>
    store.projects.find((project) => project.id === projectId) ?? null);
}

export async function getAnalysisWorkspaceSnapshot(projectId: string): Promise<{
  project: FinancialOfferProject | null;
  scenarios: FinancialAnalysisScenario[];
}> {
  return storeReader.select(storePath(), store => ({
    project: store.projects.find((project) => project.id === projectId) ?? null,
    scenarios: (store.analysisScenarios ?? [])
      .filter((scenario) => scenario.calculationId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  }));
}

export async function assertCalculationMutable(projectId: string): Promise<FinancialOfferProject | null> {
  const calculation = await getProject(projectId);
  if (calculation?.readOnly) throw new HistoricalReadonlyError();
  return calculation;
}

function priceBaseDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type PriceBasePricingSettings = Pick<FinancialOfferProject["settings"], "usdToCopRate" | "usdImportPct" | "analysisReferenceIncluded" | "budgetLimits">;

function priceBasePricingSettings(settings: FinancialOfferProject["settings"]): PriceBasePricingSettings {
  return { budgetLimits: structuredClone(settings.budgetLimits ?? []), usdToCopRate: settings.usdToCopRate, usdImportPct: settings.usdImportPct,
    analysisReferenceIncluded: settings.analysisReferenceIncluded ?? true };
}

function priceBaseStateDigest(
  snapshot: PriceBaseItem[], manualReferenceTotal: number | null, generalCosts: FinancialGeneralCost[],
  pricing?: PriceBasePricingSettings,
): string {
  const { budgetLimits, ...rest } = pricing ?? {};
  return priceBaseDigest({ items: snapshot, manualReferenceTotal, generalCosts, ...(budgetLimits?.length ? { budgetLimits } : {}), ...rest });
}

export function currentPriceBaseStateDigest(calculation: FinancialOfferProject): string {
  return priceBaseStateDigest(capturePriceBase(calculation.items), calculation.settings.manualReferenceTotal,
    calculation.generalCosts, priceBasePricingSettings(calculation.settings));
}

function priceBaseDisplayDigest(snapshot: PriceBaseItem[], manualReferenceTotal: number | null): string {
  return priceBaseDigest({ items: snapshot, manualReferenceTotal });
}

function changedPriceBaseItemIds(next: PriceBaseItem[], previous: PriceBaseItem[]): string[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextIds = new Set(next.map((item) => item.id));
  return [
    ...next.filter((item) => JSON.stringify(item) !== JSON.stringify(previousById.get(item.id))).map((item) => item.id),
    ...previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id),
  ];
}

function storedPriceBaseStateDigest(version: PriceBaseVersion): string {
  return version.stateDigest ?? priceBaseStateDigest(
    version.snapshot,
    version.manualReferenceTotal,
    version.generalCosts ?? [],
    version.usdToCopRate === undefined || version.usdImportPct === undefined
      ? undefined : { usdToCopRate: version.usdToCopRate, usdImportPct: version.usdImportPct },
  );
}

const RETAINED_OFFER_FIELDS = [
  "offerMode", "discountPct", "profitPct", "manualOfferUnit",
  "vatMode", "vatRate", "source1", "source2", "source3",
] as const satisfies readonly (keyof PriceBaseOfferSnapshot)[];

function offerSnapshotFromStoredItem(value: unknown): PriceBaseOfferSnapshot | null {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") return null;
  const item = value as FinancialOfferItem;
  if (!Object.hasOwn(item, "offerMode") || !Object.hasOwn(item, "vatMode")) return null;
  return capturePriceBaseOffers([item])[0] ?? null;
}

function retainedPriceBaseOffers(
  store: StoreData,
  projectId: string,
  current: FinancialOfferProject,
): PriceBaseOfferSnapshot[] {
  const retained = new Map<string, PriceBaseOfferSnapshot>();
  const events = [
    ...(store.priceBaseVersions ?? [])
      .filter((version) => version.projectId === projectId && version.offerSnapshots?.length)
      .map((version) => ({ at: version.createdAt, version })),
    ...(store.manualChangeReceipts ?? [])
      .filter((receipt) => receipt.projectId === projectId)
      .map((receipt) => ({ at: receipt.updatedAt, receipt })),
  ].sort((left, right) => left.at.localeCompare(right.at));
  for (const event of events) {
    if ("version" in event) {
      for (const offer of event.version.offerSnapshots ?? []) retained.set(offer.id, structuredClone(offer));
      continue;
    }
    for (const change of event.receipt.changes) {
      const full = offerSnapshotFromStoredItem(change.after) ?? offerSnapshotFromStoredItem(change.before);
      if (full) {
        retained.set(full.id, full);
        continue;
      }
      const existing = retained.get(change.itemId);
      if (existing && RETAINED_OFFER_FIELDS.includes(change.field as typeof RETAINED_OFFER_FIELDS[number])) {
        retained.set(change.itemId, {
          ...existing,
          [change.field]: structuredClone(change.after),
        });
      }
    }
  }
  for (const offer of capturePriceBaseOffers(current.items)) retained.set(offer.id, offer);
  return [...retained.values()];
}

// Keep the calculation and its history on the same fresh disk snapshot.
// This is a query only; mutation paths continue to load under their own lock.
export async function getProjectPriceBaseState(projectId: string): Promise<{
  project: FinancialOfferProject; versions: PriceBaseVersion[];
} | null> {
  return storeReader.select(storePath(), store => {
    const project = store.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    return { project, versions: (store.priceBaseVersions ?? [])
      .filter((version) => version.projectId === projectId).reverse() };
  });
}

export async function listPriceBaseVersions(projectId: string): Promise<PriceBaseVersion[]> {
  return storeReader.select(storePath(), store =>
    (store.priceBaseVersions ?? []).filter((version) => version.projectId === projectId).reverse());
}

export async function saveManualPriceBaseVersion(
  projectId: string, expectedUpdatedAt: string, operationId?: string,
): Promise<{ status: "saved" | "no_changes"; project: FinancialOfferProject; version: PriceBaseVersion } | null> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const actionDigest = operationId ? versionActionDigest({
      projectId, scope: "price_base", action: "save", targetId: null, expectedUpdatedAt,
    }) : null;
    const replay = replayVersionAction(store, operationId, actionDigest);
    if (replay) {
      const project = store.projects.find((entry) => entry.id === projectId);
      const version = store.priceBaseVersions?.find((entry) => entry.id === replay.targetId);
      if (!project || !version) return null;
      return { status: replay.status === "saved" ? "saved" : "no_changes", project, version };
    }
    const project = store.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    if (project.updatedAt !== expectedUpdatedAt) throw new CalculationConflictError();
    const snapshot = capturePriceBase(project.items);
    const manualReferenceTotal = project.settings.manualReferenceTotal;
    const generalCosts = structuredClone(project.generalCosts);
    const stateDigest = priceBaseStateDigest(snapshot, manualReferenceTotal, generalCosts, priceBasePricingSettings(project.settings));
    const latest = (store.priceBaseVersions ?? []).filter((entry) => entry.projectId === projectId).at(-1);
    if (latest && storedPriceBaseStateDigest(latest) === stateDigest) {
      const receipt: VersionActionReceipt = {
        operationId: operationId ?? "", projectId, scope: "price_base", action: "save",
        targetId: latest.id, status: "no_changes", updatedAt: project.updatedAt,
      };
      if (operationId) await writeStore(withVersionActionReceipt(store, operationId, actionDigest, receipt));
      return { status: "no_changes", project, version: latest };
    }
    const previous = latest?.snapshot ?? [];
    const version: PriceBaseVersion = {
      id: randomUUID(), projectId, parentId: latest?.id ?? null,
      createdAt: new Date().toISOString(), source: "manual", jobId: null,
      changedItemIds: changedPriceBaseItemIds(snapshot, previous),
      snapshot, offerSnapshots: capturePriceBaseOffers(project.items), generalCosts, manualReferenceTotal,
      ...priceBasePricingSettings(project.settings),
      digest: priceBaseDisplayDigest(snapshot, manualReferenceTotal), stateDigest,
    };
    const receipt: VersionActionReceipt = {
      operationId: operationId ?? "", projectId, scope: "price_base", action: "save",
      targetId: version.id, status: "saved", updatedAt: project.updatedAt,
    };
    await writeStore(withVersionActionReceipt({
      ...store, priceBaseVersions: [...(store.priceBaseVersions ?? []), version],
    }, operationId, actionDigest, receipt));
    return { status: "saved", project, version };
  });
}

function nextUpdatedAt(previous: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) && now <= previousTime ? previousTime + 1 : now).toISOString();
}

// A receipt lookup must not reload the whole store for a manual fallback.
export async function getCalculationReceipt(
  id: string,
): Promise<CalculationOperationsReceipt | ManualCalculationChangeReceipt | null> {
  const store = await readStore();
  const operation = store.calculationOperationReceipts?.[id];
  if (operation) return { ...structuredClone(operation.receipt),
    createdItemKeys: structuredClone(operation.receipt.createdItemKeys ?? []) };
  const manual = store.manualChangeReceipts?.find((entry) => entry.id === id);
  return manual ? structuredClone(manual) : null;
}

export async function getCalculationOperationReceipt(
  operationId: string,
): Promise<CalculationOperationsReceipt | null> {
  const stored = (await readStore()).calculationOperationReceipts?.[operationId];
  return stored ? { ...structuredClone(stored.receipt), createdItemKeys: structuredClone(stored.receipt.createdItemKeys ?? []) } : null;
}

export async function listCalculationOperationReceiptsByJob(
  jobId: string,
): Promise<CalculationOperationsReceipt[]> {
  const receipts = Object.values((await readStore()).calculationOperationReceipts ?? {})
    .map((entry) => ({ ...entry.receipt, createdItemKeys: entry.receipt.createdItemKeys ?? [] }))
    .filter((receipt) => receipt.jobId === jobId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  return structuredClone(receipts);
}

export async function getCalculationItemDocumentKeys(projectId: string): Promise<Record<string, string>> {
  const receipts = Object.values((await readStore()).calculationOperationReceipts ?? {})
    .map((entry) => entry.receipt)
    .filter((receipt) => receipt.calculationId === projectId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  return Object.fromEntries(receipts.flatMap((receipt) =>
    (receipt.createdItemKeys ?? []).map(({ itemId, key }) => [itemId, key]),
  ));
}

export async function applyCalculationOperations(
  rawInput: CalculationOperationsInput,
): Promise<CalculationOperationsReceipt | null> {
  const input = CalculationOperationsSchema.parse(rawInput);
  return serializeProjectSave(async () => {
    const store = await readStore();
    const digest = canonicalCalculationOperationDigest(input);
    const storedReceipt = store.calculationOperationReceipts?.[input.operationId];
    if (storedReceipt) {
      if (storedReceipt.digest !== digest) {
        throw new CalculationOperationConflictError(
          "El operationId ya fue usado con un payload distinto.", null, "operationId",
        );
      }
      return { ...structuredClone(storedReceipt.receipt), createdItemKeys: structuredClone(storedReceipt.receipt.createdItemKeys ?? []) };
    }

    const current = store.projects.find((project) => project.id === input.projectId);
    if (!current) return null;
    if (!current.odooProjectId || current.odooProjectId !== input.odooProjectId) {
      throw new CalculationOperationConflictError("El vínculo de Odoo no coincide con el cálculo.", null, "odooProjectId");
    }
    if (!current.externalId || current.externalId !== input.externalRunId) {
      throw new CalculationOperationConflictError("La corrida externa no coincide con el cálculo.", null, "externalRunId");
    }

    // expectedUpdatedAt identifies the base read. A later unrelated save is safe when
    // every field-level expected value still matches; the engine below enforces that.
    const applied = applyCalculationOperationBatch(current, input);
    const createdItemIds = new Set(applied.createdItemIds);
    const createdItemKeys = input.operations.flatMap((operation) => {
      if (operation.type !== "add_item") return [];
      const itemId = deterministicOperationItemId(input.projectId, operation.key);
      if (!createdItemIds.delete(itemId)) return [];
      return [{ itemId, key: operation.key }];
    });
    const changed = applied.changes.length > 0;
    const now = changed ? nextUpdatedAt(current.updatedAt) : current.updatedAt;
    const project = changed ? { ...applied.project, updatedAt: now } : current;
    const before = capturePriceBase(current.items);
    const after = capturePriceBase(project.items);
    const beforeGeneralCosts = structuredClone(current.generalCosts);
    const afterGeneralCosts = structuredClone(project.generalCosts);
    const beforeManualReferenceTotal = current.settings.manualReferenceTotal;
    const afterManualReferenceTotal = project.settings.manualReferenceTotal;
    const existing = (store.priceBaseVersions ?? []).filter((entry) => entry.projectId === input.projectId);
    const latest = existing.at(-1) ?? null;
    const newVersions: PriceBaseVersion[] = [];
    let parentId = latest?.id ?? null;
    const beforeDigest = priceBaseStateDigest(before, beforeManualReferenceTotal, beforeGeneralCosts, priceBasePricingSettings(current.settings));
    if (!latest || storedPriceBaseStateDigest(latest) !== beforeDigest) {
      const checkpoint: PriceBaseVersion = {
        id: randomUUID(), projectId: input.projectId, parentId, createdAt: now,
        source: latest ? "manual" : "initial", jobId: null, changedItemIds: [],
        snapshot: before, offerSnapshots: capturePriceBaseOffers(current.items),
        generalCosts: beforeGeneralCosts, manualReferenceTotal: beforeManualReferenceTotal,
        ...priceBasePricingSettings(current.settings),
        digest: priceBaseDisplayDigest(before, beforeManualReferenceTotal), stateDigest: beforeDigest,
      };
      newVersions.push(checkpoint);
      parentId = checkpoint.id;
    }
    let version = newVersions.at(-1) ?? latest;
    if (changed) {
      version = {
        id: randomUUID(), projectId: input.projectId, parentId, createdAt: now,
        source: "ai", jobId: input.jobId,
        changedItemIds: [...new Set([...applied.createdItemIds, ...applied.updatedItemIds])],
        snapshot: after, offerSnapshots: capturePriceBaseOffers(project.items),
        generalCosts: afterGeneralCosts, manualReferenceTotal: afterManualReferenceTotal,
        ...priceBasePricingSettings(project.settings),
        digest: priceBaseDisplayDigest(after, afterManualReferenceTotal),
        stateDigest: priceBaseStateDigest(after, afterManualReferenceTotal, afterGeneralCosts, priceBasePricingSettings(project.settings)),
      };
      newVersions.push(version);
    }
    if (!version) throw new Error("No se pudo crear la versión de base para la operación.");

    const receipt: CalculationOperationsReceipt = {
      status: changed ? "applied" : "no_changes",
      source: "ai",
      operationId: input.operationId,
      jobId: input.jobId,
      externalRunId: input.externalRunId,
      calculationId: input.projectId,
      baseVersionId: version.id,
      createdItemIds: applied.createdItemIds,
      createdItemKeys,
      updatedItemIds: applied.updatedItemIds,
      changes: applied.changes,
      updatedAt: project.updatedAt,
    };
    await writeStore({
      ...store,
      projects: changed
        ? [project, ...store.projects.filter((entry) => entry.id !== input.projectId)]
        : store.projects,
      priceBaseVersions: [...(store.priceBaseVersions ?? []), ...newVersions],
      calculationOperationReceipts: {
        ...store.calculationOperationReceipts,
        [input.operationId]: { digest, receipt },
      },
    });
    return receipt;
  });
}

export type ApplyPriceBaseInput = {
  projectId: string;
  odooProjectId: string;
  jobId: string;
  expectedUpdatedAt: string;
  items: PriceBasePatch[];
};

export type ApplyPriceBaseResult = {
  status: "applied" | "already_applied" | "no_changes";
  project: FinancialOfferProject;
  version: PriceBaseVersion;
};

export async function applyPriceBaseRevision(input: ApplyPriceBaseInput): Promise<ApplyPriceBaseResult | null> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const current = store.projects.find((project) => project.id === input.projectId);
    if (!current) return null;
    if (!current.odooProjectId || current.odooProjectId !== input.odooProjectId) {
      throw new Error("El vínculo de Odoo no coincide con el cálculo.");
    }
    const receiptKey = JSON.stringify([input.projectId, input.jobId]);
    const digest = priceBaseDigest(input.items);
    const receipt = store.priceBaseReceipts?.[receiptKey];
    if (receipt) {
      if (receipt.digest !== digest) throw new Error("La misma corrida ya se aplicó con otros precios.");
      const version = store.priceBaseVersions?.find((entry) => entry.id === receipt.versionId);
      if (!version) throw new Error("Falta la versión de precios aplicada previamente.");
      return { status: "already_applied", project: current, version };
    }
    if (current.updatedAt !== input.expectedUpdatedAt) throw new CalculationConflictError();
    const updatedItems = applyPriceBasePatch(current.items, input.items);
    const before = capturePriceBase(current.items);
    const after = capturePriceBase(updatedItems);
    const generalCosts = structuredClone(current.generalCosts);
    const manualReferenceTotal = current.settings.manualReferenceTotal;
    const existing = (store.priceBaseVersions ?? []).filter((entry) => entry.projectId === input.projectId);
    const latest = existing.at(-1) ?? null;
    const now = new Date().toISOString();
    const newVersions: PriceBaseVersion[] = [];
    let parentId = latest?.id ?? null;
    if (!latest || storedPriceBaseStateDigest(latest) !== priceBaseStateDigest(before, manualReferenceTotal, generalCosts, priceBasePricingSettings(current.settings))) {
      const checkpoint: PriceBaseVersion = {
        id: randomUUID(), projectId: input.projectId, parentId, createdAt: now,
        source: latest ? "manual" : "initial", jobId: null, changedItemIds: [],
        snapshot: before, offerSnapshots: capturePriceBaseOffers(current.items), generalCosts, manualReferenceTotal,
        ...priceBasePricingSettings(current.settings),
        digest: priceBaseDisplayDigest(before, manualReferenceTotal),
        stateDigest: priceBaseStateDigest(before, manualReferenceTotal, generalCosts, priceBasePricingSettings(current.settings)),
      };
      newVersions.push(checkpoint);
      parentId = checkpoint.id;
    }
    const changedItemIds = changedPriceBaseItemIds(after, before);
    const version = changedItemIds.length ? {
      id: randomUUID(), projectId: input.projectId, parentId, createdAt: now,
      source: "ai" as const, jobId: input.jobId, changedItemIds,
      snapshot: after, offerSnapshots: capturePriceBaseOffers(updatedItems), generalCosts, manualReferenceTotal,
      ...priceBasePricingSettings(current.settings),
      digest: priceBaseDisplayDigest(after, manualReferenceTotal),
      stateDigest: priceBaseStateDigest(after, manualReferenceTotal, generalCosts, priceBasePricingSettings(current.settings)),
    } : (newVersions.at(-1) ?? latest)!;
    if (changedItemIds.length) newVersions.push(version);
    const project = changedItemIds.length ? { ...current, items: updatedItems, updatedAt: now } : current;
    await writeStore({
      ...store,
      projects: changedItemIds.length
        ? [project, ...store.projects.filter((entry) => entry.id !== input.projectId)]
        : store.projects,
      priceBaseVersions: [...(store.priceBaseVersions ?? []), ...newVersions],
      priceBaseReceipts: {
        ...store.priceBaseReceipts,
        [receiptKey]: { digest, versionId: version.id },
      },
    });
    return { status: changedItemIds.length ? "applied" : "no_changes", project, version };
  });
}

export async function restorePriceBaseVersion(
  projectId: string, versionId: string, expectedUpdatedAt: string, operationId?: string, allowCostLoss = false,
): Promise<ApplyPriceBaseResult | null> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const actionDigest = operationId ? versionActionDigest({
      projectId, scope: "price_base", action: "restore", targetId: versionId, expectedUpdatedAt,
    }) : null;
    const replay = replayVersionAction(store, operationId, actionDigest);
    if (replay) {
      const project = store.projects.find((entry) => entry.id === projectId);
      const version = store.priceBaseVersions?.find((entry) => entry.id === replay.targetId);
      if (!project || !version) return null;
      return { status: replay.status === "no_changes" ? "no_changes" : "applied", project, version };
    }
    const current = store.projects.find((entry) => entry.id === projectId);
    if (!current) return null;
    if (current.updatedAt !== expectedUpdatedAt) throw new CalculationConflictError();
    const target = store.priceBaseVersions?.find((entry) => entry.id === versionId && entry.projectId === projectId);
    if (!target) throw new Error("Versión de precios no encontrada.");
    const items = restorePriceBase(
      current.items,
      target.snapshot,
      retainedPriceBaseOffers(store, projectId, current),
      current.settings.vatRate,
    );
    const impact = priceBaseRestoreImpact(current.items, items);
    if (!allowCostLoss && (impact.lostPricedItemIds.length || impact.removedItemIds.length)) {
      throw new Error(`Esta restauración quitaría ${impact.lostPricedItemIds.length} costos y ${impact.removedItemIds.length} filas. Revisa el historial y confirma expresamente antes de aplicarla.`);
    }
    const snapshot = capturePriceBase(items);
    const generalCosts = target.generalCosts === undefined
      ? structuredClone(current.generalCosts)
      : structuredClone(target.generalCosts);
    const manualReferenceTotal = target.manualReferenceTotal === undefined
      ? current.settings.manualReferenceTotal : target.manualReferenceTotal;
    const restoredPricing: PriceBasePricingSettings = {
      budgetLimits: structuredClone(target.budgetLimits ?? current.settings.budgetLimits ?? []),
      usdToCopRate: target.usdToCopRate === undefined ? current.settings.usdToCopRate : target.usdToCopRate,
      usdImportPct: target.usdImportPct === undefined ? current.settings.usdImportPct : target.usdImportPct,
      analysisReferenceIncluded: target.analysisReferenceIncluded === undefined
        ? current.settings.analysisReferenceIncluded : target.analysisReferenceIncluded,
    };
    const latest = (store.priceBaseVersions ?? []).filter((entry) => entry.projectId === projectId).at(-1);
    const before = capturePriceBase(current.items);
    const beforeGeneralCosts = structuredClone(current.generalCosts);
    const beforeDigest = priceBaseStateDigest(before, current.settings.manualReferenceTotal, beforeGeneralCosts, priceBasePricingSettings(current.settings));
    const selectedId = latest?.source === "restore" ? latest.restoredFromVersionId ?? latest.id : latest?.id;
    if (priceBaseStateDigest(snapshot, manualReferenceTotal, generalCosts, restoredPricing) === beforeDigest && selectedId === target.id) {
      const version = latest ?? target;
      const receipt: VersionActionReceipt = {
        operationId: operationId ?? "", projectId, scope: "price_base", action: "restore",
        targetId: version.id, status: "no_changes", updatedAt: current.updatedAt,
      };
      if (operationId) await writeStore(withVersionActionReceipt(store, operationId, actionDigest, receipt));
      return { status: "no_changes", project: current, version };
    }
    const now = nextUpdatedAt(current.updatedAt);
    const checkpoints: PriceBaseVersion[] = [];
    let parentId = latest?.id ?? null;
    if (!latest || storedPriceBaseStateDigest(latest) !== beforeDigest) {
      const checkpoint: PriceBaseVersion = {
        id: randomUUID(), projectId, parentId, createdAt: now,
        source: "manual", jobId: null,
        changedItemIds: changedPriceBaseItemIds(before, latest?.snapshot ?? []),
        snapshot: before, offerSnapshots: capturePriceBaseOffers(current.items), generalCosts: beforeGeneralCosts,
        manualReferenceTotal: current.settings.manualReferenceTotal,
        ...priceBasePricingSettings(current.settings),
        digest: priceBaseDisplayDigest(before, current.settings.manualReferenceTotal), stateDigest: beforeDigest,
      };
      checkpoints.push(checkpoint);
      parentId = checkpoint.id;
    }
    const version: PriceBaseVersion = {
      id: randomUUID(), projectId, parentId, createdAt: now,
      source: "restore", jobId: null, restoredFromVersionId: target.id,
      changedItemIds: changedPriceBaseItemIds(snapshot, before),
      snapshot, offerSnapshots: capturePriceBaseOffers(items), generalCosts, manualReferenceTotal,
      ...restoredPricing,
      digest: priceBaseDisplayDigest(snapshot, manualReferenceTotal),
      stateDigest: priceBaseStateDigest(snapshot, manualReferenceTotal, generalCosts, restoredPricing),
    };
    const project = {
      ...current, items, generalCosts, updatedAt: now,
      settings: { ...current.settings, manualReferenceTotal, ...restoredPricing },
    };
    const receipt: VersionActionReceipt = {
      operationId: operationId ?? "", projectId, scope: "price_base", action: "restore",
      targetId: version.id, status: "applied", updatedAt: project.updatedAt,
    };
    await writeStore(withVersionActionReceipt({
      ...store,
      projects: [project, ...store.projects.filter((entry) => entry.id !== projectId)],
      priceBaseVersions: [...(store.priceBaseVersions ?? []), ...checkpoints, version],
    }, operationId, actionDigest, receipt));
    return { status: "applied", project, version };
  });
}

const HUMAN_ITEM_FIELDS = [
  "item", "description", "technicalDescription", "sourceOriginal", "procurementLot", "technicalAnnex", "costBasisStatus", "deliverableType", "quantity", "unit", "referenceUnit",
  "manualUnitCost", "manualCostAssumption", "selectedCostMode", "selectedPriceSourceId", "costScenarioMode",
  "costScenarioDiscountPct", "priceSources", "additionalCosts", "offerMode", "discountPct",
  "profitPct", "manualOfferUnit", "offerAdjustment", "vatMode", "vatRate", "notes",
  "analysisExcludedPriceSourceIds", "analysisCostStatistic", "analysisReferenceIncluded",
] as const satisfies readonly (keyof FinancialOfferItem)[];

function sameStoredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function manualSaveChanges(
  current: FinancialOfferProject,
  updated: FinancialOfferProject,
): CalculationOperationChange[] {
  const changes: CalculationOperationChange[] = [];
  for (const field of ["name", "entity", "currency", "notesDocument"] as const) {
    if (!sameStoredValue(current[field], updated[field])) {
      changes.push({
        itemId: current.id, item: current.name, field,
        before: structuredClone(current[field]), after: structuredClone(updated[field]),
      });
    }
  }
  for (const field of Object.keys(updated.settings) as (keyof FinancialOfferProject["settings"])[]) {
    if (!sameStoredValue(current.settings[field], updated.settings[field])) {
      changes.push({
        itemId: current.id, item: updated.name, field: `settings.${field}`,
        before: structuredClone(current.settings[field]), after: structuredClone(updated.settings[field]),
      });
    }
  }

  const currentItems = new Map(current.items.map((item) => [item.id, item]));
  const updatedItems = new Map(updated.items.map((item) => [item.id, item]));
  for (const item of updated.items) {
    const beforeItem = currentItems.get(item.id);
    if (!beforeItem) {
      changes.push({ itemId: item.id, item: item.item, field: "item", before: null, after: structuredClone(item) });
      continue;
    }
    for (const field of HUMAN_ITEM_FIELDS) {
      if (!sameStoredValue(beforeItem[field], item[field])) {
        changes.push({
          itemId: item.id, item: item.item, field,
          before: structuredClone(beforeItem[field]), after: structuredClone(item[field]),
        });
      }
    }
  }
  for (const item of current.items) {
    if (!updatedItems.has(item.id)) {
      changes.push({ itemId: item.id, item: item.item, field: "item", before: structuredClone(item), after: null });
    }
  }

  const currentCosts = new Map(current.generalCosts.map((cost) => [cost.id, cost]));
  const updatedCosts = new Map(updated.generalCosts.map((cost) => [cost.id, cost]));
  for (const cost of updated.generalCosts) {
    const before = currentCosts.get(cost.id) ?? null;
    if (!sameStoredValue(before, cost)) {
      changes.push({
        itemId: `general-cost:${cost.id}`, item: cost.name, field: "general_cost",
        before: structuredClone(before), after: structuredClone(cost),
      });
    }
  }
  for (const cost of current.generalCosts) {
    if (!updatedCosts.has(cost.id)) {
      changes.push({
        itemId: `general-cost:${cost.id}`, item: cost.name, field: "general_cost",
        before: structuredClone(cost), after: null,
      });
    }
  }
  return changes;
}

export async function getCalculationChangeReceipt(id: string): Promise<ManualCalculationChangeReceipt | null> {
  const receipt = (await readStore()).manualChangeReceipts?.find((entry) => entry.id === id);
  return receipt ? structuredClone(receipt) : null;
}

export async function getSavedCalculationChangeReceipt(
  projectId: string,
  updatedAt: string,
): Promise<ManualCalculationChangeReceipt | null> {
  const receipt = (await readStore()).manualChangeReceipts
    ?.find((entry) => entry.projectId === projectId && entry.updatedAt === updatedAt);
  return receipt ? structuredClone(receipt) : null;
}

export async function listCalculationChangeReceipts(
  projectId: string,
): Promise<ManualCalculationChangeReceipt[]> {
  const receipts = (await readStore()).manualChangeReceipts
    ?.filter((entry) => entry.projectId === projectId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)) ?? [];
  return structuredClone(receipts);
}

export async function saveProject(
  projectId: string,
  patch: FinancialOfferProjectPatch,
  expectedUpdatedAt?: string | null,
  expectedItemIds?: string[] | null,
): Promise<FinancialOfferProject | null> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const current = store.projects.find((project) => project.id === projectId);
    if (!current) return null;
    if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) throw new CalculationConflictError();
    if (patch.items && expectedItemIds) {
      const currentItemIds = current.items.map((item) => item.id);
      if (JSON.stringify(currentItemIds) !== JSON.stringify(expectedItemIds)) {
        throw new CalculationConflictError(
          "La lista de ítems cambió en otra sesión. Recarga la versión vigente antes de guardar para no retirar filas nuevas.",
        );
      }
    }
    const candidate: FinancialOfferProject = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      settings: {
        ...current.settings,
        ...(patch.settings ?? {}),
      },
      items: patch.items ?? current.items,
    };
    if (sameStoredValue(candidate, current)) return current;
    const updated = { ...candidate, updatedAt: nextUpdatedAt(current.updatedAt) };
    const changes = manualSaveChanges(current, updated);
    const receipt: ManualCalculationChangeReceipt | null = changes.length ? {
      id: randomUUID(),
      projectId,
      updatedAt: updated.updatedAt,
      changes,
      summary: `${changes.length} cambio${changes.length === 1 ? "" : "s"} guardado${changes.length === 1 ? "" : "s"}.`,
      source: "human",
    } : null;
    await writeStore({
      ...store,
      projects: [updated, ...store.projects.filter((project) => project.id !== projectId)],
      manualChangeReceipts: receipt
        ? [...(store.manualChangeReceipts ?? []), receipt]
        : store.manualChangeReceipts,
    });
    return updated;
  });
}

export async function importProject(input: FinancialOfferImportInput): Promise<FinancialOfferProject> {
  return serializeProjectSave(async () => {
  const parsed = normalizeImportPayload(input);
  const store = await readStore();
  const now = new Date().toISOString();
  const sourceSystem = parsed.calculation.source_system?.trim() || null;
  const existingByExternalId = parsed.calculation.external_id
    ? store.projects.find((project) => project.externalId === parsed.calculation.external_id && project.sourceSystem === sourceSystem)
    : null;

  const isCreateOnce = Boolean(
    (input as Record<string, unknown>)?.create_once ??
    (input as { calculation?: Record<string, unknown> })?.calculation?.create_once ??
    (parsed as Record<string, unknown>)?.create_once ??
    (parsed.calculation as Record<string, unknown>)?.create_once
  );
  const receiptKey = isCreateOnce && parsed.calculation.external_id
    ? JSON.stringify([sourceSystem, parsed.calculation.external_id]) : null;
  // La huella de la corrida excluye los datos de presentacion del proyecto: un reintento de Odoo con esos datos no choca.
  const { odoo_project_name: _name, odoo_process_number: _process, odoo_entity_name: _entity, odoo_return_url: _returnUrl, odoo_db: _db, ...fingerprintMeta } = parsed.calculation;
  const fingerprintPayload = { ...parsed, calculation: fingerprintMeta };
  const digestImport = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const fingerprint = digestImport(fingerprintPayload);
  // Un recibo anterior al anexo/estado no incluía estas claves opcionales en la huella.
  const legacyFingerprint = parsed.items.every((item) => !item.technical_annex?.length && !item.cost_basis_status)
    ? digestImport({
      ...fingerprintPayload,
      items: parsed.items.map((item) => {
        const legacy: Record<string, unknown> = { ...item };
        delete legacy.technical_annex;
        delete legacy.cost_basis_status;
        return legacy;
      }),
    })
    : null;
  const receipt = receiptKey ? store.importReceipts?.[receiptKey] : null;
  if (receipt && receipt.hash !== fingerprint && receipt.hash !== legacyFingerprint) {
    throw new Error("Esta corrida ya tiene otro contenido financiero. Se conserva el calculo existente.");
  }
  if (receipt && !existingByExternalId) {
    throw new Error("El cálculo de esta corrida fue eliminado y no puede reimportarse automáticamente. Inicie una nueva corrida para crear otro cálculo.");
  }
  if (existingByExternalId && isCreateOnce) {
    return existingByExternalId;
  }
  const id = existingByExternalId?.id ?? randomUUID();
  if (parsed.calculation.name === AUTO_CALCULATION_NAME) {
    parsed.calculation.name = existingByExternalId?.name ?? nextCalculationName(store.projects, now);
  }
  const base = preserveAdditionalCostsOnReimport(
    toCalculation(parsed, id, existingByExternalId?.createdAt ?? now),
    existingByExternalId,
    parsed,
  );
  const inheritedFinancialSettings = inheritedRetentionPatch({
    explicitReteFuente: parsed.settings.apply_retefuente !== undefined,
    explicitReteIva: parsed.settings.apply_reteiva !== undefined,
    explicitReteIca: parsed.settings.apply_reteica !== undefined,
    defaults: store.financialDefaults,
    existing: existingByExternalId?.settings,
  });
  const project = {
    ...base,
    settings: {
      ...base.settings,
      ...inheritedFinancialSettings,
    },
    ...mergeCalculationLinkFields(parsed.calculation, existingByExternalId),
    updatedAt: now,
  };
  const nextProjects = [project, ...store.projects.filter((current) => current.id !== id)];
  const importReceipts = { ...store.importReceipts };
  if (receiptKey) importReceipts[receiptKey] = { hash: fingerprint, projectId: id };
  await writeStore({ ...store, projects: nextProjects, importReceipts });
  return project;
  });
}

export async function createEmptyProject(input: {
  name: string;
  externalId?: string | null;
  entity?: string | null;
  odooProjectId?: string | null;
  iaRunId?: string | null;
  sourceAnalysisId?: string | null;
  odooCallbackUrl?: string | null;
  odooReturnUrl?: string | null;
  odooDb?: string | null;
  odooProjectName?: string | null;
  odooProcessNumber?: string | null;
  odooEntityName?: string | null;
  odooUserId?: string | null;
  odooUserName?: string | null;
  nameSuffix?: string | null;
}): Promise<FinancialOfferProject> {
  const sourceSystem = "manual";
  if (input.externalId) {
    const store = await readStore();
    const existing = store.projects.find(
      (project) => project.externalId === input.externalId && project.sourceSystem === sourceSystem,
    );
    if (existing) {
      const patch = patchLinkedCalculationFields(existing, input);
      if (Object.keys(patch).length) {
        return (await saveProject(existing.id, patch)) ?? existing;
      }
      return existing;
    }
  }

  const project = await importProject({
    calculation: {
      external_id: input.externalId ?? null,
      source_system: sourceSystem,
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
      stamp_tax_rate: null,
    },
  });

  const linkPatch = patchLinkedCalculationFields(project, input);
  const nameWithSuffix = appendCalculationNameSuffix(project.name, input.nameSuffix);
  if (nameWithSuffix !== project.name) {
    linkPatch.name = nameWithSuffix;
  }
  if (Object.keys(linkPatch).length) {
    return (await saveProject(project.id, linkPatch)) ?? project;
  }
  return project;
}

export const listCalculations = listProjects;
export const getCalculation = getProject;
export const importCalculation = importProject;
export const createEmptyCalculation = createEmptyProject;
export const saveCalculation = saveProject;

export async function freezeCalculation(
  projectId: string,
  links: { externalId?: string | null; odooProjectId?: string | null; iaRunId?: string | null; sourceAnalysisId?: string | null },
): Promise<FinancialOfferProject | null> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const current = store.projects.find((project) => project.id === projectId);
    if (!current) return null;
    for (const key of ["externalId", "odooProjectId", "iaRunId", "sourceAnalysisId"] as const) {
      const expected = links[key];
      if (expected !== undefined && expected !== null && current[key] !== expected) {
        throw new Error("El vínculo Odoo/Finanzas no coincide con el cálculo.");
      }
    }
    if (current.readOnly) return current;
    const frozenAt = new Date().toISOString();
    const frozen = ensureCalculationShape({ ...current, readOnly: true, frozenAt });
    await writeStore({
      ...store,
      projects: [frozen, ...store.projects.filter((project) => project.id !== projectId)],
    }, { projectId, readOnly: true });
    return frozen;
  });
}

export async function unfreezeCalculation(
  projectId: string,
  links: { externalId?: string | null; odooProjectId?: string | null; iaRunId?: string | null; sourceAnalysisId?: string | null },
): Promise<FinancialOfferProject | null> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const current = store.projects.find((project) => project.id === projectId);
    if (!current) return null;
    for (const key of ["externalId", "odooProjectId", "iaRunId", "sourceAnalysisId"] as const) {
      const expected = links[key];
      if (expected !== undefined && expected !== null && current[key] !== expected) {
        throw new Error("El vínculo Odoo/Finanzas no coincide con el cálculo.");
      }
    }
    if (!current.readOnly) return current;
    const editable = ensureCalculationShape({ ...current, readOnly: false, frozenAt: null });
    await writeStore({
      ...store,
      projects: [editable, ...store.projects.filter((project) => project.id !== projectId)],
    }, { projectId, readOnly: false });
    return editable;
  });
}

export type ResetCalculationResult =
  | { status: "ok"; calculation: FinancialOfferProject; assetCleanupWarning: string | null }
  | { status: "not_found" | "conflict"; calculation: null; assetCleanupWarning: null };

export async function resetCalculation(projectId: string, expectedUpdatedAt?: string | null): Promise<ResetCalculationResult> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const current = store.projects.find((project) => project.id === projectId);
    if (!current) {
      return { status: "not_found", calculation: null, assetCleanupWarning: null };
    }
    if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
      return { status: "conflict", calculation: null, assetCleanupWarning: null };
    }

  const now = new Date().toISOString();
  const empty = toCalculation(
    normalizeImportPayload({
      calculation: {
        name: current.name,
        entity: current.entity,
        currency: current.currency,
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
        stamp_tax_rate: null,
      },
    }),
    current.id,
    current.createdAt,
  );
  const retentionDefaults = inheritedRetentionPatch({
    explicitReteFuente: false,
    explicitReteIva: false,
    explicitReteIca: false,
    defaults: store.financialDefaults,
  });
  const calculation = ensureCalculationShape({
    ...current,
    notesDocument: JSON.parse(JSON.stringify(EMPTY_NOTES_DOCUMENT)),
    settings: { ...empty.settings, ...retentionDefaults },
    items: empty.items,
    generalCosts: [],
    updatedAt: now,
  });

  await writeStore({
    ...store,
    projects: [calculation, ...store.projects.filter((project) => project.id !== projectId)],
    scenarios: store.scenarios.filter((scenario) => scenario.projectId !== projectId),
  });

  let assetCleanupWarning: string | null = null;
  try {
    await rm(resolve(projectRoot(), "data", "financial-offer", "note-assets", projectId), { recursive: true, force: true });
  } catch (error) {
    assetCleanupWarning = error instanceof Error ? error.message : "No se pudieron limpiar las imágenes de notas.";
  }
    return { status: "ok", calculation, assetCleanupWarning };
  });
}

export type AnalysisMutationResult = {
  scenario: FinancialAnalysisScenario;
  receipt: AnalysisActionReceipt;
};

export class CalculationFrozenError extends Error {
  readonly code = "CALCULATION_FROZEN";
  constructor() {
    super("El cálculo está congelado y no admite cambios de análisis.");
    this.name = "CalculationFrozenError";
  }
}

function normalizeAnalysisActor(actor: AnalysisActor): AnalysisActor {
  const id = actor.id?.trim();
  const name = actor.name?.trim();
  if (!id || !name) throw new Error("La acción de análisis requiere un actor identificado.");
  return { id, name };
}

function analysisActorDigestIdentity(actor: AnalysisActor): { id: string } {
  return { id: actor.id! };
}

function analysisActionDigest(input: unknown): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function replayAnalysisAction(
  store: StoreData, operationId: string, digest: string,
): AnalysisActionReceipt | null {
  const stored = store.analysisActionReceipts?.[operationId];
  if (!stored) return null;
  if (stored.digest !== digest) {
    throw new AnalysisConflictError("El operationId ya fue usado con otra acción de análisis.");
  }
  return structuredClone(stored.receipt);
}

function assertAnalysisMutable(project: FinancialOfferProject) {
  if (project.readOnly) throw new HistoricalReadonlyError();
  if (project.frozenAt) throw new CalculationFrozenError();
}

function analysisScenarioDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function appendAnalysisPriceBaseVersion(
  store: StoreData, before: FinancialOfferProject, after: FinancialOfferProject,
  source: "manual" | "restore", now: string,
): { version: PriceBaseVersion; versions: PriceBaseVersion[] } {
  const existing = (store.priceBaseVersions ?? []).filter((entry) => entry.projectId === before.id);
  const latest = existing.at(-1) ?? null;
  const versions: PriceBaseVersion[] = [];
  let parentId = latest?.id ?? null;
  const beforeSnapshot = capturePriceBase(before.items);
  const beforeGeneralCosts = structuredClone(before.generalCosts);
  const beforeDigest = priceBaseStateDigest(beforeSnapshot, before.settings.manualReferenceTotal,
    beforeGeneralCosts, priceBasePricingSettings(before.settings));
  if (!latest || storedPriceBaseStateDigest(latest) !== beforeDigest) {
    const checkpoint: PriceBaseVersion = {
      id: randomUUID(), projectId: before.id, parentId, createdAt: now,
      source: latest ? "manual" : "initial", jobId: null,
      changedItemIds: changedPriceBaseItemIds(beforeSnapshot, latest?.snapshot ?? []),
      snapshot: beforeSnapshot, offerSnapshots: capturePriceBaseOffers(before.items),
      generalCosts: beforeGeneralCosts, manualReferenceTotal: before.settings.manualReferenceTotal,
      ...priceBasePricingSettings(before.settings),
      digest: priceBaseDisplayDigest(beforeSnapshot, before.settings.manualReferenceTotal),
      stateDigest: beforeDigest,
    };
    versions.push(checkpoint);
    parentId = checkpoint.id;
  }
  const afterSnapshot = capturePriceBase(after.items);
  const version: PriceBaseVersion = {
    id: randomUUID(), projectId: after.id, parentId, createdAt: now, source, jobId: null,
    changedItemIds: changedPriceBaseItemIds(afterSnapshot, beforeSnapshot),
    snapshot: afterSnapshot, offerSnapshots: capturePriceBaseOffers(after.items),
    generalCosts: structuredClone(after.generalCosts), manualReferenceTotal: after.settings.manualReferenceTotal,
    ...priceBasePricingSettings(after.settings),
    digest: priceBaseDisplayDigest(afterSnapshot, after.settings.manualReferenceTotal),
    stateDigest: priceBaseStateDigest(afterSnapshot, after.settings.manualReferenceTotal,
      after.generalCosts, priceBasePricingSettings(after.settings)),
  };
  versions.push(version);
  return { version, versions };
}

function inverseAnalysisDiff(project: FinancialOfferProject, diff: AnalysisDiffEntry[]): FinancialOfferProject {
  const restored = structuredClone(project);
  for (const entry of [...diff].reverse()) {
    if (!entry.appliesToCalculation || entry.scope === "analysis") continue;
    if (entry.scope === "settings") {
      const settings = restored.settings as unknown as Record<string, unknown>;
      if (!sameStoredValue(settings[entry.field], entry.after)) {
        throw new AnalysisConflictError(`El campo global ${entry.field} cambió después de aceptar el análisis.`);
      }
      if (entry.beforePresent === false) delete settings[entry.field];
      else settings[entry.field] = structuredClone(entry.before);
      continue;
    }
    const item = restored.items.find((candidate) => candidate.id === entry.itemId);
    if (!item) throw new AnalysisConflictError(`El ítem ${entry.itemId} ya no existe.`);
    const record = item as unknown as Record<string, unknown>;
    if (!sameStoredValue(record[entry.field], entry.after)) {
      throw new AnalysisConflictError(`El campo ${entry.field} del ítem ${item.item || item.id} cambió después de aceptar el análisis.`);
    }
    if (entry.beforePresent === false) delete record[entry.field];
    else record[entry.field] = structuredClone(entry.before);
  }
  return restored;
}

function analysisDiffsOverlap(left: AnalysisDiffEntry, right: AnalysisDiffEntry): boolean {
  if (!left.appliesToCalculation || !right.appliesToCalculation) return false;
  if (left.scope === "analysis" || right.scope === "analysis" || left.scope !== right.scope) return false;
  if (left.scope === "settings") return left.field === right.field;
  return left.itemId === right.itemId && left.field === right.field;
}

function assertNoChangesAfterAcceptance(
  store: StoreData,
  calculationId: string,
  acceptedUpdatedAt: string,
  diff: AnalysisDiffEntry[],
) {
  const touched = diff.filter((entry) => entry.appliesToCalculation && entry.scope !== "analysis");
  const conflicts = (store.manualChangeReceipts ?? [])
    .filter((receipt) => receipt.projectId === calculationId && receipt.updatedAt > acceptedUpdatedAt)
    .flatMap((receipt) => receipt.changes)
    .filter((change) => touched.some((entry) => {
      if (entry.scope === "settings") {
        return change.itemId === calculationId && change.field === `settings.${entry.field}`;
      }
      if (change.itemId !== entry.itemId) return false;
      return change.field === "item" || change.field === entry.field;
    }));
  if (conflicts.length) {
    const fields = [...new Set(conflicts.map((change) => change.field))].join(", ");
    throw new AnalysisConflictError(`No se puede deshacer: una persona modificó después los campos ${fields}.`);
  }
  const laterAnalysisConflicts = Object.values(store.analysisActionReceipts ?? {})
    .map((entry) => entry.receipt)
    .filter((receipt) => receipt.calculationId === calculationId
      && receipt.resultingUpdatedAt > acceptedUpdatedAt
      && receipt.status === "applied"
      && (receipt.action === "accept" || receipt.action === "undo"))
    .flatMap((receipt) => receipt.diff)
    .filter((entry) => touched.some((acceptedEntry) => analysisDiffsOverlap(acceptedEntry, entry)));
  if (laterAnalysisConflicts.length) {
    const fields = [...new Set(laterAnalysisConflicts.map((entry) => entry.field))].join(", ");
    throw new AnalysisConflictError(`No se puede deshacer: otro análisis modificó después los campos ${fields}.`);
  }
}

export async function getAnalysisActionReceipt(operationId: string): Promise<AnalysisActionReceipt | null> {
  const stored = (await readStore()).analysisActionReceipts?.[operationId];
  return stored ? structuredClone(stored.receipt) : null;
}

export async function listAnalysisActionReceipts(calculationId: string): Promise<AnalysisActionReceipt[]> {
  return Object.values((await readStore()).analysisActionReceipts ?? {})
    .map((entry) => entry.receipt)
    .filter((receipt) => receipt.calculationId === calculationId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((receipt) => structuredClone(receipt));
}

export async function listAnalysisScenarios(calculationId: string): Promise<FinancialAnalysisScenario[]> {
  return (await readStore()).analysisScenarios
    ?.filter((scenario) => scenario.calculationId === calculationId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((scenario) => structuredClone(scenario)) ?? [];
}

export async function getAnalysisScenario(
  calculationId: string, scenarioId: string,
): Promise<FinancialAnalysisScenario | null> {
  const scenario = (await readStore()).analysisScenarios
    ?.find((entry) => entry.calculationId === calculationId && entry.id === scenarioId);
  return scenario ? structuredClone(scenario) : null;
}

export async function createAnalysisScenario(
  calculationId: string,
  input: { name: string; changes: AnalysisChange[]; expectedUpdatedAt: string; operationId: string },
  rawActor: AnalysisActor,
): Promise<AnalysisMutationResult | null> {
  const actor = normalizeAnalysisActor(rawActor);
  const changes = AnalysisChangesSchema.parse(input.changes);
  const digest = analysisActionDigest({ action: "create", calculationId, ...input, changes, actor: analysisActorDigestIdentity(actor) });
  return serializeProjectSave(async () => {
    const store = await readStore();
    const replay = replayAnalysisAction(store, input.operationId, digest);
    if (replay) {
      const scenario = store.analysisScenarios?.find((entry) => entry.id === replay.scenarioId);
      return scenario ? { scenario: structuredClone(scenario), receipt: replay } : null;
    }
    const project = store.projects.find((entry) => entry.id === calculationId);
    if (!project) return null;
    assertAnalysisMutable(project);
    if (project.updatedAt !== input.expectedUpdatedAt) throw new CalculationConflictError();
    const preview = previewAnalysis(project, changes);
    const now = new Date().toISOString();
    const scenario: FinancialAnalysisScenario = {
      id: randomUUID(), calculationId, name: input.name.trim() || "Escenario de análisis",
      createdAt: now, createdBy: actor, baseUpdatedAt: project.updatedAt,
      baseProject: structuredClone(project), changes: structuredClone(changes), preview,
      previewDigest: analysisScenarioDigest(preview), status: "draft",
      acceptedAt: null, acceptedBy: null, acceptanceOperationId: null,
      undoneAt: null, undoneBy: null, undoOperationId: null,
    };
    const receipt: AnalysisActionReceipt = {
      operationId: input.operationId, calculationId, scenarioId: scenario.id,
      action: "create", status: "saved", actor, baseUpdatedAt: project.updatedAt,
      resultingUpdatedAt: project.updatedAt, versionId: null,
      diff: structuredClone(preview.diff), createdAt: now,
    };
    await writeStore({
      ...store,
      analysisScenarios: [scenario, ...(store.analysisScenarios ?? [])],
      analysisActionReceipts: { ...store.analysisActionReceipts, [input.operationId]: { digest, receipt } },
    });
    return { scenario: structuredClone(scenario), receipt };
  });
}

export async function acceptAnalysisScenario(
  calculationId: string, scenarioId: string,
  input: { expectedUpdatedAt: string; operationId: string }, rawActor: AnalysisActor,
): Promise<AnalysisMutationResult | null> {
  const actor = normalizeAnalysisActor(rawActor);
  const digest = analysisActionDigest({ action: "accept", calculationId, scenarioId, ...input, actor: analysisActorDigestIdentity(actor) });
  return serializeProjectSave(async () => {
    const store = await readStore();
    const replay = replayAnalysisAction(store, input.operationId, digest);
    if (replay) {
      const scenario = store.analysisScenarios?.find((entry) => entry.id === replay.scenarioId);
      return scenario ? { scenario: structuredClone(scenario), receipt: replay } : null;
    }
    const current = store.projects.find((entry) => entry.id === calculationId);
    const scenario = store.analysisScenarios?.find((entry) => entry.id === scenarioId && entry.calculationId === calculationId);
    if (!current || !scenario) return null;
    assertAnalysisMutable(current);
    if (current.updatedAt !== input.expectedUpdatedAt || scenario.baseUpdatedAt !== current.updatedAt
        || !sameStoredValue(current, scenario.baseProject)) throw new CalculationConflictError();
    if (scenario.status !== "draft") throw new AnalysisConflictError("El escenario ya fue aceptado o deshecho.");
    const now = nextUpdatedAt(current.updatedAt);
    const candidate = structuredClone(scenario.preview.project);
    const changed = !sameStoredValue({ ...candidate, updatedAt: current.updatedAt }, current);
    const project = changed ? { ...candidate, updatedAt: now } : current;
    const versionResult = changed ? appendAnalysisPriceBaseVersion(store, current, project, "manual", now) : null;
    const accepted: FinancialAnalysisScenario = {
      ...scenario, status: "accepted", acceptedAt: now, acceptedBy: actor,
      acceptanceOperationId: input.operationId, undoneAt: null, undoneBy: null, undoOperationId: null,
    };
    const receipt: AnalysisActionReceipt = {
      operationId: input.operationId, calculationId, scenarioId,
      action: "accept", status: changed ? "applied" : "no_changes", actor,
      baseUpdatedAt: current.updatedAt, resultingUpdatedAt: project.updatedAt,
      versionId: versionResult?.version.id ?? null, diff: structuredClone(scenario.preview.diff), createdAt: now,
    };
    await writeStore({
      ...store,
      projects: changed ? [project, ...store.projects.filter((entry) => entry.id !== calculationId)] : store.projects,
      priceBaseVersions: versionResult
        ? [...(store.priceBaseVersions ?? []), ...versionResult.versions] : store.priceBaseVersions,
      analysisScenarios: (store.analysisScenarios ?? []).map((entry) => entry.id === scenarioId ? accepted : entry),
      analysisActionReceipts: { ...store.analysisActionReceipts, [input.operationId]: { digest, receipt } },
    });
    return { scenario: structuredClone(accepted), receipt };
  });
}

export async function undoAnalysisAcceptance(
  calculationId: string, scenarioId: string,
  input: { acceptanceOperationId: string; expectedUpdatedAt: string; operationId: string }, rawActor: AnalysisActor,
): Promise<AnalysisMutationResult | null> {
  const actor = normalizeAnalysisActor(rawActor);
  const digest = analysisActionDigest({ action: "undo", calculationId, scenarioId, ...input, actor: analysisActorDigestIdentity(actor) });
  return serializeProjectSave(async () => {
    const store = await readStore();
    const replay = replayAnalysisAction(store, input.operationId, digest);
    if (replay) {
      const scenario = store.analysisScenarios?.find((entry) => entry.id === replay.scenarioId);
      return scenario ? { scenario: structuredClone(scenario), receipt: replay } : null;
    }
    const current = store.projects.find((entry) => entry.id === calculationId);
    const scenario = store.analysisScenarios?.find((entry) => entry.id === scenarioId && entry.calculationId === calculationId);
    if (!current || !scenario) return null;
    assertAnalysisMutable(current);
    if (current.updatedAt !== input.expectedUpdatedAt) throw new CalculationConflictError();
    if (scenario.status !== "accepted" || scenario.acceptanceOperationId !== input.acceptanceOperationId) {
      throw new AnalysisConflictError("La aceptación indicada no es la versión activa del escenario.");
    }
    const acceptanceReceipt = store.analysisActionReceipts?.[input.acceptanceOperationId]?.receipt;
    if (!acceptanceReceipt || acceptanceReceipt.action !== "accept"
        || acceptanceReceipt.calculationId !== calculationId || acceptanceReceipt.scenarioId !== scenarioId) {
      throw new AnalysisConflictError("No existe un recibo de aceptación válido para deshacer el escenario.");
    }
    assertNoChangesAfterAcceptance(store, calculationId, acceptanceReceipt.resultingUpdatedAt, scenario.preview.diff);
    const inverse = inverseAnalysisDiff(current, scenario.preview.diff);
    const changed = !sameStoredValue(inverse, current);
    const now = changed ? nextUpdatedAt(current.updatedAt) : new Date().toISOString();
    const project = changed ? { ...inverse, updatedAt: now } : current;
    const versionResult = changed ? appendAnalysisPriceBaseVersion(store, current, project, "restore", now) : null;
    const undone: FinancialAnalysisScenario = {
      ...scenario, status: "undone", undoneAt: now, undoneBy: actor, undoOperationId: input.operationId,
    };
    const receipt: AnalysisActionReceipt = {
      operationId: input.operationId, calculationId, scenarioId,
      action: "undo", status: changed ? "applied" : "no_changes", actor,
      baseUpdatedAt: current.updatedAt, resultingUpdatedAt: project.updatedAt,
      versionId: versionResult?.version.id ?? null,
      diff: structuredClone(scenario.preview.diff), createdAt: now,
    };
    await writeStore({
      ...store,
      projects: changed ? [project, ...store.projects.filter((entry) => entry.id !== calculationId)] : store.projects,
      priceBaseVersions: versionResult
        ? [...(store.priceBaseVersions ?? []), ...versionResult.versions] : store.priceBaseVersions,
      analysisScenarios: (store.analysisScenarios ?? []).map((entry) => entry.id === scenarioId ? undone : entry),
      analysisActionReceipts: { ...store.analysisActionReceipts, [input.operationId]: { digest, receipt } },
    });
    return { scenario: structuredClone(undone), receipt };
  });
}

export async function listProjectScenarios(projectId: string): Promise<FinancialOfferScenario[]> {
  return storeReader.select(storePath(), store => store.scenarios
    .filter((scenario) => scenario.projectId === projectId && !scenario.archivedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
}

export async function createProjectScenario(
  projectId: string,
  name: string,
  note = "",
  createdBy: { id?: string | null; name?: string | null } | null = null,
  expectedUpdatedAt?: string,
  operationId?: string,
): Promise<FinancialOfferScenario | null> {
  return serializeProjectSave(async () => {
    if (operationId && !expectedUpdatedAt) {
      throw new CalculationConflictError("La operación de escenario no declara la versión esperada del cálculo.");
    }
    const store = await readStore();
    const actionDigest = operationId ? versionActionDigest({
      projectId, scope: "scenario", action: "save", targetId: null,
      expectedUpdatedAt: expectedUpdatedAt!, payload: { name, note, createdBy },
    }) : null;
    const replay = replayVersionAction(store, operationId, actionDigest);
    if (replay) {
      return store.scenarios.find((entry) => entry.id === replay.targetId && entry.projectId === projectId) ?? null;
    }
    const project = store.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    if (expectedUpdatedAt && project.updatedAt !== expectedUpdatedAt) throw new CalculationConflictError();
    const scenario: FinancialOfferScenario = {
      id: randomUUID(),
      projectId,
      name: name.trim() || `Escenario ${store.scenarios.filter((entry) => entry.projectId === projectId).length + 1}`,
      note: note.trim(),
      createdAt: new Date().toISOString(),
      archivedAt: null,
      createdBy: createdBy?.name?.trim()
        ? { id: createdBy.id?.trim() || null, name: createdBy.name.trim() }
        : null,
      kind: "offer",
      snapshot: captureOfferScenario(project),
    };
    const receipt: VersionActionReceipt = {
      operationId: operationId ?? "", projectId, scope: "scenario", action: "save",
      targetId: scenario.id, status: "saved", updatedAt: project.updatedAt,
    };
    await writeStore(withVersionActionReceipt(
      { ...store, scenarios: [scenario, ...store.scenarios] },
      operationId, actionDigest, receipt,
    ));
    return scenario;
  });
}

export async function restoreProjectScenario(
  projectId: string, scenarioId: string, expectedUpdatedAt?: string, operationId?: string,
): Promise<FinancialOfferProject | null> {
  return serializeProjectSave(async () => {
    if (operationId && !expectedUpdatedAt) {
      throw new CalculationConflictError("La operación de escenario no declara la versión esperada del cálculo.");
    }
    const store = await readStore();
    const actionDigest = operationId ? versionActionDigest({
      projectId, scope: "scenario", action: "restore", targetId: scenarioId,
      expectedUpdatedAt: expectedUpdatedAt!,
    }) : null;
    const replay = replayVersionAction(store, operationId, actionDigest);
    if (replay) return store.projects.find((entry) => entry.id === projectId) ?? null;
    const current = store.projects.find((entry) => entry.id === projectId);
    const scenario = store.scenarios.find((entry) =>
      entry.id === scenarioId && entry.projectId === projectId && !entry.archivedAt);
    if (!current || !scenario) return null;
    if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) throw new CalculationConflictError();
    const now = nextUpdatedAt(current.updatedAt);
    const currentSnapshot = captureOfferScenario(current);
    const currentAlreadySaved = store.scenarios.some((entry) => (
      entry.projectId === projectId
      && !entry.archivedAt
      && entry.kind === "offer"
      && sameStoredValue(entry.snapshot, currentSnapshot)
    ));
    const backup: FinancialOfferScenario = {
      id: randomUUID(),
      projectId,
      name: `Escenario automatico ${new Date(now).toLocaleString("es-CO", { timeZone: "America/Bogota" })}`,
      note: "El estado actual no estaba guardado y se conservo antes de cambiar de escenario.",
      createdAt: now,
      archivedAt: null,
      createdBy: null,
      kind: "offer",
      snapshot: currentSnapshot,
    };
    let restored: FinancialOfferProject;
    if (scenario.kind === "offer") {
      const snapshot = scenario.snapshot as OfferScenarioSnapshot;
      const decisions = new Map(snapshot.items.map((item) => [item.id, item]));
      if (decisions.size !== current.items.length || snapshot.items.some((item) => !current.items.some(
        (currentItem) => currentItem.id === item.id && currentItem.item === item.item))) {
        throw new Error("La lista de ítems cambió; este escenario de oferta no se puede aplicar.");
      }
      restored = ensureCalculationShape({
        ...current, updatedAt: now,
        settings: { ...current.settings, ...snapshot.settings },
        items: current.items.map((item) => {
          const decision = decisions.get(item.id)!;
          return { ...item, offerMode: decision.offerMode, discountPct: decision.discountPct,
            profitPct: decision.profitPct, manualOfferUnit: decision.manualOfferUnit };
        }),
      });
    } else {
      const legacy = scenario.snapshot as Pick<FinancialOfferProject, "name" | "settings" | "items" | "generalCosts" | "notesDocument">;
      const legacyItems = restorePriceBase(legacy.items, capturePriceBase(current.items));
      restored = ensureCalculationShape({
        ...current, updatedAt: now,
        settings: { ...current.settings, ...captureOfferScenario({
          ...current, settings: legacy.settings, items: legacyItems,
        }).settings },
        items: current.items.map((item) => {
          const old = legacyItems.find((entry) => entry.id === item.id)!;
          return { ...item, offerMode: old.offerMode, discountPct: old.discountPct,
            profitPct: old.profitPct, manualOfferUnit: old.manualOfferUnit };
        }),
      });
    }
    if (sameStoredValue({ ...restored, updatedAt: current.updatedAt }, current)) {
      const receipt: VersionActionReceipt = {
        operationId: operationId ?? "", projectId, scope: "scenario", action: "restore",
        targetId: scenario.id, status: "no_changes", updatedAt: current.updatedAt,
      };
      if (operationId) await writeStore(withVersionActionReceipt(store, operationId, actionDigest, receipt));
      return current;
    }
    const receipt: VersionActionReceipt = {
      operationId: operationId ?? "", projectId, scope: "scenario", action: "restore",
      targetId: scenario.id, status: "applied", updatedAt: restored.updatedAt,
    };
    await writeStore(withVersionActionReceipt({
      ...store,
      projects: [restored, ...store.projects.filter((entry) => entry.id !== projectId)],
      scenarios: currentAlreadySaved ? store.scenarios : [backup, ...store.scenarios],
    }, operationId, actionDigest, receipt));
    return restored;
  });
}

export async function archiveProjectScenario(projectId: string, scenarioId: string): Promise<boolean> {
  return serializeProjectSave(async () => {
  const store = await readStore();
  const scenario = store.scenarios.find((entry) => entry.id === scenarioId && entry.projectId === projectId);
  if (!scenario) return false;
  await writeStore({
    ...store,
    scenarios: store.scenarios.map((entry) => entry.id === scenarioId ? { ...entry, archivedAt: new Date().toISOString() } : entry),
  });
  return true;
  });
}

export type DeleteCalculationInput = {
  operationId: string;
  calculationId: string;
  externalId: string | null;
  odooProjectId: string | null;
  iaRunId: string | null;
  sourceAnalysisId: string | null;
  expectedUpdatedAt: string;
};

export type DeleteCalculationResult =
  | { status: "deleted" | "already_deleted"; receipt: CalculationDeletionReceipt }
  | { status: "not_found" | "conflict" | "link_mismatch" | "operation_conflict"; receipt: null };

const DELETION_RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DELETION_RECEIPTS = 2_000;

function receiptMatchesInput(receipt: CalculationDeletionReceipt, input: DeleteCalculationInput): boolean {
  return (
    receipt.operationId === input.operationId
    && receipt.calculationId === input.calculationId
    && (receipt.externalId ?? null) === input.externalId
    && (receipt.odooProjectId ?? null) === input.odooProjectId
    && (receipt.iaRunId ?? null) === input.iaRunId
    && (receipt.sourceAnalysisId ?? null) === input.sourceAnalysisId
    && receipt.deletedUpdatedAt === input.expectedUpdatedAt
  );
}

function appendDeletionReceipt(
  current: Record<string, CalculationDeletionReceipt> | undefined,
  receipt: CalculationDeletionReceipt,
): Record<string, CalculationDeletionReceipt> {
  const cutoff = Date.parse(receipt.deletedAt) - DELETION_RECEIPT_RETENTION_MS;
  const retained = Object.values(current ?? {})
    .filter((entry) => {
      const deletedAt = Date.parse(entry.deletedAt);
      return Number.isFinite(deletedAt) && deletedAt >= cutoff;
    })
    .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
    .slice(0, MAX_DELETION_RECEIPTS - 1);
  return Object.fromEntries([
    ...retained.map((entry) => [entry.operationId, entry] as const),
    [receipt.operationId, receipt],
  ]);
}

export async function deleteCalculation(input: DeleteCalculationInput): Promise<DeleteCalculationResult> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const existingReceipt = store.deletionReceipts?.[input.operationId];
    if (existingReceipt) {
      return receiptMatchesInput(existingReceipt, input)
        ? { status: "already_deleted", receipt: existingReceipt }
        : { status: "operation_conflict", receipt: null };
    }

    const current = store.projects.find((project) => project.id === input.calculationId);
    if (!current) {
      return { status: "not_found", receipt: null };
    }
    if (current.updatedAt !== input.expectedUpdatedAt) {
      return { status: "conflict", receipt: null };
    }
    const currentLinks = {
      externalId: current.externalId ?? null,
      odooProjectId: current.odooProjectId ?? null,
      iaRunId: current.iaRunId ?? null,
      sourceAnalysisId: current.sourceAnalysisId ?? null,
    };
    if (
      currentLinks.externalId !== input.externalId
      || currentLinks.odooProjectId !== input.odooProjectId
      || currentLinks.iaRunId !== input.iaRunId
      || currentLinks.sourceAnalysisId !== input.sourceAnalysisId
    ) {
      return { status: "link_mismatch", receipt: null };
    }

    const receipt: CalculationDeletionReceipt = {
      operationId: input.operationId,
      calculationId: input.calculationId,
      ...currentLinks,
      deletedUpdatedAt: current.updatedAt,
      deletedAt: new Date().toISOString(),
    };
    await writeStore({
      ...store,
      deletionReceipts: appendDeletionReceipt(store.deletionReceipts, receipt),
      projects: store.projects.filter((project) => project.id !== input.calculationId),
      scenarios: store.scenarios.filter((scenario) => scenario.projectId !== input.calculationId),
      priceBaseVersions: (store.priceBaseVersions ?? []).filter((version) => version.projectId !== input.calculationId),
      priceBaseReceipts: Object.fromEntries(
        Object.entries(store.priceBaseReceipts ?? {}).filter(([key]) => !key.startsWith(`["${input.calculationId}",`)),
      ),
      versionActionReceipts: Object.fromEntries(
        Object.entries(store.versionActionReceipts ?? {})
          .filter(([, stored]) => stored.receipt.projectId !== input.calculationId),
      ),
    });
    return { status: "deleted", receipt };
  });
}

export async function getFinancialDefaults(): Promise<FinancialAppDefaults> {
  return storeReader.select(storePath(), store => store.financialDefaults);
}

export async function saveFinancialDefaults(input: FinancialAppDefaults): Promise<FinancialAppDefaults> {
  return serializeProjectSave(async () => {
    const store = await readStore();
    const financialDefaults = { ...DEFAULT_FINANCIAL_SETTINGS, ...input };
    await writeStore({ ...store, financialDefaults });
    return financialDefaults;
  });
}
