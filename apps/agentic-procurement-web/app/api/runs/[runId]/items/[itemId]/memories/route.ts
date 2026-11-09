import { NextResponse } from "next/server";
import { commonCaseMemories, suggestCaseMemories } from "@/lib/case-memory";
import { getRun } from "@/lib/store";
import type { StageId } from "@/lib/types";

const STAGES = new Set<StageId>(["source", "extraction", "technical", "market", "supervision"]);

export async function GET(request: Request, context: { params: Promise<{ runId: string; itemId: string }> }) {
  const { runId, itemId } = await context.params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ ok: false, error: "Proceso no encontrado." }, { status: 404 });
  const item = run.items.find((entry) => entry.id === itemId);
  if (!item) return NextResponse.json({ ok: false, error: "Item no encontrado." }, { status: 404 });
  const requestedStage = new URL(request.url).searchParams.get("stage") as StageId | null;
  const stage = requestedStage && STAGES.has(requestedStage) ? requestedStage : undefined;
  const [suggestions, common] = await Promise.all([
    suggestCaseMemories(item, stage),
    commonCaseMemories()
  ]);
  return NextResponse.json({ ok: true, suggestions, common });
}
