import fs from "node:fs";
import path from "node:path";
import { dataDirectory } from "./store";

export type OdooAiConfig = {
  provider?: string;
  deepseek?: { apiKey?: string; model?: string };
  openrouter?: { apiKey?: string; model?: string };
  updatedAt?: string;
};

function configPath() {
  return path.join(dataDirectory(), "ai-config.json");
}

/**
 * Configuracion del proveedor administrada desde Odoo.
 *
 * Se guarda del lado del servidor cuando alguien abre la app desde una
 * macrotarea. La clave nunca se envia al navegador: solo la usa el proceso que
 * llama a la API del proveedor.
 */
export function readOdooAiConfig(): OdooAiConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as OdooAiConfig;
  } catch {
    return {};
  }
}

export function saveOdooAiConfig(config: OdooAiConfig) {
  try {
    fs.mkdirSync(dataDirectory(), { recursive: true });
    const target = configPath();
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2), {
      mode: 0o600
    });
    fs.renameSync(temporary, target);
  } catch {
    // Que no se pueda cachear la configuracion no debe tumbar el lanzamiento.
  }
}

/** Credencial y modelo vigentes para un proveedor, con el entorno como respaldo. */
export function credentialsFor(providerId: string) {
  const config = readOdooAiConfig();
  const entry = (config as Record<string, unknown>)[providerId] as
    | { apiKey?: string; model?: string; baseUrl?: string }
    | undefined;
  const envKey = providerId === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENROUTER_API_KEY;
  const envModel = providerId === "deepseek" ? process.env.DEEPSEEK_MODEL : process.env.OPENROUTER_MODEL;
  return {
    apiKey: (entry?.apiKey || envKey || "").trim(),
    model: (entry?.model || envModel || "").trim(),
    baseUrl: (entry?.baseUrl || "").trim(),
    origin: entry?.apiKey ? "odoo" : envKey ? "entorno" : "sin configurar"
  };
}

/** Proveedor predeterminado: manda Odoo, luego el entorno. */
export function defaultProviderId() {
  return (readOdooAiConfig().provider || process.env.DEFAULT_AGENT_PROVIDER || "deepseek").trim();
}
