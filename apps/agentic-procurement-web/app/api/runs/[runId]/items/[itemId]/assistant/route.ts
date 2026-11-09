import { NextResponse } from "next/server";
import { consultItemAssistant } from "@/lib/item-assistant";
import { providerHealth, runProviderTask } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 3600;

const PROVIDERS = new Set<ProviderId>(["mock", "codex_pc", "codex_vps"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; itemId: string }> }
) {
  try {
    const { runId, itemId } = await context.params;
    const body = await request.json() as { question?: string; providerId?: ProviderId };
    const providerId = body.providerId && PROVIDERS.has(body.providerId) ? body.providerId : "mock";
    const health = await providerHealth(providerId);
    if (!health.ok) {
      return NextResponse.json({
        ok: false,
        error: `${health.provider.label} no está disponible. ${health.diagnostic?.userAction || ""}`.trim()
      }, { status: 503 });
    }
    const result = await consultItemAssistant(
      runId,
      itemId,
      String(body.question || ""),
      providerId,
      runProviderTask
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 400 });
  }
}
