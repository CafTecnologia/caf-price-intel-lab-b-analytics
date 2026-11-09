import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/ai-error-catalog";

describe("classifyProviderError", () => {
  it("clasifica errores de modelo DeepSeek como modelo no disponible", () => {
    const message =
      "The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed deepseek-v4-flas.";

    expect(classifyProviderError(new Error(message))?.code).toBe("API_MODEL_NOT_FOUND");
  });

  it("distingue timeouts explicitos de fallos de conexion", () => {
    expect(classifyProviderError(new Error("Request timed out while waiting for provider"))?.code).toBe("API_TIMEOUT");
    expect(classifyProviderError(new Error("fetch failed"))?.code).toBe("API_CONNECTION_FAILED");
  });
});
