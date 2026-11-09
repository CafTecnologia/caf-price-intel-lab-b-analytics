import { describe, expect, it } from "vitest";

import { inheritedRetentionPatch, type RetentionDefaults } from "../lib/financial-defaults";

const defaults: RetentionDefaults = {
  applyReteFuente: true,
  reteFuenteRate: 2.5,
  reteFuenteBase: "pre_vat",
  applyReteIva: true,
  reteIvaRate: 15,
  reteIvaBase: "vat",
  applyReteIca: true,
  reteIcaRate: 0.966,
  reteIcaBase: "pre_vat",
};

describe("retention defaults", () => {
  it("inherits every enabled global retention for a new project", () => {
    expect(inheritedRetentionPatch({
      explicitReteFuente: false,
      explicitReteIva: false,
      explicitReteIca: false,
      defaults,
    })).toEqual(defaults);
  });

  it("does not override a retention explicitly supplied by the import", () => {
    const patch = inheritedRetentionPatch({
      explicitReteFuente: true,
      explicitReteIva: false,
      explicitReteIca: false,
      defaults,
    });
    expect(patch.applyReteFuente).toBeUndefined();
    expect(patch.applyReteIva).toBe(true);
  });

  it("preserves project-specific choices when an existing project is reimported", () => {
    const existing = { ...defaults, applyReteIca: false, reteIcaRate: 1.1 };
    expect(inheritedRetentionPatch({
      explicitReteFuente: false,
      explicitReteIva: false,
      explicitReteIca: false,
      defaults,
      existing,
    })).toEqual(existing);
  });
});
