import { OfferDisplaySchema } from "../../../../lib/offer-presentation";
import { currentCostVersionId } from "@offer/lib/cost-version-selection";
import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { ADDITIONAL_COST_CATEGORIES, COST_MODES, COST_STATISTICS, COST_SCENARIO_MODES, COST_BASIS_STATUSES, DELIVERABLE_TYPES, ITEM_COST_MODES, OFFER_MODES, PRICE_SOURCE_CURRENCIES, VAT_MODES, WITHHOLDING_BASES, OriginalSourceInputSchema, TechnicalAnnexExcerptInputSchema, ProcurementLotInputSchema } from "../../../../lib/contract";
import { CalculationConflictError, HistoricalReadonlyError, deleteCalculation, getCalculation, getProjectPriceBaseState, getSavedCalculationChangeReceipt, listPriceBaseVersions, listProjectScenarios, resetCalculation, saveCalculation } from "../../../../lib/store";
import { appPath } from "../../../../lib/base-path";
import { proxyOdooSession } from "../../../../lib/odoo-collaboration";
import { capturePriceBase, priceBaseRestoreImpact } from "../../../../lib/price-base";
import type { FinancialOfferProject } from "../../../../lib/contract";

function isInitialPlaceholderCalculation(calculation: Pick<FinancialOfferProject, "items">): boolean {
  const items = calculation.items;
  return (
    items.length === 1 &&
    items[0]?.description === "Item pendiente" &&
    items[0]?.notes === "Cálculo creado para carga manual posterior."
  );
}

function hasImportedItems(calculation: Pick<FinancialOfferProject, "items">): boolean {
  return calculation.items.length > 0 && !isInitialPlaceholderCalculation(calculation);
}

function buildOdooCallbackUrls(callbackUrl: string): string[] {
  const urls: string[] = [];

  try {
    const parsed = new URL(callbackUrl);
    const internalBase = process.env.ODOO_INTERNAL_BASE_URL?.trim();
    const devDockerBase =
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "18069"
        ? "http://caf-dev-odoo:8069"
        : "";
    const replacementBase = internalBase || devDockerBase;

    if (replacementBase) {
      const internal = new URL(replacementBase);
      internal.pathname = parsed.pathname;
      internal.search = parsed.search;
      urls.push(internal.toString());
    }
  } catch {
    // Keep the public callback below; malformed URLs will be reported by fetch.
  }

  urls.push(callbackUrl);
  return Array.from(new Set(urls));
}

async function syncOdooCalculation(request: Request, calculation: FinancialOfferProject): Promise<string | null> {
  if (!calculation.odooCallbackUrl) {
    return null;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (calculation.odooDb) {
    headers["X-Odoo-Database"] = calculation.odooDb;
  }

  const externalUrl = new URL(appPath(`/calculations/${calculation.id}`), request.url).toString();
  const scenarios = await listProjectScenarios(calculation.id);
  const body = JSON.stringify({
    calculationId: calculation.id,
    externalUrl,
    sourceTitle: calculation.name,
    status: hasImportedItems(calculation) ? "linked" : "pending",
    odooProjectId: calculation.odooProjectId,
    settlement: {
      applyReteFuente: calculation.settings.applyReteFuente,
      reteFuenteRate: calculation.settings.reteFuenteRate,
      reteFuenteBase: calculation.settings.reteFuenteBase,
      applyReteIva: calculation.settings.applyReteIva,
      reteIvaRate: calculation.settings.reteIvaRate,
      reteIvaBase: calculation.settings.reteIvaBase,
      applyReteIca: calculation.settings.applyReteIca,
      reteIcaRate: calculation.settings.reteIcaRate,
      reteIcaBase: calculation.settings.reteIcaBase,
      stampTaxRate: calculation.settings.stampTaxRate,
    },
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      createdAt: scenario.createdAt,
      createdBy: scenario.createdBy ?? null,
      itemCount: scenario.snapshot.items.length,
    })),
  });

  let lastError = "Odoo no confirmó la sincronización.";
  for (const callbackUrl of buildOdooCallbackUrls(calculation.odooCallbackUrl)) {
    try {
      const response = await fetch(callbackUrl, { method: "POST", headers, body });
      if (response.ok) {
        return null;
      }
      const data = await response.json().catch(() => ({}));
      lastError = typeof data.error === "string" ? data.error : `Odoo respondió ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "No se pudo contactar Odoo.";
    }
  }

  return lastError;
}

async function authorizeLinkedCalculationSave(request: Request, calculation: FinancialOfferProject): Promise<string | null> {
  if (!calculation.odooProjectId) return null;
  try {
    const response = await proxyOdooSession(request, `/caf/finanzas/calculations/${encodeURIComponent(calculation.id)}/cost-version-auth`);
    if (response.status === 204) return null;
    return response.status === 401 ? "Inicia sesión en Odoo antes de guardar este cálculo vinculado." : "No tienes permiso para editar el proyecto vinculado en Odoo.";
  } catch { return "No se pudo verificar tu permiso de Odoo; el cálculo no se guardó."; }
}

async function recordManualChange(request: Request, calculation: FinancialOfferProject): Promise<string | null> {
  if (!calculation.odooProjectId) return null;
  const receipt = await getSavedCalculationChangeReceipt(calculation.id, calculation.updatedAt);
  if (!receipt) return null;
  try {
    const state = await proxyOdooSession(request, `/caf/finanzas/calculations/${encodeURIComponent(calculation.id)}/collaboration?accessOnly=1`);
    if (!state.ok) return "El cálculo se guardó, pero no se pudo registrar la bitácora en Odoo.";
    const data = await state.json() as { csrfToken?: string };
    if (!data.csrfToken) return "El cálculo se guardó, pero falta la sesión Odoo para registrar la bitácora.";
    const form = new URLSearchParams({ csrf_token: data.csrfToken, receipt_id: receipt.id });
    const logged = await proxyOdooSession(request, `/caf/finanzas/calculations/${encodeURIComponent(calculation.id)}/record-change`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    return logged.ok ? null : "El cálculo se guardó, pero la bitácora de Odoo quedó pendiente de registrar.";
  } catch { return "El cálculo se guardó, pero la bitácora de Odoo quedó pendiente de registrar."; }
}

const nullableNumber = z.number().finite().nullable();
const nullableNonNegativeNumber = nullableNumber.refine((value) => value === null || value >= 0);
const nullableDiscountPercent = nullableNumber.refine((value) => value === null || (value >= 0 && value <= 100));

const DeleteCalculationSchema = z.object({
  operationId: z.string().regex(/^[0-9a-f]{32}$/i),
  calculationId: z.string().trim().min(1),
  externalId: z.string().trim().min(1).nullable(),
  odooProjectId: z.string().trim().min(1).nullable(),
  iaRunId: z.string().trim().min(1).nullable(),
  sourceAnalysisId: z.string().trim().min(1).nullable(),
  expectedUpdatedAt: z.string().datetime(),
}).strict();

const ResetCalculationSchema = z.object({
  action: z.literal("reset"),
  confirmation: z.literal("RESET_CALCULATION"),
  expectedUpdatedAt: z.string().datetime().optional(),
});

const DELETE_SERVICE_TOKEN_MIN_LENGTH = 32;

type DeleteAuthorization = "authorized" | "misconfigured" | "unauthorized";

function authorizeDeleteService(request: Request): DeleteAuthorization {
  const expected = process.env.FINANCIAL_DELETE_SERVICE_TOKEN?.trim() ?? "";
  if (expected.length < DELETE_SERVICE_TOKEN_MIN_LENGTH) {
    return "misconfigured";
  }

  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) {
    return "unauthorized";
  }

  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const actualDigest = createHash("sha256").update(match[1], "utf8").digest();
  return timingSafeEqual(expectedDigest, actualDigest) ? "authorized" : "unauthorized";
}

function deleteAuthorizationError(request: Request): NextResponse | null {
  const authorization = authorizeDeleteService(request);
  if (authorization === "authorized") return null;
  if (authorization === "misconfigured") {
    return NextResponse.json(
      { error: "El servicio de eliminación no está configurado.", code: "DELETE_SERVICE_UNAVAILABLE" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: "Credencial de servicio inválida.", code: "DELETE_SERVICE_UNAUTHORIZED" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

const PriceSourcePatchSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().optional().default(""),
    unitPrice: nullableNumber,
    currency: z.enum(PRICE_SOURCE_CURRENCIES),
    url: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    trm: nullableNumber,
    importPct: nullableNumber,
  })
  .strip();

const AdditionalCostPatchSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    category: z.enum(ADDITIONAL_COST_CATEGORIES),
    mode: z.enum(ITEM_COST_MODES),
    amount: nullableNumber.refine((value) => value === null || value >= 0),
    notes: z.string().optional().default(""),
    reviewStatus: z.enum(["suggested", "included", "excluded"]).optional(),
  })
  .strip();

const GeneralCostPatchSchema = AdditionalCostPatchSchema.omit({ mode: true, reviewStatus: true }).extend({ amount: z.number().finite().min(0) });

const ItemPatchSchema = z
  .object({
    id: z.string().trim().min(1),
    item: z.string().optional().default(""),
    description: z.string().trim().min(1),
    technicalDescription: z.string().optional().default(""),
    sourceOriginal: OriginalSourceInputSchema.optional(),
    procurementLot: ProcurementLotInputSchema.nullable().optional(),
    technicalAnnex: z.array(TechnicalAnnexExcerptInputSchema).optional(),
    costBasisStatus: z.enum(COST_BASIS_STATUSES).nullable().optional(),
    deliverableType: z.enum(DELIVERABLE_TYPES).nullable().optional(),
    quantity: nullableNumber,
    unit: z.string().optional().default(""),
    referenceUnit: nullableNumber,
    costOptimistic: nullableNumber,
    costModerate: nullableNumber,
    costWeightedUnit: nullableNumber,
    manualCostAssumption: z.object({ base: z.literal("reference"), discountPct: z.number().finite().min(0).max(100), previous: z.object({
      manualUnitCost: nullableNonNegativeNumber, selectedCostMode: z.enum(COST_MODES), selectedPriceSourceId: z.string().nullable(),
      analysisCostStatistic: z.enum(COST_STATISTICS).nullable(), costScenarioMode: z.enum(COST_SCENARIO_MODES).nullable(), costScenarioDiscountPct: nullableDiscountPercent,
    }).optional() }).nullable().optional(),
    offerAdjustment: z.object({ kind: z.enum(["profit", "ceiling"]), percent: z.number().finite(), previous: z.object({
      offerMode: z.enum(OFFER_MODES).nullable(), discountPct: nullableNumber, profitPct: nullableNumber, manualOfferUnit: nullableNumber,
    }) }).nullable().optional(),
    manualUnitCost: nullableNonNegativeNumber,
    selectedCostMode: z.enum(COST_MODES),
    selectedPriceSourceId: z.string().trim().nullable().optional(),
    costScenarioMode: z.enum(COST_SCENARIO_MODES).nullable().optional().default(null),
    costScenarioDiscountPct: nullableDiscountPercent.optional().default(null),
    priceSources: z.array(PriceSourcePatchSchema).optional().default([]),
    additionalCosts: z.array(AdditionalCostPatchSchema).optional().default([]),
    offerMode: z.enum(OFFER_MODES).nullable(),
    discountPct: nullableNumber,
    profitPct: nullableNumber,
    manualOfferUnit: nullableNumber,
    vatMode: z.enum(VAT_MODES),
    vatRate: nullableNumber,
    source1: z.string().optional().default(""),
    source2: z.string().optional().default(""),
    source3: z.string().optional().default(""),
    notes: z.string().optional().default(""),
  })
  .strip();

const CalculationPatchSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime().optional(),
    expectedItemIds: z.array(z.string().trim().min(1)).optional(),
    name: z.string().trim().min(1).optional(),
    odooProjectId: z.string().trim().nullable().optional(),
    notesDocument: z.record(z.string(), z.unknown()).optional(),
    iaRunId: z.string().trim().nullable().optional(),
    sourceAnalysisId: z.string().trim().nullable().optional(),
    settings: z
      .object({
        vatRate: z.number().finite().optional(),
        defaultMargin: z.number().finite().optional(),
        defaultCostMode: z.enum(COST_MODES).optional(),
        manualCostPriority: z.boolean().optional(),
        usdToCopRate: z.number().finite().nullable().optional(),
        usdImportPct: z.number().finite().optional(),
        manualReferenceTotal: z.number().finite().min(0).nullable().optional(),
        excludedProcurementLotIds: z.array(z.string().trim().min(1)).optional(),
        offerDisplay: OfferDisplaySchema.optional(),
        applyReteFuente: z.boolean().optional(),
        reteFuenteRate: z.number().finite().min(0).optional(),
        reteFuenteBase: z.enum(WITHHOLDING_BASES).optional(),
        applyReteIva: z.boolean().optional(),
        reteIvaRate: z.number().finite().min(0).optional(),
        reteIvaBase: z.enum(WITHHOLDING_BASES).optional(),
        applyReteIca: z.boolean().optional(),
        reteIcaRate: z.number().finite().min(0).optional(),
        reteIcaBase: z.enum(WITHHOLDING_BASES).optional(),
        stampTaxRate: z.number().finite().min(0).nullable().optional(),
      })
      .strip()
      .optional(),
    items: z.array(ItemPatchSchema).optional(),
    generalCosts: z.array(GeneralCostPatchSchema).optional(),
  })
  .strip();

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const isDeletionPreflight = new URL(request.url).searchParams.get("deletionPreflight") === "1";
  if (isDeletionPreflight) {
    const authorizationError = deleteAuthorizationError(request);
    if (authorizationError) return authorizationError;
  }

  const state = isDeletionPreflight ? null : await getProjectPriceBaseState(projectId);
  const calculation = isDeletionPreflight ? await getCalculation(projectId) : state?.project;
  if (!calculation) {
    return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  }

  if (isDeletionPreflight) {
    return NextResponse.json({
      calculationId: calculation.id,
      externalId: calculation.externalId ?? null,
      odooProjectId: calculation.odooProjectId ?? null,
      iaRunId: calculation.iaRunId ?? null,
      sourceAnalysisId: calculation.sourceAnalysisId ?? null,
      updatedAt: calculation.updatedAt,
    });
  }
  const versions = state?.versions ?? [];
  const currentDisplayDigest = createHash("sha256").update(JSON.stringify({
    items: capturePriceBase(calculation.items),
    manualReferenceTotal: calculation.settings.manualReferenceTotal,
  })).digest("hex");
  const currentStateDigest = createHash("sha256").update(JSON.stringify({
    items: capturePriceBase(calculation.items),
    manualReferenceTotal: calculation.settings.manualReferenceTotal,
    generalCosts: calculation.generalCosts,
    ...(calculation.settings.budgetLimits?.length ? { budgetLimits: calculation.settings.budgetLimits } : {}),
    usdToCopRate: calculation.settings.usdToCopRate,
    usdImportPct: calculation.settings.usdImportPct,
    analysisReferenceIncluded: calculation.settings.analysisReferenceIncluded ?? true,
  })).digest("hex");
  const activeVersionId = currentCostVersionId(versions, currentStateDigest, currentDisplayDigest);
  const versionSequences = new Map(versions.map((version, index) => [version.id, versions.length - index]));
  return NextResponse.json({
    calculation, project: calculation,
    costVersions: versions.map((version, index) => {
      const impact = priceBaseRestoreImpact(calculation.items, version.snapshot);
      return ({
      id: version.id, sequence: versions.length - index, createdAt: version.createdAt, source: version.source,
      restoredFromVersionId: version.restoredFromVersionId,
      restoredFromSequence: version.restoredFromVersionId ? versionSequences.get(version.restoredFromVersionId) : undefined,
      changedItems: version.changedItemIds.length,
      jobId: version.jobId,
      pricedItems: impact.pricedItems,
      lostPricedItems: impact.lostPricedItemIds.length,
      removedItems: impact.removedItemIds.length,
      itemCount: version.snapshot.length,
      generalCostCount: version.generalCosts?.length ?? 0,
      identityDigest: version.stateDigest ?? version.digest,
      active: version.id === activeVersionId,
    }); }),
  });
}

export async function PATCH(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  try {
    const body = await request.json();
    const { expectedUpdatedAt, expectedItemIds, ...patch } = CalculationPatchSchema.parse(body);
    if (patch.items !== undefined && expectedItemIds === undefined) {
      throw new CalculationConflictError(
        "La lista que intentas guardar no declara su versión. Recarga el cálculo antes de guardar.",
      );
    }
    const before = await getCalculation(projectId);
    if (!before) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    const authorizationWarning = await authorizeLinkedCalculationSave(request, before);
    if (authorizationWarning) return NextResponse.json({ error: authorizationWarning, code: "ODOO_WRITE_REQUIRED" }, { status: 403 });
    const currentById = new Map(before.items.map((item) => [item.id, item]));
    const normalizedPatch: Parameters<typeof saveCalculation>[1] = patch.items === undefined ? { ...patch, items: undefined } : {
      ...patch,
      items: patch.items.map((item) => {
        const current = currentById.get(item.id);
        return {
          ...item,
          ...(current?.sourceOriginal ? { sourceOriginal: current.sourceOriginal } : {}),
          ...(current?.dataOrganization ? { dataOrganization: current.dataOrganization } : {}),
          ...(Object.hasOwn(item, "procurementLot") ? {} : Object.hasOwn(current ?? {}, "procurementLot") ? { procurementLot: current!.procurementLot } : {}),
          deliverableType: item.deliverableType === undefined
            ? current?.deliverableType ?? null
            : item.deliverableType,
          manualCostReviewed: current?.manualCostReviewed === true
            || item.manualUnitCost !== current?.manualUnitCost
            || item.selectedCostMode !== current?.selectedCostMode
            || (item.selectedPriceSourceId ?? null) !== (current?.selectedPriceSourceId ?? null),
          additionalCostsReviewed: current?.additionalCostsReviewed === true
            || JSON.stringify(item.additionalCosts) !== JSON.stringify(current?.additionalCosts ?? []),
        };
      }),
    };
    const calculation = await saveCalculation(projectId, normalizedPatch, expectedUpdatedAt, expectedItemIds);
    if (!calculation) {
      return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    }
    const odooSyncWarning = await syncOdooCalculation(request, calculation);
    const odooCollaborationWarning = await recordManualChange(request, calculation);
    return NextResponse.json({ calculation, project: calculation, odooSyncWarning, odooCollaborationWarning });
  } catch (error) {
    const conflict = error instanceof CalculationConflictError;
    const readonly = error instanceof HistoricalReadonlyError;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo guardar el calculo.",
        code: readonly ? "HISTORICAL_READONLY" : conflict ? "CALCULATION_CONFLICT" : "SAVE_CALCULATION_FAILED",
      },
      { status: conflict || readonly ? 409 : 400 },
    );
  }
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  try {
    const input = ResetCalculationSchema.parse(await request.json());
    const result = await resetCalculation(projectId, input.expectedUpdatedAt);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    }
    if (result.status === "conflict") {
      return NextResponse.json(
        { error: "Este cálculo cambió en otra sesión. Recarga la página antes de reiniciarlo.", code: "RESET_CONFLICT" },
        { status: 409 },
      );
    }
    if (!result.calculation) {
      return NextResponse.json({ error: "No se pudo reconstruir el cálculo." }, { status: 500 });
    }
    const odooSyncWarning = await syncOdooCalculation(request, result.calculation);
    return NextResponse.json({
      calculation: result.calculation,
      project: result.calculation,
      odooSyncWarning,
      assetCleanupWarning: result.assetCleanupWarning,
    });
  } catch (error) {
    const readonly = error instanceof HistoricalReadonlyError;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo reiniciar el cálculo.",
        code: readonly ? "HISTORICAL_READONLY" : "RESET_CALCULATION_FAILED",
      },
      { status: readonly ? 409 : 400 },
    );
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const authorizationError = deleteAuthorizationError(request);
  if (authorizationError) return authorizationError;

  const { projectId } = await props.params;
  try {
    const input = DeleteCalculationSchema.parse(await request.json());
    if (input.calculationId !== projectId) {
      return NextResponse.json(
        { error: "El identificador del cálculo no coincide con la ruta.", code: "DELETE_LINK_MISMATCH" },
        { status: 403 },
      );
    }

    const result = await deleteCalculation(input);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Cálculo no encontrado.", code: "DELETE_NOT_FOUND" }, { status: 404 });
    }
    if (result.status === "link_mismatch") {
      return NextResponse.json(
        { error: "El vínculo Odoo/IA no coincide con el cálculo.", code: "DELETE_LINK_MISMATCH" },
        { status: 403 },
      );
    }
    if (result.status === "conflict" || result.status === "operation_conflict") {
      return NextResponse.json(
        {
          error: result.status === "conflict"
            ? "El cálculo cambió después de la confirmación."
            : "El identificador de operación ya fue usado para otra solicitud.",
          code: result.status === "conflict" ? "DELETE_CONFLICT" : "DELETE_OPERATION_CONFLICT",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, status: result.status, deletionReceipt: result.receipt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo eliminar el cálculo.", code: "DELETE_INVALID_REQUEST" },
      { status: 400 },
    );
  }
}
