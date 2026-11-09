import type {
  AgentItem,
  AutomationLevel,
  CommercialResolutionPlan,
  Confidence,
  Decision,
  EvidenceArtifact,
  MarketResult,
  PricingLine,
  ResolutionComponent,
  ResolutionMode,
  StageId,
  SupervisionResult,
  ValidationIssue,
  VerificationValue
} from "./types";
import { now, parseCop } from "./utils";

export type JsonRecord = Record<string, unknown>;

const CONTRACTS: Record<Exclude<StageId, "source">, string> = {
  extraction: "caf-extraction/v1",
  technical: "caf-technical/v2",
  market: "caf-market/v2",
  supervision: "caf-supervision/v2"
};

const RESOLUTION_MODES: ResolutionMode[] = [
  "direct_product",
  "pack_conversion",
  "bulk_proration",
  "bundle_bom",
  "product_plus_service",
  "equivalent_benchmark",
  "custom_fabrication",
  "ambiguous"
];
const AUTOMATION_LEVELS: AutomationLevel[] = ["automatic", "assisted", "human"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low", "no_data"];
const DECISIONS: Decision[] = ["accept", "accept_with_note", "retry", "human_review", "no_result"];
const VERIFICATION_VALUES: VerificationValue[] = ["yes", "partial", "no", "unknown", "not_applicable"];

export function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

export function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : parseCop(value);
  return Number.isFinite(parsed) ? parsed as number : null;
}

export function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry.trim();
    const record = recordValue(entry);
    if (!record) return text(entry);
    const original = text(record.datoOriginal ?? record.original ?? record.source);
    const interpretation = text(
      record.interpretacion ??
      record.interpretation ??
      record.requirement ??
      record.text ??
      record.value
    );
    const transformation = text(record.transformacion ?? record.transformation);
    if (original && interpretation) return `${original}: ${interpretation}`;
    return interpretation || original || transformation;
  }).filter(Boolean);
}

export function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

export function contractRecords(
  stage: Exclude<StageId, "source">,
  result: JsonRecord,
  expectedIds: string[]
) {
  const expectedContract = CONTRACTS[stage];
  if (text(result.contract) !== expectedContract) {
    throw new Error(`Contrato invalido: se esperaba ${expectedContract}.`);
  }
  if (!Array.isArray(result.items)) throw new Error("Contrato invalido: falta el arreglo items.");

  const allowed = new Set(expectedIds);
  const seen = new Set<string>();
  const records = new Map<string, JsonRecord>();
  const issues: ValidationIssue[] = [];
  for (const entry of result.items) {
    const record = recordValue(entry);
    if (!record) {
      issues.push({ stage, code: "record_not_object", severity: "error", message: "Un registro no es un objeto JSON." });
      continue;
    }
    const itemId = text(record.id);
    if (!itemId) {
      issues.push({ stage, code: "missing_id", severity: "error", message: "Un registro no incluye id." });
      continue;
    }
    if (!allowed.has(itemId)) {
      issues.push({ stage, itemId, code: "unexpected_id", severity: "error", message: `El proveedor agrego el id inesperado ${itemId}.` });
      continue;
    }
    if (seen.has(itemId)) {
      issues.push({ stage, itemId, code: "duplicate_id", severity: "error", message: `El proveedor duplico el id ${itemId}.` });
      records.delete(itemId);
      continue;
    }
    seen.add(itemId);
    records.set(itemId, record);
  }
  return { records, issues };
}

export function normalizeResolutionPlan(record: JsonRecord, item: AgentItem) {
  const raw = recordValue(record.resolutionPlan);
  const issues: ValidationIssue[] = [];
  if (!raw) {
    issues.push(issue("technical", item.id, "missing_resolution_plan", "Falta el plan de resolucion comercial."));
    return { plan: null, issues };
  }

  const mode = enumValue(text(raw.mode), RESOLUTION_MODES, "ambiguous");
  const automationLevel = enumValue(text(raw.automationLevel), AUTOMATION_LEVELS, "human");
  const components = Array.isArray(raw.components)
    ? raw.components.map((entry, index) => normalizeComponent(entry, index)).filter((entry): entry is ResolutionComponent => Boolean(entry))
    : [];
  const missingInformation = stringList(raw.missingInformation);
  const humanQuestions = stringList(raw.humanQuestions);
  const stopReasons = stringList(raw.stopReasons);
  const conversionRaw = recordValue(raw.conversion);
  const conversion = conversionRaw ? {
    sourcePresentation: text(conversionRaw.sourcePresentation),
    sourceQuantity: numberOrNull(conversionRaw.sourceQuantity),
    sourceUnit: text(conversionRaw.sourceUnit),
    requiredQuantity: numberOrNull(conversionRaw.requiredQuantity),
    requiredUnit: text(conversionRaw.requiredUnit),
    calculationBasis: enumValue(
      text(conversionRaw.calculationBasis),
      ["purchase_minimum", "prorated_reference", "both", "not_applicable"] as const,
      "not_applicable"
    ),
    wasteFactorPct: numberOrNull(conversionRaw.wasteFactorPct)
  } : null;

  const plan: CommercialResolutionPlan = {
    mode,
    automationLevel,
    rationale: text(raw.rationale),
    components,
    conversion,
    assumptions: stringList(raw.assumptions),
    missingInformation,
    humanQuestions,
    stopReasons
  };

  if (!plan.rationale) issues.push(issue("technical", item.id, "missing_plan_rationale", "El plan no explica por que eligio el modo de resolucion."));
  if (!components.length && !["custom_fabrication", "ambiguous"].includes(mode)) {
    issues.push(issue("technical", item.id, "missing_components", "El plan no define componentes a cotizar."));
  }
  if (["pack_conversion", "bulk_proration"].includes(mode)) {
    if (!conversion || conversion.requiredQuantity === null || !conversion.requiredUnit) {
      issues.push(issue("technical", item.id, "incomplete_conversion", "La conversion no identifica la cantidad y unidad requeridas por el item original."));
    }
  }
  if (automationLevel === "automatic" && (plan.assumptions.length || missingInformation.length || stopReasons.length)) {
    issues.push(issue("technical", item.id, "unsafe_automatic_plan", "Un plan automatico no puede depender de supuestos, informacion critica faltante o motivos de detencion."));
  }
  if (["custom_fabrication", "ambiguous"].includes(mode) && automationLevel !== "human") {
    issues.push(issue("technical", item.id, "human_gate_required", "Fabricacion a medida o ambiguedad material requieren control humano."));
  }
  if (automationLevel === "human" && !missingInformation.length && !humanQuestions.length && !stopReasons.length) {
    issues.push(issue("technical", item.id, "missing_human_handoff", "El plan humano no indica que falta ni que debe decidirse."));
  }
  return { plan, issues };
}

export function normalizeMarketResult(record: JsonRecord, item: AgentItem) {
  const issues: ValidationIssue[] = [];
  const pricingType = enumValue(
    text(record.pricingType),
    ["observed_single", "derived_conversion", "composed_bom", "partial_benchmark", "no_result"] as const,
    "no_result"
  );
  const lines = Array.isArray(record.lines)
    ? record.lines.map((entry, index) => normalizePricingLine(entry, index, item.id, issues)).filter((entry): entry is PricingLine => Boolean(entry))
    : [];
  const supplier = text(record.supplier) || lines[0]?.supplier || "";
  const product = text(record.product) || lines.map((line) => line.product).filter(Boolean).join(" + ");
  const missingComponents = stringList(record.missingComponents);
  const calculationWarnings = stringList(record.calculationWarnings);
  const workerRecommendation = decisionValue(record.workerRecommendation ?? record.decision);
  const validCosts = lines.map((line) => line.purchaseMinimumCost ?? line.referenceCost).filter((value): value is number => value !== null);
  const calculatedPrice = validCosts.length ? roundMoney(validCosts.reduce((sum, value) => sum + value, 0)) : null;
  const reportedPrice = numberOrNull(record.price);
  const currency = text(record.currency) || commonCurrency(lines) || "COP";
  const requiredComponents = (item.technical?.resolutionPlan.components || []).filter((component) => component.required);
  const representedComponents = new Set(lines.flatMap((line) => line.coveredComponentIds));
  for (const component of requiredComponents) {
    if (!representedComponents.has(component.id) && !missingComponents.includes(component.label)) {
      missingComponents.push(component.label);
    }
  }

  if (pricingType !== "no_result" && !lines.length) {
    issues.push(issue("market", item.id, "missing_pricing_lines", "El resultado comercial no trae lineas de precio verificables."));
  }
  if (pricingType === "observed_single" && lines.length !== 1) {
    issues.push(issue("market", item.id, "single_price_requires_one_line", "Un precio directo debe tener exactamente una linea."));
  }
  if (pricingType === "composed_bom" && lines.length < 2 && !missingComponents.length) {
    issues.push(issue("market", item.id, "bom_requires_components", "Un BOM completo debe incluir al menos dos componentes."));
  }
  if (pricingType === "no_result" && (supplier || reportedPrice !== null || lines.length)) {
    issues.push(issue("market", item.id, "contradictory_no_result", "El resultado declara no_result pero incluye datos comerciales."));
  }
  if (reportedPrice !== null && calculatedPrice !== null && Math.abs(reportedPrice - calculatedPrice) > Math.max(1, calculatedPrice * 0.01)) {
    calculationWarnings.push(`El total reportado ${reportedPrice} no coincide con el total recalculado ${calculatedPrice}. Se conserva el recalculado.`);
    issues.push({ stage: "market", itemId: item.id, code: "reported_total_mismatch", severity: "warning", message: calculationWarnings.at(-1) || "" });
  }
  if (lines.some((line) => line.currency && line.currency !== currency)) {
    issues.push(issue("market", item.id, "mixed_currencies", "No se pueden sumar lineas con monedas diferentes sin una conversion sustentada."));
  }
  const commercialPackages = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const packageKey = [
      line.supplier.toLowerCase(),
      line.url.toLowerCase(),
      line.observedPackagePrice,
      line.sourceQuantity,
      line.sourceUnit.toLowerCase()
    ].join("|");
    if (commercialPackages.has(packageKey)) {
      issues.push(issue("market", item.id, "duplicate_commercial_package", `La linea ${index + 1} vuelve a sumar el mismo paquete comercial. Un paquete que cubre varios componentes debe declararlos en coveredComponentIds.`));
    }
    commercialPackages.add(packageKey);
  }

  const noData = pricingType === "no_result" || !supplier || calculatedPrice === null;
  const market: MarketResult = {
    supplier,
    product,
    price: noData ? null : calculatedPrice,
    currency,
    url: text(record.url) || lines[0]?.url || "",
    notes: text(record.notes),
    evidence: stringList(record.evidence),
    confidence: noData ? "no_data" : confidenceValue(record.confidence),
    decision: noData ? "no_result" : workerRecommendation,
    pricingType,
    lines,
    missingComponents,
    calculationWarnings,
    workerRecommendation: noData ? "no_result" : workerRecommendation
  };
  return { market, issues };
}

export function normalizeSupervision(record: JsonRecord, item: AgentItem) {
  const proposed: SupervisionResult = {
    sourceSupport: verificationValue(record.sourceSupport),
    priceObserved: verificationValue(record.priceObserved),
    productMatch: verificationValue(record.productMatch),
    presentationMatch: verificationValue(record.presentationMatch),
    componentCompleteness: enumValue(text(record.componentCompleteness), ["complete", "partial", "missing", "unknown"] as const, "unknown"),
    calculationValid: verificationValue(record.calculationValid),
    confidence: confidenceValue(record.confidence),
    decision: decisionValue(record.decision),
    reason: text(record.reason),
    firstDeviation: text(record.firstDeviation),
    humanAction: text(record.humanAction),
    policyAdjustments: [],
    verifiedAt: now()
  };
  return enforceSupervisionPolicy(item, proposed);
}

export function enforceSupervisionPolicy(item: AgentItem, proposed: SupervisionResult) {
  const result = { ...proposed, policyAdjustments: [...proposed.policyAdjustments] };
  const market = item.market;
  const plan = item.technical?.resolutionPlan;

  if (!market || market.pricingType === "no_result" || !market.supplier || market.price === null) {
    return force(result, "no_data", "no_result", "Sin proveedor y precio observables.", "no_data", "required");
  }
  if (plan?.automationLevel === "human") {
    return force(result, atMost(result.confidence, "medium"), "human_review", "El plan tecnico conserva una decision o supuesto que debe confirmar una persona.", "conditional", "required");
  }
  const assisted = plan?.automationLevel === "assisted";
  if (market.missingComponents.length || ["missing", "unknown"].includes(result.componentCompleteness)) {
    return force(result, atMost(result.confidence, "medium"), "human_review", "Faltan componentes obligatorios del costo.", "conditional", "required");
  }
  if (result.sourceSupport === "no" || result.priceObserved === "no" || result.productMatch === "no" || result.presentationMatch === "no") {
    return force(result, "low", "retry", "La evidencia contradice o no soporta el candidato.", "insufficient", "required");
  }
  if (result.priceObserved === "unknown" || result.productMatch === "unknown") {
    return force(result, atMost(result.confidence, "medium"), "human_review", "La evidencia no permite confirmar el precio o el producto.", "conditional", "required");
  }
  if (result.calculationValid === "no") {
    return force(result, "low", "retry", "El calculo derivado no es reproducible.", "insufficient", "required");
  }
  if (["derived_conversion", "composed_bom"].includes(market.pricingType) && result.calculationValid === "unknown") {
    return force(result, atMost(result.confidence, "medium"), "human_review", "Un calculo derivado no puede aceptarse sin reproducir sus operandos.", "conditional", "required");
  }
  if (
    result.sourceSupport === "yes" &&
    result.priceObserved === "yes" &&
    result.productMatch === "yes" &&
    ["yes", "not_applicable"].includes(result.presentationMatch) &&
    result.componentCompleteness === "complete" &&
    ["yes", "not_applicable"].includes(result.calculationValid)
  ) {
    if (assisted) {
      return force(result, "medium", "accept_with_note", "La fuente y el precio estan sustentados; el plan conserva una diferencia o supuesto no material para el benchmark.", "sufficient", "none");
    }
    return force(result, "high", "accept", "La evidencia satisface todos los controles de alta confianza.", "sufficient", "none");
  }

  const mediumBenchmarkIsSufficient =
    ["yes", "partial", "unknown"].includes(result.sourceSupport) &&
    ["yes", "partial"].includes(result.priceObserved) &&
    ["yes", "partial"].includes(result.productMatch) &&
    ["yes", "partial", "not_applicable"].includes(result.presentationMatch) &&
    ["complete", "partial"].includes(result.componentCompleteness) &&
    ["yes", "partial", "not_applicable", "unknown"].includes(result.calculationValid) &&
    !["derived_conversion", "composed_bom"].includes(market.pricingType);

  if (mediumBenchmarkIsSufficient) {
    return force(
      result,
      "medium",
      "accept_with_note",
      "La referencia es suficiente para estimar mercado; la diferencia observada no bloquea el benchmark y queda declarada.",
      "sufficient",
      "none"
    );
  }

  return force(
    result,
    atMost(result.confidence, "medium"),
    "human_review",
    "El candidato conserva una duda material que puede cambiar el precio o la correspondencia del producto.",
    "conditional",
    "required"
  );
}

export function effectiveDecision(item: AgentItem) {
  return item.humanDecision?.decision || item.supervision?.decision || item.market?.decision || "no_result";
}

export function effectiveConfidence(item: AgentItem) {
  return item.humanDecision?.confidence || item.supervision?.confidence || item.market?.confidence || "no_data";
}

function normalizeComponent(value: unknown, index: number): ResolutionComponent | null {
  const record = recordValue(value);
  if (!record) return null;
  const kind = enumValue(
    text(record.kind),
    ["product", "accessory", "consumable", "service", "shipping", "custom"] as const,
    "product"
  );
  return {
    id: text(record.id) || `component-${index + 1}`,
    label: text(record.label),
    kind,
    required: record.required !== false,
    quantity: numberOrNull(record.quantity),
    unit: text(record.unit),
    sourcingBrief: text(record.sourcingBrief),
    requirementBasis: stringList(record.requirementBasis),
    assumptions: stringList(record.assumptions)
  };
}

function normalizeEvidence(value: unknown): EvidenceArtifact | null {
  const record = recordValue(value);
  if (!record) return null;
  const url = text(record.url);
  const method = enumValue(
    text(record.verificationMethod),
    ["direct_page", "search_result", "catalog", "provider_quote", "not_observed"] as const,
    "not_observed"
  );
  return {
    url,
    finalUrl: text(record.finalUrl) || url,
    observedAt: text(record.observedAt),
    pageTitle: text(record.pageTitle),
    observedProduct: text(record.observedProduct),
    observedPrice: numberOrNull(record.observedPrice),
    currency: text(record.currency),
    presentation: text(record.presentation),
    availability: enumValue(
      text(record.availability),
      ["in_stock", "out_of_stock", "unknown", "not_applicable"] as const,
      "unknown"
    ),
    verificationMethod: method,
    observations: stringList(record.observations)
  };
}

function normalizePricingLine(
  value: unknown,
  index: number,
  itemId: string,
  issues: ValidationIssue[]
): PricingLine | null {
  const record = recordValue(value);
  if (!record) return null;
  const pricingMethod = enumValue(
    text(record.pricingMethod),
    ["direct", "prorated", "purchase_minimum"] as const,
    "direct"
  );
  const observedPackagePrice = numberOrNull(record.observedPackagePrice);
  const sourceQuantity = numberOrNull(record.sourceQuantity);
  const requiredQuantity = numberOrNull(record.requiredQuantity);
  const sourceUnit = text(record.sourceUnit);
  const requiredUnit = text(record.requiredUnit);
  let referenceCost: number | null = null;
  let purchaseMinimumCost: number | null = null;
  let formula = "";

  if (observedPackagePrice !== null && observedPackagePrice >= 0) {
    if (pricingMethod === "direct") {
      const count = requiredQuantity && requiredQuantity > 0 ? requiredQuantity : 1;
      referenceCost = roundMoney(observedPackagePrice * count);
      purchaseMinimumCost = referenceCost;
      formula = `${observedPackagePrice} x ${count}`;
    } else if (
      sourceQuantity !== null && sourceQuantity > 0 &&
      requiredQuantity !== null && requiredQuantity > 0 &&
      sourceUnit && requiredUnit && comparableUnits(sourceUnit, requiredUnit)
    ) {
      referenceCost = roundMoney((observedPackagePrice / sourceQuantity) * requiredQuantity);
      purchaseMinimumCost = roundMoney(Math.ceil(requiredQuantity / sourceQuantity) * observedPackagePrice);
      formula = pricingMethod === "prorated"
        ? `${observedPackagePrice} / ${sourceQuantity} x ${requiredQuantity}`
        : `ceil(${requiredQuantity} / ${sourceQuantity}) x ${observedPackagePrice}`;
    } else {
      issues.push(issue("market", itemId, "unreproducible_calculation", `La linea ${index + 1} no tiene operandos y unidades compatibles.`));
    }
  }
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.map(normalizeEvidence).filter((entry): entry is EvidenceArtifact => Boolean(entry))
    : [];
  if (!text(record.supplier) || !text(record.product) || observedPackagePrice === null) {
    issues.push(issue("market", itemId, "incomplete_pricing_line", `La linea ${index + 1} no identifica proveedor, producto y precio observado.`));
  }
  if (!evidence.length) issues.push(issue("market", itemId, "missing_evidence_artifact", `La linea ${index + 1} no tiene evidencia estructurada.`));
  if (evidence.some((entry) => entry.observedPrice !== null && observedPackagePrice !== null && Math.abs(entry.observedPrice - observedPackagePrice) > Math.max(1, observedPackagePrice * 0.01))) {
    issues.push(issue("market", itemId, "evidence_price_mismatch", `La linea ${index + 1} reporta un precio diferente al artefacto.`));
  }
  return {
    componentId: text(record.componentId) || `component-${index + 1}`,
    coveredComponentIds: stringList(record.coveredComponentIds).length
      ? stringList(record.coveredComponentIds)
      : [text(record.componentId) || `component-${index + 1}`],
    label: text(record.label),
    supplier: text(record.supplier),
    product: text(record.product),
    observedPackagePrice,
    currency: text(record.currency) || evidence[0]?.currency || "COP",
    url: text(record.url) || evidence[0]?.finalUrl || evidence[0]?.url || "",
    sourceQuantity,
    sourceUnit,
    requiredQuantity,
    requiredUnit,
    pricingMethod,
    referenceCost,
    purchaseMinimumCost,
    formula,
    evidence
  };
}

function force(
  result: SupervisionResult,
  confidence: Confidence,
  decision: Decision,
  reason: string,
  benchmarkUsability: NonNullable<SupervisionResult["benchmarkUsability"]>,
  reviewRequirement: NonNullable<SupervisionResult["reviewRequirement"]>
) {
  if (result.confidence !== confidence || result.decision !== decision) {
    result.policyAdjustments.push(reason);
  }
  result.confidence = confidence;
  result.decision = decision;
  result.benchmarkUsability = benchmarkUsability;
  result.reviewRequirement = reviewRequirement;
  return result;
}

function atMost(value: Confidence, maximum: "medium") {
  return value === "high" ? maximum : value === "no_data" ? "no_data" : value;
}

export function confidenceValue(value: unknown): Confidence {
  return enumValue(text(value), CONFIDENCES, "no_data");
}

function decisionValue(value: unknown): Decision {
  return enumValue(text(value), DECISIONS, "human_review");
}

function verificationValue(value: unknown): VerificationValue {
  return enumValue(text(value), VERIFICATION_VALUES, "unknown");
}

function comparableUnits(left: string, right: string) {
  return normalizeUnit(left) === normalizeUnit(right);
}

function normalizeUnit(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[.\s]/g, "");
  const aliases: Record<string, string> = {
    unidad: "un", unidades: "un", und: "un", un: "un",
    metro: "m", metros: "m", ml: "m", m: "m",
    litro: "l", litros: "l", lt: "l", l: "l",
    kilogramo: "kg", kilogramos: "kg", kilo: "kg", kg: "kg",
    gramo: "g", gramos: "g", gr: "g", g: "g"
  };
  return aliases[normalized] || normalized;
}

function commonCurrency(lines: PricingLine[]) {
  const values = [...new Set(lines.map((line) => line.currency).filter(Boolean))];
  return values.length === 1 ? values[0] : "";
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function enumValue<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function issue(stage: StageId, itemId: string, code: string, message: string): ValidationIssue {
  return { stage, itemId, code, severity: "error", message };
}
