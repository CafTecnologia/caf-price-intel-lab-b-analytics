import type { OfferControl } from "./financial-simulation";

export type VatControl = {
  applies: boolean;
  ratePct: number;
};

export type BulkActionScope = "all" | "over_ceiling" | "selected";

export function financialControlsStorageKey(runId: string): string {
  return `financial-simulation:${runId}`;
}

export function vatControlsStorageKey(runId: string): string {
  return `offer-presentation-vat:${runId}`;
}

export function rowSelectionStorageKey(runId: string): string {
  return `offer-selection:${runId}`;
}

export function loadFinancialControls(runId: string): Record<string, OfferControl> | null {
  return loadJson<Record<string, OfferControl>>(financialControlsStorageKey(runId));
}

export function saveFinancialControls(runId: string, controls: Record<string, OfferControl>) {
  saveJson(financialControlsStorageKey(runId), controls);
}

export function loadVatControls(runId: string): Record<string, VatControl> | null {
  return loadJson<Record<string, VatControl>>(vatControlsStorageKey(runId));
}

export function saveVatControls(runId: string, controls: Record<string, VatControl>) {
  saveJson(vatControlsStorageKey(runId), controls);
}

export function loadSelectedRows(runId: string): string[] | null {
  return loadJson<string[]>(rowSelectionStorageKey(runId));
}

export function saveSelectedRows(runId: string, rowKeys: string[]) {
  saveJson(rowSelectionStorageKey(runId), rowKeys);
}

function loadJson<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}
