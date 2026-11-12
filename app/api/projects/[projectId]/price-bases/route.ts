import { currentCostVersionId } from "@offer/lib/cost-version-selection";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { appPath } from "../../../../../lib/base-path";
import { normalizeImportPayload, toCalculation } from "../../../../../lib/contract";
import { capturePriceBase, PriceBaseConflictError, type PriceBasePatch } from "../../../../../lib/price-base";
import { CalculationConflictError, applyPriceBaseRevision, getProject, getProjectPriceBaseState } from "../../../../../lib/store";

export const runtime = "nodejs";

const RequestBody = z.object({
  odooProjectId: z.string().trim().min(1),
  jobId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  artifact: z.unknown(),
  originalArtifact: z.unknown().optional(),
}).strict();

const PublicArtifact = z.object({
  version: z.union([z.literal(2), z.literal("2")]),
  items: z.array(z.unknown()).min(1),
}).passthrough();

function parsePublicArtifact(value: unknown) {
  const artifact = PublicArtifact.parse(value);
  if ("calculation" in artifact || "project" in artifact) {
    throw new Error("La revisión debe usar el JSON público v2.");
  }
  return artifact;
}

function authorized(request: Request): "yes" | "unavailable" | "no" {
  const token = process.env.FINANCIAL_PRICE_BASE_TOKEN?.trim() ?? "";
  if (token.length < 32) return "unavailable";
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return "no";
  return timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(match[1]).digest(),
  ) ? "yes" : "no";
}

function authError(request: Request): NextResponse | null {
  const auth = authorized(request);
  if (auth === "yes") return null;
  return NextResponse.json(
    { error: auth === "unavailable" ? "Servicio de versiones sin configurar." : "Credencial de servicio inválida." },
    { status: auth === "unavailable" ? 503 : 401 },
  );
}

export async function GET(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const error = authError(request);
  if (error) return error;
  const { projectId } = await props.params;
  const state = await getProjectPriceBaseState(projectId);
  if (!state) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  const { project, versions } = state;
  const currentDisplayDigest = createHash("sha256").update(JSON.stringify({
    items: capturePriceBase(project.items),
    manualReferenceTotal: project.settings.manualReferenceTotal,
  })).digest("hex");
  const currentStateDigest = createHash("sha256").update(JSON.stringify({
    items: capturePriceBase(project.items),
    manualReferenceTotal: project.settings.manualReferenceTotal,
    generalCosts: project.generalCosts,
    ...(project.settings.budgetLimits?.length ? { budgetLimits: project.settings.budgetLimits } : {}),
    usdToCopRate: project.settings.usdToCopRate,
    usdImportPct: project.settings.usdImportPct,
    analysisReferenceIncluded: project.settings.analysisReferenceIncluded ?? true,
  })).digest("hex");
  const activeVersionId = currentCostVersionId(versions, currentStateDigest, currentDisplayDigest);
  const versionSequences = new Map(versions.map((version, index) => [version.id, versions.length - index]));
  return NextResponse.json({
    calculationId: projectId,
    updatedAt: project.updatedAt,
    versions: versions.map(({ id, parentId, createdAt, source, jobId, changedItemIds,
      snapshot, generalCosts, digest, stateDigest, restoredFromVersionId }, index) => ({
      id, sequence: versions.length - index, parentId, createdAt, source, jobId, changedItemIds, restoredFromVersionId,
      restoredFromSequence: restoredFromVersionId ? versionSequences.get(restoredFromVersionId) : undefined,
      itemCount: snapshot.length,
      generalCostCount: generalCosts?.length ?? 0,
      active: id === activeVersionId,
    })),
  });
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const error = authError(request);
  if (error) return error;
  const { projectId } = await props.params;
  try {
    const input = RequestBody.parse(await request.json());
    const current = await getProject(projectId);
    if (!current) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    const artifact = parsePublicArtifact(input.artifact);
    const parsed = normalizeImportPayload(artifact);
    const incoming = toCalculation(parsed, "preview", new Date().toISOString()).items;
    const original = input.originalArtifact === undefined ? null :
      toCalculation(normalizeImportPayload(parsePublicArtifact(input.originalArtifact)), "original", new Date().toISOString()).items;
    if (original && (original.length !== incoming.length ||
      original.some((item, index) => item.item !== incoming[index]?.item))) {
      throw new Error("La revisión y el estudio original no tienen la misma lista de ítems.");
    }
    const byLabel = new Map(current.items.map((item) => [item.item, item]));
    const uniqueLabels = byLabel.size === current.items.length &&
      new Set(incoming.map((item) => item.item)).size === incoming.length;
    const sameOrder = incoming.length === current.items.length && incoming.every(
      (item, index) => item.item === current.items[index]?.item,
    );
    if (!uniqueLabels && !sameOrder) {
      throw new Error("La revisión no permite identificar con seguridad todos los ítems.");
    }
    const items: PriceBasePatch[] = incoming.flatMap((item, index) => {
      const bound = uniqueLabels ? byLabel.get(item.item) : current.items[index];
      if (!bound) throw new Error(`El ítem ${item.item} no pertenece a este cálculo.`);
      const baseline = original?.[index];
      const changedReference = !baseline || baseline.referenceUnit !== item.referenceUnit;
      const changedSources = !baseline ||
        JSON.stringify(baseline.priceSources) !== JSON.stringify(item.priceSources);
      const changedNotes = Boolean(baseline && baseline.notes !== item.notes);
      if (!changedReference && !changedSources && !changedNotes) return [];
      return [{
        id: bound.id, item: bound.item,
        ...(changedReference ? {
          referenceUnit: item.referenceUnit,
          ...(baseline ? { expectedReferenceUnit: baseline.referenceUnit } : {}),
        } : {}),
        ...(changedSources ? {
          priceSources: item.priceSources,
          ...(baseline ? { expectedPriceSources: baseline.priceSources } : {}),
        } : {}),
        ...(changedNotes ? {
          expectedNotes: baseline!.notes, notes: item.notes,
        } : {}),
      }];
    });
    const result = await applyPriceBaseRevision({
      projectId, odooProjectId: input.odooProjectId, jobId: input.jobId,
      expectedUpdatedAt: input.expectedUpdatedAt, items,
    });
    if (!result) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
    return NextResponse.json({
      status: result.status,
      calculationId: projectId,
      calculationUrl: new URL(appPath(`/calculations/${projectId}`), request.url).toString(),
      baseVersionId: result.version.id,
      changedItemIds: result.version.changedItemIds,
      appliedJobId: input.jobId,
      updatedAt: result.project.updatedAt,
    });
  } catch (error) {
    if (error instanceof CalculationConflictError || error instanceof PriceBaseConflictError) {
      return NextResponse.json({ error: error.message, code: "STALE_CALCULATION" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "No se pudo aplicar la versión de precios.";
    return NextResponse.json({ error: message, code: "INVALID_PRICE_BASE" }, { status: 400 });
  }
}
