import { ContextError, PRIVATE, readOdooProjectContext, rpc } from "./odoo-project-context";
import { proxyOdooSession, isOdooLoginRedirect } from "./odoo-collaboration";

type Link = { odooProjectId?: string | null; odooDb?: string | null };
type Row = Record<string, any>;
export type SourceNote = { id: string; group: string; source: string; stage: string | null; title: string; text: string; author: string | null; date: string | null; edited: boolean };
const taskFields = ["id", "name", "description", "caf_work_area", "caf_work_block", "caf_conclusion", "caf_conditions", "caf_decision_note", "caf_protocol_stage_id", "caf_protocol_substage_id", "write_uid", "write_date", "parent_id", "depend_on_ids", "caf_protocol_native_template_task_id"];
const label = (v: any): string | null => Array.isArray(v) ? String(v[1] || "") || null : null;
const call = (r: Request, model: string, method: string, args: unknown[], kwargs: object) => rpc(r, `/web/dataset/call_kw/${model}/${method}`, { model, method, args, kwargs });

// Rendered as React text only. Preserve paragraphs, lists and safe link destinations;
// never render chatter HTML, remote images, scripts or inline styles in Finance.
export function noteText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n").replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (entity[0] !== "#") return known[entity.toLowerCase()] || "";
      const n = parseInt(entity.slice(entity[1].toLowerCase() === "x" ? 2 : 1), entity[1].toLowerCase() === "x" ? 16 : 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function sources(request: Request, link: Link) {
  const guard = await readOdooProjectContext(request, link);
  if (!guard.ok) return { error: guard };
  const { project } = await guard.json();
  const schema = await call(request, "project.task", "fields_get", [taskFields], { attributes: ["type"] });
  const fields = taskFields.filter((f) => Object.hasOwn(schema, f));
  const scope: unknown[] = [["name", "ilike", "financ"]];
  for (const f of ["caf_work_area", "caf_work_block"]) if (fields.includes(f)) scope.unshift("|", [f, "=", "financial"]);
  const rows: Row[] = await call(request, "project.task", "search_read", [[["project_id", "=", project.id], ...scope]], { fields, limit: 201, order: "id asc" });
  return { project, tasks: rows.slice(0, 200), warnings: rows.length > 200 ? ["Se muestran las primeras 200 tareas financieras. Consulta las restantes en Odoo."] : [] };
}
function failure(error: unknown): Response {
  return Response.json({ error: error instanceof ContextError ? error.message : "No se pudo consultar esta información de Odoo. Puedes reintentar." }, { status: error instanceof ContextError ? error.status : 503, headers: PRIVATE });
}

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Use the native predecessor of the economic-offer macro, never project-wide chatter.
// Older protocols may expose a single explicit preparation macro instead.
export function previousFinancialMacro(tasks: Row[]): Row | null {
  const macros = tasks.filter((task) => !task.parent_id);
  const name = (task: Row) => normalized(label(task.caf_protocol_native_template_task_id) || task.name || "");
  const offers = macros.filter((task) => /^oferta economica$/.test(name(task)));
  if (offers.length === 1 && Array.isArray(offers[0].depend_on_ids)) {
    const predecessors = macros.filter((task) => offers[0].depend_on_ids.includes(task.id));
    return predecessors.length === 1 ? predecessors[0] : null;
  }
  const preparation = macros.filter((task) => /prepar.*analis.*financ|pre.?analisis financ/.test(name(task)));
  return preparation.length === 1 ? preparation[0] : null;
}

export async function readOdooNotes(request: Request, link: Link): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("before");
  if (raw && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) return Response.json({ error: "Página de notas inválida." }, { status: 400, headers: PRIVATE });
  try {
    const s = await sources(request, link);
    if (s.error) return s.error;
    const predecessor = previousFinancialMacro(s.tasks!);
    const tasks = predecessor ? [predecessor] : []; const project = s.project; const warnings = s.warnings!;
    if (!predecessor) return Response.json({ entries: [], next: null, warnings: ["No se identificó una macrotarea anterior única para la oferta económica. Consulta las notas en Odoo."] }, { headers: PRIVATE });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const entries: SourceNote[] = [];
    function add(id: string, task: Row | undefined, title: string, body: unknown, author: string | null, date: string | null, edited: boolean) {
      const text = id.startsWith("message-") || id.endsWith("-description") ? noteText(body) : typeof body === "string" ? body.trim() : ""; if (!text) return;
      entries.push({ id, group: task ? `task-${task.id}` : `project-${project.id}`, source: task?.name || "Comentarios del proyecto", stage: task ? [label(task.caf_protocol_stage_id), label(task.caf_protocol_substage_id)].filter(Boolean).join(" · ") || null : null, title, text, author, date, edited });
    }
    if (!raw) {
      for (const t of tasks) for (const [f, title] of [["caf_decision_note", "Nota"]]) add(`task-${t.id}-${f}`, t, title, t[f], label(t.write_uid), t.write_date || null, true);
      if (tasks.length) {
        try {
          const checks: Row[] = await call(request, "caf.work.task.check.line", "search_read", [[["task_id", "in", [...byId.keys()]], ["answer_text", "!=", false]]], { fields: ["id", "name", "task_id", "answer_text", "write_uid", "write_date"], limit: 201, order: "id asc" });
          for (const c of checks.slice(0, 200)) { const t = byId.get(c.task_id?.[0]); if (t) add(`check-${c.id}`, t, c.name || "Respuesta / evidencia", c.answer_text, label(c.write_uid), c.write_date || null, true); }
          if (checks.length > 200) warnings.push("Se muestran las primeras 200 respuestas. Consulta las restantes en Odoo.");
        } catch (e) { if (e instanceof ContextError && e.status === 401) throw e; warnings.push("No fue posible consultar las respuestas del checklist con tu acceso actual."); }
      }
    }
    const domain: unknown[] = [["model", "=", "project.task"], ["res_id", "in", [...byId.keys()]], ["message_type", "in", ["comment", "email"]]];
    if (raw) domain.push(["id", "<", Number(raw)]);
    let next: number | null = null;
    try {
      const messages: Row[] = await call(request, "mail.message", "search_read", [domain], { fields: ["id", "model", "res_id", "body", "author_id", "date"], limit: 101, order: "id desc" });
      for (const m of messages.slice(0, 100)) {
        const t = m.model === "project.task" ? byId.get(m.res_id) : undefined;
        if (t) add(`message-${m.id}`, t, "Comentario", m.body, label(m.author_id), m.date || null, false);
      }
      if (messages.length > 100) next = messages[99].id;
    } catch (e) { if (e instanceof ContextError && e.status === 401) throw e; warnings.push("No fue posible consultar los comentarios con tu acceso actual."); }
    entries.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.id.localeCompare(b.id));
    return Response.json({ entries, next, warnings }, { headers: PRIVATE });
  } catch (e) { return failure(e); }
}

export async function readOdooAttachments(request: Request, link: Link, fileId?: string): Promise<Response> {
  if (fileId && (!/^[1-9]\d*$/.test(fileId) || !Number.isSafeInteger(Number(fileId)))) return Response.json({ error: "Archivo no encontrado." }, { status: 404, headers: PRIVATE });
  try {
    const s = await sources(request, link); if (s.error) return s.error;
    const domain: unknown[] = ["|", "&", ["res_model", "=", "project.project"], ["res_id", "=", s.project.id], "&", ["res_model", "=", "project.task"], ["res_id", "in", s.tasks!.map((t) => t.id)], ["type", "=", "binary"]];
    if (fileId) domain.push(["id", "=", Number(fileId)]);
    const files: Row[] = await call(request, "ir.attachment", "search_read", [domain], { fields: ["id", "name", "mimetype", "file_size", "res_model", "res_id"], limit: fileId ? 1 : 101, order: "id desc" });
    if (!fileId) return Response.json({ files: files.slice(0, 100).map((f) => ({ id: f.id, name: f.name, size: f.file_size, source: f.res_model === "project.project" ? "Proyecto" : s.tasks!.find((t) => t.id === f.res_id)?.name || "Tarea financiera" })), warnings: [...s.warnings!, ...(files.length > 100 ? ["Se muestran los 100 adjuntos más recientes. Consulta los restantes en Odoo."] : [])] }, { headers: PRIVATE });
    if (!files.length || files[0].id !== Number(fileId)) return Response.json({ error: "Adjunto no disponible para tu usuario en este proyecto." }, { status: 404, headers: PRIVATE });
    const upstream = await proxyOdooSession(request, `/web/content/ir.attachment/${fileId}/datas?download=true`, { signal: AbortSignal.timeout(20000) });
    if (isOdooLoginRedirect(upstream) || upstream.status === 401) throw new ContextError(401, "Inicia sesión en Odoo para abrir el adjunto.");
    if (!upstream.ok) throw new ContextError(404, "Adjunto no disponible para tu usuario en este proyecto.");
    return new Response(upstream.body, { headers: { ...PRIVATE, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(files[0].name || "Adjunto")}`, "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (e) { return failure(e); }
}
