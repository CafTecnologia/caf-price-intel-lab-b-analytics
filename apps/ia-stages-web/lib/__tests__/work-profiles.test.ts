import { describe, expect, it } from "vitest";
import {
  getGeminiStageModelsForWorkProfile,
  WORK_PROFILE_OPTIONS
} from "@/lib/work-profiles";

describe("work profiles", () => {
  it("incluye cuatro perfiles con id estable", () => {
    expect(WORK_PROFILE_OPTIONS.map((o) => o.id)).toEqual(["default", "medio", "avanzado", "manual"]);
  });

  it("perfil estándar (default) usa modelos livianos", () => {
    const m = getGeminiStageModelsForWorkProfile("default");
    expect(m.stage1).toContain("lite");
    expect(m.stage2).toContain("lite");
    expect(m.stage3).toContain("lite");
  });

  it("perfil avanzado refuerza Etapa 3", () => {
    const m = getGeminiStageModelsForWorkProfile("avanzado");
    expect(m.stage3).toBe("gemini-3.1-pro-preview");
    expect(m.stage1).toBe("gemini-3.5-flash");
  });
});
