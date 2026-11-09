import { NextResponse } from "next/server";
import { getDefaultUsdToCopRate } from "@/lib/financial-offer-env";
import { stage3ResultToFinancialIngest } from "@/lib/stage3-to-financial-ingest";

export const runtime = "nodejs";

/** Vista previa local del payload de ingesta (misma lógica que /import, sin llamar a Simulador Financiero). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const stage3Result = body.stageResult ?? body.stage2Result ?? body.stage3Result ?? body.stage3Json ?? body.result;

    if (!stage3Result || typeof stage3Result !== "object" || Array.isArray(stage3Result)) {
      return NextResponse.json(
        { error: "Falta stageResult (objeto JSON de una etapa con metadata e items)." },
        { status: 400 }
      );
    }

    const ingest = stage3ResultToFinancialIngest(stage3Result as Record<string, unknown>, {
      analysisId: typeof body.analysisId === "string" ? body.analysisId : null,
      runId: typeof body.runId === "string" ? body.runId : null,
      odooProjectId: typeof body.odooProjectId === "string" ? body.odooProjectId : null,
      sourceSystem: typeof body.sourceSystem === "string" ? body.sourceSystem : undefined,
      usdToCopRate:
        typeof body.usdToCopRate === "number"
          ? body.usdToCopRate
          : typeof body.usd_to_cop_rate === "number"
            ? body.usd_to_cop_rate
            : getDefaultUsdToCopRate(),
    });

    return NextResponse.json({ ingest });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo armar la vista previa." },
      { status: 500 }
    );
  }
}
