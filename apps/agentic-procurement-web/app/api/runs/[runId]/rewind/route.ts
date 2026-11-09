import { NextResponse } from "next/server";
import { getRun, saveRun } from "@/lib/store";
import type { StageId } from "@/lib/types";
import { id, now } from "@/lib/utils";

const ORDER: StageId[] = ["source", "extraction", "technical", "market", "supervision"];

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ ok: false, error: "Proceso no encontrado." }, { status: 404 });
  const body = await request.json();
  const stage = ORDER.includes(body.stage) ? body.stage as StageId : "technical";
  const fromIndex = ORDER.indexOf(stage);
  run.branch += 1;
  run.status = "draft";
  run.activeStage = stage;
  run.completedAt = undefined;
  for (const item of run.items) {
    if (fromIndex <= ORDER.indexOf("extraction")) item.normalized = undefined;
    if (fromIndex <= ORDER.indexOf("technical")) item.technical = undefined;
    if (fromIndex <= ORDER.indexOf("market")) item.market = undefined;
    if (fromIndex <= ORDER.indexOf("supervision")) {
      item.supervision = undefined;
      item.supervisedAt = undefined;
    }
    item.status = item.market ? "priced" : item.technical ? "interpreted" : item.normalized ? "normalized" : "imported";
  }
  run.events.push({ id: id("event"), at: now(), kind: "human", stage, title: `Nueva rama desde ${stage}`, detail: String(body.comment || "El humano solicito repetir desde este checkpoint.") });
  await saveRun(run);
  return NextResponse.json({ ok: true, run });
}
