import { getCalculation } from "./store";
import { readOdooProjectContext, rpc } from "./odoo-project-context";
import { proxyOdooSession, isOdooLoginRedirect } from "./odoo-collaboration";

const CALC = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const FILE = /^[A-Za-z0-9_-]{10,200}$/;
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: PRIVATE }); }

export async function proxyStudyDocuments(request: Request, calculationId: string, fileId?: string): Promise<Response> {
  if (!CALC.test(calculationId) || (fileId !== undefined && !FILE.test(fileId))) return error("Archivo o cálculo no encontrado.", 404);
  const query = new URLSearchParams();
  const search = new URL(request.url).searchParams;
  for (const name of fileId ? [] : ["folder", "page"]) {
    const value = search.get(name);
    if (value) query.set(name, value);
  }
  const path = `/caf/finanzas/calculations/${calculationId}/documents${fileId ? `/${fileId}` : `?${query}`}`;
  try {
    let upstream = await proxyOdooSession(request, path, { signal: AbortSignal.timeout(90000) });
    // Older revisions can outlive their offer binding. Resolve only the saved
    // project's unique financial task, then reuse Odoo's existing folder/file ACL.
    if (upstream.status === 404) {
      const calculation = await getCalculation(calculationId);
      if (calculation?.odooProjectId) {
        const guard = await readOdooProjectContext(request, calculation);
        if (!guard.ok) return guard;
        const { project } = await guard.json();
        const tasks = await rpc(request, "/web/dataset/call_kw/project.task/search_read", {
          model: "project.task", method: "search_read",
          args: [[["project_id", "=", project.id], ["caf_financial_calc_id", "!=", false], ["caf_dossier_folder_id", "!=", false]]],
          kwargs: { fields: ["id", "project_id", "caf_financial_calc_id", "caf_dossier_folder_id"], limit: 2, context: { active_test: false, prefetch_fields: false } },
        });
        const task = Array.isArray(tasks) && tasks.length === 1 ? tasks[0] : null;
        const boundId = task?.caf_financial_calc_id;
        if (task?.project_id?.[0] === project.id && typeof boundId === "string" && CALC.test(boundId) && boundId !== calculationId && FILE.test(task.caf_dossier_folder_id || "")) {
          upstream = await proxyOdooSession(request, path.replace(`/calculations/${calculationId}/`, `/calculations/${boundId}/`), { signal: AbortSignal.timeout(90000) });
        }
      }
    }
    if (isOdooLoginRedirect(upstream)) return error("Inicia sesión en Odoo para consultar los archivos del estudio.", 401);
    const headers = new Headers(PRIVATE);
    for (const name of ["Content-Type", "Content-Disposition", "Content-Security-Policy"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return error("No se pudo consultar Drive. Intenta nuevamente.", 503); }
}
