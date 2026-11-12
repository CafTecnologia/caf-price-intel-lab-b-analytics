import { NextResponse } from "next/server";
import { z } from "zod";

import { buildAiResultEvidence } from "../../../../../lib/ai-result-evidence";
import { isOdooLoginRedirect, proxyOdooSession, sameAppOrigin, confirmSavedAgentMessage } from "../../../../../lib/odoo-collaboration";
import {
  getCalculation,
  listCalculationOperationReceiptsByJob,
  listPriceBaseVersions,
} from "../../../../../lib/store";

const Query = z.object({ jobId: z.string().uuid() }).strict();

function loginRequired() {
  return NextResponse.json(
    { error: "Inicia sesión en Odoo para consultar la evidencia de este cálculo." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const authorization = await proxyOdooSession(
    request,
    `/caf/finanzas/calculations/${encodeURIComponent(projectId)}/collaboration`,
  );
  if (isOdooLoginRedirect(authorization)) return loginRequired();
  if (!authorization.ok) {
    const body = await authorization.json().catch(() => ({ error: "No tienes acceso al proyecto." }));
    return NextResponse.json(body, {
      status: authorization.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    return NextResponse.json(
      { error: "Debes indicar un jobId válido." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const calculation = await getCalculation(projectId);
  if (!calculation) {
    return NextResponse.json(
      { error: "Cálculo no encontrado." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!calculation.odooProjectId || !calculation.externalId) {
    return NextResponse.json(
      { error: "El cálculo no tiene un vínculo completo con Odoo y la corrida externa." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [receipts, versions] = await Promise.all([
    listCalculationOperationReceiptsByJob(query.data.jobId),
    listPriceBaseVersions(projectId),
  ]);
  const evidence = buildAiResultEvidence({ calculation, jobId: query.data.jobId, receipts, versions });
  return NextResponse.json({ evidence }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  if (!sameAppOrigin(request)) return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  const input = Query.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Debes indicar un jobId válido." }, { status: 400 });
  const { projectId } = await props.params;
  const result = await confirmSavedAgentMessage(request, projectId, input.data.jobId);
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control":"no-store"}});
}
