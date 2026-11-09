import { NextResponse } from "next/server";
import { documentsFromHashes, prepareWorkProfileDocuments, type WorkProfileInputFile } from "@/lib/work-profile-documents";
import { getWorkProfile, listWorkProfileRuns, saveWorkProfileRun } from "@/lib/work-profile-store";
import type { WorkProfileProjectContext, WorkProfileRun } from "@/lib/work-profile-contract";
import { id } from "@/lib/utils";
import { loadWorkProfileTestCase } from "@/lib/work-profile-test-cases";
import { publicRun, publicRuns } from "@/lib/work-profile-serialize";

export const runtime = "nodejs";
const MAX_FILE_BYTES = 40_000_000;
const MAX_FILES = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json({
    ok: true,
    runs: publicRuns(await listWorkProfileRuns({
      projectId: url.searchParams.get("projectId") || undefined,
      processNumber: url.searchParams.get("processNumber") || undefined
    }))
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const testCaseId = String(form.get("testCaseId") || "").trim();
    // Documentos que ya paso la etapa de catalogo y no hace falta volver a subir.
    let sourceHashes: string[] = [];
    const rawHashes = form.get("sourceHashes");
    if (typeof rawHashes === "string" && rawHashes.trim()) {
      try {
        const parsed = JSON.parse(rawHashes);
        if (Array.isArray(parsed)) sourceHashes = parsed.filter((entry): entry is string => typeof entry === "string" && !!entry);
      } catch {
        throw new Error("La lista de documentos catalogados no es valida.");
      }
    }
    if (!files.length && !testCaseId && !sourceHashes.length) {
      throw new Error("Selecciona al menos un documento o un caso real de prueba.");
    }
    if (files.length > MAX_FILES) throw new Error(`El piloto admite hasta ${MAX_FILES} documentos por ejecucion.`);
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) throw new Error(`${oversized.name} supera el limite de 40 MB.`);
    const profileId = String(form.get("profileId") || "minimum_value_initial_assessment_v1");
    const profile = await getWorkProfile(profileId);
    if (!profile) throw new Error("Perfil no encontrado.");
    const rawProviderId = String(form.get("providerId") || "").trim();
    let providerId: WorkProfileRun["providerId"];
    if (!rawProviderId) {
      providerId = "codex_vps";
    } else if (["mock", "codex_pc", "codex_vps"].includes(rawProviderId)) {
      providerId = rawProviderId as WorkProfileRun["providerId"];
    } else {
      throw new Error(`Proveedor no reconocido: ${rawProviderId}.`);
    }
    const testCase = testCaseId ? await loadWorkProfileTestCase(testCaseId) : null;
    const project = testCase?.project || parseProject(form.get("project"));
    const uploadedInputs: WorkProfileInputFile[] = await Promise.all(files.map(async (file) => ({
      name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer())
    })));
    const inputs = testCase ? [...testCase.files, ...uploadedInputs] : uploadedInputs;
    const prepared = inputs.length ? await prepareWorkProfileDocuments(inputs) : [];
    const fromCatalog = sourceHashes.length ? await documentsFromHashes(sourceHashes) : { documents: [], missing: [] };
    if (fromCatalog.missing.length) {
      throw new Error(`${fromCatalog.missing.length} documento(s) ya no estan en el catalogo. Vuelve a pedir apoyo IA para catalogarlos.`);
    }
    // Un mismo documento puede llegar por catalogo y por carga manual.
    const documents = [...fromCatalog.documents, ...prepared].filter(
      (document, index, all) => all.findIndex((other) => other.sourceHash === document.sourceHash) === index
    );
    if (!documents.length) throw new Error("No hay documentos disponibles para analizar.");
    const now = new Date().toISOString();
    const run: WorkProfileRun = {
      contract: "caf-work-profile-run/v1",
      id: id("profile_run"),
      name: String(form.get("name") || testCase?.definition.label || project.projectName || profile.label),
      profileId: profile.id,
      profileVersion: profile.version,
      providerId,
      status: "draft",
      project,
      documents,
      skills: [],
      createdAt: now,
      updatedAt: now
    };
    await saveWorkProfileRun(run);
    return NextResponse.json({ ok: true, run: publicRun(run) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

function parseProject(value: FormDataEntryValue | null): WorkProfileProjectContext {
  if (typeof value !== "string" || !value.trim()) return {};
  try { return JSON.parse(value) as WorkProfileProjectContext; } catch { return {}; }
}
