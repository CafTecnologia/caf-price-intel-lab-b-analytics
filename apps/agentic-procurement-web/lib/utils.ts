import { createHash, randomUUID } from "node:crypto";

export function now() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function parseCop(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(".") && cleaned.includes(",")) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned.replace(",", ".");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function safeJsonFromText(raw: string): unknown {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  for (const candidate of [text, fenced]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* continue */ }
  }
  const start = Math.min(...[text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0));
  if (Number.isFinite(start)) {
    for (let end = text.length; end > start; end -= 1) {
      const candidate = text.slice(start, end).trim();
      try { return JSON.parse(candidate); } catch { /* trim suffix */ }
    }
  }
  throw new Error("El proveedor no devolvio JSON valido.");
}

export function fixMojibake(value: string) {
  if (!/[ÃÂ]/.test(value)) return value;
  try { return Buffer.from(value, "latin1").toString("utf8"); } catch { return value; }
}
