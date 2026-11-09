import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PROVIDER_WORKERS: Record<string, { label: string; baseUrl: string }> = {
  codex_vps: {
    label: "Codex VPS DEV",
    baseUrl: process.env.CODEX_VPS_WORKER_URL || "http://127.0.0.1:18735"
  }
};

const ALLOWED_ACTIONS = new Set(["health", "status", "quote", "logs", "jobs", "result"]);

type RouteContext = {
  params:
    | Promise<{ providerId?: string; action?: string }>
    | { providerId?: string; action?: string };
};

async function resolveParams(context: RouteContext) {
  return Promise.resolve(context.params);
}

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function getProviderTarget(providerId?: string, action?: string) {
  if (!providerId || !PROVIDER_WORKERS[providerId]) {
    return { error: `Proveedor no soportado: ${providerId || "(vacio)"}`, status: 404 } as const;
  }
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return { error: `Accion no soportada: ${action || "(vacia)"}`, status: 404 } as const;
  }
  return {
    provider: PROVIDER_WORKERS[providerId],
    action
  } as const;
}

async function proxyToWorker(request: Request, context: RouteContext, method: "GET" | "POST") {
  const params = await resolveParams(context);
  const target = getProviderTarget(params.providerId, params.action);
  if ("error" in target) return jsonError(target.error || "Proveedor/accion no soportados.", target.status);

  const url = new URL(request.url);
  const workerUrl = `${target.provider.baseUrl.replace(/\/+$/, "")}/${target.action}${url.search}`;
  const controller = new AbortController();
  const timeoutMs = target.action === "quote" ? 45 * 60 * 1000 : 30 * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {};
    const token = process.env.CODEX_VPS_WORKER_TOKEN;
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (method === "POST") headers["content-type"] = request.headers.get("content-type") || "application/json";

    const upstream = await fetch(workerUrl, {
      method,
      headers,
      body: method === "POST" ? await request.text() : undefined,
      cache: "no-store",
      signal: controller.signal
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": contentType }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`No se pudo contactar ${target.provider.label}: ${message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyToWorker(request, context, "GET");
}

export async function POST(request: Request, context: RouteContext) {
  return proxyToWorker(request, context, "POST");
}
