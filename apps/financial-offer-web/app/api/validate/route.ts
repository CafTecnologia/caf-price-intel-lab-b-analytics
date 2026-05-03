import { NextResponse } from "next/server";

import { normalizeImportPayload } from "@offer/lib/contract";

export async function GET() {
  return NextResponse.json({
    method: "POST",
    description: "Envia un JSON de calculo para validarlo sin guardarlo.",
    body: {
      version: 1,
      calculation: { name: "Cálculo ejemplo", currency: "COP" },
      items: [{ description: "Item ejemplo", quantity: 1, reference_unit: 100000, cost_weighted_unit: 70000 }],
      settings: { vat_rate: 19 },
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = normalizeImportPayload(body);
    return NextResponse.json({
      ok: true,
      calculation: parsed.calculation,
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
