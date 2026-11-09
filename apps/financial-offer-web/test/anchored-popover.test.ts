import { describe, expect, it } from "vitest";
import { anchoredPopoverPosition, actionSheetPosition } from "../components/anchored-popover";

describe("menús anclados", () => {
  it("se coloca bajo el botón y dentro del viewport", () => {
    expect(anchoredPopoverPosition({ left: 700, right: 820, top: 40, bottom: 78 }, 380, 240, 900, 700))
      .toEqual({ top: 84, left: 440, width: 380 });
  });

  it("se abre arriba cuando abajo no cabe y limita el ancho móvil", () => {
    expect(anchoredPopoverPosition({ left: 260, right: 380, top: 620, bottom: 658 }, 380, 230, 390, 700))
      .toEqual({ top: 384, left: 8, width: 374 });
  });

  it("conserva visible el inicio de un panel alto cerca del resumen", () => {
    expect(anchoredPopoverPosition({ left: 592, right: 720, top: 390, bottom: 425 }, 380, 560, 1366, 700, 56))
      .toEqual({ top: 56, left: 340, width: 380 });
  });

  // Retain DEV regressions when converging with current production.
  it("se mantiene dentro del ancho y abajo sin invadir el borde", () => {
    expect(actionSheetPosition(240, 320, 640)).toEqual({ top: 392, left: 8, width: 304 });
  });

  it("mantiene accesible un panel alto con teclado y viewport desplazado", () => {
    expect(actionSheetPosition(580, 390, 300, 42)).toEqual({ top: 50, left: 8, width: 374 });
  });
});
