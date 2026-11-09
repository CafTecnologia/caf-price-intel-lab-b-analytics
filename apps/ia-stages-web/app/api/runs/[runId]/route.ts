import { NextResponse } from "next/server";
import { getRun } from "@/lib/run-history";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Corrida no encontrada." }, { status: 404 });
  }

  const url = new URL(request.url);
  const includeTechnical = url.searchParams.get("technical") === "1";
  const responseRun = includeTechnical
    ? run
    : {
        ...run,
        stages: Array.isArray(run.stages)
          ? run.stages.map((stage) => ({
              ...stage,
              raw: undefined,
              cleaned: undefined,
              groundingMetadata: undefined,
              callTrace: undefined
            }))
          : []
      };

  return NextResponse.json({ run: responseRun });
}
