import { NextResponse } from "next/server";
import { prepareWorkProfileDocuments, type WorkProfileInputFile } from "@/lib/work-profile-documents";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 40_000_000;
const MAX_FILES = 120;

/**
 * Cataloga los archivos que el catalogo todavia no conoce.
 *
 * Es idempotente por sha256: subir dos veces el mismo archivo no cataloga dos
 * veces, porque prepareWorkProfileDocuments reutiliza el indice existente.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (!files.length) throw new Error("No se recibio ningun documento para catalogar.");
    if (files.length > MAX_FILES) throw new Error(`El catalogo admite hasta ${MAX_FILES} documentos por lote.`);
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) throw new Error(`${oversized.name} supera el limite de 40 MB.`);

    // Cada archivo puede venir acompanado de su md5 de Drive para dejar
    // registrada la identidad y no tener que descargarlo la proxima vez.
    let md5ByName: Record<string, string> = {};
    const rawMd5 = form.get("md5ByName");
    if (typeof rawMd5 === "string" && rawMd5.trim()) {
      try {
        const parsed = JSON.parse(rawMd5);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("formato");
        md5ByName = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([name, md5]) => [name, String(md5 ?? "")])
        );
      } catch {
        throw new Error("md5ByName no es un JSON valido con nombre de archivo -> md5.");
      }
    }

    const inputs: WorkProfileInputFile[] = await Promise.all(files.map(async (file) => ({
      name: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      md5: md5ByName[file.name]
    })));

    const documents = await prepareWorkProfileDocuments(inputs);
    return NextResponse.json({
      ok: true,
      documents: documents.map((document) => ({
        sourceHash: document.sourceHash,
        name: document.name,
        parser: document.parser,
        pageCount: document.pageCount,
        contentState: document.contentState,
        catalogStatus: document.catalogStatus,
        warnings: document.warnings
      }))
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
