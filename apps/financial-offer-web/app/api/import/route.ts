import { NextResponse } from "next/server";

import { importCalculation } from "@offer/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const calculation = await importCalculation(body);
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
      { error: error instanceof Error ? error.message : "No se pudo importar el JSON financiero.", code: "INVALID_IMPORT_PAYLOAD" },
      { status: 400 },
    );
  }
}
