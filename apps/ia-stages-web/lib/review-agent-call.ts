import { callGemini } from "@/lib/gemini";
import type { GeminiRuntimeConfig } from "@/lib/config";

/**
 * Invoca el mismo proveedor/modelo/API key que configuración «agente reparación»
 * (REVIEW_PROVIDER + REVIEW_MODEL + GEMINI_API_KEY / DEEPSEEK_API_KEY).
 * Sin esto, callGemini solo con model: resolvía otra clave vía getGeminiRuntimeConfig.
 */
export async function callReviewAgentGemini(prompt: string, cfg: GeminiRuntimeConfig) {
  return callGemini({
    prompt,
    model: `${cfg.provider}:${cfg.model}`,
    apiKey: cfg.apiKey
  });
}
