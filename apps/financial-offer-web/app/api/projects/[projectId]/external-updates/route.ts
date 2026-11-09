import { NextResponse } from "next/server";

import { applyExternalProjectUpdate } from "@offer/lib/external-updates";
import { getCalculation, saveCalculation } from "@offer/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const current = await getCalculation(projectId);
  if (!current) {
    return NextResponse.json({ error: "C?lculo no encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const result = applyExternalProjectUpdate(current, body);
    const calculation = result.changed ? await saveCalculation(projectId, { items: result.project.items }) : current;
    if (!calculation) {
      return NextResponse.json({ error: "C?lculo no encontrado." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      calculation,
      project: calculation,
      applied: result.applied,
      conflicts: result.conflicts,
      changed: result.changed,
      idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudieron aplicar actualizaciones externas.",
        code: "EXTERNAL_UPDATE_FAILED",
      },
      { status: 400 },
    );
  }
}
