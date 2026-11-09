import { NextResponse } from "next/server";
import { recordHumanReview, type HumanReviewInput } from "@/lib/human-loop";
import { executeItemCorrection } from "@/lib/orchestrator";
import { providerHealth, runProviderTask } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 3600;

const PROVIDERS = new Set<ProviderId>(["mock", "codex_pc", "codex_vps"]);

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const body = await request.json() as HumanReviewInput;
    const result = await recordHumanReview(runId, body);
    if (result.review.action !== "rerun") {
      return NextResponse.json({ ok: true, ...result });
    }

    const providerId = body.providerId && PROVIDERS.has(body.providerId) ? body.providerId : result.run.providerId;
    const health = await providerHealth(providerId);
    if (!health.ok) {
      return NextResponse.json({
        ok: false,
        error: `${health.provider.label} no está disponible. La evaluación quedó guardada y puedes reintentar la corrección cuando vuelva la conexión.`,
        run: result.run,
        review: result.review,
        memory: result.memory
      }, { status: 503 });
    }
    const run = await executeItemCorrection(runId, result.item.id, result.review.id, runProviderTask, providerId);
    const updatedReview = run.items
      .find((item) => item.id === result.item.id)
      ?.reviews.find((review) => review.id === result.review.id);
    if (!updatedReview?.resolvedAt) {
      return NextResponse.json({
        ok: false,
        error: "El agente terminó sus intentos, pero no logró aplicar una corrección válida. Tu nota quedó guardada y puedes reintentar este ítem.",
        run,
        review: updatedReview || result.review,
        memory: result.memory
      }, { status: 422 });
    }
    return NextResponse.json({ ok: true, run, review: updatedReview, memory: result.memory });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
