import { NextResponse } from "next/server";
import { z } from "zod";

import { COST_MODES, OFFER_MODES, PRICE_SOURCE_CURRENCIES, VAT_MODES } from "@offer/lib/contract";
import { getCalculation, saveCalculation } from "@offer/lib/store";

const nullableNumber = z.number().finite().nullable();

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

const ItemPatchSchema = z
  .object({
    id: z.string().trim().min(1),
    item: z.string().optional().default(""),
    description: z.string().trim().min(1),
    technicalDescription: z.string().optional().default(""),
    quantity: nullableNumber,
    unit: z.string().optional().default(""),
    referenceUnit: nullableNumber,
    costOptimistic: nullableNumber,
    costModerate: nullableNumber,
    costWeightedUnit: nullableNumber,
    manualUnitCost: nullableNumber,
    selectedCostMode: z.enum(COST_MODES),
    priceSources: z.array(PriceSourcePatchSchema).optional().default([]),
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
    name: z.string().trim().min(1).optional(),
    odooProjectId: z.string().trim().nullable().optional(),
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
      })
      .strip()
      .optional(),
    items: z.array(ItemPatchSchema).optional(),
  })
  .strip();

export async function GET(_request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const calculation = await getCalculation(projectId);
  if (!calculation) {
    return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ calculation, project: calculation });
}

export async function PATCH(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  try {
    const body = await request.json();
    const patch = CalculationPatchSchema.parse(body);
    const calculation = await saveCalculation(projectId, patch);
    if (!calculation) {
      return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    }
    return NextResponse.json({ calculation, project: calculation });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo guardar el calculo.",
        code: "SAVE_CALCULATION_FAILED",
      },
      { status: 400 },
    );
  }
}
