import { NextResponse } from "next/server";
import { fetchOdoo, normalizeOdooConnection } from "@/lib/odoo-proxy";
import { saveOdooAiConfig } from "@/lib/odoo-ai-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const connection = normalizeOdooConnection({
      baseUrl: url.searchParams.get("baseUrl"),
      db: url.searchParams.get("db"),
      token: url.searchParams.get("token")
    });
    const response = await fetchOdoo(
      connection,
      `/caf_external_apps/launch/${encodeURIComponent(connection.token)}`
    );
    const payload = await response.json().catch(() => ({}));

    // La configuracion del proveedor se guarda del lado del servidor y no se
    // agrega a la respuesta: la clave no debe llegar al navegador.
    try {
      const configResponse = await fetchOdoo(
        connection,
        `/caf_external_apps/ai-config/${encodeURIComponent(connection.token)}?service=agentic-procurement-web`
      );
      const configPayload = await configResponse.json().catch(() => ({}));
      if (configPayload?.ok && configPayload.config) saveOdooAiConfig(configPayload.config);
    } catch {
      // Si Odoo no responde la configuracion, se sigue con la ultima conocida.
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
