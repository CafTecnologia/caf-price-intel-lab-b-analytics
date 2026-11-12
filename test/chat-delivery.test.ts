import { describe, expect, it } from "vitest";

import { chatDeliveryConfirmed, pendingChatDelivery, secureRequestId, withChatSendLock } from "../lib/chat-delivery";

describe("entrega idempotente del chat", () => {
  it("reutiliza el requestId para reintentar el mismo texto y referencias", () => {
    const first = pendingChatDelivery(null, " Revisar costo ", ["item-a", "item-b"], () => "request-1");
    const retry = pendingChatDelivery(first, "Revisar costo", ["item-a", "item-b"], () => "request-2");
    expect(retry).toBe(first);
    expect(retry.requestId).toBe("request-1");
  });

  it("crea otro requestId si cambia el texto o una referencia", () => {
    const first = pendingChatDelivery(null, "Revisar costo", ["item-a"], () => "request-1");
    expect(pendingChatDelivery(first, "Revisar techo", ["item-a"], () => "request-2").requestId).toBe("request-2");
    expect(pendingChatDelivery(first, "Revisar costo", ["item-b"], () => "request-3").requestId).toBe("request-3");
  });

  it("forma un UUID v4 con getRandomValues cuando randomUUID no existe", () => {
    const id = secureRequestId({ getRandomValues: (bytes) => { bytes.fill(0); return bytes; } });
    expect(id).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("libera el envío aunque falle el generador seguro", async () => {
    let released = false;
    await expect(withChatSendLock(
      () => pendingChatDelivery(null, "Revisar", [], () => secureRequestId({ getRandomValues: () => { throw new Error("RNG falló"); } })),
      () => { released = true; },
    )).rejects.toThrow("RNG falló");
    expect(released).toBe(true);
  });
});


describe("confirmacion de la respuesta real de Odoo/IA", () => {
 const id = "6be498b5-bb2a-47f8-bdf9-2f10c117ba16";
 const calculationId = "77fba0ad-eb63-4084-ab05-10aaffe835c9";
 it.each(["queued", "running", "completed", "failed"])("reconoce el recibo durable %s, tambien al reintentar", (status) => {
   expect(chatDeliveryConfirmed({ id, status }, calculationId)).toBe(true);
 });
 it("conserva compatibilidad con una confirmacion explicita", () => {
   expect(chatDeliveryConfirmed({ queued: true }, calculationId)).toBe(true);
 });
 it.each([{}, null, "ok", [], { status: "queued" }, { id, status: "unknown" }, { id: "invalid", status: "queued" }, { queued: true, error: "review_busy" }])("no inventa recepcion por un HTTP exitoso con cuerpo invalido %j", (body) => {
   expect(chatDeliveryConfirmed(body, calculationId)).toBe(false);
 });
 it("reconoce aplicar costos solo para el calculo confirmado", () => {
   const receipt = { calculationId, appliedJobId: id, status: "already_applied" };
   expect(chatDeliveryConfirmed(receipt, calculationId)).toBe(true);
   expect(chatDeliveryConfirmed(receipt, "another-calculation")).toBe(false);
 });
});
