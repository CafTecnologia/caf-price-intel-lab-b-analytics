import { buildAiResultEvidence } from "./ai-result-evidence";
import { getCalculation, listCalculationOperationReceiptsByJob, listPriceBaseVersions } from "./store";
function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
function requestOrigin(request: Request): string | null {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? `${forwardedProtocol}:` : url.protocol;
  return host && /^[a-z0-9.:-]+$/i.test(host)
    ? normalizedOrigin(`${protocol}//${host}`) : url.origin;
}
export function sameAppOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin !== normalizedOrigin(origin)) return false;
  const configured = process.env.FINANCIAL_ALLOWED_ORIGINS;
  const allowed = configured !== undefined
    ? configured.split(",").map((value) => normalizedOrigin(value.trim())).filter(Boolean)
    : [requestOrigin(request)];
  return allowed.includes(origin);
}
export async function proxyOdooSession(request: Request, path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.ODOO_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) throw new Error("Odoo no está configurado.");
  return fetch(`${base}${path}`, {
    ...init, redirect: "manual", cache: "no-store",
    headers: { ...(init.headers ?? {}), Cookie: request.headers.get("cookie") ?? "" },
  });
}

export function isOdooLoginRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

// Confirm an already saved, completed manual request through Odoo's existing ACL/CSRF route.
// This never starts an agent or enables lifecycle automation for a closed project.
export async function confirmSavedAgentMessage(request: Request, calculationId: string, expectedJobId?: string) {
  const ignored = { status: 200, body: { confirmed: false } };
  const response = await proxyOdooSession(request, `/caf/finanzas/calculations/${encodeURIComponent(calculationId)}/collaboration`);
  if (isOdooLoginRedirect(response)) return { status: 401, body: { error: "Inicia sesión en Odoo." } };
  if (!response.ok) return { status: response.status, body: { error: "No tienes acceso al cálculo." } };
  const state = await response.json();
  const turns = state.study?.dialogue?.turns ?? [];
  const latest = [...turns].reverse().find((turn: {job_id?: string}) => turn.job_id);
  if (!state.study?.publication_busy) return ignored;
  if (!state.canMessage || !Number.isSafeInteger(state.taskId) || !state.csrfToken) return { status: 403, body: { error: "No tienes permiso para confirmar el registro." } };
  if (!latest || latest.status !== "completed" || (expectedJobId && latest.job_id !== expectedJobId)
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(latest.job_id)) return ignored;
  const calculation = await getCalculation(calculationId);
  if (!calculation?.odooProjectId || !calculation.externalId) return ignored;
  const [receipts, versions] = await Promise.all([listCalculationOperationReceiptsByJob(latest.job_id), listPriceBaseVersions(calculationId)]);
  const evidence = buildAiResultEvidence({ calculation, jobId: latest.job_id, receipts, versions });
  if (!evidence.receiptCount || evidence.rejectedReceiptCount) return ignored;
  const confirmed = await proxyOdooSession(request, `/caf/ia/tasks/${state.taskId}/apply-cost-version/${encodeURIComponent(latest.job_id)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({csrf_token: state.csrfToken}),
  });
  if (isOdooLoginRedirect(confirmed)) return { status: 401, body: { error: "Inicia sesión en Odoo." } };
  if (!confirmed.ok) return { status: confirmed.status, body: { error: "No se pudo confirmar el registro; conserva los cambios guardados." } };
  const result = await confirmed.json();
  if (result.appliedJobId !== latest.job_id || result.calculationId !== calculationId) return { status: 409, body: { error: "La confirmación no corresponde a esta solicitud." } };
  return { status: 200, body: { confirmed: true, jobId: latest.job_id } };
}
