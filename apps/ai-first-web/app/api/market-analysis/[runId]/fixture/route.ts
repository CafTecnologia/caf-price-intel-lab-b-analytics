import { NextResponse } from "next/server";

import { getMarketAnalysisService } from "@web/lib/market-analysis-service";

export async function POST(_request: Request, props: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await props.params;
    const fixturePath = getMarketAnalysisService().registerFixture(runId);

    return NextResponse.json({ fixturePath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado registrando fixture." },
      { status: 500 },
    );
  }
}
