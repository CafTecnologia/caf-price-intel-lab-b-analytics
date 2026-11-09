import type { OfferDisplay } from "./offer-presentation";
import { DataOrganizationSchema, validateOrganizationCosts, type DataOrganization } from "./data-organization";
import { z } from "zod";

export const COST_MODES = ["optimistic", "moderate", "weighted", "manual", "source"] as const;
export type CostMode = (typeof COST_MODES)[number];

export const COST_STATISTICS = ["minimum", "average", "median", "moderate"] as const;
export type CostStatistic = (typeof COST_STATISTICS)[number];

export const PRICE_SOURCE_CURRENCIES = ["COP", "USD"] as const;
export type PriceSourceCurrency = (typeof PRICE_SOURCE_CURRENCIES)[number];

export const VAT_MODES = ["included", "excluded", "exempt"] as const;
export type VatMode = (typeof VAT_MODES)[number];

export const OFFER_MODES = ["discount", "profit", "manual"] as const;
export type PersistedOfferMode = (typeof OFFER_MODES)[number];
export const COST_SCENARIO_MODES = ["unit", "lot"] as const;
export type CostScenarioMode = (typeof COST_SCENARIO_MODES)[number];
export const WITHHOLDING_BASES = ["pre_vat", "vat", "total"] as const;
export type WithholdingBase = (typeof WITHHOLDING_BASES)[number];
export const ADDITIONAL_COST_CATEGORIES = ["service", "logistics", "other"] as const;
export type AdditionalCostCategory = (typeof ADDITIONAL_COST_CATEGORIES)[number];
export const ITEM_COST_MODES = ["per_unit", "fixed"] as const;
export type ItemCostMode = (typeof ITEM_COST_MODES)[number];
export const DELIVERABLE_TYPES = ["product", "service"] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
export const COST_BASIS_STATUSES = ["conforming", "comparable_scenario", "partial", "pending"] as const;
export type CostBasisStatus = (typeof COST_BASIS_STATUSES)[number];

const numberLike = z.union([z.number(), z.string()]).nullable().optional();
const quantityLike = numberLike.refine((value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && (!value.trim() || /^(n\/d|nd|na|null|sin dato|-+)$/i.test(value.trim()))) return true;
  if (typeof value === "string" && !/^(?:(?:COP|COL\$|\$)\s*)?-?(?:\d+|\d{1,3}(?:[., ]\d{3})+)(?:[.,]\d{1,2})?$/i.test(value.trim())) return false;
  return parseMoneyLike(value) !== null;
}, "La cantidad debe ser numérica o estar vacía.");
const nonNegativeNumberLike = numberLike.refine(
  (value) => value === null || value === undefined || (parseMoneyLike(value) ?? -1) >= 0,
  "La referencia global debe ser un valor numérico no negativo.",
);
const booleanLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();
export const AUTO_CALCULATION_NAME = "__AUTO_CALCULATION_NAME__";

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

const AdditionalCostInputSchema = z
  .object({
    id: z.string().trim().optional().nullable(),
    name: z.string().trim().min(1),
    category: z.enum(ADDITIONAL_COST_CATEGORIES).optional().default("service"),
    mode: z.enum(ITEM_COST_MODES).optional().default("fixed"),
    amount: numberLike,
    notes: z.string().trim().optional().default(""),
    review_status: z.enum(["suggested", "included", "excluded"]).optional().default("included"),
  })
  .strip();

const GeneralCostInputSchema = z
  .object({
    id: z.string().trim().optional().nullable(),
    name: z.string().trim().min(1),
    category: z.enum(ADDITIONAL_COST_CATEGORIES).optional().default("other"),
    amount: numberLike,
    notes: z.string().trim().optional().default(""),
  })
  .strip();

const PublicGeneralCostInputSchema = GeneralCostInputSchema.refine(
  (cost) => cost.amount != null && (parseMoneyLike(cost.amount) ?? -1) >= 0,
  { path: ["amount"], message: "Cada costo general necesita un valor numerico no negativo." },
);

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
    /** Datos del proyecto Odoo para mostrar (opcionales). */
    odoo_project_name: z.string().trim().optional().nullable(),
    odoo_process_number: z.string().trim().optional().nullable(),
    odoo_entity_name: z.string().trim().optional().nullable(),
    odoo_return_url: z.string().trim().optional().nullable(),
    odoo_db: z.string().trim().optional().nullable(),
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

const SourceMetaInputSchema = z
  .object({
    system: z.string().trim().optional().nullable(),
    analysis_id: z.string().trim().optional().nullable(),
    odoo_project_id: z.string().trim().optional().nullable(),
    /** Datos del proyecto Odoo para mostrar (opcionales). */
    odoo_project_name: z.string().trim().optional().nullable(),
    odoo_process_number: z.string().trim().optional().nullable(),
    odoo_entity_name: z.string().trim().optional().nullable(),
    odoo_return_url: z.string().trim().optional().nullable(),
    odoo_db: z.string().trim().optional().nullable(),
    run_id: z.string().trim().optional().nullable(),
    external_id: z.string().trim().optional().nullable(),
    create_once: z.boolean().optional(),
  })
  .strip()
  .default({});

const PublicPriceSourceInputSchema = z
  .object({
    id: z.string().trim().optional().nullable(),
    name: z.string().trim().optional().nullable(),
    unit_price: numberLike,
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

export const BudgetLimitSchema = z.object({
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(240),
  procurementLotId: z.string().trim().min(1).max(128).nullable(),
  maximum: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  document: z.string().trim().min(1).max(1000),
  locator: z.string().trim().min(1).max(2000),
}).strict();
export const BudgetLimitsSchema = z.array(BudgetLimitSchema).max(100).superRefine((limits, ctx) => {
  const keys = limits.map(limit => limit.procurementLotId);
  if (new Set(limits.map(limit => limit.id)).size !== limits.length) ctx.addIssue({ code:"custom", message:"Identificadores de máximo duplicados." });
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Hay límites duplicados para el mismo componente o total." });
});
export type BudgetLimit = z.output<typeof BudgetLimitSchema>;

export const ProcurementLotInputSchema = z.object({
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(240),
  document: z.string().trim().min(1).max(1000),
  locator: z.string().trim().min(1).max(2000),
}).strict();
export type ProcurementLot = z.output<typeof ProcurementLotInputSchema>;

export const OriginalSourceInputSchema = z.object({
  description: z.string().optional().default(""),
  technical_description: z.string().optional().default(""),
  quantity: z.string().optional().default(""),
  unit: z.string().optional().default(""),
  ceiling_unit_price: z.string().optional().default(""),
  document: z.string().optional().default(""),
  locator: z.string().optional().default(""),
}).strip();

export type FinancialItemOriginalSource = z.output<typeof OriginalSourceInputSchema>;

export const TechnicalAnnexExcerptInputSchema = z.object({
  document: z.string().trim().min(1),
  locator: z.string().trim().min(1),
  text: z.string().min(1).refine((value) => value.trim().length > 0, "El extracto no puede estar vacío."),
}).strip();

export type FinancialItemTechnicalAnnexExcerpt = z.output<typeof TechnicalAnnexExcerptInputSchema>;

const PublicItemInputSchema = z
  .object({
    item: z.string().trim().optional().default(""),
    name: z.string().trim().min(1),
    description: z.string().trim().optional().default(""),
    procurement_lot: ProcurementLotInputSchema.nullable().optional(),
    source_original: OriginalSourceInputSchema.optional(),
    data_organization: DataOrganizationSchema.optional(),
    technical_annex: z.array(TechnicalAnnexExcerptInputSchema).optional().default([]),
    cost_basis_status: z.enum(COST_BASIS_STATUSES).optional().nullable(),
    deliverable_type: z.enum(DELIVERABLE_TYPES).optional().nullable(),
    quantity: quantityLike,
    unit: z.string().trim().optional().default(""),
    ceiling_unit_price: numberLike,
    official_reference_unit: nonNegativeNumberLike,
    price_sources: z.array(PublicPriceSourceInputSchema).optional().default([]),
    has_associated_cost: booleanLike,
    additional_costs: z.array(AdditionalCostInputSchema).optional().default([]),
    notes: z.string().trim().optional().default(""),
  })
  .strip()
  .superRefine((item, ctx) => {
    validateOrganizationCosts(item, ctx);
    const ids = item.price_sources.map((source, index) => source.id?.trim() || `source-${index + 1}`);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["price_sources"], message: "Cada fuente de precio debe tener un ID distinto." });
    }
    const costIds = item.additional_costs.map((cost) => cost.id?.trim()).filter(Boolean);
    if (new Set(costIds).size !== costIds.length) {
      ctx.addIssue({ code: "custom", path: ["additional_costs"], message: "Cada costo asociado debe tener un ID distinto." });
    }
  });

export const FinancialOfferItemInputSchema = z
  .object({
    item: z.string().trim().optional().default(""),
    description: z.string().trim().min(1),
    technical_description: z.string().trim().optional().default(""),
    procurement_lot: ProcurementLotInputSchema.nullable().optional(),
    source_original: OriginalSourceInputSchema.optional(),
    data_organization: DataOrganizationSchema.optional(),
    technical_annex: z.array(TechnicalAnnexExcerptInputSchema).optional().default([]),
    cost_basis_status: z.enum(COST_BASIS_STATUSES).optional().nullable(),
    deliverable_type: z.enum(DELIVERABLE_TYPES).optional().nullable(),
    quantity: quantityLike,
    unit: z.string().trim().optional().default(""),
    reference_unit: numberLike,
    official_reference_unit: nonNegativeNumberLike,
    cost_optimistic: numberLike,
    cost_moderate: numberLike,
    cost_weighted_unit: numberLike,
    manual_unit_cost: numberLike,
    selected_cost_mode: z.enum(COST_MODES).optional().default("weighted"),
    selected_price_source_id: z.string().trim().optional().nullable(),
    cost_scenario_mode: z.enum(COST_SCENARIO_MODES).optional().nullable(),
    cost_scenario_discount_pct: numberLike,
    price_sources: z.array(PriceSourceInputSchema).optional().default([]),
    has_associated_cost: booleanLike,
    additional_costs: z.array(AdditionalCostInputSchema).optional().default([]),
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
  .strip().superRefine(validateOrganizationCosts);

export const FinancialOfferSettingsInputSchema = z
  .object({
    vat_rate: numberLike,
    default_margin: numberLike,
    default_cost_mode: z.enum(COST_MODES).optional().default("weighted"),
    manual_cost_priority: booleanLike,
    usd_to_cop_rate: numberLike,
    usd_import_pct: numberLike,
    budget_limits: BudgetLimitsSchema.optional(),
    manual_reference_total: nonNegativeNumberLike,
    global_reference_total: nonNegativeNumberLike,
    total_reference: nonNegativeNumberLike,
    apply_retefuente: booleanLike,
    retefuente_rate: numberLike,
    retefuente_base: z.enum(WITHHOLDING_BASES).optional(),
    apply_reteiva: booleanLike,
    reteiva_rate: numberLike,
    reteiva_base: z.enum(WITHHOLDING_BASES).optional(),
    apply_reteica: booleanLike,
    reteica_rate: numberLike,
    reteica_base: z.enum(WITHHOLDING_BASES).optional(),
    stamp_tax_rate: numberLike,
  })
  .partial()
  .default({});

const LegacyImportSchema = z
  .object({
    project: CalculationMetaInputSchema,
    items: z.array(FinancialOfferItemInputSchema).min(1),
    settings: FinancialOfferSettingsInputSchema,
    general_costs: z.array(GeneralCostInputSchema).optional().default([]),
  })
  .strip();

const CalculationImportSchema = z
  .object({
    version: z.union([z.literal(1), z.literal("1"), z.literal(2), z.literal("2")]).optional().default(1),
    calculation: CalculationMetaInputSchema.extend({
      items: z.array(FinancialOfferItemInputSchema).optional(),
      settings: FinancialOfferSettingsInputSchema.optional(),
      general_costs: z.array(GeneralCostInputSchema).optional(),
    }).strip(),
    items: z.array(FinancialOfferItemInputSchema).optional(),
    settings: FinancialOfferSettingsInputSchema.optional(),
    general_costs: z.array(GeneralCostInputSchema).optional(),
  })
  .strip();

const PublicImportSchema = z
  .object({
    version: z.union([z.literal(2), z.literal("2"), z.literal(3), z.literal("3")]).optional().default(2),
    source: SourceMetaInputSchema,
    items: z.array(PublicItemInputSchema).min(1),
    settings: z.object({ manual_reference_total: nonNegativeNumberLike, budget_limits: BudgetLimitsSchema.optional() }).strip().optional().default({}),
    general_costs: z.array(PublicGeneralCostInputSchema).optional().default([]),
    external_id: z.string().trim().optional().nullable(),
    create_once: z.boolean().optional(),
  })
  .strip();

export const SAMPLE_PUBLIC_IMPORT_PAYLOAD = {
  version: 2,
  items: [{
    item: "1",
    name: "Taladro profesional",
    description: "Taladro 1/2 pulg, uso profesional.",
    unit: "UND",
    quantity: 2,
    ceiling_unit_price: 350000,
    price_sources: [
      { id: "proveedor-a", name: "Proveedor A", unit_price: 210000, currency: "COP", url: "https://proveedor-a.example/taladro" },
      { id: "proveedor-b", name: "Proveedor B", unit_price: 240000, currency: "COP", url: "https://proveedor-b.example/taladro" },
    ],
    additional_costs: [{ name: "Instalacion", category: "service", mode: "fixed", amount: 30000 }],
  }],
  general_costs: [{ name: "Poliza global", category: "other", amount: 15000 }],
} as const;

export type FinancialOfferImportInput = unknown;

export type FinancialOfferImport = {
  version: 1;
  calculation: z.output<typeof CalculationMetaInputSchema>;
  items: z.output<typeof FinancialOfferItemInputSchema>[];
  settings: z.output<typeof FinancialOfferSettingsInputSchema>;
  generalCosts: z.output<typeof GeneralCostInputSchema>[];
};

export type FinancialOfferNotesDocument = Record<string, unknown>;

export const EMPTY_NOTES_DOCUMENT: FinancialOfferNotesDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export type FinancialOfferCalculation = {
  id: string;
  readOnly: boolean;
  frozenAt: string | null;
  externalId: string | null;
  sourceSystem: string | null;
  odooProjectId: string | null;
  iaRunId: string | null;
  sourceAnalysisId: string | null;
  odooCallbackUrl: string | null;
  odooReturnUrl: string | null;
  odooDb: string | null;
  odooProjectName: string | null;
  odooProcessNumber: string | null;
  odooEntityName: string | null;
  odooUserId: string | null;
  odooUserName: string | null;
  notesDocument: FinancialOfferNotesDocument;
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
    manualReferenceTotal: number | null;
    budgetLimits?: BudgetLimit[];
    analysisReferenceIncluded?: boolean;
    excludedProcurementLotIds?: string[];
    offerDisplay?: OfferDisplay;
    applyReteFuente: boolean;
    reteFuenteRate: number;
    reteFuenteBase: WithholdingBase;
    applyReteIva: boolean;
    reteIvaRate: number;
    reteIvaBase: WithholdingBase;
    applyReteIca: boolean;
    reteIcaRate: number;
    reteIcaBase: WithholdingBase;
    stampTaxRate: number | null;
  };
  items: FinancialOfferItem[];
  generalCosts: FinancialGeneralCost[];
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

export type FinancialItemAdditionalCost = {
  id: string;
  name: string;
  category: AdditionalCostCategory;
  mode: ItemCostMode;
  amount: number | null;
  notes: string;
  reviewStatus?: "suggested" | "included" | "excluded";
};

export type FinancialGeneralCost = {
  id: string;
  name: string;
  category: AdditionalCostCategory;
  amount: number;
  notes: string;
};

export type FinancialOfferItem = {
  id: string;
  item: string;
  description: string;
  technicalDescription: string;
  procurementLot?: ProcurementLot | null;
  sourceOriginal?: FinancialItemOriginalSource;
  dataOrganization?: DataOrganization;
  technicalAnnex?: FinancialItemTechnicalAnnexExcerpt[];
  costBasisStatus?: CostBasisStatus | null;
  deliverableType: DeliverableType | null;
  quantity: number | null;
  unit: string;
  referenceUnit: number | null;
  officialReferenceUnit?: number | null;
  costOptimistic: number | null;
  costModerate: number | null;
  costWeightedUnit: number | null;
  manualUnitCost: number | null;
  manualCostAssumption?: { base: "reference"; discountPct: number; previous?: {
    manualUnitCost: number | null; selectedCostMode: CostMode; selectedPriceSourceId: string | null;
    analysisCostStatistic: CostStatistic | null; costScenarioMode: CostScenarioMode | null; costScenarioDiscountPct: number | null;
  } } | null;
  offerAdjustment?: { kind: "profit" | "ceiling"; percent: number; previous: {
    offerMode: PersistedOfferMode | null; discountPct: number | null; profitPct: number | null; manualOfferUnit: number | null;
  } } | null;
  manualCostReviewed?: boolean;
  additionalCostsReviewed?: boolean;
  selectedCostMode: CostMode;
  selectedPriceSourceId?: string | null;
  costScenarioMode: CostScenarioMode | null;
  costScenarioDiscountPct: number | null;
  priceSources: FinancialOfferPriceSource[];
  analysisExcludedPriceSourceIds?: string[];
  analysisCostStatistic?: CostStatistic | null;
  analysisReferenceIncluded?: boolean;
  additionalCosts: FinancialItemAdditionalCost[];
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
  } else if (dotIndex >= 0) {
    const decimals = numberText.length - dotIndex - 1;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(numberText) || decimals > 2) {
      numberText = numberText.replace(/\./g, "");
    }
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

function publicItemToInternal(item: z.output<typeof PublicItemInputSchema>): z.output<typeof FinancialOfferItemInputSchema> {
  return {
    item: item.item,
    description: item.name,
    technical_description: item.description,
    ...(Object.hasOwn(item, "procurement_lot") ? { procurement_lot: item.procurement_lot } : {}),
    source_original: item.source_original,
    data_organization: item.data_organization,
    technical_annex: item.technical_annex,
    ...(Object.hasOwn(item, "cost_basis_status") ? { cost_basis_status: item.cost_basis_status } : {}),
    ...(Object.hasOwn(item, "deliverable_type")
      ? { deliverable_type: item.deliverable_type }
      : {}),
    quantity: item.quantity,
    unit: item.unit,
    reference_unit: item.ceiling_unit_price,
    ...(Object.hasOwn(item, "official_reference_unit") ? { official_reference_unit: item.official_reference_unit } : {}),
    cost_optimistic: undefined,
    cost_moderate: undefined,
    cost_weighted_unit: undefined,
    manual_unit_cost: undefined,
    selected_cost_mode: "weighted",
    selected_price_source_id: null,
    cost_scenario_mode: null,
    cost_scenario_discount_pct: undefined,
    price_sources: item.price_sources.map((source) => ({
      id: source.id,
      name: source.name,
      unit_price: source.unit_price,
      currency: source.currency,
      url: source.url,
      notes: source.notes,
      trm: source.trm,
      import_pct: source.import_pct,
    })),
    has_associated_cost: item.has_associated_cost,
    additional_costs: item.additional_costs,
    source_1_name: "",
    source_1_price: undefined,
    source_1_currency: "COP",
    source_1_url: "",
    source_1_trm: undefined,
    source_1_import_pct: undefined,
    source_2_name: "",
    source_2_price: undefined,
    source_2_currency: "COP",
    source_2_url: "",
    source_2_trm: undefined,
    source_2_import_pct: undefined,
    source_3_name: "",
    source_3_price: undefined,
    source_3_currency: "COP",
    source_3_url: "",
    source_3_trm: undefined,
    source_3_import_pct: undefined,
    offer_mode: null,
    discount_pct: undefined,
    profit_pct: undefined,
    manual_offer_unit: undefined,
    vat_mode: "included",
    vat_rate: undefined,
    source_1: "",
    source_2: "",
    source_3: "",
    notes: item.notes,
  };
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
      const explicitName = item[`source_${number}_name` as "source_1_name" | "source_2_name" | "source_3_name"];
      const price = item[`source_${number}_price` as "source_1_price" | "source_2_price" | "source_3_price"] ?? (text ? text : null);
      const url = item[`source_${number}_url` as "source_1_url" | "source_2_url" | "source_3_url"];
      const trm = item[`source_${number}_trm` as "source_1_trm" | "source_2_trm" | "source_3_trm"];
      const importPct = item[`source_${number}_import_pct` as "source_1_import_pct" | "source_2_import_pct" | "source_3_import_pct"];
      if (!text && !explicitName && price == null && !url && trm == null && importPct == null) {
        return null;
      }
      return normalizePriceSource(
        {
          id: `source-${number}`,
          label: explicitName || text || `Fuente ${number}`,
          unitPrice: price,
          currency: item[`source_${number}_currency` as "source_1_currency" | "source_2_currency" | "source_3_currency"],
          url,
          notes: text,
          trm,
          importPct,
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

  if (raw.calculation === undefined && raw.project === undefined) {
    const parsed = PublicImportSchema.parse(input);
    const resolvedExternalId = (input as Record<string, unknown>)?.external_id as string | undefined
      ?? (input as { source?: Record<string, unknown> })?.source?.external_id as string | undefined
      ?? parsed.source.run_id
      ?? null;
    return {
      version: 1,
      calculation: {
        external_id: resolvedExternalId,
        source_system: parsed.source.system,
        odoo_project_id: parsed.source.odoo_project_id,
        ia_run_id: parsed.source.run_id,
        source_analysis_id: parsed.source.analysis_id,
        odoo_project_name: parsed.source.odoo_project_name,
        odoo_process_number: parsed.source.odoo_process_number,
        odoo_entity_name: parsed.source.odoo_entity_name,
        odoo_return_url: parsed.source.odoo_return_url,
        odoo_db: parsed.source.odoo_db,
        name: AUTO_CALCULATION_NAME,
        entity: null,
        currency: "COP",
      },
      items: parsed.items.map(publicItemToInternal),
      settings: parsed.settings,
      generalCosts: parsed.general_costs,
    };
  }

  if (raw.calculation !== undefined) {
    const rawCalculation = raw.calculation && typeof raw.calculation === "object" && !Array.isArray(raw.calculation)
      ? raw.calculation as Record<string, unknown> : {};
    const candidateItems = Array.isArray(raw.items) ? raw.items
      : Array.isArray(rawCalculation.items) ? rawCalculation.items : [];
    const usesPublicItems = candidateItems.some((item) =>
      item !== null && typeof item === "object" && "ceiling_unit_price" in item
    );
    // El formato público usa ceiling_unit_price; el formato interno usa reference_unit.
    // Sin esta conversión el esquema interno descartaría silenciosamente los seis techos.
    const inputForCalculation = usesPublicItems ? {
      ...raw,
      calculation: { ...rawCalculation, items: undefined },
      items: candidateItems.map((item) => publicItemToInternal(PublicItemInputSchema.parse(item))),
    } : input;
    const parsed = CalculationImportSchema.parse(inputForCalculation);
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
        odoo_project_name: parsed.calculation.odoo_project_name,
        odoo_process_number: parsed.calculation.odoo_process_number,
        odoo_entity_name: parsed.calculation.odoo_entity_name,
        odoo_return_url: parsed.calculation.odoo_return_url,
        odoo_db: parsed.calculation.odoo_db,
        name: parsed.calculation.name,
        entity: parsed.calculation.entity,
        currency: parsed.calculation.currency,
      },
      items,
      settings: {
        ...(parsed.calculation.settings ?? {}),
        ...(parsed.settings ?? {}),
      },
      generalCosts: parsed.general_costs ?? parsed.calculation.general_costs ?? [],
    };
  }

  const legacy = LegacyImportSchema.parse(input);
  return {
    version: 1,
    calculation: legacy.project,
    items: legacy.items,
    settings: legacy.settings,
    generalCosts: legacy.general_costs,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t.length ? t : null;
}

type OdooContextField = "odooCallbackUrl" | "odooReturnUrl" | "odooDb" | "odooProjectName" | "odooProcessNumber" | "odooEntityName" | "odooUserId" | "odooUserName";

/** When a link field is omitted on re-import, keep the previous stored value. */
export function mergeCalculationLinkFields(
  meta: FinancialOfferImport["calculation"],
  existing:
    | (Pick<FinancialOfferCalculation, "odooProjectId" | "iaRunId" | "sourceAnalysisId"> &
        Partial<Pick<FinancialOfferCalculation, OdooContextField>>)
    | null
    | undefined,
): Pick<FinancialOfferCalculation, "odooProjectId" | "iaRunId" | "sourceAnalysisId"> &
  Partial<Pick<FinancialOfferCalculation, OdooContextField>> {
  const linkFields: Pick<FinancialOfferCalculation, "odooProjectId" | "iaRunId" | "sourceAnalysisId"> &
    Partial<Pick<FinancialOfferCalculation, OdooContextField>> = {
    odooProjectId: meta.odoo_project_id !== undefined ? trimOrNull(meta.odoo_project_id) : (existing?.odooProjectId ?? null),
    iaRunId: meta.ia_run_id !== undefined ? trimOrNull(meta.ia_run_id) : (existing?.iaRunId ?? null),
    sourceAnalysisId: meta.source_analysis_id !== undefined ? trimOrNull(meta.source_analysis_id) : (existing?.sourceAnalysisId ?? null),
  };
  if (!existing) return linkFields;

  // Lo que ya abrio Odoo se conserva; lo que llega en la importacion solo completa lo que falta.
  const incoming: Partial<Record<OdooContextField, string | null>> = {
    odooReturnUrl: trimOrNull(meta.odoo_return_url),
    odooDb: trimOrNull(meta.odoo_db),
    odooProjectName: trimOrNull(meta.odoo_project_name),
    odooProcessNumber: trimOrNull(meta.odoo_process_number),
    odooEntityName: trimOrNull(meta.odoo_entity_name),
  };
  const fields: OdooContextField[] = ["odooCallbackUrl", "odooReturnUrl", "odooDb", "odooProjectName", "odooProcessNumber", "odooEntityName", "odooUserId", "odooUserName"];
  for (const field of fields) {
    if (field in existing || incoming[field]) linkFields[field] = existing[field] || incoming[field] || null;
  }

  return linkFields;
}

function uniqueAdditionalCostIds(costs: FinancialItemAdditionalCost[], itemIndex: number): FinancialItemAdditionalCost[] {
  const used = new Set<string>();
  return costs.map((cost, costIndex) => {
    let id = cost.id;
    if (used.has(id)) {
      id = `item-cost-${itemIndex + 1}-${costIndex + 1}`;
      while (used.has(id)) id += "-copy";
    }
    used.add(id);
    return id === cost.id ? cost : { ...cost, id };
  });
}

export function toCalculation(input: FinancialOfferImport, id: string, now: string): FinancialOfferCalculation {
  const defaultVatRate = parseMoneyLike(input.settings.vat_rate) ?? 19;
  const defaultUsdImportPct = parseMoneyLike(input.settings.usd_import_pct) ?? 30;
  return {
    id,
    readOnly: false,
    frozenAt: null,
    externalId: input.calculation.external_id?.trim() || null,
    sourceSystem: input.calculation.source_system?.trim() || null,
    odooProjectId: trimOrNull(input.calculation.odoo_project_id),
    iaRunId: trimOrNull(input.calculation.ia_run_id),
    sourceAnalysisId: trimOrNull(input.calculation.source_analysis_id),
    odooCallbackUrl: null,
    odooReturnUrl: trimOrNull(input.calculation.odoo_return_url),
    odooDb: trimOrNull(input.calculation.odoo_db),
    odooProjectName: trimOrNull(input.calculation.odoo_project_name),
    odooProcessNumber: trimOrNull(input.calculation.odoo_process_number),
    odooEntityName: trimOrNull(input.calculation.odoo_entity_name),
    odooUserId: null,
    odooUserName: null,
    notesDocument: EMPTY_NOTES_DOCUMENT,
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
      ...(input.settings.budget_limits ? { budgetLimits: input.settings.budget_limits } : {}),
      manualReferenceTotal:
        parseMoneyLike(input.settings.manual_reference_total) ??
        parseMoneyLike(input.settings.global_reference_total) ??
        parseMoneyLike(input.settings.total_reference),
      applyReteFuente: parseBooleanLike(input.settings.apply_retefuente, false),
      reteFuenteRate: parseMoneyLike(input.settings.retefuente_rate) ?? 2.5,
      reteFuenteBase: input.settings.retefuente_base ?? "pre_vat",
      applyReteIva: parseBooleanLike(input.settings.apply_reteiva, false),
      reteIvaRate: parseMoneyLike(input.settings.reteiva_rate) ?? 15,
      reteIvaBase: input.settings.reteiva_base ?? "vat",
      applyReteIca: parseBooleanLike(input.settings.apply_reteica, false),
      reteIcaRate: parseMoneyLike(input.settings.reteica_rate) ?? 0,
      reteIcaBase: input.settings.reteica_base ?? "pre_vat",
      stampTaxRate: parseMoneyLike(input.settings.stamp_tax_rate),
    },
    items: input.items.map((item, index) => {
      const hasAiMetadata = Boolean(input.calculation.ia_run_id?.trim() || input.calculation.source_system?.trim());
      const hasExplicitTrustedManualCost = item.selected_cost_mode === "manual"
        && parseMoneyLike(item.manual_unit_cost) !== null;
      const deferServiceCost = item.deliverable_type === "service"
        && (hasAiMetadata || !hasExplicitTrustedManualCost);
      return ({
      id: `${item.item || "item"}-${index + 1}`,
      item: item.item || String(index + 1),
      description: item.description,
      technicalDescription: item.technical_description,
      ...(Object.hasOwn(item, "procurement_lot") ? { procurementLot: item.procurement_lot } : {}),
      ...(item.source_original ? { sourceOriginal: item.source_original } : {}),
      ...(item.data_organization ? { dataOrganization: item.data_organization } : {}),
      ...(item.technical_annex.length ? { technicalAnnex: item.technical_annex } : {}),
      costBasisStatus: deferServiceCost ? "pending" : item.cost_basis_status ?? null,
      deliverableType: item.deliverable_type ?? null,
      quantity: parseMoneyLike(item.quantity),
      unit: item.unit,
      referenceUnit: parseMoneyLike(item.reference_unit),
      ...(Object.hasOwn(item, "official_reference_unit") ? { officialReferenceUnit: parseMoneyLike(item.official_reference_unit) } : {}),
      costOptimistic: parseMoneyLike(item.cost_optimistic),
      costModerate: parseMoneyLike(item.cost_moderate),
      costWeightedUnit: parseMoneyLike(item.cost_weighted_unit),
      manualUnitCost: deferServiceCost ? null : parseMoneyLike(item.manual_unit_cost),
      manualCostReviewed: false,
      additionalCostsReviewed: false,
      // IA services await human pricing; preserve sources for research/audit.
      selectedCostMode: deferServiceCost ? "manual" : item.selected_cost_mode,
      selectedPriceSourceId: item.selected_price_source_id || null,
      costScenarioMode: item.cost_scenario_mode ?? null,
      costScenarioDiscountPct: parseMoneyLike(item.cost_scenario_discount_pct),
      priceSources: normalizePriceSources(item),
      additionalCosts: uniqueAdditionalCostIds((item.additional_costs.length ? item.additional_costs : parseBooleanLike(item.has_associated_cost) ? [{ id: null, name: "Costo asociado pendiente", category: "service" as const, mode: "fixed" as const, amount: null, notes: "", review_status: "suggested" as const }] : []).map((cost, costIndex) => ({
        id: cost.id?.trim() || `item-cost-${index + 1}-${costIndex + 1}`,
        name: cost.name,
        category: cost.category,
        mode: cost.mode,
        amount: parseMoneyLike(cost.amount) === null ? null : Math.max(0, parseMoneyLike(cost.amount)!),
        notes: cost.notes,
        reviewStatus: deferServiceCost ? "suggested" : cost.review_status,
      })), index),
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
    });
    }),
    generalCosts: input.generalCosts.map((cost, index) => ({
      id: cost.id?.trim() || `general-cost-${index + 1}`,
      name: cost.name,
      category: cost.category,
      amount: Math.max(0, parseMoneyLike(cost.amount) ?? 0),
      notes: cost.notes,
    })),
  };
}

export const toProject = toCalculation;

export function preserveAdditionalCostsOnReimport(
  incoming: FinancialOfferProject,
  existing: FinancialOfferProject | null | undefined,
  source?: FinancialOfferImport,
): FinancialOfferProject {
  if (!existing) return incoming;
  const normalizedKey = (value: string) => value.trim().toLocaleLowerCase("es-CO");
  const uniqueIndex = (keyFor: (item: FinancialOfferItem) => string | null) => {
    const index = new Map<string, FinancialOfferItem>();
    const repeated = new Set<string>();
    for (const item of existing.items) {
      const key = keyFor(item);
      if (!key) continue;
      if (index.has(key)) repeated.add(key);
      else index.set(key, item);
    }
    for (const key of repeated) index.delete(key);
    return index;
  };
  const stableItemKey = (item: FinancialOfferItem) =>
    /^item-\d+$/.test(item.id) || !item.item.trim() ? null : `${item.procurementLot?.id ?? ""}\u0000${normalizedKey(item.item)}`;
  const signatureKey = (item: FinancialOfferItem) =>
    `${item.procurementLot?.id ?? ""}\u0000${[item.description, item.technicalDescription, item.unit].map(normalizedKey).join("\u0000")}`;
  const existingByItem = uniqueIndex(stableItemKey);
  const existingBySignature = uniqueIndex(signatureKey);
  const referenceWasProvided = source
    ? ["manual_reference_total", "global_reference_total", "total_reference"]
      .some((field) => Object.hasOwn(source.settings, field))
    : false;
  const legacyItemKey = (item: FinancialOfferItem) => normalizedKey(item.item);
  const legacySignatureKey = (item: FinancialOfferItem) =>
    [item.description, item.technicalDescription, item.unit].map(normalizedKey).join("\u0000");
  const existingByLegacyItem = uniqueIndex(legacyItemKey);
  const existingByLegacySignature = uniqueIndex(legacySignatureKey);
  const compatibleLot = (left: FinancialOfferItem, right: FinancialOfferItem) =>
    !left.procurementLot || !right.procurementLot || left.procurementLot.id === right.procurementLot.id;
  const matched = incoming.items.map((item, index) => {
    const stableKey = stableItemKey(item);
    const samePosition = existing.items[index];
    const positionalMatch = samePosition
      && compatibleLot(samePosition, item)
      && legacyItemKey(samePosition) === legacyItemKey(item)
      && legacySignatureKey(samePosition) === legacySignatureKey(item)
      ? samePosition
      : undefined;
    const exact = (stableKey ? existingByItem.get(stableKey) : undefined)
      ?? existingBySignature.get(signatureKey(item));
    const legacy = existingByLegacyItem.get(legacyItemKey(item))
      ?? existingByLegacySignature.get(legacySignatureKey(item));
    return exact ?? (legacy && compatibleLot(legacy, item) ? legacy : undefined) ?? positionalMatch;
  });
  const matchedExisting = new Set(matched.filter((item): item is FinancialOfferItem => Boolean(item)));
  if (matchedExisting.size !== matched.filter(Boolean).length
    || existing.items.some((item) => !matchedExisting.has(item))) {
    throw new Error("La reimportación no puede identificar sin ambigüedad todos los ítems existentes. Revise los cambios por ítem antes de guardar.");
  }

  const reservedIds = new Set(existing.items.map((item) => item.id));
  const assignedIds = new Set<string>();
  const assignedId = (item: FinancialOfferItem, previous: FinancialOfferItem | undefined) => {
    let id = previous?.id ?? item.id;
    if (!previous && (reservedIds.has(id) || assignedIds.has(id))) {
      let suffix = 1;
      do { id = `${item.id}-new-${suffix++}`; } while (reservedIds.has(id) || assignedIds.has(id));
    }
    if (assignedIds.has(id)) throw new Error("La reimportación produciría identificadores de ítem repetidos.");
    assignedIds.add(id); return id;
  };
  return {
    ...incoming,
    settings: {
      ...incoming.settings,
      excludedProcurementLotIds: existing.settings.excludedProcurementLotIds ?? [],
      budgetLimits: source && Object.hasOwn(source.settings, "budget_limits") ? incoming.settings.budgetLimits : existing.settings.budgetLimits ?? incoming.settings.budgetLimits,
      manualReferenceTotal: !source || !referenceWasProvided
        ? existing.settings.manualReferenceTotal
        : incoming.settings.manualReferenceTotal,
    },
    items: incoming.items.map((item, index) => {
      const previous = matched[index];
      const deliverableTypeWasProvided = source
        ? Object.hasOwn(source.items[index] ?? {}, "deliverable_type")
        : false;
      const costBasisStatusWasProvided = source
        ? Object.hasOwn(source.items[index] ?? {}, "cost_basis_status")
        : false;
      const deliverableType = source && deliverableTypeWasProvided
        ? item.deliverableType
        : previous?.deliverableType ?? item.deliverableType ?? null;
      const selectedHumanSource = previous?.selectedCostMode === "source" && previous.selectedPriceSourceId
        ? previous.priceSources.find((source) => source.id === previous.selectedPriceSourceId) ?? null
        : null;
      const hasHumanBaseDecision = previous?.deliverableType === "service"
        && deliverableType === "service"
        && ((previous.manualUnitCost !== null && previous.manualUnitCost > 0)
          || previous.manualCostReviewed === true
          || Boolean(selectedHumanSource));
      const mergedPriceSources = selectedHumanSource
        ? (() => {
            const found = item.priceSources.some((source) => source.id === selectedHumanSource.id);
            return found
              ? item.priceSources.map((source) => source.id === selectedHumanSource.id ? selectedHumanSource : source)
              : [...item.priceSources, selectedHumanSource];
          })()
        : item.priceSources;
      return {
        ...item,
        id: assignedId(item, previous),
        deliverableType,
        officialReferenceUnit: source && Object.hasOwn(source.items[index] ?? {}, "official_reference_unit") ? item.officialReferenceUnit ?? null : previous?.officialReferenceUnit ?? item.officialReferenceUnit,
        procurementLot: source && Object.hasOwn(source.items[index] ?? {}, "procurement_lot")
          ? item.procurementLot ?? null : previous?.procurementLot ?? item.procurementLot,
        costBasisStatus: deliverableType === "service"
          ? hasHumanBaseDecision
            ? previous?.costBasisStatus === "pending" ? null : previous?.costBasisStatus ?? null
            : "pending"
          : source && costBasisStatusWasProvided
            ? item.costBasisStatus
            : previous?.costBasisStatus ?? item.costBasisStatus ?? null,
        ...(deliverableType === "service" && !hasHumanBaseDecision
          ? {
              manualUnitCost: null,
              manualCostReviewed: false,
              selectedCostMode: "manual" as const,
              selectedPriceSourceId: null,
              priceSources: mergedPriceSources,
            }
          : hasHumanBaseDecision
            ? {
                manualUnitCost: previous!.manualUnitCost,
                manualCostAssumption: previous!.manualCostAssumption,
                manualCostReviewed: previous!.manualCostReviewed,
                selectedCostMode: previous!.selectedCostMode,
                selectedPriceSourceId: previous!.selectedPriceSourceId,
                priceSources: mergedPriceSources,
              }
            : {}),
        // Retain confirmed human costs; unreviewed AI service charges stay suggested.
        additionalCosts: previous
          && (deliverableType !== "service"
            || (previous.manualUnitCost !== null && previous.manualUnitCost > 0)
            || previous.manualCostReviewed === true
            || previous.additionalCostsReviewed === true
            || (previous.selectedCostMode === "source" && Boolean(previous.selectedPriceSourceId?.trim())))
          ? previous.additionalCosts
          : deliverableType === "service"
            ? item.additionalCosts.map((cost) => ({ ...cost, reviewStatus: "suggested" as const }))
            : item.additionalCosts,
        additionalCostsReviewed: previous?.additionalCostsReviewed ?? false,
        sourceOriginal: previous?.sourceOriginal ?? item.sourceOriginal,
        dataOrganization: previous?.dataOrganization ?? item.dataOrganization,
        technicalAnnex: [...(previous?.technicalAnnex ?? []), ...(item.technicalAnnex ?? []).filter((excerpt) =>
          !(previous?.technicalAnnex ?? []).some((saved) => saved.document === excerpt.document && saved.locator === excerpt.locator))],
      };
    }),
    generalCosts: incoming.generalCosts.length ? incoming.generalCosts : existing.generalCosts,
  };
}

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
      apply_retefuente: false,
      retefuente_rate: 2.5,
      retefuente_base: "pre_vat",
      apply_reteiva: false,
      reteiva_rate: 15,
      reteiva_base: "vat",
      apply_reteica: false,
      reteica_rate: 0,
      reteica_base: "pre_vat",
      stamp_tax_rate: null,
    },
  };
}
