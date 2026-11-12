import { describe, expect, it } from "vitest";

import { appPath, normalizeBasePath } from "../lib/base-path";

describe("financial app base path", () => {
  it("keeps development routes at the root", () => {
    expect(appPath("/api/projects", "")).toBe("/api/projects");
  });

  it("prefixes production routes without duplicate slashes", () => {
    expect(normalizeBasePath("/finanzas/")).toBe("/finanzas");
    expect(appPath("api/projects", "/finanzas/")).toBe("/finanzas/api/projects");
  });

  it("builds the public calculation URL used by the Odoo callback", () => {
    const path = appPath("/calculations/abc-123", "/finanzas");
    expect(new URL(path, "https://erp.caftecnologia.com").toString()).toBe(
      "https://erp.caftecnologia.com/finanzas/calculations/abc-123",
    );
  });
});
