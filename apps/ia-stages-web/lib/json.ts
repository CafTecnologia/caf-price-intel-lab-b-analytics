export class JsonParseError extends Error {
  raw: string;
  cleaned: string;

  constructor(message: string, raw: string, cleaned: string) {
    super(message);
    this.name = "JsonParseError";
    this.raw = raw;
    this.cleaned = cleaned;
  }
}

export function parseJsonFromModelText<T = unknown>(rawText: string): T {
  const cleaned = extractLikelyJson(rawText);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new JsonParseError("El motor IA devolvio JSON invalido.", rawText, cleaned);
  }
}

function extractLikelyJson(rawText: string) {
  let text = rawText.trim().replace(/^\uFEFF/, "");

  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    return text;
  }

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1).trim();
  }

  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    return text.slice(firstArray, lastArray + 1).trim();
  }

  return text;
}
