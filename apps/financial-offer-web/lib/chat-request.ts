export async function sendChatRequest(url: string, init: RequestInit, timeoutMs = 45_000): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Keep the deadline while reading the body, not just until headers arrive.
    const body = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error;
      return {};
    }) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("No se confirmó el envío a tiempo. Reintenta sin cambiar la indicación.");
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
