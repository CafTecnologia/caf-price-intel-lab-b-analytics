export type SortDirection = "asc" | "desc";

export type SortState<TColumn extends string> = {
  column: TColumn;
  direction: SortDirection;
};

export function compareBySortDirection(left: unknown, right: unknown, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftNumber = normalizeNumber(left);
  const rightNumber = normalizeNumber(right);

  if (leftNumber !== null || rightNumber !== null) {
    if (leftNumber === null) {
      return 1;
    }
    if (rightNumber === null) {
      return -1;
    }
    return (leftNumber - rightNumber) * multiplier;
  }

  const leftText = String(left ?? "").toLocaleLowerCase("es-CO");
  const rightText = String(right ?? "").toLocaleLowerCase("es-CO");
  return leftText.localeCompare(rightText, "es-CO", { numeric: true, sensitivity: "base" }) * multiplier;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const text = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
