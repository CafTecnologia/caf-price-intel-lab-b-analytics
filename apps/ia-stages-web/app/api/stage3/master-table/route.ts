import { NextResponse } from "next/server";
import { buildStage3MasterTable, saveStage3MasterTable, type Stage3MasterAttempt } from "@/lib/stage3-master-table";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { stage2Json?: unknown; attempts?: Stage3MasterAttempt[]; runId?: string; save?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (!body.stage2Json) {
    return NextResponse.json({ error: "Falta stage2Json para construir tabla maestra." }, { status: 400 });
  }

  const table = buildStage3MasterTable({
    stage2Json: body.stage2Json,
    attempts: Array.isArray(body.attempts) ? body.attempts : [],
    runId: typeof body.runId === "string" ? body.runId : undefined
  });
  const savedPath = body.save && body.runId ? await saveStage3MasterTable(table, body.runId) : null;
  return NextResponse.json({ ok: true, table, savedPath });
}
