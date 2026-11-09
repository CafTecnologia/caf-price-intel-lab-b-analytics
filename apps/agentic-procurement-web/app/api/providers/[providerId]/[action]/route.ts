import { NextResponse } from "next/server";
import { providerHealth, recoverProvider, runProviderTask } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

const IDS = new Set(["mock", "codex_pc", "codex_vps"]);

export async function GET(_: Request, context: { params: Promise<{ providerId: string; action: string }> }) {
  const { providerId, action } = await context.params;
  if (!IDS.has(providerId) || action !== "health") return NextResponse.json({ ok: false, error: "Ruta no soportada." }, { status: 404 });
  return NextResponse.json(await providerHealth(providerId as ProviderId));
}

export async function POST(request: Request, context: { params: Promise<{ providerId: string; action: string }> }) {
  try {
    const { providerId, action } = await context.params;
    if (!IDS.has(providerId)) return NextResponse.json({ ok: false, error: "Proveedor no soportado." }, { status: 404 });
    if (action === "recover") {
      const result = await recoverProvider(providerId as ProviderId);
      return NextResponse.json(result, { status: result.ok ? 200 : 503 });
    }
    if (action !== "task") return NextResponse.json({ ok: false, error: "Ruta no soportada." }, { status: 404 });
    return NextResponse.json(await runProviderTask(providerId as ProviderId, await request.json()));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
