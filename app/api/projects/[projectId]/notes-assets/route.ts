import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

import { appPath } from "@offer/lib/base-path";
import { assertCalculationMutable, HistoricalReadonlyError } from "@offer/lib/store";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function assetDirectory(projectId: string): string | null {
  if (!/^[a-zA-Z0-9-]+$/.test(projectId)) return null;
  return resolve(process.cwd(), "..", "..", "data", "financial-offer", "note-assets", projectId);
}

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;
  let calculation;
  try { calculation = await assertCalculationMutable(projectId); }
  catch (error) {
    if (error instanceof HistoricalReadonlyError) return NextResponse.json({ error: error.message, code: "HISTORICAL_READONLY" }, { status: 409 });
    throw error;
  }
  const targetDirectory = assetDirectory(projectId);
  if (!calculation || !targetDirectory) return NextResponse.json({ error: "Calculo no encontrado." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Envia la imagen como formulario multipart." }, { status: 400 });
  }

  const file = formData.get("file");
  const extension = file instanceof File ? IMAGE_EXTENSIONS[file.type] : undefined;
  if (!(file instanceof File) || !extension) {
    return NextResponse.json({ error: "Solo se aceptan imagenes JPG, PNG o WEBP." }, { status: 400 });
  }
  if (!file.size || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "La imagen debe pesar maximo 3 MB despues de comprimir." }, { status: 400 });
  }

  const assetId = randomUUID() + "." + extension;
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(resolve(targetDirectory, assetId), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url: appPath("/api/projects/" + projectId + "/notes-assets/" + assetId) }, { status: 201 });
}
