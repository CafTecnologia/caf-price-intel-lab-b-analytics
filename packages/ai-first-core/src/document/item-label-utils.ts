import type { NormalizedItem } from "../../../ai-first-contracts/src/schemas/item";

const NULL_LIKE_TOKENS = new Set(["", "null", "n/a", "na", "none"]);
const NON_ITEM_LABEL_TOKENS = new Set([
  "ITEM",
  "ITEMS",
  "UND",
  "UNIDAD",
  "UNIT",
  "TOTAL",
  "SUBTOTAL",
  "VALOR",
  "IVA",
  "NOTA",
  "NOTAS",
  "OBS",
  "COP",
  "USD",
  "EUR",
]);
const OCR_DIGIT_SUBSTITUTIONS: Record<string, string[]> = {
  O: ["0"],
  Q: ["0"],
  D: ["0"],
  I: ["1"],
  L: ["1"],
  T: ["1"],
  Z: ["2"],
  S: ["5"],
  B: ["8"],
  G: ["9"],
};

function parseStrictPositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function generateNumericCandidates(label: string): number[] {
  const normalized = label.trim().toUpperCase();
  if (!normalized || normalized.length > 4 || !/^[A-Z0-9]+$/.test(normalized)) {
    return [];
  }

  let candidates = [""];
  for (const char of normalized) {
    const replacements = /\d/.test(char) ? [char] : OCR_DIGIT_SUBSTITUTIONS[char] ?? [];
    if (replacements.length === 0) {
      return [];
    }

    candidates = candidates.flatMap((prefix) => replacements.map((replacement) => `${prefix}${replacement}`));
    if (candidates.length > 32) {
      return [];
    }
  }

  return Array.from(new Set(candidates.map((candidate) => parseStrictPositiveInteger(candidate)).filter((value): value is number => value !== null)));
}

function findPreviousNumericLabel(labels: Array<string | null>, index: number): number | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const parsed = parseStrictPositiveInteger(labels[cursor]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function findNextNumericLabel(labels: Array<string | null>, index: number): number | null {
  for (let cursor = index + 1; cursor < labels.length; cursor += 1) {
    const parsed = parseStrictPositiveInteger(labels[cursor]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function chooseSequentialCandidate(candidates: number[], previous: number | null, next: number | null): number | null {
  if (previous !== null && next !== null) {
    const exactBridge = candidates.filter((candidate) => candidate === previous + 1 && candidate === next - 1);
    if (exactBridge.length === 1) {
      return exactBridge[0];
    }

    const bounded = candidates.filter((candidate) => candidate > previous && candidate < next);
    if (bounded.length === 1 && next - previous <= 3) {
      return bounded[0];
    }
  }

  if (previous !== null) {
    const nextInSequence = candidates.filter((candidate) => candidate === previous + 1);
    if (nextInSequence.length === 1) {
      return nextInSequence[0];
    }
  }

  if (next !== null) {
    const previousInSequence = candidates.filter((candidate) => candidate === next - 1);
    if (previousInSequence.length === 1) {
      return previousInSequence[0];
    }
  }

  return null;
}

export function normalizeNullLikeString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return NULL_LIKE_TOKENS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export function extractTableCells(line: string): string[] {
  if (line.includes("|")) {
    return line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
  }

  return line
    .split(/\t| {2,}|;+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

export function looksLikeItemLabelToken(token: string | null | undefined): boolean {
  const normalized = token?.trim().toUpperCase() ?? "";
  if (!normalized || normalized.length > 4 || !/^[A-Z0-9]+$/.test(normalized)) {
    return false;
  }

  if (NON_ITEM_LABEL_TOKENS.has(normalized)) {
    return false;
  }

  return true;
}

export function extractLeadingItemLabelToken(line: string): string | null {
  const leadingMatch = line.match(/^\s*([A-Z0-9]{1,4})(?:\s*(?:\||\t| {2,}|-)\s*|\s+)/i);
  const token = leadingMatch?.[1] ?? null;

  return looksLikeItemLabelToken(token) ? token!.trim() : null;
}

export function looksLikeStructuredItemStart(line: string): boolean {
  if (/^\d+(?:\.\d+)?\s*(?:\||\t| {2,}|-)/.test(line)) {
    return true;
  }

  const leadingToken = extractLeadingItemLabelToken(line);
  if (!leadingToken) {
    return false;
  }

  const cells = extractTableCells(line);
  if (cells.length >= 2 && cells[0].toUpperCase() === leadingToken.toUpperCase()) {
    return cells[1].length >= 4;
  }

  return false;
}

export function normalizeSequentialItemNumbers(items: NormalizedItem[]): NormalizedItem[] {
  const currentLabels = items.map((item) => normalizeNullLikeString(item.numero_item));

  return items.map((item, index) => {
    const normalizedUnit = normalizeNullLikeString(item.unidad_medida);
    const rawLabel = currentLabels[index];
    if (!rawLabel || parseStrictPositiveInteger(rawLabel) !== null) {
      return {
        ...item,
        numero_item: rawLabel,
        unidad_medida: normalizedUnit,
      };
    }

    const candidateNumber = chooseSequentialCandidate(
      generateNumericCandidates(rawLabel),
      findPreviousNumericLabel(currentLabels, index),
      findNextNumericLabel(currentLabels, index),
    );

    if (candidateNumber === null) {
      return {
        ...item,
        numero_item: rawLabel,
        unidad_medida: normalizedUnit,
      };
    }

    const canonicalLabel = String(candidateNumber);
    currentLabels[index] = canonicalLabel;

    return {
      ...item,
      numero_item: canonicalLabel,
      unidad_medida: normalizedUnit,
      warnings: Array.from(
        new Set([
          ...item.warnings,
          `numero_item normalized from OCR-like source label '${rawLabel}' to '${canonicalLabel}' using sequence continuity.`,
        ]),
      ),
    };
  });
}
