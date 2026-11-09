import { NextResponse } from "next/server";
import { resolveCatalogByMd5 } from "@/lib/work-profile-documents";

export const runtime = "nodejs";

/**
 * Primera pregunta de cualquier trabajo IA: de estos archivos, cuales ya
 * conoces. No mueve bytes; solo compara identidades de Drive.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const files = Array.isArray(body?.files) ? body.files : [];
    if (!files.length) {
      return NextResponse.json({
        ok: true,
        known: [],
        missing: [],
        message: "No se recibio ningun archivo para revisar."
      });
    }
    const { known, missing } = await resolveCatalogByMd5(
      files.map((file: { id?: string; driveId?: string; md5Checksum?: string; md5?: string }) => ({
        driveId: file.driveId || file.id,
        md5: file.md5 || file.md5Checksum
      }))
    );
    return NextResponse.json({
      ok: true,
      known,
      missing: missing.map((entry) => entry.driveId).filter(Boolean),
      // Un archivo sin md5 (por ejemplo un Google Doc nativo) no puede
      // resolverse por identidad y siempre se trata como faltante.
      withoutIdentity: files
        .filter((file: { md5Checksum?: string; md5?: string }) => !(file.md5 || file.md5Checksum))
        .map((file: { id?: string; driveId?: string }) => file.driveId || file.id)
        .filter(Boolean)
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
