import { afterEach, describe, expect, it, vi } from "vitest";
import { postVersionAction } from "../lib/version-action-client";

afterEach(() => vi.unstubAllGlobals());

describe("acciones de versiones desde el navegador", () => {
  const path = "/api/projects/calculation/price-bases/actions";
  const payload = {
    action: "restore",
    versionId: "base-1",
    operationId: "123e4567-e89b-42d3-a456-426614174000",
    expectedUpdatedAt: "2026-10-05T17:00:00.000Z",
  };

  it("recupera el recibo sin reenviar la mutación cuando se pierde la respuesta", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        operationId: payload.operationId, status: "applied", updatedAt: "2026-10-05T17:01:00.000Z",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await postVersionAction(path, payload);
    expect(result.status).toBe("applied");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`operationId=${payload.operationId}`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBeUndefined();
  });

  it("respeta un conflicto conocido sin hacer otra escritura", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "El cálculo cambió en otra sesión.",
    }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postVersionAction(path, payload)).rejects.toThrow(/cambió/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
