import { NextResponse } from "next/server";
import { getCachedDocumentCatalog } from "@/lib/work-profile-store";

export const runtime = "nodejs";

/** Indice de un documento ya catalogado. No devuelve el original. */
export async function GET(_request: Request, context: { params: Promise<{ sourceHash: string }> }) {
  const { sourceHash } = await context.params;
  const document = await getCachedDocumentCatalog(sourceHash);
  if (!document) {
    return NextResponse.json({ ok: false, error: "Documento no catalogado." }, { status: 404 });
  }
  const index = { ...document } as Record<string, unknown>;
  delete index.text;
  delete index.sourceRef;
  if (Array.isArray(document.chunks)) {
    index.chunks = document.chunks.map((chunk) => ({
      location: chunk.location,
      method: chunk.method,
      hints: chunk.hints
    }));
  }
  // Los titulos de seccion son lineas literales del documento.
  if (Array.isArray(document.sections)) {
    index.sections = document.sections.map((section) => ({
      location: section.location,
      hints: section.hints
    }));
  }
  return NextResponse.json({
    ok: true,
    document: index,
    textLength: (document.text || "").length
  });
}
