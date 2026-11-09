import { describe, expect, it } from "vitest";
import { isGeminiCongestionError, maxCongestionRetriesForGeminiModel } from "@/lib/gemini-retry";

describe("maxCongestionRetriesForGeminiModel", () => {
  it("permite más reintentos en modelos económicos", () => {
    expect(maxCongestionRetriesForGeminiModel("gemini-2.5-flash")).toBe(2);
    expect(maxCongestionRetriesForGeminiModel("gemini-2.5-flash-lite")).toBe(2);
  });

  it("limita reintentos en modelos caros", () => {
    expect(maxCongestionRetriesForGeminiModel("gemini-2.5-pro")).toBe(1);
    expect(maxCongestionRetriesForGeminiModel("gemini-3.5-flash")).toBe(1);
    expect(maxCongestionRetriesForGeminiModel("gemini-3.1-pro-preview")).toBe(1);
  });
});

describe("isGeminiCongestionError", () => {
  it("detecta mensaje típico de alta demanda", () => {
    expect(
      isGeminiCongestionError(
        new Error(
          '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'
        )
      )
    ).toBe(true);
  });

  it("no marca errores de validación como congestión", () => {
    expect(isGeminiCongestionError(new Error("INVALID_ARGUMENT: bad prompt"))).toBe(false);
  });
});
