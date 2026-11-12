export type PendingChatDelivery = { key: string; requestId: string };
type SecureRandom = { randomUUID?: () => string; getRandomValues?: (values: Uint8Array) => Uint8Array };

export function secureRequestId(source: SecureRandom | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") throw new Error("No se pudo crear un identificador seguro para el envío.");
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function withChatSendLock<T>(work: () => Promise<T> | T, release: () => void): Promise<T> {
  try { return await work(); } finally { release(); }
}

export function chatDeliveryKey(message: string, itemIds: string[]): string {
  return JSON.stringify([message.trim(), itemIds]);
}

export function pendingChatDelivery(
  current: PendingChatDelivery | null,
  message: string,
  itemIds: string[],
  createRequestId: () => string,
): PendingChatDelivery {
  const key = chatDeliveryKey(message, itemIds);
  return current?.key === key ? current : { key, requestId: createRequestId() };
}


// Odoo forwards the durable service receipt, including on idempotent retries.
export function chatDeliveryConfirmed(value: unknown, calculationId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.error) return false;
  if (receipt.queued === true) return true;
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (typeof receipt.id === "string" && uuid.test(receipt.id)
    && ["queued", "running", "completed", "failed"].includes(String(receipt.status))) return true;
  return receipt.calculationId === calculationId
    && typeof receipt.appliedJobId === "string" && uuid.test(receipt.appliedJobId)
    && ["applied", "already_applied", "no_changes"].includes(String(receipt.status));
}
