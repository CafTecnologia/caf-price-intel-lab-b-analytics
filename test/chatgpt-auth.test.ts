import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ChatGPTAuthError,
  assertCalculationAccess,
  authenticateChatGPT,
  authorizationServerMetadata,
  beginAuthorization,
  completeAuthorization,
  exchangeToken,
  protectedResourceMetadata,
  revokeToken,
} from "../lib/chatgpt-auth";
import { middleware } from "../middleware";

const issuer = "http://127.0.0.1:18030";
const resource = `${issuer}/mcp`;
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "v".repeat(64);
let storeDir = "";

function nativeSessionResponse(url: string, init: RequestInit | undefined, uid: number) {
  if (!url.endsWith("/caf/finanzas/mcp/session")) return null;
  return Response.json(init?.method === "POST"
    ? { uid, db: "caf_dev", dedicated: true, sessionId: `mcp-dedicated-${uid}`, maxInactivitySeconds: 3600 }
    : { uid, db: "caf_dev", csrfToken: "synthetic-native-csrf" });
}

function sessionFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const native = nativeSessionResponse(url, init, 42); if (native) return native;
    if (url.endsWith("/caf/finanzas/workspace-auth")) return new Response(null, { status: 204 });
    if (url.endsWith("/web/session/get_session_info")) {
      return Response.json({ jsonrpc: "2.0", result: { uid: 42, name: "Persona QA", db: "caf_dev" } });
    }
    if (url.includes("/cost-version-auth")) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
}

function hidden(html: string, name: string) {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";
}

async function authorize(scope = "finance.read finance.write") {
  const approved = await approvedCode(scope);
  return { ...approved, token: await exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: approved.tokenBody })) };
}

async function approvedCode(scope = "finance.read finance.write") {
  const page = await authorizationPage(scope);
  const form = new URLSearchParams({
    transaction_id: hidden(page.html, "transaction_id"), csrf_token: hidden(page.html, "csrf_token"), decision: "approve",
  });
  const approval = await completeAuthorization(new Request(page.url, {
    method: "POST", headers: { Cookie: "session_id=odoo-session-qa", "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  }));
  const code = new URL(approval.headers.get("location")!).searchParams.get("code")!;
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, resource, code, code_verifier: verifier,
  });
  return { code, tokenBody };
}

async function authorizationPage(scope = "finance.read") {
  const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const url = new URL(`${issuer}/api/chatgpt/oauth/authorize`);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, resource,
    state: "state-qa", code_challenge: Buffer.from(challenge).toString("base64url"), code_challenge_method: "S256", scope,
  })) url.searchParams.set(key, value);
  const response = await beginAuthorization(new Request(url, { headers: { Cookie: "session_id=odoo-session-qa" } }));
  return { url, response, html: await response.text() };
}

async function editStore(mutator: (store: any) => void) {
  const file = path.join(storeDir, "chatgpt-oauth.json");
  const store = JSON.parse(await readFile(file, "utf8"));
  mutator(store);
  await writeFile(file, JSON.stringify(store));
}

beforeEach(async () => {
  storeDir = await mkdtemp(path.join(tmpdir(), "caf-chatgpt-auth-"));
  vi.stubEnv("CHATGPT_MCP_RESOURCE", resource);
  vi.stubEnv("CHATGPT_OAUTH_ISSUER", issuer);
  vi.stubEnv("CHATGPT_OAUTH_ALLOWED_CLIENT_IDS", clientId);
  vi.stubEnv("CHATGPT_OAUTH_ALLOWED_REDIRECT_URIS", redirectUri);
  vi.stubEnv("CHATGPT_OAUTH_SESSION_ENCRYPTION_KEY", "11".repeat(32));
  vi.stubEnv("CHATGPT_OAUTH_PROFILE_ID_KEY", "22".repeat(32));
  vi.stubEnv("CHATGPT_OAUTH_STORE_DIR", storeDir);
  vi.stubEnv("CHATGPT_ODOO_DATABASES", "caf_dev");
  vi.stubEnv("ODOO_INTERNAL_BASE_URL", "http://odoo.test:8069");
  vi.stubGlobal("fetch", sessionFetch());
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(storeDir, { recursive: true, force: true });
});

describe("OAuth ChatGPT ligado a Odoo", () => {
  it.each([
    ["context identity", "GET", { uid: 99 }],
    ["context database", "GET", { db: "foreign" }],
    ["grant identity", "POST", { uid: 99 }],
    ["grant database", "POST", { db: "foreign" }],
    ["dedicated flag", "POST", { dedicated: false }],
    ["unsafe session", "POST", { sessionId: "bad;cookie" }],
    ["expired grant", "POST", { maxInactivitySeconds: 0 }],
  ])("rechaza %s sin emitir códigos ni tokens", async (_label, method, override) => {
    const baseFetch = sessionFetch();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const response = await baseFetch(input, init);
      if (String(input).endsWith("/caf/finanzas/mcp/session") && (init?.method ?? "GET") === method)
        return Response.json({ ...await response.json(), ...override });
      return response;
    }));
    await expect(approvedCode()).rejects.toMatchObject({ code: "ODOO_AUTH_UNAVAILABLE" });
    const store = JSON.parse(await readFile(path.join(storeDir, "chatgpt-oauth.json"), "utf8"));
    expect(Object.keys(store.codes)).toHaveLength(0);
    expect(Object.keys(store.accessTokens)).toHaveLength(0);
  });

  it("solo permite HTTP loopback en producción con el flag QA explícito", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CHATGPT_OAUTH_ALLOW_HTTP_LOOPBACK_QA", "");
    expect(() => protectedResourceMetadata()).toThrowError(expect.objectContaining({ code: "OAUTH_HTTPS_REQUIRED" }));

    vi.stubEnv("CHATGPT_OAUTH_ALLOW_HTTP_LOOPBACK_QA", "true");
    expect(protectedResourceMetadata()).toMatchObject({ resource });

    vi.stubEnv("CHATGPT_MCP_RESOURCE", "http://qa.example.test/mcp");
    expect(() => protectedResourceMetadata()).toThrowError(expect.objectContaining({ code: "OAUTH_HTTPS_REQUIRED" }));
  });

  it("construye metadata y retorno de login con el base path del issuer", async () => {
    const basedIssuer = `${issuer}/finanzas`;
    const basedResource = `${basedIssuer}/api/chatgpt/mcp`;
    vi.stubEnv("CHATGPT_OAUTH_ISSUER", basedIssuer);
    vi.stubEnv("CHATGPT_MCP_RESOURCE", basedResource);
    const resourceMetadata = protectedResourceMetadata();
    const serverMetadata = authorizationServerMetadata();
    expect(resourceMetadata).toMatchObject({ resource: basedResource, authorization_servers: [basedIssuer] });
    expect(serverMetadata.authorization_endpoint).toBe(`${basedIssuer}/api/chatgpt/oauth/authorize`);
    expect(serverMetadata).not.toHaveProperty("client_id_metadata_document_supported");

    const url = new URL(`${basedIssuer}/api/chatgpt/oauth/authorize`);
    for (const [key, value] of Object.entries({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri, resource: basedResource,
      state: "state-based", code_challenge: "x".repeat(43), code_challenge_method: "S256", scope: "finance.read",
    })) url.searchParams.set(key, value);
    const login = await beginAuthorization(new Request(url));
    const location = new URL(login.headers.get("location")!);
    expect(location.pathname).toBe("/web/login");
    expect(location.searchParams.get("redirect")).toContain("/finanzas/api/chatgpt/oauth/authorize?");
  });

  it("permite cambiar cuenta de Odoo sin aprobar con la sesión anterior", async () => {
    const page = await authorizationPage();
    expect(page.html).toContain("Persona QA");
    expect(page.html).toContain("Se cerrará tu sesión actual de Odoo");
    const encoded = /class="switch-account" href="([^"]+)"/.exec(page.html)?.[1];
    expect(encoded).toBeTruthy();
    const logout = new URL(encoded!.replaceAll("&amp;", "&"));
    expect(logout.origin).toBe(issuer);
    expect(logout.pathname).toBe("/web/session/logout");
    const login = new URL(logout.searchParams.get("redirect")!, issuer);
    expect(login.pathname).toBe("/web/login");
    const resumed = new URL(login.searchParams.get("redirect")!, issuer);
    expect(resumed.pathname).toBe("/api/chatgpt/oauth/authorize");
    expect(resumed.searchParams.get("client_id")).toBe(clientId);
    expect(resumed.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(resumed.searchParams.get("state")).toBe("state-qa");

    const form = new URLSearchParams({
      transaction_id: hidden(page.html, "transaction_id"), csrf_token: hidden(page.html, "csrf_token"), decision: "approve",
    });
    await expect(completeAuthorization(new Request(page.url, {
      method: "POST", headers: { Cookie: "session_id=other-odoo-session" }, body: form,
    }))).rejects.toMatchObject({ code: "ODOO_LOGIN_REQUIRED" });

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const native = nativeSessionResponse(url, init, 43); if (native) return native;
      if (url.endsWith("/caf/finanzas/workspace-auth")) return new Response(null, { status: 204 });
      if (url.endsWith("/web/session/get_session_info")) {
        return Response.json({ jsonrpc: "2.0", result: { uid: 43, name: "Otra persona QA", db: "caf_dev" } });
      }
      return new Response(null, { status: 404 });
    }));
    const second = await beginAuthorization(new Request(page.url, { headers: { Cookie: "session_id=other-odoo-session" } }));
    const secondHtml = await second.text();
    const secondForm = new URLSearchParams({
      transaction_id: hidden(secondHtml, "transaction_id"), csrf_token: hidden(secondHtml, "csrf_token"), decision: "approve",
    });
    const approved = await completeAuthorization(new Request(page.url, {
      method: "POST", headers: { Cookie: "session_id=other-odoo-session" }, body: secondForm,
    }));
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const token = await exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, {
      method: "POST", body: new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, resource, code, code_verifier: verifier,
      }),
    }));
    expect(token.status).toBe(200);
    const payload = await token.json() as { access_token: string };
    const actor = await authenticateChatGPT(new Request(`${issuer}/mcp`, {
      headers: { Authorization: `Bearer ${payload.access_token}` },
    }));
    expect(actor).toMatchObject({ odooUid: 43, name: "Otra persona QA", sessionId: "mcp-dedicated-43" });
  });

  it("detiene la activación de una cuenta distinta de la copia real", async () => {
    const issued = await authorize();
    const payload = await issued.token.json() as { access_token: string };
    const allowed = await authenticateChatGPT(new Request(`${issuer}/mcp`, {
      headers: { Authorization: `Bearer ${payload.access_token}` },
    }));
    const manifestPath = path.join(storeDir, "snapshot-account-manifest.json");
    const raw = JSON.stringify({
      version: 1, profileId: allowed.id, odooUid: allowed.odooUid,
      projectCount: 1, calculationIds: ["42a7e900-dd14-4207-bd95-d5dc2e2a2a57"],
    });
    await writeFile(manifestPath, raw);
    vi.stubEnv("CHATGPT_SANDBOX", "true");
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_PATH", manifestPath);
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256", createHash("sha256").update(raw).digest("hex"));

    const same = await authorizationPage();
    expect(same.html).toContain("transaction_id");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const native = nativeSessionResponse(url, init, 43); if (native) return native;
      if (url.endsWith("/caf/finanzas/workspace-auth")) return new Response(null, { status: 204 });
      if (url.endsWith("/web/session/get_session_info")) {
        return Response.json({ jsonrpc: "2.0", result: { uid: 43, name: "Otra persona QA", db: "caf_dev" } });
      }
      return new Response(null, { status: 404 });
    }));
    const wrong = await beginAuthorization(new Request(same.url, { headers: { Cookie: "session_id=other-odoo-session" } }));
    const html = await wrong.text();
    expect(wrong.status).toBe(200);
    expect(html).toContain("Esta cuenta no tiene acceso a la copia de pruebas");
    expect(html).toContain("Otra persona QA");
    expect(html).toContain("Cambiar cuenta de Odoo");
    expect(html).not.toContain("transaction_id");
    const encoded = /href="([^"]+)"/.exec(html)?.[1];
    const logout = new URL(encoded!.replaceAll("&amp;", "&"));
    expect(logout.pathname).toBe("/web/session/logout");
  });

  it("no crea autorización si el manifiesto del laboratorio está incompleto", async () => {
    vi.stubEnv("CHATGPT_SANDBOX", "true");
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_PATH", "");
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256", "a".repeat(64));
    await expect(authorizationPage()).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    const store = JSON.parse(await readFile(path.join(storeDir, "chatgpt-oauth.json"), "utf8").catch(() => '{"transactions":{}}'));
    expect(Object.keys(store.transactions)).toHaveLength(0);
  });

  it("no aprueba una transacción antigua si cambió la cuenta de la copia", async () => {
    const issued = await authorize();
    const payload = await issued.token.json() as { access_token: string };
    const allowed = await authenticateChatGPT(new Request(`${issuer}/mcp`, {
      headers: { Authorization: `Bearer ${payload.access_token}` },
    }));
    const manifestPath = path.join(storeDir, "rotating-snapshot-manifest.json");
    const manifest = {
      version: 1, profileId: allowed.id, odooUid: allowed.odooUid,
      projectCount: 1, calculationIds: ["42a7e900-dd14-4207-bd95-d5dc2e2a2a57"],
    };
    const first = JSON.stringify(manifest);
    await writeFile(manifestPath, first);
    vi.stubEnv("CHATGPT_SANDBOX", "true");
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_PATH", manifestPath);
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256", createHash("sha256").update(first).digest("hex"));
    const page = await authorizationPage();
    expect(page.html).toContain("transaction_id");

    const rotated = JSON.stringify({ ...manifest, odooUid: 43 });
    await writeFile(manifestPath, rotated);
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256", createHash("sha256").update(rotated).digest("hex"));
    const form = new URLSearchParams({
      transaction_id: hidden(page.html, "transaction_id"), csrf_token: hidden(page.html, "csrf_token"), decision: "approve",
    });
    await expect(completeAuthorization(new Request(page.url, {
      method: "POST", headers: { Cookie: "session_id=odoo-session-qa" }, body: form,
    }))).rejects.toMatchObject({ code: "LAB_ACCOUNT_CHANGED" });
    const store = JSON.parse(await readFile(path.join(storeDir, "chatgpt-oauth.json"), "utf8"));
    expect(Object.keys(store.codes)).toHaveLength(0);
  });

  it("resuelve identidad desde la sesión, intercambia PKCE una vez y conserva perfil estable", async () => {
    const issued = await authorize();
    expect(issued.token.status).toBe(200);
    const payload = await issued.token.json() as { access_token: string; refresh_token: string; scope: string };
    expect(payload.scope).toBe("finance.read finance.write");
    const actor = await authenticateChatGPT(new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${payload.access_token}` } }), "finance.write");
    expect(actor).toMatchObject({ name: "Persona QA", odooUid: 42, sessionId: "mcp-dedicated-42" });
    expect(actor.id).toMatch(/^caf_/);
    await expect(exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: issued.tokenBody }))).rejects.toMatchObject({ code: "INVALID_GRANT" });
  });

  it("no amplía scopes y valida el cálculo con la sesión real de la persona", async () => {
    const issued = await authorize("finance.read");
    const payload = await issued.token.json() as { access_token: string };
    const request = new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${payload.access_token}` } });
    await expect(authenticateChatGPT(request, "finance.write")).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    const actor = await authenticateChatGPT(request);
    await assertCalculationAccess(actor, { id: "123e4567-e89b-12d3-a456-426614174000", odooProjectId: "9", odooDb: "caf_dev" }, false);
    const calls = vi.mocked(fetch).mock.calls;
    const accessCall = calls.find(([url]) => String(url).includes("cost-version-auth"));
    expect(accessCall?.[1]?.headers).toMatchObject({ Cookie: "session_id=mcp-dedicated-42", "X-Odoo-Database": "caf_dev" });
    await expect(assertCalculationAccess(actor, { id: "123e4567-e89b-12d3-a456-426614174000", odooProjectId: "9", odooDb: "other" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
  });

  it("limita cuatro cálculos sintéticos al perfil OAuth y al laboratorio", async () => {
    const allowed = [
      "123e4567-e89b-42d3-a456-426614174001",
      "123e4567-e89b-42d3-a456-426614174002",
      "123e4567-e89b-42d3-a456-426614174003",
      "123e4567-e89b-42d3-a456-426614174004",
    ];
    const project = {
      id: allowed[0], sourceSystem: "caf_chatgpt_synthetic",
      externalId: `caf-chatgpt-synthetic:${allowed[0]}`,
      odooProjectId: null, odooDb: null,
    };
    const actor = { id: "qa-profile", name: "Persona QA", odooUid: 42, sessionId: "odoo-session-qa", scopes: new Set(["finance.read", "finance.write"] as const) };
    vi.stubEnv("CHATGPT_SANDBOX", "true");
    vi.stubEnv("CHATGPT_SYNTHETIC_ALLOWED_PROFILE_IDS", actor.id);
    vi.stubEnv("CHATGPT_SYNTHETIC_CALCULATION_IDS", allowed.join(","));
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    await assertCalculationAccess(actor, project, false);
    await assertCalculationAccess(actor, project, true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBefore);

    await expect(assertCalculationAccess({ ...actor, id: "otro-perfil" }, project, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await expect(assertCalculationAccess({ ...actor, scopes: new Set(["finance.read"] as const) }, project, true)).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    await expect(assertCalculationAccess(actor, { ...project, id: "123e4567-e89b-42d3-a456-426614174005" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await expect(assertCalculationAccess(actor, { ...project, sourceSystem: "odoo_caf" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await expect(assertCalculationAccess(actor, { ...project, odooDb: "caf_dev" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    vi.stubEnv("CHATGPT_SANDBOX", "false");
    await expect(assertCalculationAccess(actor, project, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
  });

  it("limita el snapshot real del laboratorio a identidad, UUID y manifiesto íntegro", async () => {
    const id = "42a7e900-dd14-4207-bd95-d5dc2e2a2a57";
    const actor = { id: "qa-profile", name: "Persona QA", odooUid: 42, sessionId: "odoo-session-qa", scopes: new Set(["finance.read", "finance.write"] as const) };
    const project = { id, sourceSystem: "odoo_caf", odooProjectId: "2062", odooDb: "caf_dev", odooCallbackUrl: null };
    const manifestPath = path.join(storeDir, "snapshot-manifest.json");
    const raw = JSON.stringify({ version: 1, profileId: actor.id, odooUid: actor.odooUid, projectCount: 1, calculationIds: [id] });
    await writeFile(manifestPath, raw);
    vi.stubEnv("CHATGPT_SANDBOX", "true");
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_PATH", manifestPath);
    vi.stubEnv("CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256", createHash("sha256").update(raw).digest("hex"));
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    await assertCalculationAccess(actor, project, false);
    await assertCalculationAccess(actor, project, true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBefore);
    await expect(assertCalculationAccess({ ...actor, id: "other-profile" }, project, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await expect(assertCalculationAccess({ ...actor, odooUid: 43 }, project, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await expect(assertCalculationAccess(actor, { ...project, id: "123e4567-e89b-42d3-a456-426614174005" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await expect(assertCalculationAccess(actor, { ...project, odooCallbackUrl: "https://example.test/capability" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    await writeFile(manifestPath, raw + " ");
    await expect(assertCalculationAccess(actor, project, false)).rejects.toMatchObject({ code: "LAB_SNAPSHOT_UNAVAILABLE" });
  });

  it("rechaza resource, callback y sesión inventados antes de emitir grants", async () => {
    const base = new URL(`${issuer}/api/chatgpt/oauth/authorize`);
    for (const [key, value] of Object.entries({
      response_type: "code", client_id: clientId, redirect_uri: "https://evil.example/callback", resource,
      state: "s", code_challenge: "x".repeat(43), code_challenge_method: "S256", scope: "finance.read",
    })) base.searchParams.set(key, value);
    await expect(beginAuthorization(new Request(base, { headers: { Cookie: "session_id=qa" } }))).rejects.toMatchObject({ code: "INVALID_REDIRECT_URI" });
    base.searchParams.set("redirect_uri", redirectUri);
    base.searchParams.set("resource", "http://127.0.0.1:18030/other");
    await expect(beginAuthorization(new Request(base, { headers: { Cookie: "session_id=qa" } }))).rejects.toMatchObject({ code: "INVALID_RESOURCE" });
    base.searchParams.set("resource", resource);
    const login = await beginAuthorization(new Request(base));
    expect(login.status).toBe(303);
    const location = new URL(login.headers.get("location")!);
    expect(location.origin).toBe(issuer);
    expect(location.pathname).toBe("/web/login");
    const returnTo = location.searchParams.get("redirect")!;
    expect(returnTo).toContain("/api/chatgpt/oauth/authorize?");
    expect(returnTo).not.toContain("evil.example");
  });

  it("rechaza CSRF, autorización vencida y PKCE incorrecto sin emitir un segundo resultado", async () => {
    const first = await authorizationPage();
    const badCsrf = new URLSearchParams({
      transaction_id: hidden(first.html, "transaction_id"), csrf_token: "incorrecto", decision: "approve",
    });
    await expect(completeAuthorization(new Request(first.url, {
      method: "POST", headers: { Cookie: "session_id=odoo-session-qa" }, body: badCsrf,
    }))).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION" });

    const expired = await authorizationPage();
    await editStore((store) => { store.transactions[hidden(expired.html, "transaction_id")].expiresAt = 1; });
    const expiredForm = new URLSearchParams({
      transaction_id: hidden(expired.html, "transaction_id"), csrf_token: hidden(expired.html, "csrf_token"), decision: "approve",
    });
    await expect(completeAuthorization(new Request(expired.url, {
      method: "POST", headers: { Cookie: "session_id=odoo-session-qa" }, body: expiredForm,
    }))).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION" });

    const issued = await approvedCode();
    const wrongPkce = new URLSearchParams(issued.tokenBody);
    wrongPkce.set("code_verifier", "z".repeat(64));
    await expect(exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: wrongPkce }))).rejects.toMatchObject({ code: "INVALID_GRANT" });
    await expect(exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: issued.tokenBody }))).rejects.toMatchObject({ code: "INVALID_GRANT" });
  });

  it("rota refresh, detecta replay, revoca la familia y admite revocación explícita", async () => {
    const issued = await authorize();
    const first = await issued.token.json() as { access_token: string; refresh_token: string };
    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token", client_id: clientId, resource, refresh_token: first.refresh_token,
    });
    const rotated = await exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: refreshBody }));
    const second = await rotated.json() as { access_token: string; refresh_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    await expect(exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: refreshBody }))).rejects.toMatchObject({ code: "INVALID_GRANT" });
    await expect(authenticateChatGPT(new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${second.access_token}` } }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    const fresh = await authorize();
    const freshToken = await fresh.token.json() as { access_token: string };
    await revokeToken(new Request(`${issuer}/api/chatgpt/oauth/revoke`, {
      method: "POST", body: new URLSearchParams({ client_id: clientId, token: freshToken.access_token }),
    }));
    await expect(authenticateChatGPT(new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${freshToken.access_token}` } }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("conserva el tombstone de un refresh usado hasta que venza su reemplazo", async () => {
    const issued = await authorize();
    const first = await issued.token.json() as { access_token: string; refresh_token: string };
    const initialNow = Date.now();
    await editStore((store) => {
      Object.values(store.refreshTokens).forEach((token: any) => { token.expiresAt = initialNow + 1_000; });
    });
    vi.useFakeTimers();
    vi.setSystemTime(initialNow + 500);
    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token", client_id: clientId, resource, refresh_token: first.refresh_token,
    });
    const rotated = await exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, { method: "POST", body: refreshBody }));
    const second = await rotated.json() as { access_token: string; refresh_token: string };

    vi.setSystemTime(initialNow + 1_500);
    await expect(exchangeToken(new Request(`${issuer}/api/chatgpt/oauth/token`, {
      method: "POST", body: refreshBody,
    }))).rejects.toMatchObject({ code: "INVALID_GRANT" });
    await expect(authenticateChatGPT(new Request(`${issuer}/mcp`, {
      headers: { Authorization: `Bearer ${second.access_token}` },
    }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("falla cerrado ante token vencido, audiencia cambiada y usuario ajeno sin mutar", async () => {
    const issued = await authorize();
    const payload = await issued.token.json() as { access_token: string };
    await editStore((store) => { Object.values(store.accessTokens).forEach((token: any) => { token.expiresAt = 1; }); });
    await expect(authenticateChatGPT(new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${payload.access_token}` } }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    const other = await authorize("finance.read");
    const otherPayload = await other.token.json() as { access_token: string };
    vi.stubEnv("CHATGPT_MCP_RESOURCE", `${issuer}/different-mcp`);
    await expect(authenticateChatGPT(new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${otherPayload.access_token}` } }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    vi.stubEnv("CHATGPT_MCP_RESOURCE", resource);
    const actor = await authenticateChatGPT(new Request(`${issuer}/mcp`, { headers: { Authorization: `Bearer ${otherPayload.access_token}` } }));
    const before = (vi.mocked(fetch).mock.calls.length);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/caf/finanzas/workspace-auth")) return new Response(null, { status: 204 });
      if (url.endsWith("/web/session/get_session_info")) return Response.json({ result: { uid: 42, name: "Persona QA", db: "caf_dev" } });
      if (url.includes("/cost-version-auth")) return new Response(null, { status: 403 });
      throw new Error("unexpected call");
    }));
    await expect(assertCalculationAccess(actor, { id: "123e4567-e89b-12d3-a456-426614174000", odooProjectId: "99", odooDb: "caf_dev" }, false)).rejects.toMatchObject({ code: "CALCULATION_NOT_AVAILABLE" });
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    expect(before).toBeGreaterThan(0);
  });

  it("solo omite middleware en superficies exactas y no por prefijo", async () => {
    for (const route of [
      "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server",
      "/api/chatgpt/oauth/authorize", "/api/chatgpt/oauth/token", "/api/chatgpt/oauth/revoke", "/api/chatgpt/mcp", "/mcp",
    ]) {
      expect((await middleware(new NextRequest(`${issuer}${route}`))).headers.get("x-middleware-next"), route).toBe("1");
    }
    const denied = await middleware(new NextRequest(`${issuer}/api/chatgpt/oauth/authorize-extra`));
    expect(denied.status).toBe(401);
  });
});
