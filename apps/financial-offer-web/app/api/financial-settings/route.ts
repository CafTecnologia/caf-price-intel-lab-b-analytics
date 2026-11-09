import { NextResponse } from "next/server";
import { z } from "zod";

import { WITHHOLDING_BASES } from "@offer/lib/contract";
import { getFinancialDefaults, saveFinancialDefaults } from "@offer/lib/store";

const Schema = z.object({
  applyReteFuente: z.boolean(), reteFuenteRate: z.number().min(0), reteFuenteBase: z.enum(WITHHOLDING_BASES),
  applyReteIva: z.boolean(), reteIvaRate: z.number().min(0), reteIvaBase: z.enum(WITHHOLDING_BASES),
  applyReteIca: z.boolean(), reteIcaRate: z.number().min(0), reteIcaBase: z.enum(WITHHOLDING_BASES),
});

export async function GET() {
  return NextResponse.json({ settings: await getFinancialDefaults() });
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json({ settings: await saveFinancialDefaults(Schema.parse(await request.json())) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuracion invalida." }, { status: 400 });
  }
}
