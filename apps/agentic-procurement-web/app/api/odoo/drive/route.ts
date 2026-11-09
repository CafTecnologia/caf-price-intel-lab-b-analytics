import { NextResponse } from "next/server";
import { fetchOdoo, normalizeOdooConnection } from "@/lib/odoo-proxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fileId = String(url.searchParams.get("fileId") || "").trim();
    if (!/^[a-zA-Z0-9_-]{8,200}$/.test(fileId)) throw new Error("El archivo Drive no es válido.");
    const connection = normalizeOdooConnection({
      baseUrl: url.searchParams.get("baseUrl"),
      db: url.searchParams.get("db"),
      token: url.searchParams.get("token")
    });
    const response = await fetchOdoo(
      connection,
      `/caf_external_apps/launch/${encodeURIComponent(connection.token)}/drive/${encodeURIComponent(fileId)}`
    );
    const body = await response.arrayBuffer();
    const headers = new Headers();
    headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    const disposition = response.headers.get("content-disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    return new NextResponse(body, { status: response.status, headers });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
