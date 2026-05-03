import { NextResponse } from "next/server";
import { getDefaultUsdToCopRate } from "@/lib/financial-offer-env";
import { proxyToFinancialOfferApi } from "@/lib/financial-offer-proxy";
import { stage3ResultToFinancialIngest } from "@/lib/stage3-to-financial-ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const stage3Result = body.stage3Result ?? body.stage3Json ?? body.result;

    if (!stage3Result || typeof stage3Result !== "object" || Array.isArray(stage3Result)) {
      return NextResponse.json(
        { error: "Falta stage3Result (objeto JSON de Etapa 3 con metadata e items)." },
        { status: 400 }
      );
    }

    const payload = stage3ResultToFinancialIngest(stage3Result as Record<string, unknown>, {
      calculationName: typeof body.calculationName === "string" ? body.calculationName : undefined,
      externalId: body.externalId ?? null,
      sourceSystem: typeof body.sourceSystem === "string" ? body.sourceSystem : undefined,
      usdToCopRate:
        typeof body.usdToCopRate === "number"
          ? body.usdToCopRate
          : typeof body.usd_to_cop_rate === "number"
            ? body.usd_to_cop_rate
            : getDefaultUsdToCopRate(),
      defaultUsdImportPct:
        typeof body.usdImportPct === "number"
          ? body.usdImportPct
          : typeof body.usd_import_pct === "number"
            ? body.usd_import_pct
            : 30
    });

    const upstream = await proxyToFinancialOfferApi("/api/validate", payload);
    const text = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        ingest: payload,
        upstream: json
      },
      { status: upstream.ok ? 200 : 502 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al validar contra la app financiera." },
      { status: 500 }
    );
  }
}
