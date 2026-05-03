import { z } from "zod";

export const COST_MODES = ["optimistic", "moderate", "weighted", "manual"] as const;
export type CostMode = (typeof COST_MODES)[number];

export const PRICE_SOURCE_CURRENCIES = ["COP", "USD"] as const;
export type PriceSourceCurrency = (typeof PRICE_SOURCE_CURRENCIES)[number];

export const VAT_MODES = ["included", "excluded", "exempt"] as const;
export type VatMode = (typeof VAT_MODES)[number];

export const OFFER_MODES = ["discount", "profit", "manual"] as const;
export type PersistedOfferMode = (typeof OFFER_MODES)[number];

const numberLike = z.union([z.number(), z.string()]).nullable().optional();
const booleanLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();

const PriceSourceInputSchema = z
  .object({
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
    url: z.string().trim().optional().default(""),
    notes: z.string().trim().optional().default(""),
    trm: numberLike,
    import_pct: numberLike,
  })
  .strip();

const CalculationMetaInputSchema = z
  .object({
    external_id: z.string().trim().optional().nullable(),
    source_system: z.string().trim().optional().nullable(),
    /** Odoo project id or external ref (optional). */
    odoo_project_id: z.string().trim().optional().nullable(),
    /** IA pipeline run id (optional). */
    ia_run_id: z.string().trim().optional().nullable(),
    /** Unified analysis id from the IA app (optional). */
    source_analysis_id: z.string().trim().optional().nullable(),
    name: z.string().trim().min(1),
    entity: z.string().trim().optional().nullable(),
    currency: z
      .string()
      .trim()
      .optional()
      .default("COP")
      .transform((value) => value.toUpperCase())
      .refine((value) => value === "COP", "Por ahora la calculadora solo acepta valores normalizados en COP."),
  })
  .strip();

export const FinancialOfferItemInputSchema = z
  .object({
    item: z.string().trim().optional().default(""),
    description: z.string().trim().min(1),
    technical_description: z.string().trim().optional().default(""),
    quantity: numberLike,
    unit: z.string().trim().optional().default(""),
    reference_unit: numberLike,
    cost_optimistic: numberLike,
    cost_moderate: numberLike,
    cost_weighted_unit: numberLike,
    manual_unit_cost: numberLike,
    selected_cost_mode: z.enum(COST_MODES).optional().default("weighted"),
    price_sources: z.array(PriceSourceInputSchema).optional().default([]),
    source_1_name: z.string().trim().optional().default(""),
    source_1_price: numberLike,
    source_1_currency: z.string().trim().optional().default("COP").transform((value) => value.toUpperCase()).pipe(z.enum(PRICE_SOURCE_CURRENCIES)),
    source_1_url: z.string().trim().optional().default(""),
    source_1_trm: numberLike,
    source_1_import_pct: numberLike,
    source_2_name: z.string().trim().optional().default(""),
    source_2_price: numberLike,
    source_2_currency: z.string().trim().optional().default("COP").transform((value) => value.toUpperCase()).pipe(z.enum(PRICE_SOURCE_CURRENCIES)),
    source_2_url: z.string().trim().optional().default(""),
    source_2_trm: numberLike,
    source_2_import_pct: numberLike,
    source_3_name: z.string().trim().optional().default(""),
    source_3_price: numberLike,
    source_3_currency: z.string().trim().optional().default("COP").transform((value) => value.toUpperCase()).pipe(z.enum(PRICE_SOURCE_CURRENCIES)),
    source_3_url: z.string().trim().optional().default(""),
    source_3_trm: numberLike,
    source_3_import_pct: numberLike,
    offer_mode: z.enum(OFFER_MODES).optional().nullable(),
    discount_pct: numberLike,
    profit_pct: numberLike,
    manual_offer_unit: numberLike,
    vat_mode: z.enum(VAT_MODES).optional().default("included"),
    vat_rate: numberLike,
    source_1: z.string().trim().optional().default(""),
    source_2: z.string().trim().optional().default(""),
    source_3: z.string().trim().optional().default(""),
    notes: z.string().trim().optional().default(""),
  })
  .strip();

export const FinancialOfferSettingsInputSchema = z
  .object({
    vat_rate: numberLike,
    default_margin: numberLike,
    default_cost_mode: z.enum(COST_MODES).optional().default("weighted"),
    manual_cost_priority: booleanLike,
    usd_to_cop_rate: numberLike,
    usd_import_pct: numberLike,
  })
  .partial()
  .default({});

const LegacyImportSchema = z
  .object({
    project: CalculationMetaInputSchema,
    items: z.array(FinancialOfferItemInputSchema).min(1),
    settings: FinancialOfferSettingsInputSchema,
  })
  .strip();

const CalculationImportSchema = z
  .object({
    version: z.union([z.literal(1), z.literal("1")]).optional().default(1),
    calculation: CalculationMetaInputSchema.extend({
      items: z.array(FinancialOfferItemInputSchema).optional(),
      settings: FinancialOfferSettingsInputSchema.optional(),
    }).strip(),
    items: z.array(FinancialOfferItemInputSchema).optional(),
    settings: FinancialOfferSettingsInputSchema.optional(),
  })
  .strip();

export type FinancialOfferImportInput = unknown;

export type FinancialOfferImport = {
  version: 1;
  calculation: z.output<typeof CalculationMetaInputSchema>;
  items: z.output<typeof FinancialOfferItemInputSchema>[];
  settings: z.output<typeof FinancialOfferSettingsInputSchema>;
};

export type FinancialOfferCalculation = {
  id: string;
  externalId: string | null;
  sourceSystem: string | null;
  odooProjectId: string | null;
  iaRunId: string | null;
  sourceAnalysisId: string | null;
  name: string;
  entity: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    vatRate: number;
    defaultMargin: number;
    defaultCostMode: CostMode;
    manualCostPriority: boolean;
    usdToCopRate: number | null;
    usdImportPct: number;
  };
  items: FinancialOfferItem[];
};

export type FinancialOfferProject = FinancialOfferCalculation;

export type FinancialOfferPriceSource = {
  id: string;
  label: string;
  unitPrice: number | null;
  currency: PriceSourceCurrency;
  url: string;
  notes: string;
  trm: number | null;
  importPct: number | null;
};

export type FinancialOfferItem = {
  id: string;
  item: string;
  description: string;
  technicalDescription: string;
  quantity: number | null;
  unit: string;
  referenceUnit: number | null;
  costOptimistic: number | null;
  costModerate: number | null;
  costWeightedUnit: number | null;
  manualUnitCost: number | null;
  selectedCostMode: CostMode;
  priceSources: FinancialOfferPriceSource[];
  offerMode: PersistedOfferMode | null;
  discountPct: number | null;
  profitPct: number | null;
  manualOfferUnit: number | null;
  vatMode: VatMode;
  vatRate: number | null;
  source1: string;
  source2: string;
  source3: string;
  notes: string;
};

export function parseMoneyLike(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/COP|COL\$|\$|USD/gi, " ")
    .trim();
  if (!text || /^(n\/d|nd|na|null|sin dato|-+)$/i.test(text)) {
    return null;
  }

  const match = text.match(/-?\d[\d.,\s]*/);
  if (!match) {
    return null;
  }

  let numberText = match[0].replace(/\s/g, "");
  const commaIndex = numberText.lastIndexOf(",");
  const dotIndex = numberText.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    numberText = commaIndex > dotIndex ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    const decimals = numberText.length - commaIndex - 1;
    numberText = decimals > 0 && decimals <= 2 ? numberText.replace(/\./g, "").replace(",", ".") : numberText.replace(/,/g, "");
  } else if (dotIndex >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(numberText)) {
    numberText = numberText.replace(/\./g, "");
  }

  const parsed = Number(numberText);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanLike(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return /^(true|1|si|yes|y)$/i.test(value.trim());
  }
  return fallback;
}

function normalizeLegacySourceText(value: string): string {
  return value.trim();
}

function normalizePriceSource(input: {
  id?: string | null;
  label?: string | null;
  unitPrice?: unknown;
  currency?: PriceSourceCurrency;
  url?: string | null;
  notes?: string | null;
  trm?: unknown;
  importPct?: unknown;
}, index: number): FinancialOfferPriceSource | null {
  const unitPrice = parseMoneyLike(input.unitPrice);
  const rawLabel = input.label?.trim() ?? "";
  const url = input.url?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";
  const trm = parseMoneyLike(input.trm);
  const importPct = parseMoneyLike(input.importPct);

  if (unitPrice === null && !url && !notes && !rawLabel) {
    return null;
  }

  return {
    id: input.id?.trim() || `source-${index + 1}`,
    label: rawLabel || `Fuente ${index + 1}`,
    unitPrice,
    currency: input.currency ?? "COP",
    url,
    notes,
    trm,
    importPct,
  };
}

function normalizePriceSources(item: z.output<typeof FinancialOfferItemInputSchema>): FinancialOfferPriceSource[] {
  const structured = item.price_sources
    .map((source, index) =>
      normalizePriceSource(
        {
          id: source.id,
          label: source.name || source.provider || source.source,
          unitPrice: source.unit_price ?? source.price,
          currency: source.currency,
          url: source.url,
          notes: source.notes,
          trm: source.trm,
          importPct: source.import_pct,
        },
        index,
      ),
    )
    .filter((source): source is FinancialOfferPriceSource => source !== null);

  const flatSources = [1, 2, 3]
    .map((number, index) => {
      const text = normalizeLegacySourceText(item[`source_${number}` as "source_1" | "source_2" | "source_3"] ?? "");
      const name = item[`source_${number}_name` as "source_1_name" | "source_2_name" | "source_3_name"] || text || `Fuente ${number}`;
      const price = item[`source_${number}_price` as "source_1_price" | "source_2_price" | "source_3_price"] ?? (text ? text : null);
      return normalizePriceSource(
        {
          id: `source-${number}`,
          label: name,
          unitPrice: price,
          currency: item[`source_${number}_currency` as "source_1_currency" | "source_2_currency" | "source_3_currency"],
          url: item[`source_${number}_url` as "source_1_url" | "source_2_url" | "source_3_url"],
          notes: text,
          trm: item[`source_${number}_trm` as "source_1_trm" | "source_2_trm" | "source_3_trm"],
          importPct: item[`source_${number}_import_pct` as "source_1_import_pct" | "source_2_import_pct" | "source_3_import_pct"],
        },
        structured.length + index,
      );
    })
    .filter((source): source is FinancialOfferPriceSource => source !== null);

  const seen = new Set<string>();
  return [...structured, ...flatSources].filter((source) => {
    const key = `${source.label}|${source.unitPrice}|${source.currency}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeImportPayload(input: unknown): FinancialOfferImport {
  const raw = z.object({ calculation: z.unknown().optional(), project: z.unknown().optional() }).passthrough().parse(input);

  if (raw.calculation !== undefined) {
    const parsed = CalculationImportSchema.parse(input);
    const items = parsed.items ?? parsed.calculation.items ?? [];
    if (!items.length) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["items"],
          message: "Debe incluir al menos un item en calculation.items o items.",
          input,
        },
      ]);
    }
    return {
      version: 1,
      calculation: {
        external_id: parsed.calculation.external_id,
        source_system: parsed.calculation.source_system,
        odoo_project_id: parsed.calculation.odoo_project_id,
        ia_run_id: parsed.calculation.ia_run_id,
        source_analysis_id: parsed.calculation.source_analysis_id,
        name: parsed.calculation.name,
        entity: parsed.calculation.entity,
        currency: parsed.calculation.currency,
      },
      items,
      settings: {
        ...(parsed.calculation.settings ?? {}),
        ...(parsed.settings ?? {}),
      },
    };
  }

  const legacy = LegacyImportSchema.parse(input);
  return {
    version: 1,
    calculation: legacy.project,
    items: legacy.items,
    settings: legacy.settings,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t.length ? t : null;
}

/** When a link field is omitted on re-import, keep the previous stored value. */
export function mergeCalculationLinkFields(
  meta: FinancialOfferImport["calculation"],
  existing: Pick<FinancialOfferCalculation, "odooProjectId" | "iaRunId" | "sourceAnalysisId"> | null | undefined,
): Pick<FinancialOfferCalculation, "odooProjectId" | "iaRunId" | "sourceAnalysisId"> {
  return {
    odooProjectId: meta.odoo_project_id !== undefined ? trimOrNull(meta.odoo_project_id) : (existing?.odooProjectId ?? null),
    iaRunId: meta.ia_run_id !== undefined ? trimOrNull(meta.ia_run_id) : (existing?.iaRunId ?? null),
    sourceAnalysisId: meta.source_analysis_id !== undefined ? trimOrNull(meta.source_analysis_id) : (existing?.sourceAnalysisId ?? null),
  };
}

export function toCalculation(input: FinancialOfferImport, id: string, now: string): FinancialOfferCalculation {
  const defaultVatRate = parseMoneyLike(input.settings.vat_rate) ?? 19;
  const defaultUsdImportPct = parseMoneyLike(input.settings.usd_import_pct) ?? 30;
  return {
    id,
    externalId: input.calculation.external_id?.trim() || null,
    sourceSystem: input.calculation.source_system?.trim() || null,
    odooProjectId: trimOrNull(input.calculation.odoo_project_id),
    iaRunId: trimOrNull(input.calculation.ia_run_id),
    sourceAnalysisId: trimOrNull(input.calculation.source_analysis_id),
    name: input.calculation.name,
    entity: input.calculation.entity?.trim() || null,
    currency: input.calculation.currency || "COP",
    createdAt: now,
    updatedAt: now,
    settings: {
      vatRate: defaultVatRate,
      defaultMargin: parseMoneyLike(input.settings.default_margin) ?? 0,
      defaultCostMode: input.settings.default_cost_mode ?? "weighted",
      manualCostPriority: parseBooleanLike(input.settings.manual_cost_priority, false),
      usdToCopRate: parseMoneyLike(input.settings.usd_to_cop_rate),
      usdImportPct: defaultUsdImportPct,
    },
    items: input.items.map((item, index) => ({
      id: `${item.item || "item"}-${index + 1}`,
      item: item.item || String(index + 1),
      description: item.description,
      technicalDescription: item.technical_description,
      quantity: parseMoneyLike(item.quantity),
      unit: item.unit,
      referenceUnit: parseMoneyLike(item.reference_unit),
      costOptimistic: parseMoneyLike(item.cost_optimistic),
      costModerate: parseMoneyLike(item.cost_moderate),
      costWeightedUnit: parseMoneyLike(item.cost_weighted_unit),
      manualUnitCost: parseMoneyLike(item.manual_unit_cost),
      selectedCostMode: item.selected_cost_mode,
      priceSources: normalizePriceSources(item),
      offerMode: item.offer_mode ?? null,
      discountPct: parseMoneyLike(item.discount_pct),
      profitPct: parseMoneyLike(item.profit_pct),
      manualOfferUnit: parseMoneyLike(item.manual_offer_unit),
      vatMode: item.vat_mode,
      vatRate: parseMoneyLike(item.vat_rate) ?? defaultVatRate,
      source1: item.source_1,
      source2: item.source_2,
      source3: item.source_3,
      notes: item.notes,
    })),
  };
}

export const toProject = toCalculation;

export function sampleImportPayload(): FinancialOfferImportInput {
  return {
    version: 1,
    calculation: {
      external_id: null,
      source_system: "demo",
      name: "Laboratorio de calculo financiero",
      entity: "Entidad demo - pruebas internas",
      currency: "COP",
    },
    items: [
      {
        item: "1",
        description: "Taladro percutor profesional",
        technical_description: "Caso normal: tres fuentes, una en USD. Sirve para probar minimo, promedio y moderado.",
        quantity: 2,
        unit: "UND",
        reference_unit: 350000,
        selected_cost_mode: "weighted",
        price_sources: [
          {
            name: "Proveedor A",
            unit_price: 210000,
            currency: "COP",
            url: "https://proveedor.example/a",
          },
          {
            name: "Proveedor USA",
            unit_price: 55,
            currency: "USD",
            url: "https://store.example/tool",
            import_pct: 30,
          },
          {
            name: "Proveedor B",
            unit_price: 260000,
            currency: "COP",
            url: "https://proveedor.example/b",
          },
        ],
        offer_mode: "discount",
        discount_pct: 0,
        profit_pct: null,
        manual_offer_unit: null,
        vat_mode: "included",
        vat_rate: 19,
        notes: "Oferta inicial igual al techo: descuento 0%.",
      },
      {
        item: "2",
        description: "Caja de tornillos galvanizados",
        technical_description: "Caso con descuento. Debe ofertar por debajo del techo y conservar utilidad positiva.",
        quantity: 5,
        unit: "CAJA",
        reference_unit: 42000,
        selected_cost_mode: "weighted",
        price_sources: [
          {
            name: "Proveedor local",
            unit_price: 28000,
            currency: "COP",
          },
          {
            name: "Ecommerce",
            unit_price: 31000,
            currency: "COP",
          },
        ],
        offer_mode: "discount",
        discount_pct: 10,
        vat_mode: "included",
        notes: "Descuento 10% frente al techo.",
      },
      {
        item: "3",
        description: "Impresora multifuncional laser",
        technical_description: "Caso manual: el usuario decide una oferta unitaria especifica.",
        quantity: 1,
        unit: "UND",
        reference_unit: 1200000,
        manual_unit_cost: 870000,
        selected_cost_mode: "manual",
        offer_mode: "manual",
        manual_offer_unit: 1050000,
        vat_mode: "included",
        vat_rate: 19,
        notes: "Oferta manual por debajo del techo.",
      },
      {
        item: "4",
        description: "Servicio tecnico especializado",
        technical_description: "Caso de utilidad objetivo: la oferta nace desde costo + margen y se compara contra techo.",
        quantity: 8,
        unit: "HORA",
        reference_unit: 150000,
        manual_unit_cost: 95000,
        selected_cost_mode: "manual",
        offer_mode: "profit",
        profit_pct: 20,
        vat_mode: "included",
        vat_rate: 19,
        notes: "Utilidad objetivo 20%.",
      },
      {
        item: "5",
        description: "Item con techo pero sin costo",
        technical_description: "Caso incompleto: permite revisar que el resumen total no mezcle datos faltantes.",
        quantity: 3,
        unit: "UND",
        reference_unit: 500000,
        selected_cost_mode: "manual",
        offer_mode: "discount",
        discount_pct: 0,
        vat_mode: "included",
        vat_rate: 19,
        notes: "Debe quedar fuera del resumen financiero completo por falta de costo.",
      },
      {
        item: "6",
        description: "Item con costo pero sin techo",
        technical_description: "Caso incompleto: permite validar alertas cuando falta precio techo.",
        quantity: 4,
        unit: "UND",
        manual_unit_cost: 180000,
        selected_cost_mode: "manual",
        offer_mode: "profit",
        profit_pct: 15,
        vat_mode: "included",
        vat_rate: 19,
        notes: "Sin precio techo, no debe contaminar comparaciones contra techo.",
      },
      {
        item: "7",
        description: "Item con costo mayor al techo",
        technical_description: "Caso critico: descuento 0% oferta al techo, pero queda por debajo del costo.",
        quantity: 100,
        unit: "UND",
        reference_unit: 50000,
        manual_unit_cost: 400000,
        selected_cost_mode: "manual",
        offer_mode: "discount",
        discount_pct: 0,
        vat_mode: "included",
        vat_rate: 19,
        notes: "Debe marcar perdida o alerta de costo superior al techo.",
      },
      {
        item: "8",
        description: "Material exento de IVA",
        technical_description: "Caso tributario: precio exento para revisar que no se agregue IVA.",
        quantity: 10,
        unit: "UND",
        reference_unit: 90000,
        selected_cost_mode: "optimistic",
        price_sources: [
          {
            name: "Proveedor exento A",
            unit_price: 62000,
            currency: "COP",
          },
          {
            name: "Proveedor exento B",
            unit_price: 70000,
            currency: "COP",
          },
        ],
        offer_mode: "discount",
        discount_pct: 5,
        vat_mode: "exempt",
        vat_rate: 0,
        notes: "Exento de IVA para probar modo tributario.",
      },
    ],
    settings: {
      vat_rate: 19,
      default_margin: 0,
      default_cost_mode: "weighted",
      manual_cost_priority: false,
      usd_to_cop_rate: 4000,
      usd_import_pct: 30,
    },
  };
}
