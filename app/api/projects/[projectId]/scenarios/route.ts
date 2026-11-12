import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CalculationConflictError, createProjectScenario,
  getVersionActionReceipt, listProjectScenarios,
} from "../../../../../lib/store";

import { scenarioAccessError } from "./auth";

const OperationId = z.string().uuid();
const CreateScenarioSchema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(500).optional().default(""),
  expectedUpdatedAt: z.string().datetime().optional(),
  operationId: OperationId.optional(),
  createdBy: z
    .object({
      id: z.string().trim().nullable().optional(),
      name: z.string().trim().min(1).max(160),
    })
    .nullable()
    .optional()
    .default(null),
}).strict();

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const operationId = new URL(request.url).searchParams.get("operationId");
  if (!operationId) return NextResponse.json({ scenarios: await listProjectScenarios(projectId) });
  const parsed = OperationId.safeParse(operationId);
  if (!parsed.success) return NextResponse.json({ error: "operationId inválido." }, { status: 400 });
  const accessError = await scenarioAccessError(request, projectId);
  if (accessError) return accessError;
  const receipt = await getVersionActionReceipt(parsed.data, projectId, "scenario");
  if (!receipt) return NextResponse.json({ error: "Recibo no encontrado." }, { status: 404 });
  return NextResponse.json({
    receipt,
    operationId: receipt.operationId,
    status: receipt.status,
    scenarioId: receipt.targetId,
    updatedAt: receipt.updatedAt,
  });
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  const accessError = await scenarioAccessError(request, projectId);
  if (accessError) return accessError;
  try {
    const input = CreateScenarioSchema.parse(await request.json());
    const scenario = await createProjectScenario(
      projectId, input.name, input.note, input.createdBy,
      input.expectedUpdatedAt, input.operationId,
    );
    if (!scenario) return NextResponse.json({ error: "Calculo no encontrado." }, { status: 404 });
    const receipt = input.operationId
      ? await getVersionActionReceipt(input.operationId, projectId, "scenario")
      : null;
    return NextResponse.json({
      scenario,
      operationId: input.operationId ?? null,
      status: receipt?.status ?? "saved",
      updatedAt: receipt?.updatedAt ?? input.expectedUpdatedAt ?? null,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof CalculationConflictError) {
      const operationConflict = error.message.includes("operationId");
      return NextResponse.json({
        error: error.message,
        code: operationConflict ? "OPERATION_ID_CONFLICT" : "STALE_CALCULATION",
      }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el escenario." },
      { status: 400 },
    );
  }
}
