import { NextResponse } from "next/server";
import { getProject } from "../../../../../lib/store";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const allowed = [new URL(request.url).origin];
  if (forwardedHost && forwardedProto && /^[a-z0-9.:-]+$/i.test(forwardedHost)
      && (forwardedProto === "http" || forwardedProto === "https")) {
    allowed.push(`${forwardedProto}://${forwardedHost}`);
  }
  return !!origin && allowed.includes(origin);
}

export async function scenarioAccessError(request: Request, projectId: string): Promise<NextResponse | null> {
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Cálculo no encontrado." }, { status: 404 });
  const fetchSite = request.headers.get("sec-fetch-site");
  const safeRead = request.method === "GET" && (!fetchSite || fetchSite === "same-origin" || fetchSite === "same-site");
  if (!safeRead && !sameOrigin(request)) {
    return NextResponse.json({ error: "La acción debe iniciarse desde este cálculo." }, { status: 403 });
  }
  if (!project.odooProjectId) return null;
  const base = process.env.ODOO_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return NextResponse.json({ error: "Inicia sesión en Odoo para guardar versiones; después vuelve a este cálculo y reintenta.", code: "ODOO_LOGIN_REQUIRED" }, { status: 401 });
  }
  if (!base) {
    return NextResponse.json({ error: "No se pudo verificar la sesión de Odoo.", code: "ODOO_AUTH_UNAVAILABLE" }, { status: 503 });
  }
  try {
    const response = await fetch(`${base}/caf/finanzas/calculations/${projectId}/cost-version-auth`, {
      headers: { Cookie: cookie }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (response.status === 204) return null;
    if (response.status === 401 || (response.status >= 300 && response.status < 400)) {
      return NextResponse.json({ error: "Inicia sesión en Odoo para guardar versiones; después vuelve a este cálculo y reintenta.", code: "ODOO_LOGIN_REQUIRED" }, { status: 401 });
    }
    if (response.status === 404) {
      return NextResponse.json({ error: "Odoo no encontró el vínculo de este cálculo con el proyecto.", code: "ODOO_LINK_MISSING" }, { status: 404 });
    }
    if (response.status >= 500) {
      return NextResponse.json({ error: "No se pudo verificar la sesión de Odoo. Vuelve a intentarlo.", code: "ODOO_AUTH_UNAVAILABLE" }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ error: "No se pudo verificar la sesión de Odoo.", code: "ODOO_AUTH_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ error: "Tu sesión no tiene permiso de edición sobre este proyecto en Odoo.", code: "ODOO_EDIT_DENIED" }, { status: 403 });
}
