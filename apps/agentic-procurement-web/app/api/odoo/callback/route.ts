import { NextResponse } from "next/server";
import { fetchOdoo, normalizeOdooConnection } from "@/lib/odoo-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const connection = normalizeOdooConnection(body);
    const response = await fetchOdoo(
      connection,
      `/caf_external_apps/callback/${encodeURIComponent(connection.token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.payload || {})
      }
    );
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
