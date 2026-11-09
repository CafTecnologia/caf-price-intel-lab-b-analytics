import { NextResponse } from "next/server";
import { appendUserFeedback } from "@/lib/feedback-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      runId?: string | null;
      stage?: string | null;
      analysisId?: string | null;
      analysisCode?: string | null;
      odooProjectId?: string | null;
      url?: string | null;
      userText?: string | null;
      meta?: Record<string, unknown>;
    };

    const userText = typeof body.userText === "string" ? body.userText.trim() : "";
    if (userText.length < 8) {
      return NextResponse.json({ error: "Describe el problema con un poco más de detalle (mín. 8 caracteres)." }, { status: 400 });
    }

    const saved = await appendUserFeedback({
      runId: typeof body.runId === "string" ? body.runId : null,
      stage: typeof body.stage === "string" ? body.stage : null,
      analysisId: typeof body.analysisId === "string" ? body.analysisId : null,
      analysisCode: typeof body.analysisCode === "string" ? body.analysisCode : null,
      odooProjectId: typeof body.odooProjectId === "string" ? body.odooProjectId : null,
      url: typeof body.url === "string" ? body.url : null,
      userText,
      meta: body.meta && typeof body.meta === "object" ? body.meta : undefined
    });

    return NextResponse.json({ ok: true, id: saved.id, ts: saved.ts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el comentario." },
      { status: 500 }
    );
  }
}

