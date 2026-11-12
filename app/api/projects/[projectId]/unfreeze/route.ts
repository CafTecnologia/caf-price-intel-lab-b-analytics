import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { unfreezeCalculation } from "@offer/lib/store";

const UnfreezeSchema = z.object({
  externalId: z.string().nullable().optional(),
  odooProjectId: z.string().nullable().optional(),
  iaRunId: z.string().nullable().optional(),
  sourceAnalysisId: z.string().nullable().optional(),
}).strict();

function authorized(request: Request): boolean {
  const expected = process.env.FINANCIAL_PRICE_BASE_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Credencial de servicio inválida." }, { status: 401 });
  }
  try {
    const { projectId } = await props.params;
    const calculation = await unfreezeCalculation(
      projectId,
      UnfreezeSchema.parse(await request.json()),
    );
    if (!calculation) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true, calculation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo reactivar el cálculo." },
      { status: 409 },
    );
  }
}
