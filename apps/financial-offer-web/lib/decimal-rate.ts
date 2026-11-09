export function cleanDecimalRateDraft(input: string, maxDecimals = 4): string {
  const clean = input.replace(/\s/g, "").replace(/[^\d.,]/g, "");
  const separatorIndex = clean.search(/[.,]/);
  if (separatorIndex < 0) return clean;

  const integer = clean.slice(0, separatorIndex).replace(/[.,]/g, "") || "0";
  const separator = clean[separatorIndex];
  const decimals = clean.slice(separatorIndex + 1).replace(/[.,]/g, "").slice(0, maxDecimals);
  return `${integer}${separator}${decimals}`;
}

export function parseDecimalRateDraft(input: string): number | null {
  const clean = cleanDecimalRateDraft(input);
  if (!clean || /[.,]$/.test(clean)) return null;
  const parsed = Number(clean.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function commitDecimalRateDraft(input: string): number {
  const clean = cleanDecimalRateDraft(input).replace(/[.,]$/, "");
  return parseDecimalRateDraft(clean) ?? 0;
}

export function formatDecimalRateDraft(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(value).replace(".", ",");
}
