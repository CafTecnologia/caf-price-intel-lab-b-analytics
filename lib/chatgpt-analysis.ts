import { z } from "zod";

import {
  ADDITIONAL_COST_CATEGORIES,
  COST_BASIS_STATUSES,
  COST_STATISTICS,
  DELIVERABLE_TYPES,
  ITEM_COST_MODES,
  BudgetLimitsSchema,
  type FinancialItemAdditionalCost,
  type FinancialOfferProject,
} from "./contract";
import {
  buildInitialOfferControls,
  buildSimulation,
  offerControlWithProfitPct,
  offerControlWithDiscountPct,
  type SimulationResult,
} from "./financial-engine";

const reason = z.string().trim().min(1).max(1000);
const itemIds = z.array(z.string().trim().min(1)).max(1000);

const AnalysisItemFieldsSchema = z.object({
  description: z.string().trim(),
  technicalDescription: z.string().trim(),
  quantity: z.number().finite().nonnegative().nullable(),
  unit: z.string().trim(),
  referenceUnit: z.number().finite().nonnegative().nullable(),
  officialReferenceUnit: z.number().finite().nonnegative().nullable(),
  deliverableType: z.enum(DELIVERABLE_TYPES).nullable(),
  costBasisStatus: z.enum(COST_BASIS_STATUSES).nullable(),
  notes: z.string().trim(),
}).partial().strict();

const SetItemFieldsSchema = z.object({
  type: z.literal("set_item_fields"),
  kind: z.literal("correction"),
  reason,
  itemId: z.string().trim().min(1),
  expected: AnalysisItemFieldsSchema,
  patch: AnalysisItemFieldsSchema,
}).strict();

const ExcludePriceSourceSchema = z.object({
  type: z.literal("exclude_price_source"),
  kind: z.enum(["criterion", "exploration"]),
  reason,
  itemId: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  excluded: z.boolean(),
}).strict();

const SetCostStatisticSchema = z.object({
  type: z.literal("set_cost_statistic"),
  kind: z.enum(["criterion", "exploration"]),
  reason,
  itemId: z.string().trim().min(1),
  statistic: z.enum(COST_STATISTICS),
}).strict();

const SetAdditionalCostInclusionSchema = z.object({
  type: z.literal("set_additional_cost_inclusion"),
  kind: z.enum(["criterion", "exploration"]),
  reason,
  itemId: z.string().trim().min(1),
  costId: z.string().trim().min(1),
  included: z.boolean(),
}).strict();

const AddAdditionalCostSchema = z.object({
  type: z.literal("add_additional_cost"),
  kind: z.enum(["correction", "criterion"]),
  reason,
  itemId: z.string().trim().min(1),
  cost: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    category: z.enum(ADDITIONAL_COST_CATEGORIES).default("service"),
    mode: z.enum(ITEM_COST_MODES).default("fixed"),
    amount: z.number().finite().nonnegative().nullable(),
    notes: z.string().trim().default(""),
  }).strict(),
}).strict();

const SetReferenceInclusionSchema = z.object({
  type: z.literal("set_reference_inclusion"),
  kind: z.enum(["criterion", "exploration"]),
  reason,
  scope: z.enum(["project", "items"]),
  itemIds: itemIds.default([]),
  included: z.boolean(),
}).strict();

const SetMarginSchema = z.object({
  type: z.literal("set_margin"),
  kind: z.enum(["criterion", "exploration"]),
  reason,
  itemIds: itemIds.default([]),
  marginPctOnCost: z.number().finite().nonnegative().max(100000),
}).strict();

const SetCostDiscountSchema = z.object({
  type: z.literal("set_cost_discount"),
  kind: z.enum(["criterion", "exploration"]), reason,
  itemIds: itemIds.default([]),
  discountPct: z.number().finite().min(0).max(100),
  basis: z.enum(["base", "current"]).default("base"),
}).strict();

const SetOfferDiscountSchema = z.object({
  type: z.literal("set_offer_discount"),
  kind: z.enum(["criterion", "exploration"]), reason,
  itemIds: itemIds.default([]),
  discountPct: z.number().finite().min(0).max(100),
}).strict();

const GroupSpecificationsSchema = z.object({
  type: z.literal("group_specifications"),
  kind: z.enum(["criterion", "exploration"]),
  reason,
  groupId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(240),
  itemIds: itemIds.min(1),
}).strict();

const SetBudgetLimitsSchema = z.object({
  type: z.literal("set_budget_limits"), kind: z.literal("correction"), reason,
  expected: BudgetLimitsSchema, limits: BudgetLimitsSchema,
}).strict();

export const AnalysisChangeSchema = z.discriminatedUnion("type", [
  SetItemFieldsSchema,
  SetBudgetLimitsSchema,
  ExcludePriceSourceSchema,
  SetCostStatisticSchema,
  SetAdditionalCostInclusionSchema,
  AddAdditionalCostSchema,
  SetReferenceInclusionSchema,
  SetMarginSchema,
  SetCostDiscountSchema,
  SetOfferDiscountSchema,
  GroupSpecificationsSchema,
]).superRefine((change, context) => {
  if (change.type === "set_item_fields") {
    const patchKeys = Object.keys(change.patch).sort();
    const expectedKeys = Object.keys(change.expected).sort();
    if (!patchKeys.length) context.addIssue({ code: "custom", path: ["patch"], message: "La corrección necesita al menos un campo." });
    if (JSON.stringify(patchKeys) !== JSON.stringify(expectedKeys)) {
      context.addIssue({ code: "custom", path: ["expected"], message: "expected debe incluir exactamente las claves de patch." });
    }
  }
  if (change.type === "set_reference_inclusion") {
    if (change.scope === "project" && change.itemIds.length) {
      context.addIssue({ code: "custom", path: ["itemIds"], message: "La referencia global no acepta IDs de ítem." });
    }
    if (change.scope === "items" && !change.itemIds.length) {
      context.addIssue({ code: "custom", path: ["itemIds"], message: "La referencia por ítem necesita al menos un ID." });
    }
  }
});

export const AnalysisChangesSchema = z.array(AnalysisChangeSchema).min(1).max(1000);
export type AnalysisChange = z.output<typeof AnalysisChangeSchema>;

export type AnalysisActor = { id: string | null; name: string };
export type AnalysisDiffEntry = {
  kind: AnalysisChange["kind"];
  reason: string;
  scope: "item" | "settings" | "analysis";
  itemId: string | null;
  field: string;
  before: unknown;
  beforePresent?: boolean;
  after: unknown;
  appliesToCalculation: boolean;
};
export type AnalysisGroup = { groupId: string; label: string; itemIds: string[]; reason: string };
export type AnalysisPreview = {
  project: FinancialOfferProject;
  originalSimulation: SimulationResult;
  simulation: SimulationResult;
  diff: AnalysisDiffEntry[];
  groups: AnalysisGroup[];
  warnings: string[];
};

export type FinancialAnalysisScenario = {
  id: string;
  calculationId: string;
  name: string;
  createdAt: string;
  createdBy: AnalysisActor;
  baseUpdatedAt: string;
  baseProject: FinancialOfferProject;
  changes: AnalysisChange[];
  preview: AnalysisPreview;
  previewDigest: string;
  status: "draft" | "accepted" | "undone";
  acceptedAt: string | null;
  acceptedBy: AnalysisActor | null;
  acceptanceOperationId: string | null;
  undoneAt: string | null;
  undoneBy: AnalysisActor | null;
  undoOperationId: string | null;
};

export type AnalysisActionReceipt = {
  operationId: string;
  calculationId: string;
  scenarioId: string;
  action: "create" | "accept" | "undo";
  status: "saved" | "applied" | "no_changes";
  actor: AnalysisActor;
  baseUpdatedAt: string;
  resultingUpdatedAt: string;
  versionId: string | null;
  diff: AnalysisDiffEntry[];
  createdAt: string;
};

export class AnalysisConflictError extends Error {
  readonly code = "ANALYSIS_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "AnalysisConflictError";
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) throw new AnalysisConflictError(`${label} contiene IDs repetidos.`);
  return values;
}

function itemIndex(project: FinancialOfferProject, id: string): number {
  const index = project.items.findIndex((item) => item.id === id);
  if (index < 0) throw new AnalysisConflictError(`El ítem ${id} no pertenece al cálculo.`);
  return index;
}

function addDiff(
  diff: AnalysisDiffEntry[], change: AnalysisChange, scope: AnalysisDiffEntry["scope"],
  itemId: string | null, field: string, before: unknown, after: unknown, appliesToCalculation = true,
) {
  if (same(before, after)) return;
  diff.push({ kind: change.kind, reason: change.reason, scope, itemId, field,
    before: structuredClone(before), after: structuredClone(after), appliesToCalculation });
}

export function previewAnalysis(project: FinancialOfferProject, rawChanges: AnalysisChange[]): AnalysisPreview {
  const changes = AnalysisChangesSchema.parse(rawChanges);
  const candidate = structuredClone(project);
  const diff: AnalysisDiffEntry[] = [];
  const groups: AnalysisGroup[] = [];
  const warnings: string[] = [];

  // Price instructions use final costs/quantities; preserve their relative order.
  const isPriceChange = (change: AnalysisChange) => change.type === "set_margin" || change.type === "set_offer_discount";
  const orderedChanges = [...changes.filter(change => !isPriceChange(change)), ...changes.filter(isPriceChange)];
  for (const change of orderedChanges) {
    if (change.type === "set_budget_limits") {
      const before = candidate.settings.budgetLimits ?? [];
      if (!same(before, change.expected)) throw new AnalysisConflictError("Los límites presupuestales cambiaron.");
      for (const limit of change.limits) {
        if (limit.procurementLotId && !candidate.items.some(item => item.procurementLot?.id === limit.procurementLotId))
          throw new AnalysisConflictError("El componente presupuestal no pertenece al cálculo.");
      }
      if (same(before, change.limits)) continue;
      const beforePresent = Object.hasOwn(candidate.settings, "budgetLimits");
      candidate.settings.budgetLimits = structuredClone(change.limits);
      addDiff(diff, change, "settings", null, "budgetLimits", before, change.limits);
      if (diff.at(-1)?.field === "budgetLimits") diff.at(-1)!.beforePresent = beforePresent;
      continue;
    }
    if (change.type === "set_item_fields") {
      const index = itemIndex(candidate, change.itemId);
      const item = candidate.items[index]!;
      for (const key of Object.keys(change.patch) as Array<keyof typeof change.patch>) {
        const before = key === "officialReferenceUnit" ? item.officialReferenceUnit ?? null : item[key as keyof typeof item];
        const expected = change.expected[key];
        if (!same(before, expected)) throw new AnalysisConflictError(`El campo ${String(key)} del ítem ${item.item || item.id} cambió.`);
        const after = change.patch[key];
        if (same(before, after)) continue;
        const countBefore = diff.length;
        addDiff(diff, change, "item", item.id, String(key), before, after);
        if (diff.length > countBefore) diff.at(-1)!.beforePresent = Object.hasOwn(item, key);
        (item as unknown as Record<string, unknown>)[key] = structuredClone(after);
      }
      continue;
    }

    if (change.type === "exclude_price_source") {
      const index = itemIndex(candidate, change.itemId);
      const item = candidate.items[index]!;
      if (!item.priceSources.some((source) => source.id === change.sourceId)) {
        throw new AnalysisConflictError(`La fuente ${change.sourceId} no pertenece al ítem ${item.item || item.id}.`);
      }
      const before = item.analysisExcludedPriceSourceIds ?? [];
      const next = new Set(before);
      if (change.excluded) next.add(change.sourceId); else next.delete(change.sourceId);
      const after = item.priceSources.map((source) => source.id).filter((id) => next.has(id));
      item.analysisExcludedPriceSourceIds = after;
      addDiff(diff, change, "item", item.id, "analysisExcludedPriceSourceIds", before, after);
      continue;
    }

    if (change.type === "set_cost_statistic") {
      const index = itemIndex(candidate, change.itemId);
      const item = candidate.items[index]!;
      const before = item.analysisCostStatistic ?? null;
      item.analysisCostStatistic = change.statistic;
      addDiff(diff, change, "item", item.id, "analysisCostStatistic", before, change.statistic);
      continue;
    }

    if (change.type === "set_additional_cost_inclusion") {
      const index = itemIndex(candidate, change.itemId);
      const item = candidate.items[index]!;
      const costIndex = item.additionalCosts.findIndex((cost) => cost.id === change.costId);
      if (costIndex < 0) throw new AnalysisConflictError(`El costo ${change.costId} no pertenece al ítem ${item.item || item.id}.`);
      const before = structuredClone(item.additionalCosts);
      const cost = item.additionalCosts[costIndex]!;
      item.additionalCosts[costIndex] = {
        ...cost,
        reviewStatus: change.included ? (cost.amount === null ? "suggested" : "included") : "excluded",
      };
      if (change.included && cost.amount === null) warnings.push(`${cost.name}: costo pendiente; no se suma hasta tener valor.`);
      addDiff(diff, change, "item", item.id, "additionalCosts", before, item.additionalCosts);
      continue;
    }

    if (change.type === "add_additional_cost") {
      const index = itemIndex(candidate, change.itemId);
      const item = candidate.items[index]!;
      const existing = item.additionalCosts.find((cost) => cost.id === change.cost.id);
      const next: FinancialItemAdditionalCost = {
        ...change.cost,
        reviewStatus: change.cost.amount === null ? "suggested" : "included",
      };
      if (existing) {
        if (!same(existing, next)) throw new AnalysisConflictError(`El ID de costo ${change.cost.id} ya existe con otro contenido.`);
        continue;
      }
      const before = structuredClone(item.additionalCosts);
      item.additionalCosts = [...item.additionalCosts, next];
      if (next.amount === null) warnings.push(`${next.name}: costo nuevo pendiente; no se suma hasta tener valor.`);
      addDiff(diff, change, "item", item.id, "additionalCosts", before, item.additionalCosts);
      continue;
    }

    if (change.type === "set_reference_inclusion") {
      if (change.scope === "project") {
        const before = candidate.settings.analysisReferenceIncluded ?? true;
        candidate.settings.analysisReferenceIncluded = change.included;
        addDiff(diff, change, "settings", null, "analysisReferenceIncluded", before, change.included);
      } else {
        for (const id of unique(change.itemIds, "La lista de referencias")) {
          const index = itemIndex(candidate, id);
          const item = candidate.items[index]!;
          const before = item.analysisReferenceIncluded ?? true;
          item.analysisReferenceIncluded = change.included;
          addDiff(diff, change, "item", item.id, "analysisReferenceIncluded", before, change.included);
        }
      }
      continue;
    }

    if (change.type === "set_cost_discount") {
      const selected = change.itemIds.length ? unique(change.itemIds, "La lista de costos") : candidate.items.map(item => item.id);
      const currentSimulation = buildSimulation(candidate, buildInitialOfferControls(candidate));
      for (const id of selected) {
        const index = itemIndex(candidate, id), item = candidate.items[index]!;
        if (currentSimulation.rows[index]!.baseCostUnit === null)
          throw new AnalysisConflictError(`No se puede descontar el costo del ítem ${item.item || item.id}: falta un costo base disponible.`);
        const previous = item.costScenarioDiscountPct ?? 0;
        const discount = change.basis === "current" ? 100 - (100 - previous) * (1 - change.discountPct / 100) : change.discountPct;
        for (const [field, value] of [["costScenarioMode", "lot"], ["costScenarioDiscountPct", discount]] as const) {
          addDiff(diff, change, "item", item.id, field, item[field], value);
          (item as unknown as Record<string, unknown>)[field] = value;
        }
        if (item.additionalCosts.some(cost => cost.reviewStatus !== "excluded"))
          warnings.push(`Ítem ${item.item || item.id}: el descuento de costo afecta al producto; los costos asociados se conservan.`);
      }
      continue;
    }

    if (change.type === "set_offer_discount") {
      const selected = change.itemIds.length ? unique(change.itemIds, "La lista de descuento") : candidate.items.map(item => item.id);
      const currentSimulation = buildSimulation(candidate, buildInitialOfferControls(candidate));
      for (const id of selected) {
        const index = itemIndex(candidate, id), item = candidate.items[index]!, row = currentSimulation.rows[index]!;
        const control = offerControlWithDiscountPct(row.control, change.discountPct, { costUnit: row.costUnit, referenceUnit: row.referenceUnit, offerUnit: row.offerUnit });
        if (!control) throw new AnalysisConflictError(`No se puede fijar descuento al ítem ${item.item || item.id}: falta un precio techo unitario incluido. Una referencia informativa no es un techo.`);
        const patch = { offerMode: control.mode, discountPct: control.discountPct, profitPct: control.profitPct, manualOfferUnit: control.manualOfferUnit, offerAdjustment: null };
        for (const [field, value] of Object.entries(patch)) {
          const record = item as unknown as Record<string, unknown>;
          if (same(record[field] ?? null, value)) continue;
          const count = diff.length;
          addDiff(diff, change, "item", item.id, field, record[field] ?? null, value);
          if (diff.length > count) diff.at(-1)!.beforePresent = Object.hasOwn(item, field);
          record[field] = value;
        }
      }
      continue;
    }

    if (change.type === "set_margin") {
      const selected = change.itemIds.length ? unique(change.itemIds, "La lista de margen") : candidate.items.map((item) => item.id);
      const currentSimulation = buildSimulation(candidate, buildInitialOfferControls(candidate));
      for (const id of selected) {
        const index = itemIndex(candidate, id);
        const item = candidate.items[index]!;
        const row = currentSimulation.rows[index]!;
        const control = offerControlWithProfitPct(row.control, change.marginPctOnCost, {
          costUnit: row.costUnit,
          referenceUnit: row.referenceUnit,
          offerUnit: row.offerUnit,
        });
        if (!control) {
          throw new AnalysisConflictError(`No se puede aplicar margen al ítem ${item.item || item.id}: falta un costo disponible.`);
        }
        addDiff(diff, change, "item", item.id, "offerMode", item.offerMode, control.mode);
        addDiff(diff, change, "item", item.id, "discountPct", item.discountPct, control.discountPct);
        addDiff(diff, change, "item", item.id, "profitPct", item.profitPct, control.profitPct);
        addDiff(diff, change, "item", item.id, "manualOfferUnit", item.manualOfferUnit, control.manualOfferUnit);
        item.offerMode = control.mode;
        item.discountPct = control.discountPct;
        item.profitPct = control.profitPct;
        item.manualOfferUnit = control.manualOfferUnit;
      }
      continue;
    }

    const ids = unique(change.itemIds, `El grupo ${change.groupId}`);
    ids.forEach((id) => itemIndex(candidate, id));
    if (groups.some((group) => group.groupId === change.groupId)) throw new AnalysisConflictError(`El grupo ${change.groupId} está repetido.`);
    const group = { groupId: change.groupId, label: change.label, itemIds: ids, reason: change.reason };
    groups.push(group);
    addDiff(diff, change, "analysis", null, `group:${change.groupId}`, null, group, false);
  }

  return {
    project: candidate,
    originalSimulation: buildSimulation(project, buildInitialOfferControls(project)),
    simulation: buildSimulation(candidate, buildInitialOfferControls(candidate)),
    diff,
    groups,
    warnings: [...new Set(warnings)],
  };
}
