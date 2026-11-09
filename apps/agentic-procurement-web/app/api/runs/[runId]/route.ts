import { NextResponse } from "next/server";
import { getRun } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getRun(runId);
  return run ? NextResponse.json({ ok: true, run }) : NextResponse.json({ ok: false, error: "Proceso no encontrado." }, { status: 404 });
}
