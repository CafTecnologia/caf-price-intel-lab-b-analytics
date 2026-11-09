import { NextResponse } from "next/server";
import { getWorkProfileRun, saveWorkProfileRun } from "@/lib/work-profile-store";
import { publicRun } from "@/lib/work-profile-serialize";

export async function GET(_: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getWorkProfileRun(runId);
  return run ? NextResponse.json({ ok: true, run: publicRun(run) }) : NextResponse.json({ ok: false, error: "Ejecucion no encontrada." }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const run = await getWorkProfileRun(runId);
    if (!run) return NextResponse.json({ ok: false, error: "Ejecucion no encontrada." }, { status: 404 });
    const body = await request.json() as { note?: unknown; resolved?: unknown };
    const note = String(body.note || "").trim();
    if (!note) return NextResponse.json({ ok: false, error: "Escribe una observacion antes de guardarla." }, { status: 400 });
    const now = new Date().toISOString();
    run.review = {
      status: body.resolved === true ? "resolved" : "open",
      note,
      updatedAt: now,
      resolvedAt: body.resolved === true ? now : undefined
    };
    await saveWorkProfileRun(run);
    return NextResponse.json({ ok: true, run: publicRun(run) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
