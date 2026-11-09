import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeDocumentSet, type DocumentIntakeFile } from "@/lib/document-intake";
import type { DocumentInputSource, DocumentIntakeProfileId } from "@/lib/document-intake-contract";
import { listRuns, saveRun, saveUpload } from "@/lib/store";
import type { AgentItem, AgentRun, ProviderId, RunOrigin } from "@/lib/types";
import { id, now } from "@/lib/utils";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 40_000_000;
const MAX_TOTAL_BYTES = 200_000_000;

export async function GET() {
  return NextResponse.json({ ok: true, runs: await listRuns() });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let files: DocumentIntakeFile[] = [];
    let name = "Nuevo proceso";
    let providerId: ProviderId = "mock";
    let batchSize = 10;
    let origin: RunOrigin = { kind: "upload" };
    let profileId: DocumentIntakeProfileId = "procurement_items_v1";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const uploads = [...form.getAll("files"), ...form.getAll("file")]
        .filter((entry): entry is File => entry instanceof File && entry.size > 0);
      const uniqueUploads = uploads.filter((file, index) =>
        uploads.findIndex((candidate) => candidate === file) === index
      );
      if (!uniqueUploads.length) {
        return NextResponse.json({ ok: false, error: "Selecciona al menos un archivo." }, { status: 400 });
      }
      files = await Promise.all(uniqueUploads.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        buffer: Buffer.from(await file.arrayBuffer())
      })));
      name = String(form.get("name") || defaultAnalysisName(files));
      providerId = normalizeProvider(form.get("providerId"));
      batchSize = normalizeBatch(form.get("batchSize"));
      origin = normalizeOrigin(form.get("origin"));
      profileId = normalizeProfile(form.get("profileId") || origin.documentProfileId);
    } else {
      const body = await request.json();
      providerId = normalizeProvider(body.providerId);
      batchSize = normalizeBatch(body.batchSize);
      name = String(body.name || "Piloto papeleria");
      const fixture = String(body.fixture || "licitacion-papeleria-12.json").replace(/[^a-zA-Z0-9._-]/g, "");
      files = [{
        name: fixture,
        mimeType: "application/json",
        buffer: await fs.readFile(path.join(process.cwd(), "fixtures", fixture))
      }];
      profileId = normalizeProfile(body.profileId);
    }

    validateUploadSizes(files);
    await Promise.all(files.map((file) => saveUpload(file.name, file.buffer)));

    const intake = await analyzeDocumentSet(files, {
      profileId,
      providerId,
      source: intakeSource(origin)
    });
    const runId = id("run");
    const createdAt = now();
    const usedIds = new Set<string>();
    const items: AgentItem[] = intake.items.map((original, index) => {
      let itemId = String(original.id || index + 1);
      if (usedIds.has(itemId)) itemId = `${itemId}_${index + 1}`;
      usedIds.add(itemId);
      original.id = itemId;
      return { id: itemId, original, status: "imported", reviews: [] };
    });
    const selectedNames = intake.documents.filter((document) => document.selected).map((document) => document.name);
    const fileName = files.length === 1 ? files[0].name : `${name} · ${files.length} documentos`;
    const run: AgentRun = {
      contract: "caf-agent-run/v1",
      id: runId,
      name,
      branch: 1,
      status: items.length ? "draft" : "needs_review",
      providerId,
      model: providerId === "mock" ? "synthetic-v1" : "codex-cli",
      batchSize,
      createdAt,
      updatedAt: createdAt,
      activeStage: "source",
      origin: { ...origin, documentProfileId: intake.profile.id },
      inventory: {
        fileName,
        extension: files.length === 1 ? path.extname(files[0].name).toLowerCase() : ".folder",
        size: files.reduce((sum, file) => sum + file.buffer.length, 0),
        sheets: intake.documents.map((document) => ({
          name: document.name,
          rows: document.candidateItems,
          columns: 0
        })),
        parser: intake.contract,
        detectedRows: items.length,
        warnings: intake.warnings
      },
      documentIntake: intake,
      items,
      steps: [{
        id: id("step_source"),
        stage: "source",
        title: "Inventario y seleccion documental",
        expected: "Encontrar documentos utiles y conservar evidencia por item sin reinterpretar el contenido.",
        observed: `${intake.coverage.documentsProcessed}/${intake.coverage.documentsFound} documento(s) procesados; ${selectedNames.length} seleccionados; ${items.length} items trazables.`,
        status: intake.status === "ready" ? "passed" : intake.status === "failed" ? "failed" : "warning",
        startedAt: createdAt,
        completedAt: createdAt,
        durationMs: 0,
        provider: providerId,
        itemIds: items.map((item) => item.id),
        validationIssues: intake.conflicts.map((conflict) => ({
          stage: "source",
          itemId: conflict.itemId,
          code: conflict.code,
          severity: "warning",
          message: conflict.message
        }))
      }],
      events: [{
        id: id("event"),
        at: createdAt,
        kind: intake.status === "failed" ? "error" : intake.status === "needs_review" ? "warning" : "system",
        stage: "source",
        title: "Fuentes documentales preparadas",
        detail: `${files.length} documento(s): ${items.length} items detectados con evidencia.`
      }],
      metrics: {
        totalItems: items.length,
        normalized: 0,
        interpreted: 0,
        priced: 0,
        accepted: 0,
        pending: items.length,
        warnings: intake.warnings.length + intake.conflicts.length,
        durationMs: 0,
        providerCalls: intake.selection.method === "agent" ? 1 : 0
      }
    };
    await saveRun(run);
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 400 });
  }
}

function normalizeProvider(value: unknown): ProviderId {
  return ["mock", "codex_pc", "codex_vps"].includes(String(value)) ? String(value) as ProviderId : "mock";
}

function normalizeBatch(value: unknown) {
  const number = Number(value || 10);
  return Math.max(1, Math.min(30, Number.isFinite(number) ? number : 10));
}

function normalizeProfile(value: unknown): DocumentIntakeProfileId {
  const text = safeText(value);
  return text || "procurement_items_v1";
}

function normalizeOrigin(value: FormDataEntryValue | null): RunOrigin {
  if (typeof value !== "string" || !value.trim()) return { kind: "upload" };
  try {
    const parsed = JSON.parse(value) as Partial<RunOrigin>;
    if (!["odoo_project_drive", "odoo_project_folder"].includes(String(parsed.kind))) return { kind: "upload" };
    return {
      kind: parsed.kind as RunOrigin["kind"],
      odooProjectId: safeText(parsed.odooProjectId),
      odooProjectName: safeText(parsed.odooProjectName),
      odooAnalysisRecordId: safeText(parsed.odooAnalysisRecordId),
      odooReturnUrl: safeHttpUrl(parsed.odooReturnUrl),
      driveFileId: safeText(parsed.driveFileId),
      driveFileName: safeText(parsed.driveFileName),
      driveFileUrl: safeHttpUrl(parsed.driveFileUrl),
      driveFolderUrl: safeHttpUrl(parsed.driveFolderUrl),
      driveFileIds: safeTextArray(parsed.driveFileIds),
      driveFileNames: safeTextArray(parsed.driveFileNames),
      documentProfileId: safeText(parsed.documentProfileId)
    };
  } catch {
    return { kind: "upload" };
  }
}

function intakeSource(origin: RunOrigin): DocumentInputSource {
  return {
    kind: origin.kind === "odoo_project_folder"
      ? "odoo_drive_folder"
      : origin.kind === "odoo_project_drive"
        ? "odoo_drive_file"
        : "upload",
    projectId: origin.odooProjectId,
    projectName: origin.odooProjectName,
    folderUrl: origin.driveFolderUrl
  };
}

function defaultAnalysisName(files: DocumentIntakeFile[]) {
  if (files.length === 1) return files[0].name.replace(/\.[^.]+$/, "");
  return `Analisis documental · ${files.length} archivos`;
}

function validateUploadSizes(files: DocumentIntakeFile[]) {
  const oversized = files.find((file) => file.buffer.length > MAX_FILE_BYTES);
  if (oversized) throw new Error(`${oversized.name} supera el limite de 40 MB por archivo.`);
  const total = files.reduce((sum, file) => sum + file.buffer.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error("La seleccion supera 200 MB. Divide la carpeta en dos analisis.");
}

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) || undefined : undefined;
}

function safeTextArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map(safeText).filter((entry): entry is string => Boolean(entry)).slice(0, 500);
}

function safeHttpUrl(value: unknown) {
  const text = safeText(value);
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
