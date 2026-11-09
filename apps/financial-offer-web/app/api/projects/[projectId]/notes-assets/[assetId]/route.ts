import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

import { getCalculation } from "@offer/lib/store";

export const runtime = "nodejs";

const MIME_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

function assetPath(projectId: string, assetId: string): { path: string; type: string } | null {
  if (!/^[a-zA-Z0-9-]+$/.test(projectId)) return null;
  const match = assetId.match(/^([a-f0-9-]{36})\.(jpg|png|webp)$/i);
  if (!match) return null;
  return {
    path: resolve(process.cwd(), "..", "..", "data", "financial-offer", "note-assets", projectId, assetId),
    type: MIME_TYPES[match[2].toLowerCase()] || "application/octet-stream",
  };
}

export async function GET(_request: Request, props: { params: Promise<{ projectId: string; assetId: string }> }) {
  const { projectId, assetId } = await props.params;
  const calculation = await getCalculation(projectId);
  const asset = assetPath(projectId, assetId);
  if (!calculation || !asset) return NextResponse.json({ error: "Imagen no encontrada." }, { status: 404 });
  try {
    return new Response(await readFile(asset.path), {
      headers: { "Content-Type": asset.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Imagen no encontrada." }, { status: 404 });
  }
}
