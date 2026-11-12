import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ADDITIONAL_COST_CATEGORIES,
  BudgetLimitsSchema,
  DELIVERABLE_TYPES,
  ProcurementLotInputSchema,
  OriginalSourceInputSchema,
  TechnicalAnnexExcerptInputSchema,
  ITEM_COST_MODES,
  PRICE_SOURCE_CURRENCIES,
  normalizeImportPayload,
  parseMoneyLike,
  toCalculation,
  type FinancialGeneralCost,
  type FinancialOfferItem,
  type FinancialOfferProject,
} from "./contract";
import { normalizeSourcePrice } from "./financial-engine";

const numberLike = z.union([z.number().finite(), z.string()]).nullable().optional();
const nonNegativeItemNumberLike = numberLike.refine((value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && (!value.trim() || /^(n\/d|nd|na|null|sin dato|-+)$/i.test(value.trim()))) return true;
  const parsed = parseMoneyLike(value);
  return parsed !== null && parsed >= 0;
}, "La cantidad y el techo unitario deben ser valores no negativos o estar vacíos.");

const nonNegativeMoneyLike = numberLike.refine(
  (value) => value == null || (parseMoneyLike(value) ?? -1) >= 0,
  "El valor monetario debe ser no negativo o estar vacío.",
);
const positiveRateLike = numberLike.refine(
  (value) => value == null || (parseMoneyLike(value) ?? 0) > 0,
  "La TRM debe ser positiva o estar vacía.",
);

const PublicPriceSourceSchema = z.object({
  id: z.string().trim().min(1).optional().nullable(),
  name: z.string().trim().optional().nullable(),
  unit_price: nonNegativeMoneyLike,
  currency: z.string().trim().optional().default("COP")
    .transform((value) => value.toUpperCase()).pipe(z.enum(PRICE_SOURCE_CURRENCIES)),
  url: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
  trm: positiveRateLike,
  import_pct: nonNegativeMoneyLike,
}).strict();

const PublicAdditionalCostSchema = z.object({
  id: z.string().trim().min(1).optional().nullable(),
  name: z.string().trim().min(1),
  category: z.enum(ADDITIONAL_COST_CATEGORIES).optional().default("service"),
  mode: z.enum(ITEM_COST_MODES).optional().default("fixed"),
  amount: nonNegativeMoneyLike,
  notes: z.string().trim().optional().default(""),
  review_status: z.enum(["suggested", "included", "excluded"]).optional().default("included"),
}).strict();

const PublicItemSchema = z.object({
  item: z.string().trim().optional().default(""),
  name: z.string().trim().min(1),
  description: z.string().trim().optional().default(""),
  procurement_lot: ProcurementLotInputSchema.nullable().optional(),
  source_original: OriginalSourceInputSchema.optional(),
  technical_annex: z.array(TechnicalAnnexExcerptInputSchema).optional(),
  cost_basis_status: z.enum(["conforming", "comparable_scenario", "partial", "pending"]).nullable().optional(),
  deliverable_type: z.enum(DELIVERABLE_TYPES).optional().nullable(),
  quantity: nonNegativeItemNumberLike,
  unit: z.string().trim().optional().default(""),
  ceiling_unit_price: nonNegativeItemNumberLike,
  official_reference_unit: nonNegativeItemNumberLike,
  price_sources: z.array(PublicPriceSourceSchema).optional().default([]),
  has_associated_cost: z.union([z.boolean(), z.string(), z.number()]).nullable().optional(),
  additional_costs: z.array(PublicAdditionalCostSchema).optional().default([]),
  notes: z.string().trim().optional().default(""),
}).strict().superRefine((item, context) => {
  const ids = item.additional_costs.map((cost) => cost.id?.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["additional_costs"], message: "Cada costo asociado debe tener un ID distinto." });
});

const ItemPatchSchema = z.object({
  item: z.string().trim().optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  procurement_lot: ProcurementLotInputSchema.nullable().optional(),
  source_original: OriginalSourceInputSchema.nullable().optional(),
  technical_annex: z.array(TechnicalAnnexExcerptInputSchema).optional(),
  cost_basis_status: z.enum(["conforming", "comparable_scenario", "partial", "pending"]).nullable().optional(),
  deliverable_type: z.enum(DELIVERABLE_TYPES).optional().nullable(),
  quantity: nonNegativeItemNumberLike,
  unit: z.string().trim().optional(),
  ceiling_unit_price: nonNegativeItemNumberLike,
  official_reference_unit: nonNegativeItemNumberLike,
  price_sources: z.array(PublicPriceSourceSchema).optional(),
  additional_costs: z.array(PublicAdditionalCostSchema).optional(),
  notes: z.string().trim().optional(),
}).strict();

const AddItemOperationSchema = z.object({
  type: z.literal("add_item"),
  key: z.string().trim().min(1).max(256),
  item: PublicItemSchema,
}).strict();

const UpdateItemOperationSchema = z.object({
  type: z.literal("update_item"),
  itemId: z.string().trim().min(1),
  patch: ItemPatchSchema,
  expected: ItemPatchSchema,
}).strict().superRefine((operation, context) => {
  const patchKeys = Object.keys(operation.patch).sort();
  const expectedKeys = Object.keys(operation.expected).sort();
  if (operation.patch.procurement_lot === null) {
    context.addIssue({ code: "custom", path: ["patch", "procurement_lot"], message: "La IA no puede borrar el lote contractual." });
  }
  if (operation.patch.source_original === null) {
    context.addIssue({ code: "custom", path: ["patch", "source_original"], message: "El texto original no se borra mediante operaciones de IA." });
  }
  if (!patchKeys.length) {
    context.addIssue({ code: "custom", path: ["patch"], message: "La actualización necesita al menos un campo." });
  }
  if (JSON.stringify(patchKeys) !== JSON.stringify(expectedKeys)) {
    context.addIssue({
      code: "custom", path: ["expected"],
      message: "expected debe incluir exactamente cada campo enviado en patch.",
    });
  }
});

const GeneralCostValueSchema = z.object({
  name: z.string().trim().min(1),
  category: z.enum(ADDITIONAL_COST_CATEGORIES).optional().default("other"),
  amount: z.union([z.number().finite(), z.string()]),
  notes: z.string().trim().optional().default(""),
}).strict().superRefine((cost, context) => {
  const amount = parseMoneyLike(cost.amount);
  if (amount === null || amount < 0) {
    context.addIssue({ code: "custom", path: ["amount"], message: "El costo general necesita un valor no negativo." });
  }
});

const GeneralCostUpsertSchema = z.object({
  id: z.string().trim().min(1),
  value: GeneralCostValueSchema,
  expected: GeneralCostValueSchema.nullable(),
}).strict();

const SetGeneralCostsOperationSchema = z.object({
  type: z.literal("set_general_costs"),
  costs: z.array(GeneralCostUpsertSchema).min(1),
}).strict();

const ProjectReferenceValueSchema = z.number().finite().nonnegative().nullable();

const SetProjectReferenceOperationSchema = z.object({
  type: z.literal("set_project_reference"),
  manual_reference_total: ProjectReferenceValueSchema,
  expected: z.object({
    manual_reference_total: ProjectReferenceValueSchema,
  }).strict(),
}).strict();

const SetBudgetLimitsOperationSchema = z.object({
  type: z.literal("set_budget_limits"), budget_limits: BudgetLimitsSchema,
  expected: z.object({ budget_limits: BudgetLimitsSchema }).strict(),
}).strict();
export const CalculationOperationsSchema = z.object({
  projectId: z.string().trim().min(1),
  odooProjectId: z.string().trim().min(1),
  externalRunId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  operationId: z.string().trim().min(1),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  operations: z.array(z.discriminatedUnion("type", [
    AddItemOperationSchema,
    UpdateItemOperationSchema,
    SetGeneralCostsOperationSchema,
    SetProjectReferenceOperationSchema,
    SetBudgetLimitsOperationSchema,
  ])).min(1),
}).strict();

export type CalculationOperationsInput = z.input<typeof CalculationOperationsSchema>;
export type ParsedCalculationOperationsInput = z.output<typeof CalculationOperationsSchema>;
export type CalculationOperation = ParsedCalculationOperationsInput["operations"][number];
export type CalculationOperationChange = {
  itemId: string;
  item: string;
  field: string;
  before: unknown;
  after: unknown;
};

export class CalculationOperationConflictError extends Error {
  readonly code = "CALCULATION_OPERATION_CONFLICT";
  constructor(
    message: string,
    readonly itemId: string | null = null,
    readonly field: string | null = null,
    readonly expected: unknown = undefined,
    readonly actual: unknown = undefined,
  ) {
    super(message);
    this.name = "CalculationOperationConflictError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function canonicalCalculationOperationDigest(input: ParsedCalculationOperationsInput): string {
  return createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex");
}

export function deterministicOperationItemId(projectId: string, key: string): string {
  const digest = createHash("sha256").update(`${projectId}\u0000${key}`).digest("hex");
  return `operation-item-${digest.slice(0, 32)}`;
}

function normalizePublicItem(item: z.output<typeof PublicItemSchema>, id: string): FinancialOfferItem {
  const normalized = normalizeImportPayload({ version: 2, items: [item] });
  const result = toCalculation(normalized, "operation-preview", "2000-01-01T00:00:00.000Z").items[0];
  if (!result) throw new Error("No se pudo normalizar el ítem de la operación.");
  return { ...result, id };
}

export function calculationOperationItemValues(item: FinancialOfferItem): z.output<typeof PublicItemSchema> {
  return PublicItemSchema.parse(publicItem(item));
}

function publicItem(item: FinancialOfferItem): z.input<typeof PublicItemSchema> {
  return {
    item: item.item,
    name: item.description,
    description: item.technicalDescription,
    procurement_lot: item.procurementLot ?? null,
    source_original: item.sourceOriginal,
    technical_annex: item.technicalAnnex,
    cost_basis_status: item.costBasisStatus,
    deliverable_type: item.deliverableType,
    quantity: item.quantity,
    unit: item.unit,
    ceiling_unit_price: item.referenceUnit,
    official_reference_unit: item.officialReferenceUnit ?? null,
    price_sources: item.priceSources.map((source) => ({
      id: source.id, name: source.label, unit_price: source.unitPrice,
      currency: source.currency, url: source.url, notes: source.notes,
      trm: source.trm, import_pct: source.importPct,
    })),
    additional_costs: item.additionalCosts.map((cost) => ({
      id: cost.id, name: cost.name, category: cost.category, mode: cost.mode,
      amount: cost.amount, notes: cost.notes, review_status: cost.reviewStatus ?? "included",
    })),
    notes: item.notes,
  };
}

const itemFieldMap = {
  item: "item",
  name: "description",
  description: "technicalDescription",
  procurement_lot: "procurementLot",
  source_original: "sourceOriginal",
  technical_annex: "technicalAnnex",
  cost_basis_status: "costBasisStatus",
  deliverable_type: "deliverableType",
  quantity: "quantity",
  unit: "unit",
  ceiling_unit_price: "referenceUnit",
  official_reference_unit: "officialReferenceUnit",
  price_sources: "priceSources",
  additional_costs: "additionalCosts",
  notes: "notes",
} as const;
type PublicItemField = keyof typeof itemFieldMap;

function normalizedFields(
  current: FinancialOfferItem,
  fields: z.output<typeof ItemPatchSchema>,
): Partial<FinancialOfferItem> {
  const normalizedInput = { ...publicItem(current), ...fields };
  if (normalizedInput.source_original === null) delete normalizedInput.source_original;
  const parsed = PublicItemSchema.parse(normalizedInput);
  const normalized = normalizePublicItem(parsed, current.id);
  return Object.fromEntries(Object.keys(fields).map((field) => {
    const internalField = itemFieldMap[field as PublicItemField];
    return [internalField, structuredClone(normalized[internalField])];
  })) as Partial<FinancialOfferItem>;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function comparableOptionalItemField(field: string, value: unknown): unknown {
  if (field === "technical_annex") return value ?? [];
  if (field === "procurement_lot" || field === "source_original" || field === "cost_basis_status" || field === "official_reference_unit") return value ?? null;
  return value;
}

function normalizedGeneralCost(id: string, value: z.output<typeof GeneralCostValueSchema>): FinancialGeneralCost {
  return {
    id,
    name: value.name,
    category: value.category,
    amount: Math.max(0, parseMoneyLike(value.amount) ?? 0),
    notes: value.notes,
  };
}

function publicGeneralCost(cost: FinancialGeneralCost): z.output<typeof GeneralCostValueSchema> {
  return { name: cost.name, category: cost.category, amount: cost.amount, notes: cost.notes };
}

export type ApplyCalculationOperationBatchResult = {
  project: FinancialOfferProject;
  createdItemIds: string[];
  updatedItemIds: string[];
  changes: CalculationOperationChange[];
};

function assertFiniteOperationItem(item: FinancialOfferItem, settings: FinancialOfferProject["settings"]): void {
  const quantity = item.quantity ?? 1;
  const unitValues = item.priceSources.map((source) => normalizeSourcePrice(source, settings, item.notes).normalizedUnit);
  let sourceSum = 0;
  for (const value of unitValues) {
    if (value === null) continue;
    sourceSum += value;
    if (!Number.isFinite(value) || !Number.isFinite(sourceSum) || !Number.isFinite(value * quantity)
        || value > Number.MAX_SAFE_INTEGER || sourceSum > Number.MAX_SAFE_INTEGER
        || value * quantity > Number.MAX_SAFE_INTEGER) {
      throw new CalculationOperationConflictError("El costo de una fuente produce un resultado no finito.", item.id, "price_sources");
    }
  }
  for (const value of [item.referenceUnit, item.manualUnitCost]) {
    if (value !== null && (!Number.isFinite(value * quantity) || value > Number.MAX_SAFE_INTEGER
        || value * quantity > Number.MAX_SAFE_INTEGER)) {
      throw new CalculationOperationConflictError("La cantidad produce un resultado monetario no finito.", item.id, "quantity");
    }
  }
  let associatedTotal = 0;
  for (const cost of item.additionalCosts) {
    if (cost.reviewStatus !== "included" || cost.amount === null) continue;
    const amount = cost.mode === "per_unit" ? cost.amount * quantity : cost.amount;
    associatedTotal += amount;
    if (!Number.isFinite(amount) || !Number.isFinite(associatedTotal)
        || amount > Number.MAX_SAFE_INTEGER || associatedTotal > Number.MAX_SAFE_INTEGER) {
      throw new CalculationOperationConflictError("Los costos asociados producen un resultado no finito.", item.id, "additional_costs");
    }
  }
}

export function applyCalculationOperationBatch(
  project: FinancialOfferProject,
  input: ParsedCalculationOperationsInput,
): ApplyCalculationOperationBatchResult {
  let items = structuredClone(project.items);
  let generalCosts = structuredClone(project.generalCosts);
  let settings = structuredClone(project.settings);
  const createdItemIds: string[] = [];
  const updatedItemIds = new Set<string>();
  const changes: CalculationOperationChange[] = [];

  for (const operation of input.operations) {
    if (operation.type === "add_item") {
      const id = deterministicOperationItemId(input.projectId, operation.key);
      if (operation.item.additional_costs.some((cost) => cost.review_status !== "suggested")) {
        throw new CalculationOperationConflictError("Los costos asociados nuevos requieren decisión humana.", id, "additional_costs");
      }
      const added = normalizePublicItem(operation.item, id);
      assertFiniteOperationItem(added, settings);
      const existing = items.find((item) => item.id === id);
      if (existing) {
        if (!equal(captureOperationItem(existing), captureOperationItem(added))) {
          throw new CalculationOperationConflictError(
            `La clave ${operation.key} ya fue usada con contenido distinto.`, id, "key",
            captureOperationItem(added), captureOperationItem(existing),
          );
        }
        continue;
      }
      if (items.some((item) => item.id === added.id)) {
        throw new CalculationOperationConflictError("El identificador determinista del ítem ya existe.", added.id, "id");
      }
      items.push(added);
      createdItemIds.push(added.id);
      changes.push({ itemId: added.id, item: added.item, field: "item", before: null, after: captureOperationItem(added) });
      continue;
    }

    if (operation.type === "update_item") {
      const index = items.findIndex((item) => item.id === operation.itemId);
      if (index < 0) {
        throw new CalculationOperationConflictError(`El ítem ${operation.itemId} no existe.`, operation.itemId, "id");
      }
      const current = items[index]!;
      if (operation.patch.additional_costs) {
        const existingCosts = new Map(current.additionalCosts.map((cost) => [cost.id, cost]));
        const existingPublicCosts = new Map((publicItem(current).additional_costs ?? []).map((cost) => [cost.id, cost]));
        const proposedCosts = new Map(operation.patch.additional_costs.map((cost) => [cost.id, cost]));
        for (const previous of current.additionalCosts) {
          const proposed = proposedCosts.get(previous.id);
          if (!proposed) {
            throw new CalculationOperationConflictError("La IA no puede quitar un costo asociado existente.", current.id, "additional_costs");
          }
          if ((previous.reviewStatus ?? "included") !== "suggested" && !equal(proposed, existingPublicCosts.get(previous.id))) {
            throw new CalculationOperationConflictError("La IA no puede cambiar un costo asociado decidido por una persona.", current.id, "additional_costs");
          }
        }
        for (const cost of operation.patch.additional_costs) {
          const previous = cost.id ? existingCosts.get(cost.id) : undefined;
          if (previous ? cost.review_status !== (previous.reviewStatus ?? "included") : cost.review_status !== "suggested") {
            throw new CalculationOperationConflictError("La IA no puede decidir si aplica un costo asociado.", current.id, "additional_costs");
          }
        }
      }
      const expected = normalizedFields(current, operation.expected);
      const patch = normalizedFields(current, operation.patch);
      for (const field of Object.keys(operation.patch) as PublicItemField[]) {
        const internalField = itemFieldMap[field];
        const actualValue = current[internalField];
        const expectedValue = expected[internalField];
        const nextValue = patch[internalField];
        const comparableActual = comparableOptionalItemField(field, actualValue);
        if (!equal(comparableActual, comparableOptionalItemField(field, expectedValue))
            && !equal(comparableActual, comparableOptionalItemField(field, nextValue))) {
          throw new CalculationOperationConflictError(
            `El campo ${field} del ítem ${current.item || current.id} cambió después de preparar la operación.`,
            current.id, field, expectedValue, actualValue,
          );
        }
      }
      const next = { ...current, ...patch } as FinancialOfferItem;
      assertFiniteOperationItem(next, settings);
      const capturedFields = new Map<string, keyof FinancialOfferItem>(
        (Object.keys(operation.patch) as PublicItemField[]).map((field) => [field, itemFieldMap[field]]),
      );
      if (current.deliverableType !== "service" && next.deliverableType === "service") {
        if (!current.manualCostReviewed) {
          next.selectedCostMode = "manual";
          next.manualUnitCost = null;
          next.costBasisStatus = "pending";
          capturedFields.set("selected_cost_mode", "selectedCostMode");
          capturedFields.set("manual_unit_cost", "manualUnitCost");
          capturedFields.set("cost_basis_status", "costBasisStatus");
        }
        if (!current.additionalCostsReviewed) {
          next.additionalCosts = next.additionalCosts.map((cost) => ({ ...cost, reviewStatus: "suggested" }));
          capturedFields.set("additional_costs", "additionalCosts");
        }
      }
      for (const [field, internalField] of capturedFields) {
        if (!equal(current[internalField], next[internalField])) {
          changes.push({
            itemId: current.id, item: next.item, field,
            before: structuredClone(current[internalField] ?? null), after: structuredClone(next[internalField] ?? null),
          });
          updatedItemIds.add(current.id);
        }
      }
      items[index] = next;
      continue;
    }

    if (operation.type === "set_budget_limits") {
      const actual = settings.budgetLimits ?? [], next = operation.budget_limits;
      if (!equal(actual, operation.expected.budget_limits) && !equal(actual, next))
        throw new CalculationOperationConflictError("Los máximos documentales cambiaron después de preparar la operación.", "project-settings", "budget_limits");
      for (const limit of next) {
        if (limit.maximum > Number.MAX_SAFE_INTEGER || (limit.procurementLotId !== null && !items.some(item => item.procurementLot?.id === limit.procurementLotId)))
          throw new CalculationOperationConflictError("Máximo fuera de rango o componente ajeno al cálculo.", "project-settings", "budget_limits");
      }
      if (!equal(actual, next)) {
        settings = { ...settings, budgetLimits: structuredClone(next) };
        changes.push({ itemId:"project-settings", item:project.name, field:"budget_limits", before:actual, after:next });
      }
      continue;
    }
    if (operation.type === "set_project_reference") {
      const actual = settings.manualReferenceTotal;
      const expected = operation.expected.manual_reference_total;
      const next = operation.manual_reference_total;
      if (!equal(actual, expected) && !equal(actual, next)) {
        throw new CalculationOperationConflictError(
          "La referencia global cambió después de preparar la operación.",
          "project-settings", "manual_reference_total", expected, actual,
        );
      }
      if (next !== null && next > Number.MAX_SAFE_INTEGER) {
        throw new CalculationOperationConflictError("La referencia global excede el rango monetario preciso.", "project-settings", "manual_reference_total");
      }
      if (!equal(actual, next)) {
        settings = { ...settings, manualReferenceTotal: next };
        changes.push({
          itemId: "project-settings",
          item: project.name,
          field: "manual_reference_total",
          before: actual,
          after: next,
        });
      }
      continue;
    }

    const seen = new Set<string>();
    for (const upsert of operation.costs) {
      if (seen.has(upsert.id)) throw new Error(`El costo general ${upsert.id} aparece dos veces en la operación.`);
      seen.add(upsert.id);
      const index = generalCosts.findIndex((cost) => cost.id === upsert.id);
      const current = index < 0 ? null : generalCosts[index]!;
      const expected = upsert.expected === null ? null : normalizedGeneralCost(upsert.id, upsert.expected);
      const next = normalizedGeneralCost(upsert.id, upsert.value);
      if (!equal(current, expected) && !equal(current, next)) {
        throw new CalculationOperationConflictError(
          `El costo general ${upsert.id} cambió después de preparar la operación.`,
          `general-cost:${upsert.id}`, "general_cost", expected, current,
        );
      }
      if (equal(current, next)) continue;
      if (index < 0) generalCosts.push(next);
      else generalCosts[index] = next;
      changes.push({
        itemId: `general-cost:${upsert.id}`, item: next.name, field: "general_cost",
        before: current ? publicGeneralCost(current) : null, after: publicGeneralCost(next),
      });
    }
    if (generalCosts.some((cost) => cost.amount > Number.MAX_SAFE_INTEGER)
        || !Number.isFinite(generalCosts.reduce((total, cost) => total + cost.amount, 0))
        || generalCosts.reduce((total, cost) => total + cost.amount, 0) > Number.MAX_SAFE_INTEGER) {
      throw new CalculationOperationConflictError("Los costos generales producen un resultado no finito.", "general-costs", "general_cost");
    }
  }

  return {
    project: { ...project, settings, items, generalCosts },
    createdItemIds,
    updatedItemIds: [...updatedItemIds],
    changes,
  };
}

function captureOperationItem(item: FinancialOfferItem): unknown {
  return PublicItemSchema.parse(publicItem(item));
}
