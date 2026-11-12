import { NextRequest, NextResponse } from "next/server";

type Access = "ok" | "login" | "forbidden" | "unavailable";
type ServiceKey = "FINANCIAL_IMPORT_TOKEN" | "FINANCIAL_PRICE_BASE_TOKEN" | "FINANCIAL_DELETE_SERVICE_TOKEN";

function appPath(request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const base = request.nextUrl.basePath || process.env.NEXT_PUBLIC_BASE_PATH || "";
  return base && pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

function serviceKey(pathname: string, method: string, search: URLSearchParams): ServiceKey | null {
  if (method === "POST" && (pathname === "/api/import" || pathname === "/api/validate")) return "FINANCIAL_IMPORT_TOKEN";
  const project = /^\/api\/projects\/[^/]+$/.test(pathname);
  if (project && method === "GET" && search.get("deletionPreflight") === "1") return "FINANCIAL_DELETE_SERVICE_TOKEN";
  if (project && method === "DELETE") return "FINANCIAL_DELETE_SERVICE_TOKEN";
  if (project && method === "GET") return "FINANCIAL_PRICE_BASE_TOKEN";
  if (/^\/api\/projects\/[^/]+\/(?:operations|price-bases)$/.test(pathname) && (method === "GET" || method === "POST")) return "FINANCIAL_PRICE_BASE_TOKEN";
  if (/^\/api\/projects\/[^/]+\/(?:freeze|unfreeze)$/.test(pathname) && method === "POST") return "FINANCIAL_PRICE_BASE_TOKEN";
  return null;
}

async function validServiceToken(supplied: string, key: ServiceKey): Promise<boolean> {
  const expected = process.env[key]?.trim() ?? "";
  if (expected.length < 32 || supplied.length < 32) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function odooAccess(request: NextRequest): Promise<Access> {
  const session = request.cookies.get("session_id")?.value ?? "";
  if (!session || session.length > 512 || /[;\r\n]/.test(session)) return "login";
  const base = process.env.ODOO_INTERNAL_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) return "unavailable";
  try {
    const response = await fetch(`${base}/caf/finanzas/workspace-auth`, {
      headers: { Cookie: `session_id=${session}` },
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    if (response.status === 204) return "ok";
    if (response.status === 401 || (response.status >= 300 && response.status < 400)) return "login";
    if (response.status === 403) return "forbidden";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("host") ?? "";
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? `${forwardedProtocol}:`
    : request.nextUrl.protocol;
  return /^[a-z0-9.:-]+$/i.test(host)
    ? new URL(`${protocol}//${host}`).origin
    : request.nextUrl.origin;
}

function allowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configured = process.env.FINANCIAL_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);
  return configured?.length ? configured.includes(origin) : origin === publicOrigin(request);
}

function withPrivateHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

const CHATGPT_SELF_AUTHENTICATED_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/api/chatgpt/oauth/authorize",
  "/api/chatgpt/oauth/token",
  "/api/chatgpt/oauth/revoke",
  "/api/chatgpt/mcp",
  "/mcp",
]);

function denied(request: NextRequest, access: Exclude<Access, "ok">): NextResponse {
  const path = appPath(request);
  if (path.startsWith("/api/")) {
    const detail = access === "login"
      ? { status: 401, code: "ODOO_LOGIN_REQUIRED", error: "Inicia sesión en Odoo para usar Finanzas." }
      : access === "forbidden"
        ? { status: 403, code: "ODOO_ACCESS_DENIED", error: "Tu usuario de Odoo no tiene acceso a Finanzas." }
        : { status: 503, code: "ODOO_AUTH_UNAVAILABLE", error: "No se pudo verificar la sesión de Odoo." };
    return withPrivateHeaders(NextResponse.json({ error: detail.error, code: detail.code }, { status: detail.status }));
  }
  const base = request.nextUrl.basePath || process.env.NEXT_PUBLIC_BASE_PATH || "";
  const location = new URL(`${base}/access?reason=${access}`, publicOrigin(request));
  return withPrivateHeaders(NextResponse.redirect(location, 307));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = appPath(request);
  if (pathname === "/access") return withPrivateHeaders(NextResponse.next());
  if (CHATGPT_SELF_AUTHENTICATED_PATHS.has(pathname)) return withPrivateHeaders(NextResponse.next());
  const method = request.method.toUpperCase();
  const key = serviceKey(pathname, method, request.nextUrl.searchParams);
  const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (key && bearer) {
    if (await validServiceToken(bearer, key)) return withPrivateHeaders(NextResponse.next());
    return withPrivateHeaders(NextResponse.json({ error: "Credencial de servicio inválida.", code: "SERVICE_AUTH_DENIED" }, { status: 401 }));
  }
  const access = await odooAccess(request);
  if (access !== "ok") return denied(request, access);
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !allowedOrigin(request)) {
    return withPrivateHeaders(NextResponse.json({ error: "Origen no autorizado.", code: "ORIGIN_DENIED" }, { status: 403 }));
  }
  return withPrivateHeaders(NextResponse.next());
}

export const config = { matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"] };
