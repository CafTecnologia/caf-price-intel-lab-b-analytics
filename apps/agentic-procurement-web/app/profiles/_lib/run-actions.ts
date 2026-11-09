"use client";

import {
  appPath,
  type DriveFile,
  type ExecutionPhase,
  type Launch,
  type OdooConnection,
  type ProviderId,
  type WorkProfile,
  type WorkProfileRun
} from "./shared";

type Ctx = {
  connection: OdooConnection | null;
  launch: Launch | null;
  setPhase: (phase: ExecutionPhase) => void;
  setNotice: (message: string) => void;
  refresh: () => Promise<void>;
};

export async function syncOdoo(ctx: Ctx, run: WorkProfileRun, status: WorkProfileRun["status"]) {
  if (!ctx.connection) return;
  try {
    const response = await fetch(appPath("/api/odoo/callback"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ctx.connection,
        payload: {
          runId: run.id,
          analysisId: run.id,
          sourceTitle: run.name,
          status,
          odooProjectId: ctx.launch?.project?.id
        }
      })
    });
    if (!response.ok) throw new Error("Odoo no confirmo el estado.");
  } catch {
    ctx.setNotice("El analisis se conservo, pero Odoo no confirmo la ultima actualizacion. Puedes volver al proyecto y abrirlo de nuevo para reintentar el vinculo.");
  }
}

export type ExecuteInput = {
  profile: WorkProfile;
  providerId: ProviderId;
  uploads: File[];
  driveFileIds: string[];
  testCaseId?: string;
};

/** Cataloga un lote y devuelve los sha256 resultantes. */
async function ingest(files: File[], md5ByName: Record<string, string>) {
  if (!files.length) return [] as string[];
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  if (Object.keys(md5ByName).length) form.set("md5ByName", JSON.stringify(md5ByName));
  const response = await fetch(appPath("/api/catalog/ingest"), { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudieron catalogar los documentos.");
  return (data.documents || []).map((document: { sourceHash: string }) => document.sourceHash) as string[];
}

/**
 * Etapa de catalogo antes de cualquier trabajo IA.
 *
 * Primero se pregunta al catalogo cuales de los archivos ya se conocen, usando
 * el md5 que Drive entrega en el listado. Solo se descargan y catalogan los
 * que faltan. La segunda vez que alguien pide apoyo IA sobre el mismo proceso,
 * no viaja un solo byte.
 */
async function catalogStage(ctx: Ctx, driveFileIds: string[], uploads: File[]) {
  const hashes: string[] = [];
  const drive = ctx.launch?.drive?.files || [];
  const selected = drive.filter((file: DriveFile) => driveFileIds.includes(file.id));

  if (ctx.connection && selected.length) {
    ctx.setPhase("resolving");
    const response = await fetch(appPath("/api/catalog/resolve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: selected.map((file) => ({ id: file.id, md5Checksum: file.md5Checksum })) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo consultar el catalogo.");

    for (const entry of data.known || []) hashes.push(entry.sourceHash);

    const missingIds: string[] = data.missing || [];
    const pending = selected.filter((file) => missingIds.includes(file.id));
    // La carpeta del proyecto cambia con el tiempo. Se dice que se encontro de
    // nuevo para que el usuario entienda por que esta vez tarda mas.
    const conocidos = selected.length - pending.length;
    if (pending.length && conocidos) {
      ctx.setNotice(
        `${pending.length} documento(s) nuevo(s) en la carpeta. Los otros ${conocidos} ya estaban preparados y no se vuelven a leer.`
      );
    }
    if (pending.length) {
      ctx.setPhase("downloading");
      const files: File[] = [];
      const md5ByName: Record<string, string> = {};
      for (const file of pending) {
        const query = new URLSearchParams({ ...ctx.connection, fileId: file.id });
        const download = await fetch(appPath(`/api/odoo/drive?${query}`));
        if (!download.ok) throw new Error(`No se pudo descargar ${file.name}.`);
        files.push(new File([await download.blob()], file.name, {
          type: file.mimeType || download.headers.get("content-type") || "application/octet-stream"
        }));
        if (file.md5Checksum) md5ByName[file.name] = file.md5Checksum;
      }
      ctx.setPhase("cataloging");
      hashes.push(...await ingest(files, md5ByName));
    }
  }

  if (uploads.length) {
    ctx.setPhase("cataloging");
    hashes.push(...await ingest(uploads, {}));
  }

  return [...new Set(hashes)];
}

export async function createAndExecute(ctx: Ctx, input: ExecuteInput): Promise<string> {
  const { profile, providerId, uploads, driveFileIds, testCaseId } = input;

  const sourceHashes = await catalogStage(ctx, driveFileIds, uploads);
  if (!sourceHashes.length && !testCaseId) {
    throw new Error("No hay documentos para analizar. Guarda los archivos del proceso en la carpeta del proyecto y vuelve a pedir apoyo IA.");
  }

  ctx.setPhase("preparing");
  const form = new FormData();
  form.set("profileId", profile.id);
  form.set("providerId", providerId);
  if (testCaseId) form.set("testCaseId", testCaseId);
  if (sourceHashes.length) form.set("sourceHashes", JSON.stringify(sourceHashes));
  form.set("name", ctx.launch?.project?.name || `Piloto - ${profile.label}`);
  form.set("project", JSON.stringify({
    projectId: ctx.launch?.project?.id,
    projectName: ctx.launch?.project?.name,
    processNumber: ctx.launch?.project?.processNumber,
    entity: ctx.launch?.project?.entity,
    object: ctx.launch?.project?.object,
    modality: ctx.launch?.project?.modality,
    amount: ctx.launch?.project?.amount,
    closingDate: ctx.launch?.project?.closingDate,
    stage: ctx.launch?.project?.stage,
    protocol: ctx.launch?.project?.protocol,
    notes: ctx.launch?.project?.notes,
    companyKnowledge: ctx.launch?.project?.companyKnowledge
  }));

  const createResponse = await fetch(appPath("/api/work-runs"), { method: "POST", body: form });
  const created = await createResponse.json();
  if (!createResponse.ok) throw new Error(created.error || "No se pudo crear la ejecucion.");

  await ctx.refresh();
  await syncOdoo(ctx, created.run, "running");

  ctx.setPhase("executing");
  let timer: number | undefined;
  try {
    const executePromise = fetch(appPath(`/api/work-runs/${created.run.id}/execute`), { method: "POST" });
    timer = window.setInterval(() => void ctx.refresh(), 1500);
    const executeResponse = await executePromise;
    window.clearInterval(timer); timer = undefined;
    const executed = await executeResponse.json();
    if (!executeResponse.ok) throw new Error(executed.error || "La ejecucion se interrumpio.");
    await ctx.refresh();
    ctx.setPhase("syncing");
    await syncOdoo(ctx, executed.run, executed.run.status);
  } finally {
    if (timer) window.clearInterval(timer);
  }
  return created.run.id as string;
}

export async function resumeRun(ctx: Ctx, runId: string) {
  ctx.setPhase("executing");
  let timer: number | undefined;
  try {
    timer = window.setInterval(() => void ctx.refresh(), 1500);
    const response = await fetch(appPath(`/api/work-runs/${runId}/execute`), { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo reanudar la ejecucion.");
    window.clearInterval(timer); timer = undefined;
    await ctx.refresh();
    ctx.setPhase("syncing");
    await syncOdoo(ctx, data.run, data.run.status);
  } finally {
    if (timer) window.clearInterval(timer);
  }
}

export async function saveRunReview(ctx: Ctx, runId: string, note: string, resolved: boolean) {
  const response = await fetch(appPath(`/api/work-runs/${runId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, resolved })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo guardar la revision.");
  await ctx.refresh();
  ctx.setNotice(resolved
    ? "Revision humana registrada como resuelta; el resultado de la IA se conserva sin alteraciones."
    : "Observacion humana guardada en la traza de esta ejecucion.");
}
