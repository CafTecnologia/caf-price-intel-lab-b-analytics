import { describe, expect, it } from "vitest";

import { safeJsonParse } from "../src/providers/shared/json";

describe("safeJsonParse", () => {
  it("repairs raw line breaks inside JSON strings", () => {
    const parsed = safeJsonParse('[{"text":"Linea 1\nLinea 2","value":1}]') as Array<{ text: string; value: number }>;

    expect(parsed).toEqual([{ text: "Linea 1\nLinea 2", value: 1 }]);
  });

  it("salvages complete objects from a truncated top-level array", () => {
    const parsed = safeJsonParse('[{"id":1},{"id":2},{"id":') as Array<{ id: number }>;

    expect(parsed).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
