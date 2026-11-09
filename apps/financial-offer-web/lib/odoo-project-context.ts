import { isOdooLoginRedirect, proxyOdooSession } from "./odoo-collaboration";

const FIELDS = ["id", "name", "numero_proceso_licitatorio", "lic_numero_proceso", "entidad_licitante", "lic_entidad", "lic_cuantia", "lic_modalidad", "lic_ubicacion", "lic_objeto", "fecha_cierre", "lic_enlace", "enlace_externo", "stage_id", "user_id", "lic_currency_id"];
export const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export class ContextError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function rpc(request: Request, path: string, params: object): Promise<any> {
  const response = await proxyOdooSession(request, path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params }), signal: AbortSignal.timeout(10000),
  });
  if (isOdooLoginRedirect(response) || response.status === 401) throw new ContextError(401, "Inicia sesión en Odoo para consultar el proyecto.");
  if (response.status === 403 || response.status === 404) throw new ContextError(404, "Proyecto no disponible para tu usuario en Odoo.");
  if (!response.ok) throw new Error("upstream");
  const body = await response.json();
  if (body.error) {
    const name = body.error.data?.name;
    if (name === "odoo.http.SessionExpiredException") throw new ContextError(401, "Inicia sesión en Odoo para consultar el proyecto.");
    if (["odoo.exceptions.AccessError", "odoo.exceptions.MissingError"].includes(name)) throw new ContextError(404, "Proyecto no disponible para tu usuario en Odoo.");
    throw new Error("rpc");
  }
  return body.result;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function relation(value: unknown): string | null { return Array.isArray(value) ? text(value[1]) : null; }
function safeLink(value: unknown): string | null {
  try { const url = new URL(String(value)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export type OdooProjectContextData = {
  id: number; name: string | null; process: string | null; entity: string | null;
  budget: number | null; currency: string | null; deadline: string | null;
  modality: string | null; location: string | null; objective: string | null;
  stage: string | null; manager: string | null; sourceUrl: string | null;
};
/** Reads the stored link with the caller's Odoo session. No service token, sudo, write or client-supplied project ID. */
export async function readOdooProjectContext(request: Request, link: { odooProjectId?: string | null; odooDb?: string | null }): Promise<Response> {
  if (!link.odooProjectId || !/^[1-9]\d*$/.test(link.odooProjectId) || !Number.isSafeInteger(Number(link.odooProjectId))) return Response.json({ error: "Este cálculo no tiene un proyecto Odoo asociado." }, { status: 404, headers: PRIVATE });
  try {
    const call = (method: string, args: unknown[], kwargs: object) => rpc(request, `/web/dataset/call_kw/project.project/${method}`, { model: "project.project", method, args, kwargs });
    // #97: session and schema in parallel (one Odoo round trip less); session errors still win, as before.
    const [sessionResult, schemaResult] = await Promise.allSettled([rpc(request, "/web/session/get_session_info", {}), call("fields_get", [FIELDS], { attributes: ["type"] })]);
    if (sessionResult.status === "rejected") throw sessionResult.reason;
    const session = sessionResult.value;
    if (!session?.uid) throw new ContextError(401, "Inicia sesión en Odoo para consultar el proyecto.");
    if (link.odooDb && session.db !== link.odooDb) throw new ContextError(409, "El cálculo pertenece a otra base de Odoo. Abre su proyecto de origen para consultarlo.");
    if (schemaResult.status === "rejected") throw schemaResult.reason;
    const schema = schemaResult.value;
    const fields = FIELDS.filter((name) => Object.hasOwn(schema, name));
    const id = Number(link.odooProjectId);
    const rows = await call("search_read", [[["id", "=", id]]], { fields, limit: 1 });
    const p = rows?.[0];
    if (!p || p.id !== id) throw new ContextError(404, "Proyecto no disponible para tu usuario en Odoo.");
    const project: OdooProjectContextData = {
      id, name: text(p.name), process: text(p.numero_proceso_licitatorio) || text(p.lic_numero_proceso),
      entity: text(p.entidad_licitante) || text(p.lic_entidad),
      // Odoo's empty monetary field serializes as zero. It is not an approved zero budget.
      budget: typeof p.lic_cuantia === "number" && Number.isFinite(p.lic_cuantia) && p.lic_cuantia > 0 ? p.lic_cuantia : null,
      currency: relation(p.lic_currency_id), deadline: text(p.fecha_cierre), modality: text(p.lic_modalidad),
      location: text(p.lic_ubicacion), objective: text(p.lic_objeto), stage: relation(p.stage_id), manager: relation(p.user_id),
      sourceUrl: safeLink(p.lic_enlace) || safeLink(p.enlace_externo),
    };
    return Response.json({ project }, { headers: PRIVATE });
  } catch (error) {
    return Response.json({ error: error instanceof ContextError ? error.message : "No se pudieron consultar los datos de Odoo. Puedes reintentar." }, { status: error instanceof ContextError ? error.status : 503, headers: PRIVATE });
  }
}
