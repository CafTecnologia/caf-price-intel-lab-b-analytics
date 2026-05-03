import { NextResponse } from "next/server";
import { getRun } from "@/lib/run-history";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Corrida no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ run });
}
