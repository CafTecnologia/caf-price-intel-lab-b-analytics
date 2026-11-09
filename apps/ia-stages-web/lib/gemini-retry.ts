import { classifyProviderError } from "@/lib/ai-error-catalog";

/** Backoff en ms entre intentos por congestión del proveedor (solo tras error calificado). */
export const GEMINI_CONGESTION_BACKOFF_MS = [3000, 8000] as const;

const EXPENSIVE_GEMINI_MODEL_IDS = new Set([
  "gemini-2.5-pro",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3-pro-preview",
  "gemini-3-pro-image-preview"
]);

function stripModelsPrefix(model: string) {
  return model.replace(/^models\//i, "").trim();
}

/**
 * Modelos con costo alto: menos reintentos automáticos para no multiplicar tokens en vano.
 * Retorna el número de **reintentos** permitidos después del primer fallo (0 = solo un intento).
 */
export function maxCongestionRetriesForGeminiModel(model: string): number {
  const id = stripModelsPrefix(model);
  return EXPENSIVE_GEMINI_MODEL_IDS.has(id) ? 1 : 2;
}

/**
 * Solo congestión / cuota clara del proveedor. No usar para errores genéricos o de validación.
 */
export function isGeminiCongestionError(error: unknown): boolean {
  const classified = classifyProviderError(error);
  if (classified?.code === "API_RATE_LIMITED" || classified?.code === "API_PROVIDER_UNAVAILABLE") {
    return true;
  }
  if (classified?.code === "API_PROVIDER_ERROR") {
    const msg = `${classified.technicalMessage}`.toLowerCase();
    if (
      msg.includes("high demand") ||
      msg.includes("spikes in demand") ||
      msg.includes("unavailable") ||
      msg.includes("resource exhausted") ||
      msg.includes("overloaded") ||
      msg.includes("503") ||
      msg.includes("429")
    ) {
      return true;
    }
  }
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  return (
    lower.includes("high demand") ||
    lower.includes("spikes in demand") ||
    lower.includes('"status":"unavailable"') ||
    lower.includes('"code":503') ||
    lower.includes('"code":429') ||
    lower.includes("resource exhausted")
  );
}

export function sleepMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
