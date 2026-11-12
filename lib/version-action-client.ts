"use client";

export type VersionActionResult = {
  status: "saved" | "applied" | "no_changes";
  operationId: string | null;
  updatedAt: string;
  baseVersionId?: string;
  scenarioId?: string;
};

export async function postVersionAction(
  path: string,
  payload: { operationId: string; expectedUpdatedAt: string; [key: string]: unknown },
): Promise<VersionActionResult> {
  async function recover(): Promise<VersionActionResult> {
    const receiptUrl = `${path}?${new URLSearchParams({ operationId: payload.operationId })}`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(receiptUrl, { cache: "no-store", credentials: "same-origin" });
        if (response.ok) return await response.json() as VersionActionResult;
        if (response.status !== 404) break;
      } catch {
        // La consulta puede fallar mientras termina el POST; no reenviar la mutación.
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw new Error("No pude confirmar el resultado. Recarga el cálculo y comprueba la versión antes de volver a intentarlo.");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return recover();
  }
  let body: { error?: string; [key: string]: unknown };
  try {
    body = await response.json() as { error?: string; [key: string]: unknown };
  } catch {
    return recover();
  }
  if (!response.ok) throw new Error(body.error || "No se pudo completar la acción.");
  return body as VersionActionResult;
}
