import { NextResponse } from "next/server";

import { AUTO_CALCULATION_NAME, SAMPLE_PUBLIC_IMPORT_PAYLOAD, normalizeImportPayload } from "@offer/lib/contract";

export async function GET() {
  return NextResponse.json({
    method: "POST",
    description: "Comprueba estructura y campos para importar el JSON sin guardarlo; la auditoria del estudio corresponde al servicio de IA.",
    body: SAMPLE_PUBLIC_IMPORT_PAYLOAD,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = normalizeImportPayload(body);
    return NextResponse.json({
      ok: true,
      calculation: {
        ...parsed.calculation,
        name: parsed.calculation.name === AUTO_CALCULATION_NAME ? "Generado automáticamente por la app" : parsed.calculation.name,
      },
      itemCount: parsed.items.length,
      settings: parsed.settings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "JSON invalido.",
        code: "INVALID_IMPORT_PAYLOAD",
      },
      { status: 400 },
    );
  }
}
