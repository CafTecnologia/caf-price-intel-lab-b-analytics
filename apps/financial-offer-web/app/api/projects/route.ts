import { NextResponse } from "next/server";

import { createEmptyCalculation, listCalculations } from "@offer/lib/store";

export async function GET() {
  const calculations = await listCalculations();
  return NextResponse.json({ calculations, projects: calculations });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      externalId?: string | null;
      entity?: string | null;
      odooProjectId?: string | null;
      iaRunId?: string | null;
      sourceAnalysisId?: string | null;
      odooCallbackUrl?: string | null;
      odooReturnUrl?: string | null;
      odooDb?: string | null;
      nameSuffix?: string | null;
      odooProjectName?: string | null;
      odooProcessNumber?: string | null;
      odooEntityName?: string | null;
      odooUserId?: string | null;
      odooUserName?: string | null;
    };
    const calculation = await createEmptyCalculation({
      name: body.name?.trim() || "Cálculo sin nombre",
      externalId: body.externalId ?? null,
      entity: body.entity ?? null,
      odooProjectId: body.odooProjectId,
      iaRunId: body.iaRunId,
      sourceAnalysisId: body.sourceAnalysisId,
      odooCallbackUrl: body.odooCallbackUrl,
      odooReturnUrl: body.odooReturnUrl,
      odooDb: body.odooDb,
      nameSuffix: body.nameSuffix,
      odooProjectName: body.odooProjectName,
      odooProcessNumber: body.odooProcessNumber,
      odooEntityName: body.odooEntityName,
      odooUserId: body.odooUserId,
      odooUserName: body.odooUserName,
    });
    return NextResponse.json(
      {
        calculation,
        calculationId: calculation.id,
        url: `/calculations/${calculation.id}`,
        project: calculation,
        projectId: calculation.id,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear el calculo financiero.", code: "CREATE_CALCULATION_FAILED" },
      { status: 400 },
    );
  }
}
