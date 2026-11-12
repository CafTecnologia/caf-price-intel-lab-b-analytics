import { NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveProjectScenario, CalculationConflictError,
  getVersionActionReceipt, restoreProjectScenario,
} from "../../../../../../lib/store";

import { scenarioAccessError } from "../auth";

const OperationId = z.string().uuid();
const RestoreScenarioSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  operationId: OperationId.optional(),
}).strict();

export async function GET(request: Request, props: { params: Promise<{ projectId: string; scenarioId: string }> }) {
  const { projectId, scenarioId } = await props.params;
  const parsed = OperationId.safeParse(new URL(request.url).searchParams.get("operationId"));
  if (!parsed.success) return NextResponse.json({ error: "operationId inválido." }, { status: 400 });
  const accessError = await scenarioAccessError(request, projectId);
  if (accessError) return accessError;
  const receipt = await getVersionActionReceipt(parsed.data, projectId, "scenario");
  if (!receipt || receipt.action !== "restore" || receipt.targetId !== scenarioId) {
    return NextResponse.json({ error: "Recibo no encontrado." }, { status: 404 });
  }
  return NextResponse.json({
    receipt,
    operationId: receipt.operationId,
    status: receipt.status,
    scenarioId: receipt.targetId,
    updatedAt: receipt.updatedAt,
  });
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string; scenarioId: string }> }) {
  const { projectId, scenarioId } = await props.params;
  const accessError = await scenarioAccessError(request, projectId);
  if (accessError) return accessError;
  try {
    const raw = await request.text();
    const input = RestoreScenarioSchema.parse(raw ? JSON.parse(raw) : {});
    const project = await restoreProjectScenario(
      projectId, scenarioId, input.expectedUpdatedAt, input.operationId,
    );
    if (!project) return NextResponse.json({ error: "Escenario no encontrado." }, { status: 404 });
    const receipt = input.operationId
      ? await getVersionActionReceipt(input.operationId, projectId, "scenario")
      : null;
    return NextResponse.json({
      project,
      operationId: input.operationId ?? null,
      status: receipt?.status ?? "applied",
      updatedAt: receipt?.updatedAt ?? project.updatedAt,
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
      { error: error instanceof Error ? error.message : "No se pudo abrir el escenario." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ projectId: string; scenarioId: string }> }) {
  const { projectId, scenarioId } = await props.params;
  const accessError = await scenarioAccessError(request, projectId);
  if (accessError) return accessError;
  const archived = await archiveProjectScenario(projectId, scenarioId);
  if (!archived) return NextResponse.json({ error: "Escenario no encontrado." }, { status: 404 });
  return NextResponse.json({ archived: true });
}
