import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CalculationOperationsSchema, CalculationOperationConflictError, calculationOperationItemValues } from "../../../../../lib/calculation-operations";
import { applyCalculationOperations, getCalculationReceipt, getCalculationItemDocumentKeys, getProject, listCalculationOperationReceiptsByJob } from "../../../../../lib/store";
import { appPath } from "../../../../../lib/base-path";

function authorized(request: Request) {
  const token = process.env.FINANCIAL_PRICE_BASE_TOKEN?.trim() ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  return token.length >= 32 && !!match && timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(match[1]).digest());
}
function denied() { return NextResponse.json({ error: "Credencial de servicio inválida." }, { status: 401 }); }
const Query = z.object({ operationId: z.string().min(1).optional(), receiptId: z.string().min(1).optional(), jobId: z.string().min(1).optional() }).strict();
export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  if (!authorized(request)) return denied();
  const { projectId } = await props.params;
  const query = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  const receiptId = query.data.operationId ?? query.data.receiptId;
  if (receiptId) {
    const receipt = await getCalculationReceipt(receiptId);
    if (!receipt || (("calculationId" in receipt ? receipt.calculationId : receipt.projectId) !== projectId)) return NextResponse.json({ error: "Recibo no encontrado." }, { status: 404 });
    return NextResponse.json({ receipt });
  }
  if (query.data.jobId) return NextResponse.json({ receipts: (await listCalculationOperationReceiptsByJob(query.data.jobId)).filter((receipt) => receipt.calculationId === projectId) });
  const calculation = await getProject(projectId);
  if (!calculation) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  const documentKeys = await getCalculationItemDocumentKeys(projectId);
  return NextResponse.json({ calculation: { id: calculation.id, externalId: calculation.externalId, odooProjectId: calculation.odooProjectId, updatedAt: calculation.updatedAt, settings: { budgetLimits: calculation.settings.budgetLimits ?? [], manualReferenceTotal: calculation.settings.manualReferenceTotal, usdToCopRate: calculation.settings.usdToCopRate, usdImportPct: calculation.settings.usdImportPct }, items: calculation.items.map((item) => ({ ...item, documentKey: documentKeys[item.id], editableFields: calculationOperationItemValues(item) })), generalCosts: calculation.generalCosts }, calculationUrl: appPath(`/calculations/${projectId}`) });
}
export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  if (!authorized(request)) return denied();
  const { projectId } = await props.params;
  try {
    const input = CalculationOperationsSchema.parse({ ...(await request.json()), projectId });
    const receipt = await applyCalculationOperations(input);
    if (!receipt) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    return NextResponse.json({ receipt, calculationUrl: appPath(`/calculations/${projectId}`) });
  } catch (error) {
    const conflict = error instanceof CalculationOperationConflictError;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo aplicar la operación.", code: conflict ? error.code : "INVALID_OPERATION" }, { status: conflict ? 409 : 400 });
  }
}
