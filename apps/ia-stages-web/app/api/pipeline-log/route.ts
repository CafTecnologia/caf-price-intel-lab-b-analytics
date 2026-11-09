import { NextResponse } from "next/server";
import { readPipelineLogRows } from "@/lib/pipeline-log-reader";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId")?.trim() ?? "";
  const stage = searchParams.get("stage")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? 200);

  if (!runId) {
    return NextResponse.json({ error: "Falta runId." }, { status: 400 });
  }

  const rows = await readPipelineLogRows({
    runId,
    stage: stage && stage !== "all" ? stage : undefined,
    limit
  });

  return NextResponse.json({ rows });
}

