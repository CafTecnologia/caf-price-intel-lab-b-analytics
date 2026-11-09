import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CalculationConflictError, getProject, getVersionActionReceipt,
  restorePriceBaseVersion, saveManualPriceBaseVersion,
} from "../../../../../../lib/store";

export const runtime = "nodejs";

const OperationId = z.string().uuid();
const Input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    expectedUpdatedAt: z.string().datetime(),
    operationId: OperationId.optional(),
  }).strict(),
  z.object({
    action: z.literal("restore"),
    expectedUpdatedAt: z.string().datetime(),
    operationId: OperationId.optional(),
    versionId: z.string().uuid(),
    allowCostLoss: z.boolean().optional().default(false),
  }).strict(),
]);
const Query = z.object({ operationId: OperationId }).strict();

async function authorizedOdooUser(request: Request, projectId: string): Promise<"ok" | "login" | "forbidden" | "missing" | "unavailable"> {
  const base = process.env.ODOO_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  const cookie = request.headers.get("cookie");
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const allowed = [new URL(request.url).origin];
  if (forwardedHost && forwardedProto && /^[a-z0-9.:-]+$/i.test(forwardedHost) &&
      (forwardedProto === "http" || forwardedProto === "https")) {
    allowed.push(`${forwardedProto}://${forwardedHost}`);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  const safeRead = request.method === "GET" && (!fetchSite || fetchSite === "same-origin" || fetchSite === "same-site");
  if (!safeRead && (!origin || !allowed.includes(origin))) return "forbidden";
  if (!base) return "unavailable";
  if (!cookie) return "login";
  try {
    const response = await fetch(
      `${base}/caf/finanzas/calculations/${projectId}/cost-version-auth`,
      { headers: { Cookie: cookie }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000) },
    );
    if (response.status === 204) return "ok";
    if (response.status === 401 || (response.status >= 300 && response.status < 400)) return "login";
    if (response.status === 404) return "missing";
    if (response.status >= 500) return "unavailable";
  } catch {
    return "unavailable";
  }
  return "forbidden";
}

async function editableProject(request: Request, projectId: string): Promise<NextResponse | null> {
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  }
  const project = await getProject(projectId);
  if (!project || !project.odooProjectId) {
    return NextResponse.json({ error: "Cálculo de Odoo no encontrado." }, { status: 404 });
  }
  const access = await authorizedOdooUser(request, projectId);
  if (access === "login") {
    return NextResponse.json({ error: "Inicia sesión en Odoo para guardar versiones; después vuelve a este cálculo y reintenta.", code: "ODOO_LOGIN_REQUIRED" }, { status: 401 });
  }
  if (access === "missing") {
    return NextResponse.json({ error: "Odoo no encontró el vínculo de este cálculo con el proyecto.", code: "ODOO_LINK_MISSING" }, { status: 404 });
  }
  if (access === "unavailable") {
    return NextResponse.json({ error: "No se pudo verificar la sesión de Odoo. Vuelve a intentarlo.", code: "ODOO_AUTH_UNAVAILABLE" }, { status: 503 });
  }
  if (access !== "ok") {
    return NextResponse.json({ error: "Tu sesión no tiene permiso de edición sobre este proyecto en Odoo.", code: "ODOO_EDIT_DENIED" }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const accessError = await editableProject(request, projectId);
  if (accessError) return accessError;
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "operationId inválido." }, { status: 400 });
  const receipt = await getVersionActionReceipt(parsed.data.operationId, projectId, "price_base");
  if (!receipt) return NextResponse.json({ error: "Recibo no encontrado." }, { status: 404 });
  return NextResponse.json({
    receipt,
    operationId: receipt.operationId,
    status: receipt.status,
    baseVersionId: receipt.targetId,
    updatedAt: receipt.updatedAt,
  });
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const accessError = await editableProject(request, projectId);
  if (accessError) return accessError;
  try {
    const body = Input.parse(await request.json());
    const result = body.action === "save"
      ? await saveManualPriceBaseVersion(projectId, body.expectedUpdatedAt, body.operationId)
      : await restorePriceBaseVersion(projectId, body.versionId, body.expectedUpdatedAt, body.operationId, body.allowCostLoss);
    if (!result) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    const receipt = body.operationId
      ? await getVersionActionReceipt(body.operationId, projectId, "price_base")
      : null;
    return NextResponse.json({
      status: receipt?.status ?? result.status,
      operationId: body.operationId ?? null,
      baseVersionId: receipt?.targetId ?? result.version.id,
      changedItems: result.version.changedItemIds.length,
      updatedAt: receipt?.updatedAt ?? result.project.updatedAt,
    });
  } catch (error) {
    if (error instanceof CalculationConflictError) {
      const operationConflict = error.message.includes("operationId");
      return NextResponse.json({
        error: error.message,
        code: operationConflict ? "OPERATION_ID_CONFLICT" : "STALE_CALCULATION",
      }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la versión de costos." },
      { status: 400 },
    );
  }
}
