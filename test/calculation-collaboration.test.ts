import { describe, expect, it } from "vitest";

import { visibleStudyEvents } from "../lib/study-events";

describe("proceso visible del estudio", () => {
  it("muestra solo los eventos operativos permitidos y conserva las últimas diez entradas", () => {
    const events = [
      { type: "thinking", message: "razonamiento privado" },
      ...Array.from({ length: 11 }, (_, index) => ({ type: index % 2 ? "phase" : "source", message: `evento ${index}` })),
    ];
    const visible = visibleStudyEvents(events);
    expect(visible).toHaveLength(10);
    expect(visible[0]?.message).toBe("evento 1");
    expect(visible.some((event) => event.message === "razonamiento privado")).toBe(false);
  });
});
