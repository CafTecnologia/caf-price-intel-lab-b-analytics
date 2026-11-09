import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  contractRecords,
  normalizeMarketResult,
  normalizeResolutionPlan,
  normalizeSupervision
} from "../lib/commercial-policy";
import type {
  AgentItem,
  AutomationLevel,
  Decision,
  ResolutionMode
} from "../lib/types";

type GoldenCase = {
  id: string;
  name: string;
  unit: string;
  description: string;
  expectedMode: ResolutionMode;
  expectedAutomation: AutomationLevel;
  expectedOutcome: Decision;
};

const golden = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "fixtures", "golden-resolution-cases.json"), "utf8")
) as { cases: GoldenCase[] };

test("golden: los ocho modos separan automatizacion, asistencia y control humano", () => {
  assert.equal(golden.cases.length, 8);
  for (const entry of golden.cases) {
    const item = makeItem(entry);
    const record = technicalRecord(entry);
    const result = normalizeResolutionPlan(record, item);
    assert.ok(result.plan, entry.id);
    assert.equal(result.plan?.mode, entry.expectedMode, entry.id);
    assert.equal(result.plan?.automationLevel, entry.expectedAutomation, entry.id);
    assert.equal(result.issues.filter((issue) => issue.severity === "error").length, 0, entry.id);
  }
});

test("golden: un plan automatico con supuestos materiales es invalido", () => {
  const entry = golden.cases[0];
  const item = makeItem(entry);
  const record = technicalRecord(entry);
  const plan = record.resolutionPlan as Record<string, unknown>;
  plan.assumptions = ["El empaque probablemente trae 100 unidades"];
  const result = normalizeResolutionPlan(record, item);
  assert.ok(result.issues.some((issue) => issue.code === "unsafe_automatic_plan"));
});

test("golden: la conversion conserva precio prorrateado y compra minima reproducibles", () => {
  const entry = golden.cases.find((value) => value.id === "bulk-proration")!;
  const item = withPlan(entry);
  const result = normalizeMarketResult({
    id: item.id,
    pricingType: "derived_conversion",
    supplier: "Proveedor de cable",
    product: "Rollo cable solar 100 m",
    price: 999,
    currency: "COP",
    url: "https://example.com/cable",
    notes: "",
    confidence: "medium",
    workerRecommendation: "accept_with_note",
    missingComponents: [],
    calculationWarnings: [],
    lines: [{
      componentId: "main",
      label: "Cable solar",
      supplier: "Proveedor de cable",
      product: "Rollo cable solar 100 m",
      observedPackagePrice: 500000,
      currency: "COP",
      url: "https://example.com/cable",
      sourceQuantity: 100,
      sourceUnit: "m",
      requiredQuantity: 37,
      requiredUnit: "ML",
      pricingMethod: "prorated",
      evidence: [evidence("https://example.com/cable", 500000, "Rollo 100 m")]
    }]
  }, item);
  assert.equal(result.market.lines[0].referenceCost, 185000);
  assert.equal(result.market.lines[0].purchaseMinimumCost, 500000);
  assert.equal(result.market.price, 500000);
  assert.ok(result.issues.some((issue) => issue.code === "reported_total_mismatch"));
});

test("golden: un BOM incompleto nunca se acepta automaticamente", () => {
  const entry = golden.cases.find((value) => value.id === "bundle-complete")!;
  const item = withPlan(entry);
  item.market = normalizeMarketResult({
    id: item.id,
    pricingType: "composed_bom",
    supplier: "Proveedor mobiliario",
    product: "Mesa",
    currency: "COP",
    url: "https://example.com/mesa",
    notes: "",
    confidence: "high",
    workerRecommendation: "accept",
    missingComponents: [],
    calculationWarnings: [],
    lines: [line("mesa", "Mesa", 300000)]
  }, item).market;
  const supervision = normalizeSupervision(supervisionRecord("high", "accept"), item);
  assert.equal(supervision.decision, "human_review");
  assert.equal(supervision.confidence, "medium");
  assert.ok(item.market.missingComponents.length >= 2);
});

test("golden: un paquete que cubre dos servicios se suma una sola vez", () => {
  const entry = golden.cases.find((value) => value.id === "product-service")!;
  const item = withPlan(entry);
  const shared = line("instalacion", "Instalacion con configuracion", 120000);
  shared.coveredComponentIds = ["instalacion", "configuracion"];
  const market = normalizeMarketResult({
    id: item.id,
    pricingType: "partial_benchmark",
    supplier: "Integrador",
    product: "Servicio de instalacion y configuracion",
    price: 120000,
    currency: "COP",
    url: shared.url,
    notes: "",
    confidence: "medium",
    workerRecommendation: "human_review",
    missingComponents: ["Camara IP"],
    calculationWarnings: [],
    lines: [shared]
  }, item);
  assert.equal(market.market.price, 120000);
  assert.equal(market.issues.some((issue) => issue.code === "duplicate_commercial_package"), false);

  const duplicated = normalizeMarketResult({
    id: item.id,
    pricingType: "composed_bom",
    supplier: "Integrador",
    product: "Servicio duplicado",
    price: 240000,
    currency: "COP",
    url: shared.url,
    notes: "",
    confidence: "medium",
    workerRecommendation: "human_review",
    missingComponents: ["Camara IP"],
    calculationWarnings: [],
    lines: [shared, { ...shared, componentId: "configuracion", coveredComponentIds: ["configuracion"] }]
  }, item);
  assert.ok(duplicated.issues.some((issue) => issue.code === "duplicate_commercial_package"));
});

test("golden: alta confianza exige fuente, precio, producto, presentacion, componentes y calculo", () => {
  const item = directItem();
  item.market = normalizeMarketResult(marketRecord(item, 25000), item).market;
  const accepted = normalizeSupervision(supervisionRecord("high", "accept"), item);
  assert.equal(accepted.confidence, "high");
  assert.equal(accepted.decision, "accept");

  const unknown = normalizeSupervision({ ...supervisionRecord("high", "accept"), priceObserved: "unknown" }, item);
  assert.equal(unknown.confidence, "medium");
  assert.equal(unknown.decision, "human_review");

  const contradicted = normalizeSupervision({ ...supervisionRecord("high", "accept"), productMatch: "no" }, item);
  assert.equal(contradicted.confidence, "low");
  assert.equal(contradicted.decision, "retry");
});

test("golden: un benchmark asistido bien sustentado sirve con nota en vez de bloquearse", () => {
  const item = directItem();
  item.technical!.resolutionPlan.automationLevel = "assisted";
  item.technical!.resolutionPlan.humanQuestions = ["Confirmar un detalle secundario que no cambia materialmente el rango de precio."];
  item.market = normalizeMarketResult(marketRecord(item, 25000), item).market;
  const result = normalizeSupervision(supervisionRecord("high", "accept"), item);
  assert.equal(result.confidence, "medium");
  assert.equal(result.decision, "accept_with_note");
});

test("golden: una variacion moderada del precio visible conserva el benchmark con nota", () => {
  const item = directItem();
  item.market = normalizeMarketResult(marketRecord(item, 150000), item).market;
  const result = normalizeSupervision({
    ...supervisionRecord("medium", "accept_with_note"),
    priceObserved: "partial",
    reason: "La misma fuente muestra hoy 140000 COP; la diferencia es una actualizacion comercial no material.",
    firstDeviation: "El precio visible actual difiere moderadamente del reportado."
  }, item);
  assert.equal(result.confidence, "medium");
  assert.equal(result.decision, "accept_with_note");
});

test("golden: sin proveedor o precio se clasifica sin datos, no baja confianza", () => {
  const item = directItem();
  item.market = normalizeMarketResult({
    id: item.id,
    pricingType: "no_result",
    supplier: "",
    product: "",
    price: null,
    currency: "COP",
    url: "",
    notes: "No se encontro fuente.",
    confidence: "low",
    workerRecommendation: "retry",
    missingComponents: [],
    calculationWarnings: [],
    lines: []
  }, item).market;
  const result = normalizeSupervision(supervisionRecord("low", "retry"), item);
  assert.equal(result.confidence, "no_data");
  assert.equal(result.decision, "no_result");
});

test("golden: IDs duplicados o ajenos no contaminan el lote", () => {
  const result = contractRecords("market", {
    contract: "caf-market/v2",
    items: [{ id: "1" }, { id: "1" }, { id: "999" }]
  }, ["1", "2"]);
  assert.equal(result.records.size, 0);
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), ["duplicate_id", "unexpected_id"]);
});

function makeItem(entry: GoldenCase): AgentItem {
  return {
    id: entry.id,
    original: {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      unit: entry.unit,
      quantity: 1,
      ceilingPrice: "$ 100.000",
      source: { file: "golden.json", row: 1 },
      raw: {}
    },
    normalized: {
      name: entry.name,
      description: entry.description,
      unit: entry.unit,
      quantity: 1,
      ceilingPriceCop: 100000,
      transformations: []
    },
    status: "normalized",
    reviews: []
  };
}

function technicalRecord(entry: GoldenCase) {
  const human = entry.expectedAutomation === "human";
  const assisted = entry.expectedAutomation === "assisted";
  const bundle = entry.expectedMode === "bundle_bom";
  const service = entry.expectedMode === "product_plus_service";
  const components = human ? [] : bundle ? [
    component("mesa", "Mesa", "product"),
    component("pasacables", "Pasacables", "accessory"),
    component("canaleta", "Canaleta", "accessory")
  ] : service ? [
    component("camara", "Camara IP", "product"),
    component("instalacion", "Instalacion y configuracion", "service")
  ] : [component("main", entry.name, "product")];
  return {
    id: entry.id,
    purchaseMode: human ? "unclear" : "open",
    hardRequirements: [entry.description],
    flexibleRequirements: [],
    ambiguities: human || assisted ? ["Confirmacion requerida"] : [],
    searchBrief: `Buscar ${entry.name}`,
    confidence: human ? "low" : assisted ? "medium" : "high",
    resolutionPlan: {
      mode: entry.expectedMode,
      automationLevel: entry.expectedAutomation,
      rationale: `Estrategia golden para ${entry.id}.`,
      components,
      conversion: ["pack_conversion", "bulk_proration"].includes(entry.expectedMode) ? {
        sourcePresentation: "",
        sourceQuantity: null,
        sourceUnit: "",
        requiredQuantity: entry.id === "bulk-proration" ? 37 : 1000,
        requiredUnit: entry.id === "bulk-proration" ? "ML" : "UN",
        calculationBasis: "both",
        wasteFactorPct: null
      } : null,
      assumptions: assisted ? ["La presentacion comercial debe confirmarse con la fuente"] : [],
      missingInformation: human ? ["Dato tecnico material no disponible"] : [],
      humanQuestions: human ? ["Confirmar dato faltante"] : assisted ? ["Confirmar presentacion observada"] : [],
      stopReasons: human ? ["No concluir sin dato faltante"] : []
    }
  };
}

function withPlan(entry: GoldenCase) {
  const item = makeItem(entry);
  item.technical = {
    purchaseMode: technicalRecord(entry).purchaseMode as "exact" | "defined_range" | "open" | "unclear",
    hardRequirements: [entry.description],
    flexibleRequirements: [],
    ambiguities: [],
    searchBrief: `Buscar ${entry.name}`,
    confidence: entry.expectedAutomation === "automatic" ? "high" : "medium",
    resolutionPlan: normalizeResolutionPlan(technicalRecord(entry), item).plan!
  };
  item.status = "interpreted";
  return item;
}

function directItem() {
  return withPlan(golden.cases[0]);
}

function component(id: string, label: string, kind: string) {
  return { id, label, kind, required: true, quantity: 1, unit: "UN", sourcingBrief: `Buscar ${label}`, requirementBasis: [label], assumptions: [] };
}

function evidence(url: string, price: number, presentation: string) {
  return { url, finalUrl: url, observedAt: "2026-07-23T12:00:00Z", pageTitle: "Producto", observedProduct: "Producto", observedPrice: price, currency: "COP", presentation, availability: "in_stock", verificationMethod: "direct_page", observations: [] };
}

function line(componentId: string, label: string, price: number) {
  return { componentId, coveredComponentIds: [componentId], label, supplier: "Proveedor", product: label, observedPackagePrice: price, currency: "COP", url: `https://example.com/${componentId}`, sourceQuantity: 1, sourceUnit: "UN", requiredQuantity: 1, requiredUnit: "UN", pricingMethod: "direct", evidence: [evidence(`https://example.com/${componentId}`, price, "Unidad")] };
}

function marketRecord(item: AgentItem, price: number) {
  return { id: item.id, pricingType: "observed_single", supplier: "Proveedor", product: item.original.name, price, currency: "COP", url: "https://example.com/direct", notes: "", confidence: "high", workerRecommendation: "accept", missingComponents: [], calculationWarnings: [], lines: [line("main", item.original.name, price)] };
}

function supervisionRecord(confidence: string, decision: string) {
  return { sourceSupport: "yes", priceObserved: "yes", productMatch: "yes", presentationMatch: "yes", componentCompleteness: "complete", calculationValid: "yes", confidence, decision, reason: "Evidencia coherente.", firstDeviation: "", humanAction: "" };
}
