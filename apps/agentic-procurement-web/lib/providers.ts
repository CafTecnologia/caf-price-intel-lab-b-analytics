import { centralConnection, centralResponse, centralText } from "./central-routing";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentTaskRequest, AgentTaskResponse, ProviderDefinition, ProviderId } from "./types";
import { credentialsFor } from "./odoo-ai-config";

const ALL_PROVIDERS: ProviderDefinition[] = [
  {
    id: "mock",
    label: "Simulador trazable",
    description: "Prueba el flujo completo sin consumir IA ni buscar en la web.",
    baseUrl: "internal://mock",
    transport: "internal",
    capabilities: ["Pruebas deterministas", "Errores controlados", "Respuesta inmediata"]
  },
  {
    id: "codex_pc",
    label: "Codex PC local",
    description: "Usa la sesion de Codex de este computador mediante el worker local.",
    baseUrl: process.env.CODEX_PC_WORKER_URL || "http://127.0.0.1:18731",
    transport: "http",
    capabilities: ["Archivos", "Razonamiento", "Busqueda web", "Ejecucion persistente"]
  },
  {
    id: "codex_vps",
    label: process.env.CODEX_VPS_LABEL || "Codex VPS DEV",
    description: process.env.CODEX_VPS_DESCRIPTION || "Worker Codex instalado en el VPS DEV; usa el mismo contrato del PC.",
    baseUrl: process.env.CODEX_VPS_WORKER_URL || "http://127.0.0.1:18735",
    transport: "http",
    capabilities: ["Ejecucion remota", "Razonamiento", "Logs persistentes", "Procesos largos"]
  },
  {
    id: "deepseek",
    label: process.env.DEEPSEEK_LABEL || "DeepSeek",
    description: "API directa de DeepSeek. No necesita worker local ni permisos de disco.",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    transport: "openai",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    capabilities: ["Razonamiento", "Contexto largo", "Sin worker local"]
  },
  {
    id: "openrouter",
    label: process.env.OPENROUTER_LABEL || "OpenRouter",
    description: "Pasarela OpenRouter: el modelo se elige por configuracion.",
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    transport: "openai",
    model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
    apiKeyEnv: "OPENROUTER_API_KEY",
    capabilities: ["Varios modelos", "Cambio de modelo por configuracion", "Sin worker local"]
  }
];

const enabledProviderIds = new Set(
  (process.env.ENABLED_AGENT_PROVIDERS || "mock,codex_pc,codex_vps,deepseek,openrouter")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

export const PROVIDERS = ALL_PROVIDERS.filter((entry) => enabledProviderIds.has(entry.id))
  .map(entry => centralConnection() && entry.transport !== "internal" ? {
    ...entry, label: "IA central · OpenAI con respaldo VPS",
    description: "Modelo y esfuerzo elegidos por tarea desde la política central de Odoo.",
    capabilities: ["Selección por tarea", "Respaldo VPS", "Consumo en IA"]
  } : entry);

function apiKeyFor(definition: ProviderDefinition) {
  return credentialsFor(definition.id).apiKey;
}

/** Modelo vigente: el configurado en Odoo manda sobre el del entorno. */
function modelFor(definition: ProviderDefinition) {
  return credentialsFor(definition.id).model || definition.model || "";
}

/** URL de la API: la configurada en Odoo manda sobre la del entorno. */
function baseUrlFor(definition: ProviderDefinition) {
  return credentialsFor(definition.id).baseUrl || definition.baseUrl;
}

/** De donde salio la credencial, para poder explicarlo sin exponerla. */
function credentialOrigin(definition: ProviderDefinition) {
  return credentialsFor(definition.id).origin;
}

/**
 * Salud de un proveedor de API directa. Distingue tres cosas que antes se
 * confundian en un unico "fetch failed": no hay credencial, la credencial fue
 * rechazada, o el servicio no responde.
 */
async function openAiHealth(definition: ProviderDefinition, checkedAt: string) {
  const key = apiKeyFor(definition);
  if (!key) {
    return {
      ok: false,
      status: "not_configured",
      error: `${definition.label} sin clave configurada en Odoo.`,
      service: definition.id,
      provider: definition,
      checkedAt,
      diagnostic: {
        code: "sin_credencial",
        title: "Falta la credencial",
        detail: `${definition.label} todavia no tiene clave configurada.`,
        userAction: "Cargala en Odoo, en Ajustes > CAF Integraciones > Proveedor de IA, y vuelve a abrir el apoyo IA desde la macrotarea."
      }
    };
  }
  try {
    const response = await fetch(`${baseUrlFor(definition)}/models`, {
      headers: { authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: "unauthorized",
        error: `Credencial rechazada (HTTP ${response.status}).`,
        service: definition.id,
        provider: definition,
        checkedAt,
        diagnostic: {
          code: "credencial_rechazada",
          title: "La credencial fue rechazada",
          detail: `${definition.label} respondio HTTP ${response.status}: la clave no es valida o no tiene permisos.`,
          userAction: "Corrige la clave en Odoo, en Ajustes > CAF Integraciones > Proveedor de IA."
        }
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: "unavailable",
        error: `El proveedor respondio HTTP ${response.status}.`,
        service: definition.id,
        provider: definition,
        checkedAt,
        diagnostic: {
          code: "servicio_con_error",
          title: "El proveedor respondio con error",
          detail: `${definition.label} respondio HTTP ${response.status}.`,
          userAction: "Reintenta en unos minutos o elige otro proveedor."
        }
      };
    }
    return {
      ok: true,
      status: "ready",
      error: undefined as string | undefined,
      service: definition.id,
      provider: definition,
      checkedAt,
      diagnostic: {
        code: "ready",
        title: "Disponible",
        detail: `${definition.label} responde. Modelo: ${modelFor(definition)}. Credencial tomada de: ${credentialOrigin(definition)}.`,
        userAction: ""
      }
    };
  } catch (error) {
    return {
      ok: false,
      status: "unreachable",
      error: error instanceof Error ? error.message : String(error),
      service: definition.id,
      provider: definition,
      checkedAt,
      diagnostic: {
        code: "sin_respuesta",
        title: "El proveedor no responde",
        detail: `No se pudo contactar ${baseUrlFor(definition)}: ${error instanceof Error ? error.message : String(error)}.`,
        userAction: "Comprueba la salida a internet del servidor o elige otro proveedor."
      }
    };
  }
}

export class ProviderTaskError extends Error {
  code: string;
  retryable: boolean;
  userAction: string;

  constructor(message: string, options?: { code?: string; retryable?: boolean; userAction?: string }) {
    super(message);
    this.name = "ProviderTaskError";
    this.code = options?.code || "provider_task_failed";
    this.retryable = options?.retryable !== false;
    this.userAction = options?.userAction || "";
  }
}

export function isNonRetryableProviderError(error: unknown): error is ProviderTaskError {
  return error instanceof ProviderTaskError && !error.retryable;
}

export function provider(id: ProviderId) {
  return PROVIDERS.find((entry) => entry.id === id) || PROVIDERS[0];
}

export async function providerHealth(id: ProviderId) {
  const definition = provider(id);
  const checkedAt = new Date().toISOString();
  const central = definition.transport !== "internal" ? centralConnection() : null;
  if (central) {
    try {
      const response = await fetch(central.url + "/status", {
        headers: { Authorization: "Bearer " + central.token, "X-Odoo-Database": central.controlDatabase, "X-CAF-Origin-Database": central.database },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000)
      });
      const body = response.ok ? await response.json() : {};
      const ok = body.configured === true;
      return { ok, status: ok ? "ready" : "not_configured", provider: definition, checkedAt,
        diagnostic: { code: ok ? "central_configured" : "central_unavailable",
          title: ok ? "Política central configurada" : "Revisar política central",
          detail: ok ? "El modelo se selecciona al ejecutar. El resultado y el consumo se registran en IA." :
            "No se confirmó una política activa para esta conexión.",
          userAction: ok ? "" : "Revise Consumo y delegación en Odoo.", recoverable: false } };
    } catch {
      return { ok: false, status: "offline", provider: definition, checkedAt,
        diagnostic: { code: "central_unavailable", title: "Sin conexión con la política central",
          detail: "No se pudo consultar la configuración de IA.", userAction: "Revise la conexión con Odoo.", recoverable: false } };
    }
  }
  if (definition.transport === "openai") return openAiHealth(definition, checkedAt);
  if (definition.transport === "internal") {
    return {
      ok: true,
      status: "ready",
      service: "caf-agent-mock",
      provider: definition,
      checkedAt,
      diagnostic: {
        code: "ready",
        title: "Disponible",
        detail: "El simulador interno está listo.",
        userAction: "",
        recoverable: false
      }
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${definition.baseUrl}/health`, { cache: "no-store", signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    const ok = response.ok && body?.ok !== false;
    return {
      ok,
      status: ok ? "ready" : "error",
      provider: definition,
      worker: body,
      checkedAt,
      diagnostic: ok
        ? {
            code: body?.status === "processing" ? "busy" : "ready",
            title: body?.status === "processing" ? "Procesando una tarea" : "Disponible",
            detail: body?.activeJobId ? `Trabajo activo: ${body.activeJobId}.` : "El worker respondió correctamente.",
            userAction: "",
            recoverable: false
          }
        : body?.diagnostic || {
            code: "worker_error",
            title: "El worker respondió con error",
            detail: `El puerto responde, pero el servicio devolvió HTTP ${response.status}.`,
            userAction: "Reinicia el proveedor y vuelve a comprobar.",
            recoverable: true
          }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isVps = id === "codex_vps";
    return {
      ok: false,
      status: "offline",
      provider: definition,
      error: message,
      checkedAt,
      diagnostic: {
        code: isVps ? "remote_provider_unavailable" : "local_worker_unavailable",
        title: isVps ? "Proveedor remoto desconectado" : "Worker local detenido",
        detail: isVps
          ? "La app no puede alcanzar el servicio remoto de Codex."
          : "La app no puede alcanzar el worker de Codex en el puerto local 18731.",
        userAction: isVps
          ? process.platform === "win32"
            ? "Pulsa Reconectar para restablecer la conexión remota."
            : "Pide al administrador reiniciar el proveedor remoto."
          : "Pulsa Iniciar para levantar el worker local.",
        recoverable: !isVps || process.platform === "win32"
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function recoverProvider(id: ProviderId) {
  if (id === "mock") return providerHealth(id);
  if (process.platform !== "win32") {
    return {
      ...(await providerHealth(id)),
      recovery: { attempted: false, error: "La recuperación automática solo está configurada en el host Windows actual." }
    };
  }
  const scriptName = id === "codex_vps" ? "start-vps-tunnel-hidden.vbs" : "start-local-provider-hidden.vbs";
  const script = path.join(process.cwd(), "scripts", scriptName);
  if (!fs.existsSync(script)) {
    return {
      ...(await providerHealth(id)),
      recovery: { attempted: false, error: `No se encontró ${scriptName}.` }
    };
  }
  const wscript = path.join(process.env.WINDIR || "C:\\Windows", "System32", "wscript.exe");
  const child = spawn(wscript, [script], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  let health = await providerHealth(id);
  for (let attempt = 1; attempt <= 12 && !health.ok; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    health = await providerHealth(id);
  }
  return {
    ...health,
    recovery: {
      attempted: true,
      ok: health.ok,
      action: id === "codex_vps" ? "restart_tunnel" : "start_worker",
      error: health.ok ? "" : "El proceso fue iniciado, pero el proveedor aún no responde. Revisa el detalle técnico."
    }
  };
}

export async function runProviderTask(id: ProviderId, request: AgentTaskRequest): Promise<AgentTaskResponse> {
  const definition = provider(id);
  if (definition.transport === "internal") {
    return {
      ok: true,
      contract: "caf-agent-provider/v1",
      jobId: request.jobId,
      status: "completed",
      stage: request.stage,
      rawResponse: JSON.stringify(request.mockResponse ?? {}, null, 2),
      summary: { engine: "mock", seconds: 0, characters: JSON.stringify(request.mockResponse ?? {}).length }
    };
  }
  if (centralConnection()) {
    const started = Date.now();
    const stage = request.routingTask || (["market", "supervision"].includes(request.stage) ? "agentic_market" :
      request.stage === "source" ? "document_catalog" : "agentic_extraction");
    const response = await centralResponse(stage, {
      input: request.prompt, max_output_tokens: 8192,
      ...(stage === "agentic_market" ? { tools: [{ type: "web_search" }] } : {})
    }, 600000);
    if (!response) throw new Error("Falta la política central.");
    const rawResponse = centralText(response);
    if (!rawResponse.trim()) throw new Error("La IA respondió sin contenido.");
    return { ok: true, contract: "caf-agent-provider/v1", jobId: request.jobId,
      status: "completed", stage: request.stage, rawResponse,
      summary: { engine: response.caf_routing?.provider + ":" + response.model + "/" + response.caf_routing?.effort,
        seconds: (Date.now() - started) / 1000, characters: rawResponse.length } };
  }
  if (definition.transport === "openai") {
    const key = apiKeyFor(definition);
    if (!key) {
      throw new Error(
        `${definition.label} no tiene clave configurada. Cargala en Odoo, en Ajustes > CAF Integraciones > Proveedor de IA.`
      );
    }
    const started = Date.now();
    let apiResponse: Response;
    try {
      apiResponse = await fetch(`${baseUrlFor(definition)}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: modelFor(definition),
          messages: [{ role: "user", content: request.prompt }],
          temperature: 0
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10 * 60 * 1000)
      });
    } catch (error) {
      throw new Error(
        `${definition.label} no respondio: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
    const payload = await apiResponse.text();
    if (!apiResponse.ok) {
      const motivo = apiResponse.status === 401 || apiResponse.status === 403
        ? `la credencial ${definition.apiKeyEnv} fue rechazada`
        : `respondio HTTP ${apiResponse.status}`;
      throw new Error(`${definition.label} ${motivo}. ${payload.slice(0, 300)}`);
    }
    let data: { choices?: Array<{ message?: { content?: string } }> } = {};
    try { data = JSON.parse(payload); } catch { throw new Error(`${definition.label} devolvio una respuesta ilegible.`); }
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) throw new Error(`${definition.label} respondio sin contenido.`);
    return {
      ok: true,
      contract: "caf-agent-provider/v1",
      jobId: request.jobId,
      status: "completed",
      stage: request.stage,
      rawResponse: content,
      summary: {
        engine: `${definition.id}:${modelFor(definition)}`,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        characters: content.length
      }
    };
  }
  const response = await fetch(`${definition.baseUrl}/agent/task`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, engine: "codex_exec" }),
    cache: "no-store",
    signal: AbortSignal.timeout(45 * 60 * 1000)
  });
  const text = await response.text();
  let body: Partial<AgentTaskResponse> = {};
  try { body = JSON.parse(text); } catch { body = { rawResponse: text }; }
  if (!response.ok || !body.ok) {
    throw new ProviderTaskError(
      body.error || `Proveedor ${definition.label} respondio HTTP ${response.status}.`,
      {
        code: body.code,
        retryable: body.retryable,
        userAction: body.userAction
      }
    );
  }
  return body as AgentTaskResponse;
}
