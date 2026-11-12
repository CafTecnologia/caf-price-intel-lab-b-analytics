import { z } from "zod";

import {
  PRICE_SOURCE_CURRENCIES,
  parseMoneyLike,
  type FinancialOfferItem,
  type FinancialOfferPriceSource,
  type FinancialOfferProject,
  type PriceSourceCurrency,
} from "./contract";

const numberLike = z.union([z.number(), z.string()]).nullable().optional();

const ExternalPriceSourceSchema = z
  .object({
    source_id: z.string().trim().optional().nullable(),
    id: z.string().trim().optional().nullable(),
    name: z.string().trim().optional().nullable(),
    source: z.string().trim().optional().nullable(),
    provider: z.string().trim().optional().nullable(),
    unit_price: numberLike,
    price: numberLike,
    currency: z
      .string()
      .trim()
      .optional()
      .default("COP")
      .transform((value) => value.toUpperCase())
      .pipe(z.enum(PRICE_SOURCE_CURRENCIES)),
    url: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    trm: numberLike,
    import_pct: numberLike,
  })
  .strip();

const ExternalItemFieldsSchema = z
  .object({
    item: z.string().trim().optional().nullable(),
    name: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    technical_description: z.string().trim().optional().nullable(),
    quantity: numberLike,
    unit: z.string().trim().optional().nullable(),
    ceiling_unit_price: numberLike,
    reference_unit: numberLike,
    price_sources: z.array(ExternalPriceSourceSchema).optional(),
    notes: z.string().trim().optional().nullable(),
  })
  .strip();

const ExternalItemUpdateSchema = z
  .object({
    match: z
      .object({
        id: z.string().trim().optional().nullable(),
        item: z.string().trim().optional().nullable(),
        name: z.string().trim().optional().nullable(),
        description: z.string().trim().optional().nullable(),
      })
      .strip()
      .optional()
      .default({}),
    fields: ExternalItemFieldsSchema,
    append_if_missing: z.boolean().optional().default(false),
  })
  .strip();

export const ExternalProjectUpdateSchema = z
  .object({
    version: z.union([z.literal(2), z.literal("2")]).optional().default(2),
    source: z
      .object({
        system: z.string().trim().optional().nullable(),
        analysis_id: z.string().trim().optional().nullable(),
        run_id: z.string().trim().optional().nullable(),
        stage: z.string().trim().optional().nullable(),
        sequence: z.union([z.number(), z.string()]).optional().nullable(),
        sent_at: z.string().trim().optional().nullable(),
      })
      .strip()
      .optional()
      .default({}),
    idempotency_key: z.string().trim().optional().nullable(),
    items: z.array(ExternalItemUpdateSchema).min(1),
  })
  .strip();

export type ExternalProjectUpdate = z.output<typeof ExternalProjectUpdateSchema>;

export type ExternalUpdateApplied = {
  itemId: string;
  item: string;
  fields: string[];
};

export type ExternalUpdateConflict = {
  item?: string;
  field?: string;
  reason: string;
};

export type ExternalUpdateResult = {
  project: FinancialOfferProject;
  applied: ExternalUpdateApplied[];
  conflicts: ExternalUpdateConflict[];
  changed: boolean;
};

type ExternalItemFields = z.output<typeof ExternalItemFieldsSchema>;
type ExternalPriceSource = z.output<typeof ExternalPriceSourceSchema>;

export function applyExternalProjectUpdate(project: FinancialOfferProject, input: unknown): ExternalUpdateResult {
  const update = ExternalProjectUpdateSchema.parse(input);
  const items = [...project.items];
  const applied: ExternalUpdateApplied[] = [];
  const conflicts: ExternalUpdateConflict[] = [];

  for (const incoming of update.items) {
    const matchIndex = findItemIndex(items, incoming.match);
    if (matchIndex < 0) {
      if (!incoming.append_if_missing) {
        conflicts.push({
          item: incoming.match.item ?? incoming.fields.item ?? incoming.match.name ?? undefined,
          reason: "item_not_found",
        });
        continue;
      }
      const created = buildExternalItem(project, incoming.fields, items.length + 1);
      items.push(created);
      applied.push({ itemId: created.id, item: created.item, fields: ["created"] });
      continue;
    }

    const current = items[matchIndex]!;
    const { item, fields } = mergeExternalItemFields(current, incoming.fields);
    items[matchIndex] = item;
    if (fields.length) {
      applied.push({ itemId: item.id, item: item.item, fields });
    }
  }

  const changed = applied.some((entry) => entry.fields.length > 0);
  return {
    project: changed ? { ...project, items } : project,
    applied,
    conflicts,
    changed,
  };
}

function findItemIndex(
  items: FinancialOfferItem[],
  match: { id?: string | null; item?: string | null; name?: string | null; description?: string | null },
): number {
  const id = clean(match.id);
  if (id) {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) return index;
  }

  const itemLabel = clean(match.item);
  if (itemLabel) {
    const index = items.findIndex((item) => item.item.trim() === itemLabel);
    if (index >= 0) return index;
  }

  const name = normalizeText(match.name);
  if (name) {
    const index = items.findIndex((item) => normalizeText(item.description) === name);
    if (index >= 0) return index;
  }

  const description = normalizeText(match.description);
  if (description) {
    const index = items.findIndex((item) => normalizeText(item.technicalDescription) === description);
    if (index >= 0) return index;
  }

  return -1;
}

function mergeExternalItemFields(
  current: FinancialOfferItem,
  fields: ExternalItemFields,
): { item: FinancialOfferItem; fields: string[] } {
  const next = { ...current };
  const changed: string[] = [];

  setStringField(next, "item", fields.item, "item", changed);
  setStringField(next, "description", fields.name, "name", changed);
  setStringField(next, "technicalDescription", fields.description ?? fields.technical_description, "description", changed);
  setNumberField(next, "quantity", fields.quantity, "quantity", changed);
  setStringField(next, "unit", fields.unit, "unit", changed);
  setNumberField(next, "referenceUnit", fields.ceiling_unit_price ?? fields.reference_unit, "ceiling_unit_price", changed);
  setStringField(next, "notes", fields.notes, "notes", changed);

  if (fields.price_sources !== undefined) {
    const mergedSources = mergePriceSources(next.priceSources, fields.price_sources);
    if (JSON.stringify(mergedSources) !== JSON.stringify(next.priceSources)) {
      next.priceSources = mergedSources;
      changed.push("price_sources");
    }
  }

  return { item: next, fields: changed };
}

function buildExternalItem(project: FinancialOfferProject, fields: ExternalItemFields, index: number): FinancialOfferItem {
  const itemLabel = clean(fields.item) || String(index);
  return {
    id: `external-${Date.now()}-${index}`,
    item: itemLabel,
    description: clean(fields.name) || `Item ${itemLabel}`,
    technicalDescription: clean(fields.description ?? fields.technical_description) || "",
    deliverableType: null,
    quantity: parseMoneyLike(fields.quantity),
    unit: clean(fields.unit) || "",
    referenceUnit: parseMoneyLike(fields.ceiling_unit_price ?? fields.reference_unit),
    costOptimistic: null,
    costModerate: null,
    costWeightedUnit: null,
    manualUnitCost: null,
    selectedCostMode: project.settings.defaultCostMode,
    costScenarioMode: null,
    costScenarioDiscountPct: null,
    priceSources: mergePriceSources([], fields.price_sources ?? []),
    additionalCosts: [],
    offerMode: null,
    discountPct: null,
    profitPct: null,
    manualOfferUnit: null,
    vatMode: "included",
    vatRate: project.settings.vatRate,
    source1: "",
    source2: "",
    source3: "",
    notes: clean(fields.notes) || "",
  };
}

function mergePriceSources(
  currentSources: FinancialOfferPriceSource[],
  incomingSources: ExternalPriceSource[],
): FinancialOfferPriceSource[] {
  const next = currentSources.map((source) => ({ ...source }));

  for (const incoming of incomingSources) {
    const key = clean(incoming.source_id) || clean(incoming.id);
    const label = clean(incoming.name) || clean(incoming.provider) || clean(incoming.source);
    const url = clean(incoming.url);
    const index = findSourceIndex(next, key, label, url);
    const existing = index >= 0 ? next[index]! : null;
    const source = normalizeIncomingSource(incoming, existing, next.length);
    if (!source) continue;
    if (index >= 0) {
      next[index] = source;
    } else {
      next.push(source);
    }
  }

  return next;
}

function findSourceIndex(sources: FinancialOfferPriceSource[], key: string | null, label: string | null, url: string | null): number {
  if (key) {
    const byId = sources.findIndex((source) => source.id === key);
    if (byId >= 0) return byId;
  }
  if (url) {
    const byUrl = sources.findIndex((source) => source.url && source.url === url);
    if (byUrl >= 0) return byUrl;
  }
  if (label) {
    const normalizedLabel = normalizeText(label);
    const byLabel = sources.findIndex((source) => normalizeText(source.label) === normalizedLabel);
    if (byLabel >= 0) return byLabel;
  }
  return -1;
}

function normalizeIncomingSource(
  incoming: ExternalPriceSource,
  existing: FinancialOfferPriceSource | null,
  index: number,
): FinancialOfferPriceSource | null {
  const label = clean(incoming.name) || clean(incoming.provider) || clean(incoming.source);
  const unitPriceInput = incoming.unit_price ?? incoming.price;
  const unitPrice = unitPriceInput !== undefined ? parseMoneyLike(unitPriceInput) : existing?.unitPrice ?? null;
  const url = incoming.url !== undefined ? clean(incoming.url) || "" : existing?.url ?? "";
  const notes = incoming.notes !== undefined ? clean(incoming.notes) || "" : existing?.notes ?? "";
  const trm = incoming.trm !== undefined ? parseMoneyLike(incoming.trm) : existing?.trm ?? null;
  const importPct = incoming.import_pct !== undefined ? parseMoneyLike(incoming.import_pct) : existing?.importPct ?? null;
  const id = clean(incoming.source_id) || clean(incoming.id) || existing?.id || `source-${index + 1}`;

  if (!label && unitPrice === null && !url && !notes && !existing) {
    return null;
  }

  return {
    id,
    label: label || existing?.label || `Fuente ${index + 1}`,
    unitPrice,
    currency: (incoming.currency ?? existing?.currency ?? "COP") as PriceSourceCurrency,
    url,
    notes,
    trm,
    importPct,
  };
}

function setStringField(
  target: FinancialOfferItem,
  key: "item" | "description" | "technicalDescription" | "unit" | "notes",
  value: string | null | undefined,
  publicName: string,
  changed: string[],
) {
  if (value === undefined || value === null) return;
  const nextValue = value.trim();
  if (target[key] !== nextValue) {
    target[key] = nextValue;
    changed.push(publicName);
  }
}

function setNumberField(
  target: FinancialOfferItem,
  key: "quantity" | "referenceUnit",
  value: unknown,
  publicName: string,
  changed: string[],
) {
  if (value === undefined) return;
  const nextValue = parseMoneyLike(value);
  if (target[key] !== nextValue) {
    target[key] = nextValue;
    changed.push(publicName);
  }
}

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
