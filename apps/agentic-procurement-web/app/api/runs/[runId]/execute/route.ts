import { NextResponse } from "next/server";
import { executeRun } from "@/lib/orchestrator";
import { providerHealth, runProviderTask } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 3600;

const PROVIDER_IDS = new Set<ProviderId>(["mock", "codex_pc", "codex_vps"]);

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const body = await request.json().catch(() => ({})) as { providerId?: string };
    const providerId = body.providerId && PROVIDER_IDS.has(body.providerId as ProviderId)
      ? body.providerId as ProviderId
      : undefined;
    if (body.providerId && !providerId) {
      return NextResponse.json({ ok: false, error: "Proveedor no soportado." }, { status: 400 });
    }
    if (providerId) {
      const health = await providerHealth(providerId);
      if (!health.ok) {
        return NextResponse.json({
          ok: false,
          error: `${health.provider.label} no tiene conexión. El archivo y el checkpoint permanecen intactos; selecciona otro proveedor para reanudar.`
        }, { status: 503 });
      }
    }
    const run = await executeRun(runId, runProviderTask, providerId);
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
