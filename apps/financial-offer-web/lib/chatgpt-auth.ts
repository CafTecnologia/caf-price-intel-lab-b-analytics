import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type FinanceScope = "finance.read" | "finance.write";

export interface ChatGPTActor {
  id: string;
  name: string;
  odooUid: number;
  sessionId: string;
  scopes: ReadonlySet<FinanceScope>;
}

export interface CalculationAccessSubject {
  id: string;
  odooProjectId: string | null;
  odooDb: string | null;
  sourceSystem?: string | null;
  externalId?: string | null;
  odooCallbackUrl?: string | null;
}

export class ChatGPTAuthError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    public readonly code: string,
    message: string,
    public readonly challenge?: string,
  ) {
    super(message);
    this.name = "ChatGPTAuthError";
  }
}

interface AuthConfig {
  resource: string;
  issuer: string;
  metadataUrl: string;
  allowedClientIds: Set<string>;
  allowedRedirectUris: Set<string>;
  encryptionKey: Buffer;
  profileKey: Buffer;
  storeDir: string;
  odooBase: string;
  allowedOdooDatabases: Set<string>;
}

interface AuthorizationTransaction {
  id: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: FinanceScope[];
  state: string;
  codeChallenge: string;
  csrfHash: string;
  sessionCiphertext: string;
  dedicatedSession?: boolean;
  sessionMaxInactivityMs?: number;
  odooUid: number;
  name: string;
  profileId: string;
  expiresAt: number;
}

interface AuthorizationCode {
  hash: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: FinanceScope[];
  codeChallenge: string;
  sessionCiphertext: string;
  dedicatedSession?: boolean;
  sessionMaxInactivityMs?: number;
  odooUid: number;
  name: string;
  profileId: string;
  expiresAt: number;
}

interface AccessTokenRecord {
  hash: string;
  familyId: string;
  clientId: string;
  resource: string;
  scopes: FinanceScope[];
  sessionCiphertext: string;
  dedicatedSession?: boolean;
  sessionMaxInactivityMs?: number;
  odooUid: number;
  name: string;
  profileId: string;
  expiresAt: number;
  revokedAt?: number;
}

interface RefreshTokenRecord extends Omit<AccessTokenRecord, "revokedAt"> {
  status: "active" | "used" | "revoked";
}

type TokenSubject = Pick<AccessTokenRecord,
  "clientId" | "resource" | "scopes" | "sessionCiphertext" | "dedicatedSession" | "sessionMaxInactivityMs" | "odooUid" | "name" | "profileId"
>;

interface AuthStore {
  version: 1;
  transactions: Record<string, AuthorizationTransaction>;
  codes: Record<string, AuthorizationCode>;
  accessTokens: Record<string, AccessTokenRecord>;
  refreshTokens: Record<string, RefreshTokenRecord>;
  revokedFamilies: Record<string, number>;
}

const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 90 * 1000;
const KNOWN_SCOPES = new Set<FinanceScope>(["finance.read", "finance.write"]);
const CALCULATION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function emptyStore(): AuthStore {
  return { version: 1, transactions: {}, codes: {}, accessTokens: {}, refreshTokens: {}, revokedFamilies: {} };
}

function csv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function configuredUrl(name: string): string {
  const raw = process.env[name]?.trim() ?? "";
  let url: URL;
  try { url = new URL(raw); } catch { throw new ChatGPTAuthError(503, "OAUTH_NOT_CONFIGURED", `${name} no está configurado.`); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const qaHttpLoopback = process.env.CHATGPT_OAUTH_ALLOW_HTTP_LOOPBACK_QA === "true";
  if (url.username || url.password || url.search || url.hash) throw new ChatGPTAuthError(503, "OAUTH_NOT_CONFIGURED", `${name} contiene componentes no permitidos.`);
  if (url.protocol !== "https:"
      && !(process.env.NODE_ENV === "test" && url.protocol === "http:" && loopback)
      && !(qaHttpLoopback && url.protocol === "http:" && loopback)) {
    throw new ChatGPTAuthError(503, "OAUTH_HTTPS_REQUIRED", `${name} debe usar HTTPS.`);
  }
  return url.toString().replace(/\/$/, "");
}

function keyFromEnv(name: string, fallback?: Buffer): Buffer {
  const raw = process.env[name]?.trim();
  if (!raw && fallback) return fallback;
  if (!raw) throw new ChatGPTAuthError(503, "OAUTH_NOT_CONFIGURED", `${name} no está configurada.`);
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new ChatGPTAuthError(503, "OAUTH_NOT_CONFIGURED", `${name} debe contener 32 bytes.`);
  return key;
}

function authConfig(): AuthConfig {
  const resource = configuredUrl("CHATGPT_MCP_RESOURCE");
  const issuer = configuredUrl("CHATGPT_OAUTH_ISSUER");
  const metadataUrl = process.env.CHATGPT_OAUTH_RESOURCE_METADATA_URL?.trim()
    ? configuredUrl("CHATGPT_OAUTH_RESOURCE_METADATA_URL")
    : `${issuer}/.well-known/oauth-protected-resource`;
  const allowedClientIds = new Set(csv("CHATGPT_OAUTH_ALLOWED_CLIENT_IDS"));
  const allowedRedirectUris = new Set(csv("CHATGPT_OAUTH_ALLOWED_REDIRECT_URIS"));
  const storeDir = process.env.CHATGPT_OAUTH_STORE_DIR?.trim() ?? "";
  const odooBase = process.env.ODOO_INTERNAL_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  const allowedOdooDatabases = new Set(csv("CHATGPT_ODOO_DATABASES"));
  if (!allowedClientIds.size || !allowedRedirectUris.size || !storeDir || !path.isAbsolute(storeDir) || !odooBase || allowedOdooDatabases.size !== 1) {
    throw new ChatGPTAuthError(503, "OAUTH_NOT_CONFIGURED", "La autenticación ChatGPT no está configurada completamente.");
  }
  const encryptionKey = keyFromEnv("CHATGPT_OAUTH_SESSION_ENCRYPTION_KEY");
  return {
    resource, issuer, metadataUrl, allowedClientIds, allowedRedirectUris, encryptionKey,
    profileKey: keyFromEnv("CHATGPT_OAUTH_PROFILE_ID_KEY", encryptionKey),
    storeDir, odooBase, allowedOdooDatabases,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function opaque(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function seal(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function unseal(value: string, key: Buffer): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new ChatGPTAuthError(401, "INVALID_TOKEN", "La credencial ya no es válida.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ChatGPTAuthError(401, "INVALID_TOKEN", "La credencial ya no es válida.");
  }
}

function cleanStore(store: AuthStore, now = Date.now()): void {
  for (const [id, item] of Object.entries(store.transactions)) if (item.expiresAt <= now) delete store.transactions[id];
  for (const [id, item] of Object.entries(store.codes)) if (item.expiresAt <= now) delete store.codes[id];
  for (const [id, item] of Object.entries(store.accessTokens)) if (item.expiresAt <= now) delete store.accessTokens[id];
  for (const [id, item] of Object.entries(store.refreshTokens)) if (item.expiresAt <= now) delete store.refreshTokens[id];
  const activeFamilies = new Set(Object.values(store.refreshTokens).map((item) => item.familyId));
  for (const family of Object.keys(store.revokedFamilies)) if (!activeFamilies.has(family)) delete store.revokedFamilies[family];
}

async function acquireStoreLock(config: AuthConfig) {
  await mkdir(config.storeDir, { recursive: true, mode: 0o700 });
  await chmod(config.storeDir, 0o700);
  const lockPath = path.join(config.storeDir, "chatgpt-oauth.lock");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}:${Date.now()}`);
      return async () => { await handle.close(); await unlink(lockPath).catch(() => undefined); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 30_000) await unlink(lockPath).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new ChatGPTAuthError(503, "OAUTH_STORE_BUSY", "La autenticación está ocupada; vuelve a intentar.");
}

async function withStore<T>(config: AuthConfig, update: (store: AuthStore) => Promise<T> | T): Promise<T> {
  const release = await acquireStoreLock(config);
  try {
    const storePath = path.join(config.storeDir, "chatgpt-oauth.json");
    let store = emptyStore();
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8")) as AuthStore;
      if (parsed?.version === 1) store = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ChatGPTAuthError(503, "OAUTH_STORE_INVALID", "No se pudo leer el almacén de autenticación.");
    }
    cleanStore(store);
    const result = await update(store);
    const temporary = path.join(config.storeDir, `.chatgpt-oauth.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(temporary, `${JSON.stringify(store)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, storePath);
    return result;
  } finally {
    await release();
  }
}

function sessionCookie(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("session_id="))?.slice("session_id=".length) ?? "";
  if (!raw || raw.length > 512 || /[\s;\r\n]/.test(raw)) throw new ChatGPTAuthError(401, "ODOO_LOGIN_REQUIRED", "Inicia sesión en Odoo para continuar.");
  return raw;
}

function rotatedSession(response: Response, current: string): string {
  // Only accept the native cookie from our fixed, trusted Odoo origin.
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = /(?:^|,\s*)session_id=([A-Za-z0-9_-]{1,512})(?:;|$)/.exec(cookie);
  return match?.[1] ?? current;
}

function browserRotation(response: Response, before: string, after: string, config: AuthConfig): Response {
  if (before !== after) response.headers.append("Set-Cookie", `session_id=${after}; Path=/; HttpOnly; SameSite=Lax${config.issuer.startsWith("https:") ? "; Secure" : ""}`);
  return response;
}

async function odooSession(config: AuthConfig, sessionId: string): Promise<{ uid: number; name: string; sessionId: string }> {
  const headers = { Cookie: `session_id=${sessionId}` };
  let gate: Response;
  try {
    gate = await fetch(`${config.odooBase}/caf/finanzas/workspace-auth`, {
      headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
  } catch { throw new ChatGPTAuthError(503, "ODOO_AUTH_UNAVAILABLE", "No se pudo verificar la sesión de Odoo."); }
  if (gate.status === 401 || (gate.status >= 300 && gate.status < 400)) throw new ChatGPTAuthError(401, "ODOO_LOGIN_REQUIRED", "Inicia sesión en Odoo para continuar.");
  if (gate.status === 403) throw new ChatGPTAuthError(403, "ODOO_ACCESS_DENIED", "Tu usuario de Odoo no tiene acceso a Finanzas.");
  if (gate.status !== 204) throw new ChatGPTAuthError(503, "ODOO_AUTH_UNAVAILABLE", "No se pudo verificar la sesión de Odoo.");
  sessionId = rotatedSession(gate, sessionId);
  headers.Cookie = `session_id=${sessionId}`;
  let response: Response;
  try {
    response = await fetch(`${config.odooBase}/web/session/get_session_info`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {}, id: null }),
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
  } catch { throw new ChatGPTAuthError(503, "ODOO_AUTH_UNAVAILABLE", "No se pudo resolver la identidad de Odoo."); }
  if (!response.ok) throw new ChatGPTAuthError(response.status === 401 ? 401 : 503, response.status === 401 ? "ODOO_LOGIN_REQUIRED" : "ODOO_AUTH_UNAVAILABLE", "No se pudo resolver la identidad de Odoo.");
  const body = await response.json().catch(() => null) as { result?: Record<string, unknown> } | null;
  const uid = body?.result?.uid;
  const database = body?.result?.db;
  const label = body?.result?.name ?? body?.result?.username ?? body?.result?.login;
  if (!Number.isInteger(uid) || typeof label !== "string" || !label.trim() || typeof database !== "string" || !config.allowedOdooDatabases.has(database)) {
    throw new ChatGPTAuthError(503, "ODOO_IDENTITY_INVALID", "Odoo no devolvió una identidad válida para la base permitida.");
  }
  return { uid: uid as number, name: label.trim(), sessionId: rotatedSession(response, sessionId) };
}

type OdooIdentity = Awaited<ReturnType<typeof odooSession>>;

async function dedicatedOdooSession(config: AuthConfig, actor: OdooIdentity) {
  const endpoint = `${config.odooBase}/caf/finanzas/mcp/session`;
  let sessionId = actor.sessionId;
  try {
    const context = await fetch(endpoint, { headers: { Cookie: `session_id=${sessionId}` }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!context.ok) throw new Error("Native grant unavailable");
    sessionId = rotatedSession(context, sessionId);
    const info = await context.json();
    if (info.uid !== actor.uid || !config.allowedOdooDatabases.has(info.db) || typeof info.csrfToken !== "string") throw new Error("Native identity mismatch");
    const response = await fetch(endpoint, {
      method: "POST", headers: { Cookie: `session_id=${sessionId}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf_token: info.csrfToken }), cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Native grant unavailable");
    const grant = await response.json();
    if (grant.uid !== actor.uid || !config.allowedOdooDatabases.has(grant.db) || grant.dedicated !== true
        || typeof grant.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(grant.sessionId)
        || !Number.isFinite(grant.maxInactivitySeconds) || grant.maxInactivitySeconds <= 0) throw new Error("Native grant invalid");
    return { ...actor, sessionId: grant.sessionId, dedicatedSession: true,
      sessionMaxInactivityMs: Math.min(REFRESH_TOKEN_TTL_MS, grant.maxInactivitySeconds * 1000) };
  } catch {
    throw new ChatGPTAuthError(503, "ODOO_AUTH_UNAVAILABLE", "No se pudo conservar la autorización de Odoo. Vuelve a intentar.");
  }
}

async function currentTokenSession(config: AuthConfig, source: TokenSubject & { hash?: string }): Promise<TokenSubject & OdooIdentity> {
  const oldSession = unseal(source.sessionCiphertext, config.encryptionKey);
  const checked = await odooSession(config, oldSession);
  if (checked.uid !== source.odooUid) throw new ChatGPTAuthError(401, "ODOO_IDENTITY_CHANGED", "La identidad de Odoo cambió.");
  const actor = source.dedicatedSession ? { ...checked, dedicatedSession: true, sessionMaxInactivityMs: source.sessionMaxInactivityMs }
    : await dedicatedOdooSession(config, checked);
  if (source.dedicatedSession && actor.sessionId === oldSession) return { ...source, ...actor };
  // CAS: concurrent validation of an older cookie must not overwrite a newer
  // rotation or an already migrated grant. No network calls inside the lock.
  const resolved = await withStore(config, (store) => {
    const records = [...Object.values(store.accessTokens), ...Object.values(store.refreshTokens)];
    const current = source.hash ? store.accessTokens[source.hash] ?? store.refreshTokens[source.hash] : undefined;
    if (current && current.sessionCiphertext !== source.sessionCiphertext) {
      return { ...current, ...checked, sessionId: unseal(current.sessionCiphertext, config.encryptionKey) };
    }
    const matched = records.filter((record) => record.odooUid === source.odooUid && record.sessionCiphertext === source.sessionCiphertext);
    const ciphertext = seal(actor.sessionId, config.encryptionKey);
    for (const record of matched) {
      record.sessionCiphertext = ciphertext;
      record.dedicatedSession = actor.dedicatedSession;
      record.sessionMaxInactivityMs = actor.sessionMaxInactivityMs;
    }
    return { ...source, ...actor, sessionCiphertext: ciphertext };
  });
  return resolved;
}

function profileId(config: AuthConfig, uid: number): string {
  const database = [...config.allowedOdooDatabases][0];
  return `caf_${createHmac("sha256", config.profileKey).update(`odoo:${database}:${uid}`).digest("base64url")}`;
}

function parseScopes(raw: string | null): FinanceScope[] {
  const scopes = [...new Set((raw || "finance.read").split(/\s+/).filter(Boolean))];
  if (!scopes.length || !scopes.includes("finance.read") || scopes.some((scope) => !KNOWN_SCOPES.has(scope as FinanceScope))) {
    throw new ChatGPTAuthError(400, "INVALID_SCOPE", "Los permisos solicitados no son válidos.");
  }
  return scopes as FinanceScope[];
}

function validateAuthorizationRequest(request: Request, config: AuthConfig) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const resource = url.searchParams.get("resource") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  if (url.searchParams.get("response_type") !== "code") throw new ChatGPTAuthError(400, "UNSUPPORTED_RESPONSE_TYPE", "Solo se admite response_type=code.");
  if (!config.allowedClientIds.has(clientId)) throw new ChatGPTAuthError(400, "INVALID_CLIENT", "Cliente OAuth no autorizado.");
  if (!config.allowedRedirectUris.has(redirectUri)) throw new ChatGPTAuthError(400, "INVALID_REDIRECT_URI", "Callback OAuth no autorizado.");
  if (!safeEqual(resource, config.resource)) throw new ChatGPTAuthError(400, "INVALID_RESOURCE", "El recurso OAuth no coincide.");
  if (!state || state.length > 2048) throw new ChatGPTAuthError(400, "INVALID_REQUEST", "Falta state válido.");
  if (url.searchParams.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw new ChatGPTAuthError(400, "INVALID_REQUEST", "Se requiere PKCE S256.");
  }
  return { clientId, redirectUri, resource, state, codeChallenge, scopes: parseScopes(url.searchParams.get("scope")) };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function oauthRedirect(config: AuthConfig, transaction: Pick<AuthorizationTransaction, "redirectUri" | "state">, values: Record<string, string>): Response {
  const location = new URL(transaction.redirectUri);
  for (const [key, value] of Object.entries({ ...values, state: transaction.state, iss: config.issuer })) location.searchParams.set(key, value);
  return new Response(null, { status: 303, headers: { Location: location.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

function odooLoginUrl(request: Request, config: AuthConfig): URL {
  const requested = new URL(request.url);
  const authorize = new URL(`${config.issuer}/api/chatgpt/oauth/authorize`);
  authorize.search = requested.search;
  const login = new URL("/web/login", config.issuer);
  login.searchParams.set("redirect", `${authorize.pathname}${authorize.search}`);
  return login;
}

function odooLoginRedirect(request: Request, config: AuthConfig): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: odooLoginUrl(request, config).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function odooSwitchAccountUrl(request: Request, config: AuthConfig): string {
  const login = odooLoginUrl(request, config);
  const logout = new URL("/web/session/logout", config.issuer);
  logout.searchParams.set("redirect", `${login.pathname}${login.search}`);
  return logout.toString();
}

export async function beginAuthorization(request: Request): Promise<Response> {
  const config = authConfig();
  const input = validateAuthorizationRequest(request, config);
  let sessionId: string;
  let actor: OdooIdentity;
  try {
    sessionId = sessionCookie(request);
    actor = await odooSession(config, sessionId);
  } catch (error) {
    if (error instanceof ChatGPTAuthError && error.code === "ODOO_LOGIN_REQUIRED") return odooLoginRedirect(request, config);
    throw error;
  }
  if (process.env.CHATGPT_SANDBOX === "true" && labSnapshotConfigured()) {
    const manifest = await readLabSnapshotManifest();
    if (manifest.odooUid !== actor.uid || manifest.profileId !== profileId(config, actor.uid)) {
      const switchAccountUrl = odooSwitchAccountUrl(request, config);
      return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cambiar cuenta de Odoo</title><style>:root{color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f3eb;color:#24332e;font:16px/1.5 system-ui,sans-serif}main{width:min(100%,42rem);padding:32px;background:#fffdf8;border:1px solid #ddd2c4;border-radius:16px;box-shadow:0 18px 55px rgba(64,51,33,.12)}h1{line-height:1.2}strong{color:#17605a}a{display:inline-block;margin-top:14px;padding:12px 18px;border-radius:9px;background:#17605a;color:white;font-weight:750}small{display:block;margin-top:16px;color:#5e6c66}</style></head><body><main><h1>Esta cuenta no tiene acceso a la copia de pruebas</h1><p>Odoo tiene abierta la cuenta <strong>${escapeHtml(actor.name)}</strong>. Los cálculos cargados en este laboratorio corresponden a otra cuenta autorizada.</p><a href="${escapeHtml(switchAccountUrl)}">Cambiar cuenta de Odoo</a><small>Esto cerrará tu sesión actual de Odoo en este navegador y abrirá el inicio de sesión. No se activó la conexión de ChatGPT.</small></main></body></html>`, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        },
      });
    }
  }
  const browserSession = sessionId;
  sessionId = actor.sessionId;
  const transactionId = opaque("caf_tx_");
  const csrf = opaque("caf_csrf_");
  const transaction: AuthorizationTransaction = {
    id: transactionId, ...input, csrfHash: sha256(csrf),
    sessionCiphertext: seal(sessionId, config.encryptionKey), odooUid: actor.uid, name: actor.name,
    profileId: profileId(config, actor.uid), expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
  };
  await withStore(config, (store) => { store.transactions[transactionId] = transaction; });
  const scopeText = (input.scopes.includes("finance.write") ? "consultar y modificar cálculos autorizados" : "consultar cálculos autorizados")
    + (process.env.CHATGPT_SANDBOX === "true" ? " en una copia de pruebas independiente. Los cambios no se aplican a Finanzas en producción" : "");
  const switchAccountUrl = odooSwitchAccountUrl(request, config);
  return browserRotation(new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar Finanzas CAF</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f3eb;color:#24332e;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(100%,42rem);padding:clamp(24px,5vw,42px);background:#fffdf8;border:1px solid #ddd2c4;border-radius:16px;box-shadow:0 18px 55px rgba(64,51,33,.12)}.eyebrow{margin:0 0 8px;color:#17605a;font-size:.78rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:0 0 22px;font-size:clamp(1.65rem,5vw,2.35rem);line-height:1.15}.account{display:grid;gap:3px;margin:0 0 18px;padding:14px 16px;background:#eef5f1;border:1px solid #cadfd5;border-radius:10px}.account span{color:#5e6c66;font-size:.82rem}.account strong{font-size:1.05rem}.scope{margin:0;color:#4e554f}form{display:flex;gap:10px;margin-top:28px}button{min-height:44px;padding:10px 18px;border-radius:9px;border:1px solid transparent;font:inherit;font-weight:750;cursor:pointer}button[value=approve]{background:#17605a;color:#fff;box-shadow:0 7px 18px rgba(23,96,90,.2)}button[value=approve]:hover{background:#104f4a}button[value=deny]{background:#fff7ea;color:#875817;border-color:#ddb878}button:focus-visible{outline:3px solid #d78a2b;outline-offset:2px}.switch{margin:18px 0 0}.switch a{color:#17605a;font-weight:750}.switch small{display:block;margin-top:5px;color:#5e6c66;line-height:1.4}@media(max-width:480px){body{padding:14px}main{padding:24px 20px}form{flex-direction:column}button{width:100%}}</style></head><body><main><p class="eyebrow">CAF · Finanzas</p><h1>Autorizar Finanzas CAF</h1><p class="account"><span>Cuenta Odoo</span><strong>${escapeHtml(actor.name)}</strong></p><p class="scope">ChatGPT podrá ${scopeText}. Odoo volverá a comprobar tus permisos en cada cálculo.</p><form method="post"><input type="hidden" name="transaction_id" value="${escapeHtml(transactionId)}"><input type="hidden" name="csrf_token" value="${escapeHtml(csrf)}"><button name="decision" value="approve" type="submit">Autorizar</button><button name="decision" value="deny" type="submit">Cancelar</button></form><p class="switch"><a class="switch-account" href="${escapeHtml(switchAccountUrl)}">Cambiar cuenta de Odoo</a><small>Se cerrará tu sesión actual de Odoo en este navegador y podrás entrar con otra cuenta.</small></p></main></body></html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  }), browserSession, actor.sessionId, config);
}

export async function completeAuthorization(request: Request): Promise<Response> {
  const config = authConfig();
  const form = await request.formData();
  const transactionId = String(form.get("transaction_id") ?? "");
  const csrf = String(form.get("csrf_token") ?? "");
  const decision = String(form.get("decision") ?? "");
  const transaction = await withStore(config, (store) => store.transactions[transactionId]);
  if (!transaction || transaction.expiresAt <= Date.now() || !safeEqual(transaction.csrfHash, sha256(csrf))) {
    throw new ChatGPTAuthError(400, "INVALID_AUTHORIZATION", "La autorización venció o no es válida.");
  }
  const browserSession = sessionCookie(request);
  const storedSession = unseal(transaction.sessionCiphertext, config.encryptionKey);
  if (!safeEqual(browserSession, storedSession)) throw new ChatGPTAuthError(401, "ODOO_LOGIN_REQUIRED", "La sesión de Odoo cambió; inicia de nuevo.");
  const actor = await odooSession(config, browserSession);
  if (actor.uid !== transaction.odooUid) throw new ChatGPTAuthError(401, "ODOO_IDENTITY_CHANGED", "La identidad de Odoo cambió; inicia de nuevo.");
  if (decision !== "approve") {
    await withStore(config, (store) => { delete store.transactions[transactionId]; });
    return oauthRedirect(config, transaction, { error: "access_denied", error_description: "La persona canceló la autorización." });
  }
  if (process.env.CHATGPT_SANDBOX === "true" && labSnapshotConfigured()) {
    const manifest = await readLabSnapshotManifest();
    if (manifest.odooUid !== actor.uid || manifest.profileId !== transaction.profileId) {
      throw new ChatGPTAuthError(403, "LAB_ACCOUNT_CHANGED", "La cuenta autorizada para esta copia cambió; inicia de nuevo.");
    }
  }
  const grant = await dedicatedOdooSession(config, actor);
  const code = opaque("caf_ac_");
  const codeRecord: AuthorizationCode = {
    hash: sha256(code), clientId: transaction.clientId, redirectUri: transaction.redirectUri,
    resource: transaction.resource, scopes: transaction.scopes, codeChallenge: transaction.codeChallenge,
    sessionCiphertext: seal(grant.sessionId, config.encryptionKey), dedicatedSession: true,
    sessionMaxInactivityMs: grant.sessionMaxInactivityMs, odooUid: transaction.odooUid, name: actor.name,
    profileId: transaction.profileId, expiresAt: Date.now() + CODE_TTL_MS,
  };
  await withStore(config, (store) => {
    if (!store.transactions[transactionId]) throw new ChatGPTAuthError(409, "AUTHORIZATION_ALREADY_USED", "La autorización ya fue usada.");
    delete store.transactions[transactionId];
    store.codes[codeRecord.hash] = codeRecord;
  });
  return browserRotation(oauthRedirect(config, transaction, { code }), browserSession, actor.sessionId, config);
}

function issueTokens(source: TokenSubject, familyId = opaque("caf_fam_")) {
  const accessToken = opaque("caf_at_");
  const refreshToken = opaque("caf_rt_");
  const now = Date.now();
  const common = { ...source, familyId };
  return {
    accessToken, refreshToken,
    accessRecord: { ...common, hash: sha256(accessToken), expiresAt: now + ACCESS_TOKEN_TTL_MS } satisfies AccessTokenRecord,
    refreshRecord: { ...common, hash: sha256(refreshToken), expiresAt: now + Math.min(REFRESH_TOKEN_TTL_MS, source.sessionMaxInactivityMs ?? REFRESH_TOKEN_TTL_MS), status: "active" } satisfies RefreshTokenRecord,
  };
}

function tokenResponse(tokens: ReturnType<typeof issueTokens>): Response {
  return Response.json({
    access_token: tokens.accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: tokens.refreshToken, scope: tokens.accessRecord.scopes.join(" "), resource: tokens.accessRecord.resource,
  }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

export async function exchangeToken(request: Request): Promise<Response> {
  const config = authConfig();
  if (request.headers.has("authorization")) throw new ChatGPTAuthError(400, "INVALID_CLIENT", "Este cliente público usa PKCE sin secreto.");
  const form = await request.formData();
  const grantType = String(form.get("grant_type") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const resource = String(form.get("resource") ?? "");
  if (!config.allowedClientIds.has(clientId)) throw new ChatGPTAuthError(400, "INVALID_CLIENT", "Cliente OAuth no autorizado.");
  if (!safeEqual(resource, config.resource)) throw new ChatGPTAuthError(400, "INVALID_RESOURCE", "El recurso OAuth no coincide.");
  if (grantType === "authorization_code") {
    const codeHash = sha256(String(form.get("code") ?? ""));
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    const record = await withStore(config, (store) => {
      const found = store.codes[codeHash];
      if (found) delete store.codes[codeHash];
      return found;
    });
    if (!record || record.expiresAt <= Date.now()) throw new ChatGPTAuthError(400, "INVALID_GRANT", "El código no es válido o ya fue usado.");
    if (record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(sha256(verifier), record.codeChallenge)) {
      throw new ChatGPTAuthError(400, "INVALID_GRANT", "El código, callback o PKCE no coincide.");
    }
    const sessionId = unseal(record.sessionCiphertext, config.encryptionKey);
    const actor = await odooSession(config, sessionId);
    if (actor.uid !== record.odooUid) throw new ChatGPTAuthError(400, "INVALID_GRANT", "La identidad de Odoo cambió.");
    const tokens = issueTokens({
      clientId, resource, scopes: record.scopes, sessionCiphertext: seal(actor.sessionId, config.encryptionKey),
      dedicatedSession: record.dedicatedSession, sessionMaxInactivityMs: record.sessionMaxInactivityMs,
      odooUid: record.odooUid, name: actor.name, profileId: record.profileId,
    });
    await withStore(config, (store) => {
      store.accessTokens[tokens.accessRecord.hash] = tokens.accessRecord;
      store.refreshTokens[tokens.refreshRecord.hash] = tokens.refreshRecord;
    });
    return tokenResponse(tokens);
  }
  if (grantType === "refresh_token") {
    const refreshHash = sha256(String(form.get("refresh_token") ?? ""));
    const requestedScope = form.get("scope") === null ? null : parseScopes(String(form.get("scope")));
    const record = await withStore(config, (store) => {
      const found = store.refreshTokens[refreshHash];
      if (!found || found.clientId !== clientId || found.resource !== resource || store.revokedFamilies[found.familyId]) return undefined;
      if (found.status !== "active") {
        store.revokedFamilies[found.familyId] = Date.now();
        found.status = "revoked";
        return undefined;
      }
      return { ...found };
    });
    if (!record) throw new ChatGPTAuthError(400, "INVALID_GRANT", "El refresh token no es válido.");
    const scopes = requestedScope ?? record.scopes;
    if (scopes.some((scope) => !record.scopes.includes(scope))) throw new ChatGPTAuthError(400, "INVALID_SCOPE", "El refresh no puede ampliar permisos.");
    // Verify the dependency before consuming the token. A timeout/503 leaves
    // it retryable; only a successful atomic rotation consumes it.
    const subject = await currentTokenSession(config, record);
    const tokens = issueTokens({ ...subject, scopes }, record.familyId);
    const committed = await withStore(config, (store) => {
      const current = store.refreshTokens[refreshHash];
      if (!current || current.clientId !== clientId || current.resource !== resource || store.revokedFamilies[record.familyId]) return false;
      if (current.status !== "active") {
        store.revokedFamilies[record.familyId] = Date.now();
        current.status = "revoked";
        return false;
      }
      current.status = "used";
      for (const refresh of Object.values(store.refreshTokens)) {
        if (refresh.familyId === record.familyId && refresh.status === "used") refresh.expiresAt = Math.max(refresh.expiresAt, tokens.refreshRecord.expiresAt);
      }
      store.accessTokens[tokens.accessRecord.hash] = tokens.accessRecord;
      store.refreshTokens[tokens.refreshRecord.hash] = tokens.refreshRecord;
      return true;
    });
    if (!committed) throw new ChatGPTAuthError(400, "INVALID_GRANT", "La familia de tokens fue revocada.");
    return tokenResponse(tokens);
  }
  throw new ChatGPTAuthError(400, "UNSUPPORTED_GRANT_TYPE", "Grant OAuth no soportado.");
}

export async function revokeToken(request: Request): Promise<Response> {
  const config = authConfig();
  const form = await request.formData();
  const clientId = String(form.get("client_id") ?? "");
  const hash = sha256(String(form.get("token") ?? ""));
  if (!config.allowedClientIds.has(clientId)) throw new ChatGPTAuthError(400, "INVALID_CLIENT", "Cliente OAuth no autorizado.");
  await withStore(config, (store) => {
    const access = store.accessTokens[hash];
    if (access?.clientId === clientId) access.revokedAt = Date.now();
    const refresh = store.refreshTokens[hash];
    if (refresh?.clientId === clientId) {
      refresh.status = "revoked";
      store.revokedFamilies[refresh.familyId] = Date.now();
    }
  });
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

function bearer(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match || match[1].length > 512) throw invalidToken("Falta una credencial válida.");
  return match[1];
}

function challenge(config: AuthConfig, error: string, description: string, scope?: FinanceScope): string {
  // OAuth challenge headers must remain ASCII for strict HTTP clients.
  description = description.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  const escaped = (value: string) => value.replace(/["\\]/g, "");
  return `Bearer resource_metadata="${escaped(config.metadataUrl)}", error="${escaped(error)}", error_description="${escaped(description)}"${scope ? `, scope="${scope}"` : ""}`;
}

function invalidToken(message: string): ChatGPTAuthError {
  let authChallenge: string | undefined;
  try { authChallenge = challenge(authConfig(), "invalid_token", message); } catch { authChallenge = undefined; }
  return new ChatGPTAuthError(401, "INVALID_TOKEN", message, authChallenge);
}

export async function authenticateChatGPT(request: Request, requiredScope: FinanceScope = "finance.read"): Promise<ChatGPTActor> {
  const config = authConfig();
  const record = await withStore(config, (store) => store.accessTokens[sha256(bearer(request))]);
  if (!record || record.expiresAt <= Date.now() || record.revokedAt || record.resource !== config.resource || record.clientId === "" || record.familyId === "") {
    throw invalidToken("La credencial venció o fue revocada.");
  }
  const revoked = await withStore(config, (store) => Boolean(store.revokedFamilies[record.familyId]));
  if (revoked) throw invalidToken("La credencial fue revocada.");
  if (!record.scopes.includes(requiredScope)) {
    throw new ChatGPTAuthError(403, "INSUFFICIENT_SCOPE", "La conexión no tiene el permiso requerido.", challenge(config, "insufficient_scope", "Falta el permiso requerido.", requiredScope));
  }
  let actor: TokenSubject & OdooIdentity;
  try { actor = await currentTokenSession(config, record); }
  catch (error) {
    if (error instanceof ChatGPTAuthError && ["ODOO_LOGIN_REQUIRED", "ODOO_IDENTITY_CHANGED"].includes(error.code)) {
      throw invalidToken("La sesión de Odoo venció o cambió. Vuelve a conectar Finanzas CAF.");
    }
    throw error;
  }
  const stillActive = await withStore(config, (store) => {
    const current = store.accessTokens[record.hash];
    return current && !current.revokedAt && current.expiresAt > Date.now() && !store.revokedFamilies[record.familyId];
  });
  if (!stillActive) throw invalidToken("La credencial fue revocada.");
  return { id: record.profileId, name: actor.name, odooUid: record.odooUid, sessionId: actor.sessionId, scopes: new Set(record.scopes) };
}

type LabSnapshotManifest = {
  version: number; profileId: string; odooUid: number; projectCount: number; calculationIds: string[];
};

function labSnapshotConfigured(): boolean {
  return Boolean(process.env.CHATGPT_LAB_SNAPSHOT_MANIFEST_PATH || process.env.CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256);
}

async function readLabSnapshotManifest(): Promise<LabSnapshotManifest> {
  const manifestPath = process.env.CHATGPT_LAB_SNAPSHOT_MANIFEST_PATH;
  const expectedHash = process.env.CHATGPT_LAB_SNAPSHOT_MANIFEST_SHA256;
  if (!manifestPath || !path.isAbsolute(manifestPath) || !/^[0-9a-f]{64}$/.test(expectedHash ?? "")) {
    throw new ChatGPTAuthError(404, "CALCULATION_NOT_AVAILABLE", "Cálculo no disponible.");
  }
  try {
    const raw = await readFile(manifestPath, "utf8");
    if (!safeEqual(createHash("sha256").update(raw).digest("hex"), expectedHash!)) throw new Error("Manifest hash mismatch");
    const manifest = JSON.parse(raw) as Partial<LabSnapshotManifest>;
    if (manifest.version !== 1 || typeof manifest.profileId !== "string" || !manifest.profileId
        || !Number.isInteger(manifest.odooUid) || !Array.isArray(manifest.calculationIds)
        || manifest.projectCount !== manifest.calculationIds.length
        || manifest.calculationIds.length < 1 || manifest.calculationIds.length > 5000
        || new Set(manifest.calculationIds).size !== manifest.calculationIds.length
        || !manifest.calculationIds.every((id) => typeof id === "string" && CALCULATION_ID.test(id))) {
      throw new Error("Invalid manifest");
    }
    return manifest as LabSnapshotManifest;
  } catch {
    throw new ChatGPTAuthError(503, "LAB_SNAPSHOT_UNAVAILABLE", "La autorización de la copia de pruebas no está disponible.");
  }
}

export async function assertCalculationAccess(actor: ChatGPTActor, project: CalculationAccessSubject, write: boolean): Promise<void> {
  const config = authConfig();
  if (write && !actor.scopes.has("finance.write")) throw new ChatGPTAuthError(403, "INSUFFICIENT_SCOPE", "La conexión no permite modificar cálculos.", challenge(config, "insufficient_scope", "Falta finance.write.", "finance.write"));
  // El laboratorio sintético no tiene ofertas Odoo. El token sigue ligado a una
  // sesión Odoo real, pero la autorización del fixture se limita a identidad y
  // UUID exactos configurados fuera del almacén financiero mutable.
  if (project.sourceSystem === "caf_chatgpt_synthetic") {
    const allowedProfiles = csv("CHATGPT_SYNTHETIC_ALLOWED_PROFILE_IDS");
    const allowedCalculations = new Set(csv("CHATGPT_SYNTHETIC_CALCULATION_IDS"));
    if (process.env.CHATGPT_SANDBOX !== "true"
      || allowedProfiles.length !== 1 || allowedProfiles[0] !== actor.id
      || allowedCalculations.size !== 4 || !allowedCalculations.has(project.id)
      || !CALCULATION_ID.test(project.id)
      || project.odooProjectId !== null || project.odooDb !== null
      || project.externalId !== `caf-chatgpt-synthetic:${project.id}`) {
      throw new ChatGPTAuthError(404, "CALCULATION_NOT_AVAILABLE", "Cálculo no disponible.");
    }
    return;
  }
  // A snapshot imported into the isolated laboratory is authorized only for
  // the connected Odoo identity and exact IDs in a read-only, hashed manifest.
  // It never uses live Odoo project-write permissions or callback credentials.
  if (process.env.CHATGPT_SANDBOX === "true") {
    const manifest = await readLabSnapshotManifest();
    if (!CALCULATION_ID.test(project.id) || !manifest.calculationIds.includes(project.id)
        || manifest.profileId !== actor.id || manifest.odooUid !== actor.odooUid
        || project.odooCallbackUrl !== null) {
      throw new ChatGPTAuthError(404, "CALCULATION_NOT_AVAILABLE", "Cálculo no disponible.");
    }
    return;
  }
  if (!CALCULATION_ID.test(project.id) || !project.odooProjectId || !project.odooDb || !config.allowedOdooDatabases.has(project.odooDb)) {
    throw new ChatGPTAuthError(404, "CALCULATION_NOT_AVAILABLE", "Cálculo no disponible.");
  }
  let response: Response;
  try {
    response = await fetch(`${config.odooBase}/caf/finanzas/calculations/${encodeURIComponent(project.id)}/cost-version-auth`, {
      headers: { Cookie: `session_id=${actor.sessionId}`, "X-Odoo-Database": project.odooDb },
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new ChatGPTAuthError(503, "ODOO_AUTH_UNAVAILABLE", "No se pudo comprobar el permiso del cálculo."); }
  if (response.status === 204) {
    const renewed = rotatedSession(response, actor.sessionId);
    if (renewed !== actor.sessionId) {
      const old = actor.sessionId;
      await withStore(config, (store) => {
        const encrypted = seal(renewed, config.encryptionKey);
        for (const record of [...Object.values(store.accessTokens), ...Object.values(store.refreshTokens)]) {
          if (record.odooUid === actor.odooUid && unseal(record.sessionCiphertext, config.encryptionKey) === old) record.sessionCiphertext = encrypted;
        }
      });
      actor.sessionId = renewed;
    }
    return;
  }
  if (response.status === 401 || (response.status >= 300 && response.status < 400)) throw invalidToken("La sesión de Odoo venció.");
  if (response.status === 403 || response.status === 404) throw new ChatGPTAuthError(404, "CALCULATION_NOT_AVAILABLE", "Cálculo no disponible.");
  throw new ChatGPTAuthError(503, "ODOO_AUTH_UNAVAILABLE", "No se pudo comprobar el permiso del cálculo.");
}

export function authErrorResponse(error: unknown): Response {
  const known = error instanceof ChatGPTAuthError ? error : new ChatGPTAuthError(503, "AUTH_UNAVAILABLE", "La autenticación no está disponible.");
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  if (known.challenge) headers.set("WWW-Authenticate", known.challenge);
  const body: Record<string, unknown> = { error: known.code.toLowerCase(), error_description: known.message };
  if (known.challenge) body._meta = { "mcp/www_authenticate": [known.challenge] };
  return new Response(JSON.stringify(body), { status: known.status, headers });
}

export function protectedResourceMetadata() {
  const config = authConfig();
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ["finance.read", "finance.write"] satisfies FinanceScope[],
  };
}

export function authorizationServerMetadata(): Record<string, unknown> {
  const config = authConfig();
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/api/chatgpt/oauth/authorize`,
    token_endpoint: `${config.issuer}/api/chatgpt/oauth/token`,
    revocation_endpoint: `${config.issuer}/api/chatgpt/oauth/revoke`,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["finance.read", "finance.write"],
  };
}
